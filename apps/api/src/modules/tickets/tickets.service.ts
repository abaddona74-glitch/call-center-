import {
  type AddTicketCommentFieldsParsed,
  BUSINESS_TIMEZONE,
  type CreateTicketFieldsParsed,
  type SessionUser,
  type TicketAction,
  type TicketCallPrefill,
  type TicketChangeAction,
  type TicketContext,
  type TicketDetail,
  type TicketEventKind,
  type TicketListQueryParsed,
  type TicketListResponse,
  type TicketView,
  TICKET_VIEWS,
  normalizeUzPhone,
  ticketCode,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Insertable, Updateable } from 'kysely';
import { LRUCache } from 'lru-cache';
import mammoth from 'mammoth';
import type { WorkingCalendar } from '../../common/time/working-calendar.js';
import { AppConfig } from '../../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service.js';
import { type DetectedType, detectAttachmentType, safeAttachmentName } from './domain/attachment-type.js';
import { sanitizeDocHtml } from './domain/doc-html.js';
import { scheduleForEndedCall, scheduleForRunningCall } from './domain/recording-link.js';
import { isCallbackOverdue, isOverdue, slaDueAt } from './domain/sla.js';
import { compareCallbackQueue } from './domain/ticket-callback.js';
import {
  type ActionInput,
  type Denial,
  type TicketActor,
  canComment,
  canDelete,
  canViewTicket,
  decideAction,
  inView,
} from './domain/ticket-workflow.js';
import { TicketCallLookup } from './ticket-call-lookup.service.js';
import { TicketDirectoriesRepository } from './ticket-directories.repository.js';
import { TicketFilesStore } from './ticket-files.store.js';
import { TicketNotifier } from './ticket-notifier.service.js';
import { TicketPresenter, ticketFacts } from './ticket-presenter.service.js';
import { TicketsRepository } from './tickets.repository.js';
import type { TicketAttachmentRow, TicketEventsTable, TicketRow, TicketsTable } from './tickets.tables.js';

/** What multer hands over (memory storage). */
export interface IncomingFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

interface PreparedFile {
  buffer: Buffer;
  type: DetectedType;
  fileName: string;
}

interface StoredFile extends PreparedFile {
  key: string;
}

export interface Me {
  userId: number;
  label: string;
  extension: string | null;
}

/** Workflow denial → HTTP error. A ticket the user may not see is reported exactly like a missing one. */
export function denialToHttp(d: Denial): Error {
  switch (d.code) {
    case 'not_found':
      return new NotFoundException(d.message);
    case 'forbidden':
      return new ForbiddenException(d.message);
    case 'conflict':
      return new ConflictException(d.message);
    default:
      return new BadRequestException(d.message);
  }
}

const ACTION_EVENT: Record<'assign' | 'start' | 'forward' | 'release', TicketEventKind> = {
  assign: 'assigned',
  start: 'started',
  forward: 'forwarded',
  release: 'released',
};
const ACTION_NOTICE: Record<ManualAction, TicketChangeAction> = {
  assign: 'assigned',
  start: 'started',
  resolve: 'done',
  reject: 'rejected',
  forward: 'forwarded',
  release: 'released',
};

