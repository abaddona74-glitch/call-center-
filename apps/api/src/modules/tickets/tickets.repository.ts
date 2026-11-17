import type { Role, TicketParty } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { Insertable, Updateable } from 'kysely';
import { LRUCache } from 'lru-cache';
import { type DbHost, InjectDb } from '../../database/db.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import type { TicketViewer } from './domain/ticket-policy.js';
import type {
  TicketAttachmentRow,
  TicketAttachmentsTable,
  TicketCommentRow,
  TicketCommentsTable,
  TicketRow,
  TicketsTable,
} from './tickets.tables.js';

export interface ActiveUser {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
}

const LIST_LIMIT = 1000;

@Injectable()
export class TicketsRepository {
  private readonly logger = new Logger(TicketsRepository.name);
  private readonly pbxNames = new LRUCache<'all', Map<string, string>>({ max: 1, ttl: 5 * 60_000 });

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    @InjectPbxDb() private readonly pbx: PbxDb,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Newest first; the visibility rule mirrors `canViewTicket` (domain/ticket-policy.ts). */
  async listVisible(viewer: TicketViewer, party: TicketParty): Promise<TicketRow[]> {
    let q = this.db.selectFrom('tickets').selectAll();
    if (party === 'creator') {
      q = q.where((eb) => eb.or([eb('creatorParty', '=', 'creator'), eb('creatorUserId', '=', viewer.userId)]));
    } else if (party === 'receiver') {
      q = q.where((eb) =>
        eb.or([eb('targetAll', '=', true), eb('targetUserId', '=', viewer.userId), eb('assigneeUserId', '=', viewer.userId)]),
      );
    } else if (party !== 'admin') {
      return [];
    }
    return q.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(LIST_LIMIT).execute();
  }

  findById(id: number): Promise<TicketRow | undefined> {
    return this.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst();
  }

  insert(values: Insertable<TicketsTable>): Promise<TicketRow> {
    return this.db.insertInto('tickets').values(values).returningAll().executeTakeFirstOrThrow();
  }

  /** Optimistic update: only applies when the status is still `expectedStatus`. */
  update(id: number, values: Updateable<TicketsTable>, expectedStatus?: TicketRow['status']): Promise<TicketRow | undefined> {
    let q = this.db.updateTable('tickets').set({ ...values, updatedAt: new Date() }).where('id', '=', id);
    if (expectedStatus) q = q.where('status', '=', expectedStatus);
    return q.returningAll().executeTakeFirst();
  }

  async delete(id: number): Promise<void> {
    await this.db.deleteFrom('tickets').where('id', '=', id).execute();
  }

  async attachmentsOf(ticketIds: number[]): Promise<TicketAttachmentRow[]> {
    if (ticketIds.length === 0) return [];
    return this.db
      .selectFrom('ticketAttachments')
      .selectAll()
      .where('ticketId', 'in', ticketIds)
      .orderBy('id')
      .execute();
  }

  async commentCounts(ticketIds: number[]): Promise<Map<number, number>> {
    if (ticketIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('ticketComments')
      .select(['ticketId', (eb) => eb.fn.countAll<number>().as('n')])
      .where('ticketId', 'in', ticketIds)
      .groupBy('ticketId')
      .execute();
    return new Map(rows.map((r) => [r.ticketId, Number(r.n)]));
  }

  commentsOf(ticketId: number): Promise<TicketCommentRow[]> {
    return this.db.selectFrom('ticketComments').selectAll().where('ticketId', '=', ticketId).orderBy('id').execute();
  }

  insertComment(values: Insertable<TicketCommentsTable>): Promise<TicketCommentRow> {
    return this.db.insertInto('ticketComments').values(values).returningAll().executeTakeFirstOrThrow();
  }

  async insertAttachments(values: Insertable<TicketAttachmentsTable>[]): Promise<void> {
    if (values.length > 0) await this.db.insertInto('ticketAttachments').values(values).execute();
  }

  findAttachment(ticketId: number, attachmentId: number): Promise<TicketAttachmentRow | undefined> {
    return this.db
      .selectFrom('ticketAttachments')
      .selectAll()
      .where('ticketId', '=', ticketId)
      .where('id', '=', attachmentId)
      .executeTakeFirst();
  }

  /** Completed tickets finished before `before` (all completed when null). */
  completedTickets(before: Date | null): Promise<TicketRow[]> {
    let q = this.db.selectFrom('tickets').selectAll().where('status', '=', 'completed');
    if (before) q = q.where('completedAt', '<', before);
    return q.execute();
  }

  async storageKeysOf(ticketIds: number[]): Promise<string[]> {
    if (ticketIds.length === 0) return [];
    const rows = await this.db.selectFrom('ticketAttachments').select('storageKey').where('ticketId', 'in', ticketIds).execute();
    return rows.map((r) => r.storageKey);
  }

  async deleteMany(ticketIds: number[]): Promise<void> {
    if (ticketIds.length > 0) await this.db.deleteFrom('tickets').where('id', 'in', ticketIds).execute();
  }

  async allStorageKeys(): Promise<Set<string>> {
    const rows = await this.db.selectFrom('ticketAttachments').select('storageKey').execute();
    return new Set(rows.map((r) => r.storageKey));
  }

  activeUsers(): Promise<ActiveUser[]> {
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'extension'])
      .where('isActive', '=', true)
      .orderBy('extension')
      .execute();
  }

  findActiveUser(id: number): Promise<ActiveUser | undefined> {
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'extension'])
      .where('id', '=', id)
      .where('isActive', '=', true)
      .executeTakeFirst();
  }

  /** Operator names by extension from the PBX (`asterisk.users`); empty when the PBX is unavailable. */
  async operatorNames(): Promise<Map<string, string>> {
    const cached = this.pbxNames.get('all');
    if (cached) return cached;
    const names = new Map<string, string>();
    if (this.pbx) {
      try {
        const rows = await this.pbx.selectFrom('asterisk.users').select(['extension', 'name']).execute();
        for (const r of rows) if (r.name?.trim()) names.set(String(r.extension), r.name.trim());
      } catch (err) {
        this.logger.warn(`PBX operator names unavailable: ${(err as Error).message}`);
      }
    }
    this.pbxNames.set('all', names);
    return names;
  }
}
