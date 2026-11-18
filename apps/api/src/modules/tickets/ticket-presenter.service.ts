import type {
  SessionUser,
  Ticket,
  TicketAttachment,
  TicketCall,
  TicketDetail,
  TicketEvent,
  TicketPerson,
  TicketRef,
} from '@cc/shared';
import { ticketActorKind, ticketCode } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { isCallbackOverdue, isOverdue } from './domain/sla.js';
import { ATTEMPT_STALE_MS } from './domain/ticket-callback.js';
import { type TicketActor, type TicketFacts, isUnread, ticketActions, ticketActor } from './domain/ticket-workflow.js';
import { TicketDirectoriesRepository } from './ticket-directories.repository.js';
import { TicketsRepository } from './tickets.repository.js';
import type {
  TicketAttachmentRow,
  TicketCallRow,
  TicketCommentRow,
  TicketEventRow,
  TicketRow,
} from './tickets.tables.js';

export interface DirectoryRefs {
  regions: Map<number, TicketRef>;
  cities: Map<number, TicketRef>;
  categories: Map<number, TicketRef>;
}

export function ticketFacts(row: TicketRow): TicketFacts {
  return {
    status: row.status,
    regionId: row.regionId,
    creatorUserId: row.creatorUserId,
    assigneeUserId: row.assigneeUserId,
    closedByUserId: row.closedByUserId,
    customerPhone: row.customerPhone,
    callbackUserIds: row.callbackUserIds ?? [],
  };
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

function person(userId: number | null, label: string | null, extension: string | null): TicketPerson | null {
  return label === null ? null : { userId, label, extension };
}

export function toAttachment(a: TicketAttachmentRow): TicketAttachment {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    kind: a.kind,
    size: a.sizeBytes,
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

/** My latest callback attempt on the ticket that still waits for an outcome. */
export function openAttemptOf(calls: TicketCallRow[], userId: number, now = new Date()): TicketCallRow | null {
  const mine = calls
    .filter(
      (c) =>
        c.kind === 'callback' &&
        c.userId === userId &&
        c.outcome === null &&
        c.attemptStatus !== 'failed' &&
        now.getTime() - new Date(c.startedAt).getTime() < ATTEMPT_STALE_MS,
    )
    .sort((a, b) => b.id - a.id);
  return mine[0] ?? null;
}

/**
 * Turns rows into API objects for one viewer: directory names, SLA, unread, last contact, and the
 * actions the viewer may take. Also resolves the viewer into a TicketActor (with their regions).
 */
@Injectable()
export class TicketPresenter {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly dirs: TicketDirectoriesRepository,
  ) {}

  async actorFor(user: Pick<SessionUser, 'id' | 'role' | 'extension'>): Promise<TicketActor> {
    const regionIds = ticketActorKind(user) === 'executive' ? await this.repo.regionIdsOf(user.id) : [];
    return ticketActor(user, regionIds);
  }

  async refs(): Promise<DirectoryRefs> {
    const [regions, cities, categories] = await Promise.all([
      this.dirs.regions(),
      this.dirs.cities(),
      this.dirs.categories(),
    ]);
    const ref = (r: { id: number; nameUz: string; nameRu: string }): [number, TicketRef] => [
      r.id,
      { id: r.id, nameUz: r.nameUz, nameRu: r.nameRu },
    ];
    return {
      regions: new Map(regions.map(ref)),
      cities: new Map(cities.map(ref)),
      categories: new Map(categories.map(ref)),
    };
  }

  /** Display label for a user: PBX name of the extension, else the username. */
  async label(user: { username: string; extension: string | null }): Promise<string> {
    if (user.extension) {
      const name = (await this.repo.operatorNames()).get(user.extension);
      if (name) return name;
    }
    return user.username;
  }

  async tickets(rows: TicketRow[], actor: TicketActor, refs?: DirectoryRefs): Promise<Ticket[]> {
    const ids = rows.map((r) => r.id);
    const [r, counts, reads, calls] = await Promise.all([
      refs ?? this.refs(),
      this.repo.countsOf(ids),
      actor.capabilities.regionAlerts ? this.repo.readsOf(actor.userId, ids) : Promise.resolve(new Map<number, Date>()),
      actor.capabilities.callback
        ? this.repo.callsOf(rows.filter((x) => x.status === 'callback_pending').map((x) => x.id))
        : Promise.resolve([]),
    ]);
    const now = new Date();
    return rows.map((row) =>
      this.ticket(row, actor, r, {
        comments: counts.comments.get(row.id) ?? 0,
        attachments: counts.attachments.get(row.id) ?? 0,
        readAt: reads.get(row.id) ?? null,
        calls: calls.filter((c) => c.ticketId === row.id),
        now,
      }),
    );
  }

  ticket(
    row: TicketRow,
    actor: TicketActor,
    refs: DirectoryRefs,
    extra: { comments: number; attachments: number; readAt: Date | null; calls: TicketCallRow[]; now: Date },
  ): Ticket {
    const facts = ticketFacts(row);
    const lastContact =
      row.lastContactLabel !== null && row.lastContactAt
        ? {
            userId: row.lastContactUserId,
            label: row.lastContactLabel,
            extension: row.lastContactExtension,
            at: new Date(row.lastContactAt).toISOString(),
          }
        : null;
    return {
      id: row.id,
      code: ticketCode(row.id),
      status: row.status,
      description: row.description,
      customerPhone: row.customerPhone,
      customerName: row.customerName,
      organization:
        row.organizationName !== null
          ? { id: row.organizationId, name: row.organizationName, tin: row.organizationTin }
          : null,
      region: row.regionId !== null ? (refs.regions.get(row.regionId) ?? null) : null,
      city: row.cityId !== null ? (refs.cities.get(row.cityId) ?? null) : null,
      category: row.categoryId !== null ? (refs.categories.get(row.categoryId) ?? null) : null,
      needsTriage: row.regionId === null && row.status !== 'closed',
      creator: { userId: row.creatorUserId, label: row.creatorLabel, extension: row.creatorExtension },
      assignee: person(row.assigneeUserId, row.assigneeLabel, row.assigneeExtension),
      assignedAt: iso(row.assignedAt),
      startedAt: iso(row.startedAt),
      resolution: row.resolution,
      resolutionNote: row.resolutionNote,
      resolvedBy: person(row.resolvedByUserId, row.resolvedByLabel, row.resolvedByExtension),
      resolvedAt: iso(row.resolvedAt),
      dueAt: iso(row.dueAt),
      overdue: isOverdue(
        {
          status: row.status,
          dueAt: row.dueAt ? new Date(row.dueAt) : null,
          resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
        },
        extra.now,
      ),
      callbackDueAt: iso(row.callbackDueAt),
      callbackOverdue: isCallbackOverdue(
        {
          callbackDueAt: row.callbackDueAt ? new Date(row.callbackDueAt) : null,
          closedAt: row.closedAt ? new Date(row.closedAt) : null,
        },
        extra.now,
      ),
      closedAt: iso(row.closedAt),
      closedBy: person(row.closedByUserId, row.closedByLabel, row.closedByExtension),
      callbackOutcome: row.callbackOutcome,
      callbackNote: row.callbackNote,
      callbackAttempts: row.callbackAttempts,
      lastContact,
      lastContactIsMe: row.lastContactUserId !== null && row.lastContactUserId === actor.userId,
      originCallId: row.originCallId,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      attachmentCount: extra.attachments,
      commentCount: extra.comments,
      unread: isUnread(actor, { ...facts, regionChangedAt: new Date(row.regionChangedAt) }, extra.readAt),
      actions: ticketActions(actor, facts, {
        hasOpenAttempt: openAttemptOf(extra.calls, actor.userId, extra.now) !== null,
      }),
    };
  }

  async detail(row: TicketRow, actor: TicketActor): Promise<TicketDetail> {
    const [refs, attachments, comments, events, calls, reads] = await Promise.all([
      this.refs(),
      this.repo.attachmentsOf([row.id]),
      this.repo.commentsOf(row.id),
      this.repo.eventsOf(row.id),
      this.repo.callsOf([row.id]),
      actor.capabilities.regionAlerts
        ? this.repo.readsOf(actor.userId, [row.id])
        : Promise.resolve(new Map<number, Date>()),
    ]);
    const ticket = this.ticket(row, actor, refs, {
      comments: comments.length,
      attachments: attachments.length,
      readAt: reads.get(row.id) ?? null,
      calls,
      now: new Date(),
    });
    return {
      ...ticket,
      attachments: attachments.filter((a) => a.commentId === null).map(toAttachment),
      comments: comments.map((c: TicketCommentRow) => ({
        id: c.id,
        author: { userId: c.authorUserId, label: c.authorLabel, extension: c.authorExtension },
        body: c.body,
        isSystem: c.isSystem,
        createdAt: new Date(c.createdAt).toISOString(),
        attachments: attachments.filter((a) => a.commentId === c.id).map(toAttachment),
      })),
      events: events.map((e) => this.event(e, refs)),
      calls: calls.map((c) => this.call(c)),
    };
  }

  private event(e: TicketEventRow, refs: DirectoryRefs): TicketEvent {
    return {
      id: e.id,
      kind: e.kind,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      fromRegion: e.fromRegionId !== null ? (refs.regions.get(e.fromRegionId) ?? null) : null,
      toRegion: e.toRegionId !== null ? (refs.regions.get(e.toRegionId) ?? null) : null,
      actor: person(e.actorUserId, e.actorLabel, e.actorExtension),
      note: e.note,
      createdAt: new Date(e.createdAt).toISOString(),
    };
  }

  private call(c: TicketCallRow): TicketCall {
    return {
      id: c.id,
      kind: c.kind,
      callId: c.callId,
      phone: c.phone,
      operator: person(c.userId, c.userLabel, c.extension),
      startedAt: new Date(c.startedAt).toISOString(),
      answeredAt: iso(c.answeredAt),
      endedAt: iso(c.endedAt),
      talkSeconds: c.talkSeconds,
      attemptStatus: c.attemptStatus,
      outcome: c.outcome,
      outcomeNote: c.outcomeNote,
      recording: {
        status: c.recordingStatus,
        fileName: c.recordingPath ? (c.recordingPath.split('/').pop() ?? null) : null,
      },
    };
  }
}