/**
 * Tickets: creation (from a call in progress, a past call or by hand), the regional workflow, the chat
 * and attachments. Identity only from the session, every rule from domain/ticket-workflow.ts, every
 * change audited and announced over WS to the users who may see the ticket.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  private readonly previews = new LRUCache<number, string>({ max: 100 });
  private readonly downloadAudit = new LRUCache<string, true>({ max: 10_000, ttl: 10 * 60_000 });
  constructor(
    private readonly repo: TicketsRepository,
    private readonly dirs: TicketDirectoriesRepository,
    private readonly presenter: TicketPresenter,
    private readonly notifier: TicketNotifier,
    private readonly calls: TicketCallLookup,
    private readonly files: TicketFilesStore,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly workingCalendar: WorkingCalendarService,
  ) {}

  /** The shared working calendar (Settings → Ish vaqti). Deadlines are fixed when they are set. */
  get calendar(): WorkingCalendar {
    return this.workingCalendar.get();
  }

  async me(user: SessionUser): Promise<Me> {
    return { userId: user.id, label: await this.presenter.label(user), extension: user.extension };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async context(user: SessionUser): Promise<TicketContext> {
    const actor = await this.presenter.actorFor(user);
    return {
      kind: actor.kind,
      capabilities: actor.capabilities,
      regionIds: [...actor.regionIds].sort((a, b) => a - b),
      maxFileMb: this.config.get('TICKETS_MAX_FILE_MB'),
      slaWorkingDays: this.config.get('TICKETS_SLA_WORKING_DAYS'),
      callbackSlaWorkingDays: this.config.get('TICKETS_CALLBACK_SLA_WORKING_DAYS'),
      unread: actor.capabilities.regionAlerts ? await this.repo.unreadCount(user.id, [...actor.regionIds]) : 0,
    };
  }

  async unread(user: SessionUser): Promise<number> {
    const actor = await this.presenter.actorFor(user);
    return actor.capabilities.regionAlerts ? this.repo.unreadCount(user.id, [...actor.regionIds]) : 0;
  }

  async list(user: SessionUser, query: TicketListQueryParsed): Promise<TicketListResponse> {
    const actor = await this.presenter.actorFor(user);
    if (actor.kind === 'none') throw new ForbiddenException('No access to tickets');
    const rows = await this.repo.listVisible(actor, query);
    const now = new Date();
    const overdue = (r: TicketRow) =>
      isOverdue(
        {
          status: r.status,
          dueAt: r.dueAt ? new Date(r.dueAt) : null,
          resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
        },
        now,
      );
    const callbackOverdue = (r: TicketRow) =>
      r.status === 'callback_pending' &&
      isCallbackOverdue({ callbackDueAt: r.callbackDueAt ? new Date(r.callbackDueAt) : null, closedAt: null }, now);

    const counts = { all: 0, mine: 0, queue: 0, callback: 0, triage: 0, overdue: 0, callbackOverdue: 0 };
    for (const r of rows) {
      const f = ticketFacts(r);
      for (const v of TICKET_VIEWS) if (inView(actor, f, v)) counts[v]++;
      if (overdue(r)) counts.overdue++;
      if (callbackOverdue(r)) counts.callbackOverdue++;
    }
    const view: TicketView = query.view;
    let selected = rows.filter((r) => inView(actor, ticketFacts(r), view));
    if (query.overdue) selected = selected.filter(overdue);
    if (view === 'callback') {
      selected = selected.sort((a, b) =>
        compareCallbackQueue(
          {
            id: a.id,
            lastContactUserId: a.lastContactUserId,
            resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : null,
          },
          {
            id: b.id,
            lastContactUserId: b.lastContactUserId,
            resolvedAt: b.resolvedAt ? new Date(b.resolvedAt) : null,
          },
          actor.userId,
        ),
      );
    }
    return { items: await this.presenter.tickets(selected.slice(0, 500), actor), counts };
  }

  /** Opening a ticket marks it read (executives' unread counter). */
  async get(user: SessionUser, id: number): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.visibleRow(id, actor);
    if (actor.capabilities.regionAlerts && row.status === 'new') {
      await this.repo.markRead(user.id, row.id);
      await this.notifier.pushUnread([actor]);
    }
    return this.presenter.detail(row, actor);
  }

  async detailFor(user: SessionUser, row: TicketRow): Promise<TicketDetail> {
    return this.presenter.detail(row, await this.presenter.actorFor(user));
  }

  async visibleRow(id: number, actor: TicketActor): Promise<TicketRow> {
    const row = await this.repo.findById(id);
    if (!row || !canViewTicket(actor, ticketFacts(row))) throw new NotFoundException('Ticket not found');
    return row;
  }

  /** What the create form shows for a call (phone from the call itself) + open tickets of that number. */
  async callPrefill(user: SessionUser, callId: string): Promise<TicketCallPrefill> {
    const actor = await this.presenter.actorFor(user);
    if (!actor.capabilities.create) throw new ForbiddenException('You cannot open tickets');
    const call = await this.calls.resolve(actor, user, callId);
    const open = call.phone ? await this.repo.openTicketsOfPhone(call.phone) : [];
    return {
      callId: call.callId,
      source: call.source,
      phone: call.phone,
      startedAt: call.startedAt?.toISOString() ?? null,
      openTickets: open.map((t) => ({ id: t.id, code: ticketCode(t.id), status: t.status })),
    };
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /** `fields` were validated (and transformed) by the controller's schema. */
  async create(user: SessionUser, fields: CreateTicketFieldsParsed, incoming: IncomingFile[]): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    if (!actor.capabilities.create) {
      await this.audit.record('tickets.denied', { details: { action: 'create', kind: actor.kind } });
      throw new ForbiddenException('You cannot open tickets');
    }
    const region = await this.dirs.findRegion(fields.regionId);
    if (!region?.isActive) throw new BadRequestException('Choose an active region');
    const category = await this.dirs.findCategory(fields.categoryId);
    if (!category?.isActive) throw new BadRequestException('Choose an active category');
    const cityId = fields.cityId ?? null;
    if (cityId !== null) {
      const city = await this.dirs.findCity(cityId);
      if (!city?.isActive || city.regionId !== region.id)
        throw new BadRequestException('The city/district does not belong to the region');
    }

    const call = fields.callId ? await this.calls.resolve(actor, user, fields.callId) : null;
    const phone = call ? call.phone : normalizeUzPhone(fields.phone ?? '');
    if (!phone) {
      throw new BadRequestException(call ? 'The call has no citizen number' : "Enter the citizen's phone number");
    }

    const prepared = this.prepareFiles(incoming);
    const stored = await this.storeFiles(prepared);
    let row: TicketRow;
    try {
      row = await this.persistCreate(user, { ...fields, cityId }, phone, call, stored);
    } catch (err) {
      await this.files.remove(stored.map((f) => f.key));
      throw err;
    }
    await this.notifier.changed(null, row, 'created', { userId: user.id, label: row.creatorLabel });
    return this.presenter.detail(row, actor);
  }

  @Transactional()
  private async persistCreate(
    user: SessionUser,
    fields: CreateTicketFieldsParsed & { cityId: number | null },
    phone: string,
    call: Awaited<ReturnType<TicketCallLookup['resolve']>> | null,
    stored: StoredFile[],
  ): Promise<TicketRow> {
    const me = await this.me(user);
    const now = new Date();
    const values: Insertable<TicketsTable> = {
      status: 'new',
      description: fields.description,
      customerPhone: phone,
      customerName: fields.customerName?.trim() || null,
      regionId: fields.regionId,
      cityId: fields.cityId,
      categoryId: fields.categoryId,
      originCallId: call?.callId ?? null,
      creatorUserId: me.userId,
      creatorLabel: me.label,
      creatorExtension: me.extension,
      dueAt: slaDueAt(now, this.config.get('TICKETS_SLA_WORKING_DAYS'), this.calendar),
      regionChangedAt: now,
      createdAt: now,
    };
    if (call && (call.source === 'live' || call.answered)) {
      // The operator who opens the ticket from a call has just talked to the citizen.
      Object.assign(values, {
        lastContactUserId: me.userId,
        lastContactLabel: me.label,
        lastContactExtension: call.extension,
        lastContactAt: now,
      });
    }
    const row = await this.repo.insert(values);
    await this.repo.insertAttachments(stored.map((f) => this.attachmentRow(row.id, null, f, user)));
    await this.repo.insertEvents([this.event(row.id, 'created', me, { toStatus: 'new', toRegionId: row.regionId })]);
    if (call) {
      const schedule = call.ended ? scheduleForEndedCall(now, this.lookupMs) : scheduleForRunningCall(now);
      await this.repo.insertCall({
        ticketId: row.id,
        kind: 'origin',
        callId: call.callId,
        phone,
        extension: call.extension,
        userId: me.userId,
        userLabel: me.label,
        startedAt: call.startedAt ?? now,
        endedAt: call.ended ? now : null,
        talkSeconds: call.talkSeconds,
        recordingNextAt: schedule.nextAt,
        recordingDeadline: schedule.deadline,
      });
    }
    await this.audit.record('tickets.create', {
      target: `ticket:${row.id}`,
      details: {
        regionId: row.regionId,
        categoryId: row.categoryId,
        callId: call?.callId ?? null,
        source: call?.source ?? 'manual',
        files: stored.length,
      },
    });
    return row;
  }

  get lookupMs(): number {
    return this.config.get('TICKETS_RECORDING_LOOKUP_MINUTES') * 60_000;
  }

  // ---------------------------------------------------------------------------
  // Regional workflow
  // ---------------------------------------------------------------------------

  async act(user: SessionUser, id: number, action: ManualAction, input: ActionInput = {}): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Ticket not found');
    const decision = decideAction(actor, ticketFacts(row), action, input);
    if (!decision.ok) {
      if (decision.code === 'forbidden' || decision.code === 'not_found') {
        // Outside the transaction, so the denial stays in the audit log.
        await this.audit.record('tickets.denied', {
          target: `ticket:${id}`,
          details: { action, kind: actor.kind, reason: decision.code },
        });
      }
      throw denialToHttp(decision);
    }
    if (action === 'forward') {
      const target = await this.dirs.findRegion(input.regionId as number);
      if (!target?.isActive) throw new BadRequestException('Choose an active region');
    }
    const updated = await this.persistAction(user, row, action, input);
    // Back in the region queue it is unread for the region's executives again — but not for the one who released it.
    if (action === 'release' && actor.capabilities.regionAlerts) await this.repo.markRead(user.id, row.id);
    await this.notifier.changed(row, updated, ACTION_NOTICE[action], {
      userId: user.id,
      label: (await this.me(user)).label,
    });
    return this.presenter.detail(updated, actor);
  }

  @Transactional()
  private async persistAction(
    user: SessionUser,
    row: TicketRow,
    action: ManualAction,
    input: ActionInput,
  ): Promise<TicketRow> {
    const me = await this.me(user);
    const now = new Date();
    const note = input.note?.trim() || null;
    const changes: Updateable<TicketsTable> = {};
    const events: Insertable<TicketEventsTable>[] = [];

    switch (action) {
      case 'assign':
        Object.assign(changes, {
          status: 'assigned',
          assigneeUserId: me.userId,
          assigneeLabel: me.label,
          assigneeExtension: me.extension,
          assignedAt: now,
        });
        events.push(this.event(row.id, ACTION_EVENT.assign, me, { fromStatus: row.status, toStatus: 'assigned' }));
        break;
      case 'start':
        Object.assign(changes, { status: 'in_progress', startedAt: now });
        events.push(this.event(row.id, ACTION_EVENT.start, me, { fromStatus: row.status, toStatus: 'in_progress' }));
        break;
      case 'resolve':
      case 'reject': {
        // done / rejected go straight to the shared callback queue (the automatic "return" step).
        const resolution = action === 'resolve' ? 'done' : 'rejected';
        Object.assign(changes, {
          status: 'callback_pending',
          resolution,
          resolutionNote: note,
          resolvedByUserId: me.userId,
          resolvedByLabel: me.label,
          resolvedByExtension: me.extension,
          resolvedAt: now,
          callbackDueAt: slaDueAt(now, this.config.get('TICKETS_CALLBACK_SLA_WORKING_DAYS'), this.calendar),
        });
        events.push(this.event(row.id, resolution, me, { fromStatus: row.status, toStatus: resolution, note }));
        events.push(this.event(row.id, 'returned', null, { fromStatus: resolution, toStatus: 'callback_pending' }));
        break;
      }
      case 'forward':
        Object.assign(changes, {
          status: 'new',
          regionId: input.regionId,
          cityId: null,
          assigneeUserId: null,
          assigneeLabel: null,
          assigneeExtension: null,
          assignedAt: null,
          startedAt: null,
          regionChangedAt: now,
        });
        events.push(
          this.event(row.id, ACTION_EVENT.forward, me, {
            fromStatus: row.status,
            toStatus: 'new',
            fromRegionId: row.regionId,
            toRegionId: input.regionId ?? null,
            note,
          }),
        );
        break;
      case 'release':
        // Same region, back to its queue: nobody holds it, the SLA keeps running from creation.
        Object.assign(changes, {
          status: 'new',
          assigneeUserId: null,
          assigneeLabel: null,
          assigneeExtension: null,
          assignedAt: null,
          startedAt: null,
          regionChangedAt: now,
        });
        events.push(this.event(row.id, ACTION_EVENT.release, me, { fromStatus: row.status, toStatus: 'new', note }));
        break;
    }

    const updated = await this.repo.update(row.id, changes, row.version);
    if (!updated) throw new ConflictException('The ticket was changed by someone else; refresh and try again');
    await this.repo.insertEvents(events);
    await this.audit.record(`tickets.${action}`, {
      target: `ticket:${row.id}`,
      details: {
        from: row.status,
        to: updated.status,
        ...(action === 'forward' ? { fromRegionId: row.regionId, toRegionId: updated.regionId } : {}),
        ...(action === 'release' ? { fromAssigneeUserId: row.assigneeUserId } : {}),
        ...(note ? { note } : {}),
      },
    });
    return updated;
  }

  event(
    ticketId: number,
    kind: TicketEventKind,
    actor: Me | null,
    extra: Partial<
      Pick<Insertable<TicketEventsTable>, 'fromStatus' | 'toStatus' | 'fromRegionId' | 'toRegionId' | 'note'>
    > = {},
  ): Insertable<TicketEventsTable> {
    return {
      ticketId,
      kind,
      actorUserId: actor?.userId ?? null,
      actorLabel: actor?.label ?? null,
      actorExtension: actor?.extension ?? null,
      fromStatus: extra.fromStatus ?? null,
      toStatus: extra.toStatus ?? null,
      fromRegionId: extra.fromRegionId ?? null,
      toRegionId: extra.toRegionId ?? null,
      note: extra.note ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Chat, delete
  // ---------------------------------------------------------------------------

  async comment(
    user: SessionUser,
    id: number,
    fields: AddTicketCommentFieldsParsed,
    incoming: IncomingFile[],
  ): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.visibleRow(id, actor);
    if (!canComment(actor, ticketFacts(row))) throw new ForbiddenException('You cannot write in this ticket');
    const prepared = this.prepareFiles(incoming);
    if (!fields.body && prepared.length === 0) throw new BadRequestException('Write a message or attach a file');

    const stored = await this.storeFiles(prepared);
    try {
      await this.persistComment(user, row, fields.body, stored);
    } catch (err) {
      await this.files.remove(stored.map((f) => f.key));
      throw err;
    }
    const fresh = (await this.repo.findById(id)) ?? row;
    await this.notifier.changed(fresh, fresh, 'commented', { userId: user.id, label: (await this.me(user)).label });
    return this.presenter.detail(fresh, actor);
  }

  @Transactional()
  private async persistComment(user: SessionUser, row: TicketRow, body: string, stored: StoredFile[]): Promise<void> {
    const me = await this.me(user);
    const comment = await this.repo.insertComment({
      ticketId: row.id,
      authorUserId: me.userId,
      authorLabel: me.label,
      authorExtension: me.extension,
      body,
    });
    await this.repo.insertAttachments(stored.map((f) => this.attachmentRow(row.id, comment.id, f, user)));
    await this.audit.record('tickets.comment', {
      target: `ticket:${row.id}`,
      details: { commentId: comment.id, files: stored.length },
    });
  }

  async remove(user: SessionUser, id: number): Promise<void> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.visibleRow(id, actor);
    if (!canDelete(actor)) {
      await this.audit.record('tickets.denied', {
        target: `ticket:${id}`,
        details: { action: 'delete', kind: actor.kind },
      });
      throw new ForbiddenException('Only the superuser can delete tickets');
    }
    const keys = await this.persistDelete(row);
    await this.files.remove(keys);
    await this.notifier.changed(row, null, 'closed', { userId: user.id, label: (await this.me(user)).label });
  }

  @Transactional()
  private async persistDelete(row: TicketRow): Promise<string[]> {
    const keys = await this.repo.storageKeysOf([row.id]);
    await this.repo.delete(row.id);
    await this.audit.record('tickets.delete', {
      target: `ticket:${row.id}`,
      details: { status: row.status, regionId: row.regionId, creatorUserId: row.creatorUserId, files: keys.length },
    });
    return keys;
  }

  /** Daily: attachment files that no row references (upload saved, transaction rolled back). */
  @Cron('15 3 * * *', { timeZone: BUSINESS_TIMEZONE })
  async sweepOrphanFiles(): Promise<void> {
    const orphans = await this.files.sweepOrphans(await this.repo.allStorageKeys(), 86_400_000);
    if (orphans > 0) this.logger.log(`removed ${orphans} orphaned attachment files`);
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  async attachment(
    user: SessionUser,
    ticketId: number,
    attachmentId: number,
  ): Promise<{ row: TicketAttachmentRow; path: string }> {
    const actor = await this.presenter.actorFor(user);
    await this.visibleRow(ticketId, actor);
    const row = await this.repo.findAttachment(ticketId, attachmentId);
    if (!row) throw new NotFoundException('Attachment not found');
    const key = `${user.id}:${row.id}`;
    if (!this.downloadAudit.has(key)) {
      this.downloadAudit.set(key, true);
      await this.audit.record('tickets.attachment.download', {
        target: `ticket:${ticketId}`,
        details: { attachmentId },
      });
    }
    return { row, path: this.files.pathOf(row.storageKey) };
  }

  /** DOCX → HTML on the server (mammoth), then sanitized with a strict allow-list. */
  async docPreview(user: SessionUser, ticketId: number, attachmentId: number): Promise<{ html: string }> {
    const { row } = await this.attachment(user, ticketId, attachmentId);
    if (row.kind !== 'docx') throw new BadRequestException('Only DOCX attachments have a preview');
    const cached = this.previews.get(row.id);
    if (cached !== undefined) return { html: cached };
    const buffer = await this.files.read(row.storageKey);
    if (detectAttachmentType(buffer)?.kind !== 'docx')
      throw new UnsupportedMediaTypeException('The document cannot be previewed');
    let html: string;
    try {
      html = sanitizeDocHtml((await mammoth.convertToHtml({ buffer })).value);
    } catch (err) {
      this.logger.warn(`docx preview failed for attachment ${row.id}: ${(err as Error).message}`);
      throw new UnsupportedMediaTypeException('The document cannot be previewed');
    }
    this.previews.set(row.id, html);
    return { html };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private prepareFiles(incoming: IncomingFile[]): PreparedFile[] {
    return incoming.map((f) => {
      const type = f.size > 0 ? detectAttachmentType(f.buffer) : null;
      if (!type) {
        throw new UnsupportedMediaTypeException(
          `"${safeName(f.originalname)}": only images (PNG, JPEG, GIF, WEBP), PDF and DOCX files are allowed`,
        );
      }
      return { buffer: f.buffer, type, fileName: safeAttachmentName(f.originalname, type) };
    });
  }

  private async storeFiles(prepared: PreparedFile[]): Promise<StoredFile[]> {
    const stored: StoredFile[] = [];
    try {
      for (const p of prepared) stored.push({ ...p, key: await this.files.save(p.buffer) });
    } catch (err) {
      await this.files.remove(stored.map((s) => s.key));
      throw err;
    }
    return stored;
  }

  private attachmentRow(ticketId: number, commentId: number | null, f: StoredFile, user: SessionUser) {
    return {
      ticketId,
      commentId,
      storageKey: f.key,
      fileName: f.fileName,
      mimeType: f.type.mime,
      kind: f.type.kind,
      sizeBytes: f.buffer.length,
      uploadedByUserId: user.id,
    };
  }
}

/** For the decideAction type: the workflow actions a person triggers through this service. */
export type ManualAction = Extract<TicketAction, 'assign' | 'start' | 'resolve' | 'reject' | 'forward' | 'release'>;

function safeName(name: string): string {
  // oxlint-disable-next-line no-control-regex -- rejecting control characters on purpose
  return name.replace(/[\u0000-\u001f"\\]/g, '').slice(0, 80);
}
