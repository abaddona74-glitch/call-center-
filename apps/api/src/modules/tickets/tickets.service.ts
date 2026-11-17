import {
  type AddTicketCommentFieldsParsed,
  BUSINESS_TIMEZONE,
  type CreateTicketFieldsParsed,
  type SessionUser,
  type Ticket,
  type TicketAttachment,
  type TicketChangeAction,
  type TicketContext,
  type TicketDetail,
  type TicketFilter,
  type TicketListResponse,
  type TicketParty,
  type TicketPerson,
  type TicketTransition,
  type UpdateTicketRequest,
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
import { LRUCache } from 'lru-cache';
import mammoth from 'mammoth';
import { AppConfig } from '../../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { type DetectedType, detectAttachmentType, safeAttachmentName } from './domain/attachment-type.js';
import { sanitizeDocHtml } from './domain/doc-html.js';
import {
  type TicketFacts,
  type TicketViewer,
  canCreateTicket,
  canDeleteTicket,
  canEditTicket,
  canRetargetTicket,
  canTransition,
  canViewTicket,
  isMine,
  nextStatus,
  ticketParty,
  ticketPermissions,
} from './domain/ticket-policy.js';
import { TicketFilesStore } from './ticket-files.store.js';
import { type ActiveUser, TicketsRepository } from './tickets.repository.js';
import type { TicketAttachmentRow, TicketCommentRow, TicketRow } from './tickets.tables.js';

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

function facts(row: TicketRow): TicketFacts {
  return {
    status: row.status,
    creatorUserId: row.creatorUserId,
    creatorParty: row.creatorParty,
    targetAll: row.targetAll,
    targetUserId: row.targetUserId,
    assigneeUserId: row.assigneeUserId,
  };
}

function person(userId: number | null, label: string | null, extension: string | null): TicketPerson | null {
  return label === null ? null : { userId, label, extension };
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

function toAttachment(a: TicketAttachmentRow): TicketAttachment {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    kind: a.kind,
    size: a.sizeBytes,
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

const TRANSITION_ACTION: Record<TicketTransition, TicketChangeAction> = {
  accept: 'accepted',
  reject: 'rejected',
  complete: 'completed',
};

/**
 * Operator tickets (legacy viewer ticketService), rebuilt:
 * identity from the session only, explicit state machine with optimistic locking,
 * attachments checked by content and stored outside the web root, every change audited,
 * WS notices only to users who may see the ticket.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  private readonly previews = new LRUCache<number, string>({ max: 100 });
  private readonly downloadAudit = new LRUCache<string, true>({ max: 10_000, ttl: 10 * 60_000 });

  constructor(
    private readonly repo: TicketsRepository,
    private readonly files: TicketFilesStore,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  private get creatorFrom(): number {
    return this.config.get('TICKETS_CREATOR_EXTENSION_FROM');
  }

  private viewer(user: SessionUser): { v: TicketViewer; party: TicketParty } {
    const v: TicketViewer = {
      userId: user.id,
      role: user.role,
      extension: user.extension,
      permissions: user.permissions,
    };
    return { v, party: ticketParty(v, this.creatorFrom) };
  }

  private async label(user: { username: string; extension: string | null }): Promise<string> {
    if (user.extension) {
      const name = (await this.repo.operatorNames()).get(user.extension);
      if (name) return name;
    }
    return user.username;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async context(user: SessionUser): Promise<TicketContext> {
    const { party } = this.viewer(user);
    const canCreate = canCreateTicket(party);
    return {
      party,
      canCreate,
      canCleanup: party === 'admin',
      purgeCompletedAfterDays: this.config.get('TICKETS_PURGE_COMPLETED_AFTER_DAYS'),
      maxFileMb: this.config.get('TICKETS_MAX_FILE_MB'),
      assignees: canCreate ? await this.assignees() : [],
    };
  }

  /** Receivers a ticket can be addressed to. */
  async assignees(): Promise<TicketContext['assignees']> {
    const names = await this.repo.operatorNames();
    return (await this.repo.activeUsers())
      .filter((u) => u.extension && ticketParty(u, this.creatorFrom) === 'receiver')
      .map((u) => ({ userId: u.id, username: u.username, extension: u.extension as string, name: names.get(u.extension as string) ?? null }))
      .sort((a, b) => Number(a.extension) - Number(b.extension));
  }

  async list(user: SessionUser, filter: TicketFilter): Promise<TicketListResponse> {
    const { v, party } = this.viewer(user);
    const rows = await this.repo.listVisible(v, party);
    const stats = { all: rows.length, mine: 0, open: 0, accepted: 0, completed: 0, rejected: 0 };
    for (const r of rows) {
      stats[r.status]++;
      if (isMine(facts(r), v, party)) stats.mine++;
    }
    const selected = rows.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'mine') return isMine(facts(r), v, party);
      return r.status === filter;
    });
    return { items: await this.toTickets(selected, v, party), stats };
  }

  async get(user: SessionUser, id: number): Promise<TicketDetail> {
    const { v, party } = this.viewer(user);
    const row = await this.visibleRow(id, v, party);
    return this.detail(row, v, party);
  }

  private async visibleRow(id: number, v: TicketViewer, party: TicketParty): Promise<TicketRow> {
    const row = await this.repo.findById(id);
    // A ticket the user may not see is reported exactly like a missing one.
    if (!row || !canViewTicket(facts(row), v, party)) throw new NotFoundException('Ticket not found');
    return row;
  }

  private async toTickets(rows: TicketRow[], v: TicketViewer, party: TicketParty): Promise<Ticket[]> {
    const ids = rows.map((r) => r.id);
    const [attachments, counts] = await Promise.all([this.repo.attachmentsOf(ids), this.repo.commentCounts(ids)]);
    return rows.map((r) =>
      this.toTicket(
        r,
        attachments.filter((a) => a.ticketId === r.id && a.commentId === null),
        counts.get(r.id) ?? 0,
        v,
        party,
      ),
    );
  }

  private toTicket(r: TicketRow, attachments: TicketAttachmentRow[], commentCount: number, v: TicketViewer, party: TicketParty): Ticket {
    return {
      id: r.id,
      code: ticketCode(r.id),
      status: r.status,
      body: r.body,
      customerPhone: r.customerPhone,
      isUrgent: r.isUrgent,
      creator: { userId: r.creatorUserId, label: r.creatorLabel, extension: r.creatorExtension },
      target: r.targetAll ? null : person(r.targetUserId, r.targetLabel, r.targetExtension),
      assignee: person(r.assigneeUserId, r.assigneeLabel, r.assigneeExtension),
      acceptedAt: iso(r.acceptedAt),
      completedBy: person(r.completedByUserId, r.completedByLabel, r.completedByExtension),
      completedAt: iso(r.completedAt),
      rejectedBy: person(r.rejectedByUserId, r.rejectedByLabel, r.rejectedByExtension),
      rejectedAt: iso(r.rejectedAt),
      rejectReason: r.rejectReason,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
      attachments: attachments.map(toAttachment),
      commentCount,
      permissions: ticketPermissions(facts(r), v, party),
    };
  }

  private async detail(row: TicketRow, v: TicketViewer, party: TicketParty): Promise<TicketDetail> {
    const [attachments, comments] = await Promise.all([this.repo.attachmentsOf([row.id]), this.repo.commentsOf(row.id)]);
    const ticket = this.toTicket(
      row,
      attachments.filter((a) => a.commentId === null),
      comments.length,
      v,
      party,
    );
    return {
      ...ticket,
      comments: comments.map((c: TicketCommentRow) => ({
        id: c.id,
        author: { userId: c.authorUserId, label: c.authorLabel, extension: c.authorExtension },
        body: c.body,
        isSystem: c.isSystem,
        createdAt: new Date(c.createdAt).toISOString(),
        attachments: attachments.filter((a) => a.commentId === c.id).map(toAttachment),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /** `fields` were validated (and transformed) by the controller's schema — not parsed again here. */
  async create(user: SessionUser, fields: CreateTicketFieldsParsed, incoming: IncomingFile[]): Promise<TicketDetail> {
    const { v, party } = this.viewer(user);
    if (!canCreateTicket(party)) {
      await this.audit.record('tickets.denied', { details: { action: 'create', party } });
      throw new ForbiddenException('Only the ticket creators group and admins can open tickets');
    }
    const prepared = this.prepareFiles(incoming);
    if (!fields.body && prepared.length === 0) throw new BadRequestException('Write a comment or attach a file');

    const target = fields.targetUserId ? await this.receiver(fields.targetUserId) : null;
    const stored = await this.storeFiles(prepared);
    let row: TicketRow;
    try {
      row = await this.persistCreate(user, party as 'admin' | 'creator', fields, target, stored);
    } catch (err) {
      await this.files.remove(stored.map((f) => f.key));
      throw err;
    }
    await this.notify(row, 'created', user);
    return this.detail(row, v, party);
  }

  @Transactional()
  private async persistCreate(
    user: SessionUser,
    party: 'admin' | 'creator',
    fields: CreateTicketFieldsParsed,
    target: ActiveUser | null,
    stored: StoredFile[],
  ): Promise<TicketRow> {
    const row = await this.repo.insert({
      body: fields.body,
      customerPhone: fields.customerPhone ?? null,
      isUrgent: fields.isUrgent ?? false,
      creatorUserId: user.id,
      creatorLabel: await this.label(user),
      creatorExtension: user.extension,
      creatorParty: party,
      targetAll: target === null,
      targetUserId: target?.id ?? null,
      targetLabel: target ? await this.label(target) : null,
      targetExtension: target?.extension ?? null,
    });
    await this.repo.insertAttachments(stored.map((f) => this.attachmentRow(row.id, null, f, user)));
    await this.audit.record('tickets.create', {
      target: `ticket:${row.id}`,
      details: { urgent: row.isUrgent, targetUserId: row.targetUserId, files: stored.length },
    });
    return row;
  }

  async update(user: SessionUser, id: number, req: UpdateTicketRequest): Promise<TicketDetail> {
    const { v, party } = this.viewer(user);
    const updated = await this.persistUpdate(user, v, party, id, req);
    await this.notify(updated, 'updated', user);
    return this.detail(updated, v, party);
  }

  @Transactional()
  private async persistUpdate(
    user: SessionUser,
    v: TicketViewer,
    party: TicketParty,
    id: number,
    req: UpdateTicketRequest,
  ): Promise<TicketRow> {
    const row = await this.visibleRow(id, v, party);
    const f = facts(row);
    if (!canEditTicket(f, v, party)) throw new ForbiddenException('Only the creator or an admin can edit this ticket');

    const changes: Parameters<TicketsRepository['update']>[1] = {};
    if (req.body !== undefined) changes.body = req.body;
    if (req.customerPhone !== undefined) changes.customerPhone = req.customerPhone;
    if (req.isUrgent !== undefined) changes.isUrgent = req.isUrgent;
    if (req.targetUserId !== undefined) {
      const sameTarget = req.targetUserId === null ? row.targetAll : row.targetUserId === req.targetUserId;
      if (!sameTarget) {
        if (!canRetargetTicket(f, v, party)) throw new ConflictException('The ticket was already taken; it cannot be re-addressed');
        const target = req.targetUserId === null ? null : await this.receiver(req.targetUserId);
        changes.targetAll = target === null;
        changes.targetUserId = target?.id ?? null;
        changes.targetLabel = target ? await this.label(target) : null;
        changes.targetExtension = target?.extension ?? null;
      }
    }
    const updated = await this.repo.update(id, changes, row.status);
    if (!updated) throw new ConflictException('The ticket was changed by someone else; refresh and try again');
    await this.audit.record('tickets.update', { target: `ticket:${id}`, details: { fields: Object.keys(changes) } });
    return updated;
  }

  async transition(user: SessionUser, id: number, transition: TicketTransition, reason?: string): Promise<TicketDetail> {
    const { v, party } = this.viewer(user);
    const row = await this.visibleRow(id, v, party);
    const to = nextStatus(row.status, transition);
    if (!to) throw new ConflictException(`A ticket in status "${row.status}" cannot be ${TRANSITION_ACTION[transition]}`);
    if (!canTransition(facts(row), v, party, transition)) {
      // Outside the transaction, so the denial stays in the audit log.
      await this.audit.record('tickets.denied', { target: `ticket:${id}`, details: { action: transition, party } });
      throw new ForbiddenException('You are not allowed to do this with this ticket');
    }
    if (transition === 'reject' && !reason) throw new BadRequestException('A reason is required to reject a ticket');
    const updated = await this.persistTransition(user, row, transition, to, reason);
    await this.notify(updated, TRANSITION_ACTION[transition], user);
    return this.detail(updated, v, party);
  }

  /** Applies a checked transition; the status lock makes concurrent clicks fail with 409. */
  @Transactional()
  private async persistTransition(
    user: SessionUser,
    row: TicketRow,
    transition: TicketTransition,
    to: TicketRow['status'],
    reason?: string,
  ): Promise<TicketRow> {
    const id = row.id;
    const now = new Date();
    const me = { userId: user.id, label: await this.label(user), extension: user.extension };
    const changes: Parameters<TicketsRepository['update']>[1] = { status: to };
    if (transition === 'accept') {
      Object.assign(changes, {
        assigneeUserId: me.userId,
        assigneeLabel: me.label,
        assigneeExtension: me.extension,
        acceptedAt: now,
        rejectedByUserId: null,
        rejectedByLabel: null,
        rejectedByExtension: null,
        rejectedAt: null,
        rejectReason: null,
      });
    } else if (transition === 'complete') {
      Object.assign(changes, {
        completedByUserId: me.userId,
        completedByLabel: me.label,
        completedByExtension: me.extension,
        completedAt: now,
      });
    } else {
      Object.assign(changes, {
        rejectedByUserId: me.userId,
        rejectedByLabel: me.label,
        rejectedByExtension: me.extension,
        rejectedAt: now,
        rejectReason: reason,
      });
    }

    const updated = await this.repo.update(id, changes, row.status);
    if (!updated) throw new ConflictException('The ticket was changed by someone else; refresh and try again');
    if (transition === 'reject') {
      // The reason also goes into the ticket chat as a system message (legacy behaviour).
      await this.repo.insertComment({
        ticketId: id,
        authorUserId: me.userId,
        authorLabel: me.label,
        authorExtension: me.extension,
        body: reason as string,
        isSystem: true,
      });
    }
    await this.audit.record(`tickets.${transition}`, {
      target: `ticket:${id}`,
      details: { from: row.status, to, ...(reason ? { reason } : {}) },
    });
    return updated;
  }

  async comment(user: SessionUser, id: number, fields: AddTicketCommentFieldsParsed, incoming: IncomingFile[]): Promise<TicketDetail> {
    const { v, party } = this.viewer(user);
    const row = await this.visibleRow(id, v, party);
    if (!ticketPermissions(facts(row), v, party).comment) throw new ForbiddenException('You cannot comment on this ticket');
    const prepared = this.prepareFiles(incoming);
    if (!fields.body && prepared.length === 0) throw new BadRequestException('Write a message or attach a file');

    const stored = await this.storeFiles(prepared);
    let updated: TicketRow;
    try {
      updated = await this.persistComment(user, row, fields.body, stored);
    } catch (err) {
      await this.files.remove(stored.map((f) => f.key));
      throw err;
    }
    await this.notify(updated, 'commented', user);
    return this.detail(updated, v, party);
  }

  @Transactional()
  private async persistComment(user: SessionUser, row: TicketRow, body: string, stored: StoredFile[]): Promise<TicketRow> {
    const comment = await this.repo.insertComment({
      ticketId: row.id,
      authorUserId: user.id,
      authorLabel: await this.label(user),
      authorExtension: user.extension,
      body,
    });
    await this.repo.insertAttachments(stored.map((f) => this.attachmentRow(row.id, comment.id, f, user)));
    const updated = (await this.repo.update(row.id, {})) ?? row;
    await this.audit.record('tickets.comment', {
      target: `ticket:${row.id}`,
      details: { commentId: comment.id, files: stored.length },
    });
    return updated;
  }

  async remove(user: SessionUser, id: number): Promise<void> {
    const { v, party } = this.viewer(user);
    const row = await this.visibleRow(id, v, party);
    if (!canDeleteTicket(facts(row), v, party)) {
      await this.audit.record('tickets.denied', { target: `ticket:${id}`, details: { action: 'delete', party } });
      throw new ForbiddenException('Only an admin, or the creator while the ticket is new, can delete it');
    }
    const recipients = await this.recipients(row);
    const keys = await this.persistDelete(row);
    await this.files.remove(keys);
    this.realtime.broadcast('tickets.deleted', { id, code: ticketCode(id) }, { userIds: recipients });
  }

  @Transactional()
  private async persistDelete(row: TicketRow): Promise<string[]> {
    const keys = await this.repo.storageKeysOf([row.id]);
    await this.repo.delete(row.id);
    await this.audit.record('tickets.delete', {
      target: `ticket:${row.id}`,
      details: { status: row.status, creatorUserId: row.creatorUserId, files: keys.length },
    });
    return keys;
  }

  /** Admin "clean completed" button: deletes every completed ticket and its files. */
  async cleanup(user: SessionUser): Promise<number> {
    const { party } = this.viewer(user);
    if (party !== 'admin') throw new ForbiddenException('Only admins can clean up tickets');
    return this.purge(null, 'tickets.cleanup');
  }

  /** Daily: completed tickets older than TICKETS_PURGE_COMPLETED_AFTER_DAYS are deleted with their files. */
  @Cron('15 3 * * *', { timeZone: BUSINESS_TIMEZONE })
  async scheduledPurge(): Promise<void> {
    const days = this.config.get('TICKETS_PURGE_COMPLETED_AFTER_DAYS');
    if (days > 0) {
      const removed = await this.purge(new Date(Date.now() - days * 86_400_000), 'tickets.purge');
      if (removed > 0) this.logger.log(`purged ${removed} completed tickets`);
    }
    const orphans = await this.files.sweepOrphans(await this.repo.allStorageKeys(), 86_400_000);
    if (orphans > 0) this.logger.log(`removed ${orphans} orphaned attachment files`);
  }

  private async purge(before: Date | null, action: string): Promise<number> {
    const { ids, keys } = await this.persistPurge(before, action);
    await this.files.remove(keys);
    if (ids.length > 0) this.realtime.broadcast('tickets.purged', { removed: ids.length });
    return ids.length;
  }

  @Transactional()
  private async persistPurge(before: Date | null, action: string): Promise<{ ids: number[]; keys: string[] }> {
    const rows = await this.repo.completedTickets(before);
    const ids = rows.map((r) => r.id);
    const keys = await this.repo.storageKeysOf(ids);
    await this.repo.deleteMany(ids);
    await this.audit.record(action, {
      details: { removed: ids.length, ids: ids.slice(0, 200), before: before?.toISOString() ?? null },
      ...(action === 'tickets.purge' ? { actorLabel: 'system' } : {}),
    });
    return { ids, keys };
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  async attachment(user: SessionUser, ticketId: number, attachmentId: number): Promise<{ row: TicketAttachmentRow; path: string }> {
    const { v, party } = this.viewer(user);
    await this.visibleRow(ticketId, v, party);
    const row = await this.repo.findAttachment(ticketId, attachmentId);
    if (!row) throw new NotFoundException('Attachment not found');
    const key = `${user.id}:${row.id}`;
    if (!this.downloadAudit.has(key)) {
      this.downloadAudit.set(key, true);
      await this.audit.record('tickets.attachment.download', { target: `ticket:${ticketId}`, details: { attachmentId } });
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
    if (detectAttachmentType(buffer)?.kind !== 'docx') throw new UnsupportedMediaTypeException('The document cannot be previewed');
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

  private async receiver(userId: number): Promise<ActiveUser> {
    const u = await this.repo.findActiveUser(userId);
    if (!u || ticketParty(u, this.creatorFrom) !== 'receiver') {
      throw new BadRequestException('The selected operator cannot receive tickets');
    }
    return u;
  }

  /** User ids that may see the ticket (same rule as the REST endpoints). */
  private async recipients(row: TicketRow): Promise<number[]> {
    const f = facts(row);
    return (await this.repo.activeUsers())
      .filter((u) => canViewTicket(f, { userId: u.id, role: u.role, extension: u.extension }, ticketParty(u, this.creatorFrom)))
      .map((u) => u.id);
  }

  private async notify(row: TicketRow, action: TicketChangeAction, actor: SessionUser): Promise<void> {
    try {
      const userIds = await this.recipients(row);
      if (userIds.length === 0) return;
      this.realtime.broadcast(
        'tickets.changed',
        {
          id: row.id,
          code: ticketCode(row.id),
          action,
          status: row.status,
          isUrgent: row.isUrgent,
          preview: row.body.slice(0, 120),
          actor: { userId: actor.id, label: await this.label(actor) },
          targetUserId: row.targetAll ? null : row.targetUserId,
          targetLabel: row.targetAll ? null : row.targetLabel,
          creatorUserId: row.creatorUserId,
          at: new Date().toISOString(),
        },
        { userIds },
      );
    } catch (err) {
      this.logger.warn(`ticket notification failed: ${(err as Error).message}`);
    }
  }
}

function safeName(name: string): string {
  // oxlint-disable-next-line no-control-regex -- rejecting control characters on purpose
  return name.replace(/[\u0000-\u001f"\\]/g, '').slice(0, 80);
}
