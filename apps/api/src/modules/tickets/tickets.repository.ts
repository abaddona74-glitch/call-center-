import type { TicketStatus } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import { type Insertable, type Updateable, sql } from 'kysely';
import { LRUCache } from 'lru-cache';
import { type DbHost, InjectDb } from '../../database/db.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import type { TicketActor } from './domain/ticket-workflow.js';
import type {
  TicketAttachmentRow,
  TicketAttachmentsTable,
  TicketCallRow,
  TicketCallsTable,
  TicketCommentRow,
  TicketCommentsTable,
  TicketEventRow,
  TicketEventsTable,
  TicketRow,
  TicketsTable,
} from './tickets.tables.js';

export interface ActiveUser {
  id: number;
  username: string;
  role: string;
  extension: string | null;
}

export interface ListFilter {
  status?: TicketStatus;
  regionId?: number;
  categoryId?: number;
  q?: string;
}

const LIST_LIMIT = 3000;
/** Without a status filter, closed tickets older than this are left out of lists (reports still count them). */
const CLOSED_LIST_DAYS = 90;

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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

  // --- tickets -----------------------------------------------------------------------------------

  /** Newest first. The visibility rule mirrors `canViewTicket` (domain/ticket-workflow.ts). */
  async listVisible(actor: TicketActor, filter: ListFilter): Promise<TicketRow[]> {
    let q = this.db.selectFrom('tickets').selectAll();
    if (!actor.capabilities.viewAll) {
      if (actor.kind === 'executive') {
        if (actor.regionIds.size === 0) return [];
        q = q.where('regionId', 'in', [...actor.regionIds]);
      } else if (actor.kind === 'operator') {
        q = q.where((eb) =>
          eb.or([
            eb('creatorUserId', '=', actor.userId),
            eb('status', '=', 'callback_pending'),
            eb(eb.val(actor.userId), '=', eb.fn.any('callbackUserIds')),
            eb('closedByUserId', '=', actor.userId),
          ]),
        );
      } else {
        return [];
      }
    }
    if (filter.status) q = q.where('status', '=', filter.status);
    else {
      const since = new Date(Date.now() - CLOSED_LIST_DAYS * 86_400_000);
      q = q.where((eb) => eb.or([eb('status', '<>', 'closed'), eb('closedAt', '>=', since)]));
    }
    if (filter.regionId) q = q.where('regionId', '=', filter.regionId);
    if (filter.categoryId) q = q.where('categoryId', '=', filter.categoryId);
    const text = filter.q?.trim();
    if (text) {
      const code = /^(?:tk-?)?(\d{1,9})$/i.exec(text);
      const digits = text.replace(/\D/g, '');
      q = q.where((eb) => {
        const ors = [
          eb('description', 'ilike', `%${likeEscape(text)}%`),
          eb('customerName', 'ilike', `%${likeEscape(text)}%`),
        ];
        if (code) ors.push(eb('id', '=', Number(code[1])));
        if (digits.length >= 3) ors.push(eb('customerPhone', 'like', `%${digits}%`));
        return eb.or(ors);
      });
    }
    return q.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(LIST_LIMIT).execute();
  }

  findById(id: number): Promise<TicketRow | undefined> {
    return this.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Row lock for a state change inside a transaction. */
  findForUpdate(id: number): Promise<TicketRow | undefined> {
    return this.db.selectFrom('tickets').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  insert(values: Insertable<TicketsTable>): Promise<TicketRow> {
    return this.db.insertInto('tickets').values(values).returningAll().executeTakeFirstOrThrow();
  }

  /** Optimistic update: applies only when the row still has `expectedVersion`; bumps the version. */
  update(id: number, values: Updateable<TicketsTable>, expectedVersion: number): Promise<TicketRow | undefined> {
    return this.db
      .updateTable('tickets')
      .set({ ...values, version: expectedVersion + 1, updatedAt: new Date() })
      .where('id', '=', id)
      .where('version', '=', expectedVersion)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: number): Promise<void> {
    await this.db.deleteFrom('tickets').where('id', '=', id).execute();
  }

  /** Not-closed tickets of a citizen's number. */
  openTicketsOfPhone(phone: string): Promise<TicketRow[]> {
    return this.db
      .selectFrom('tickets')
      .selectAll()
      .where('customerPhone', '=', phone)
      .where('status', '<>', 'closed')
      .orderBy('id', 'desc')
      .limit(20)
      .execute();
  }

  /** Remember that the user called this ticket back (read access after closing). No version bump. */
  async addCallbackUser(id: number, userId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({ callbackUserIds: sql<number[]>`array_append(callback_user_ids, ${userId}::integer)` })
      .where('id', '=', id)
      .where((eb) => eb.not(eb(eb.val(userId), '=', eb.fn.any('callbackUserIds'))))
      .execute();
  }

  /** Remember who last talked to the citizen on every open ticket of that number. */
  async setLastContact(
    phone: string,
    contact: { userId: number | null; label: string; extension: string | null; at: Date },
  ): Promise<number[]> {
    const rows = await this.db
      .updateTable('tickets')
      .set({
        lastContactUserId: contact.userId,
        lastContactLabel: contact.label,
        lastContactExtension: contact.extension,
        lastContactAt: contact.at,
      })
      .where('customerPhone', '=', phone)
      .where('status', '<>', 'closed')
      .where((eb) => eb.or([eb('lastContactAt', 'is', null), eb('lastContactAt', '<=', contact.at)]))
      .returning('id')
      .execute();
    return rows.map((r) => r.id);
  }

  /** Tickets created in [from, to) — for reports. */
  createdBetween(from: Date, to: Date, regionIds: number[] | null): Promise<TicketRow[]> {
    let q = this.db.selectFrom('tickets').selectAll().where('createdAt', '>=', from).where('createdAt', '<', to);
    if (regionIds) {
      if (regionIds.length === 0) return Promise.resolve([]);
      q = q.where('regionId', 'in', regionIds);
    }
    return q.execute();
  }

  // --- timeline ----------------------------------------------------------------------------------

  async insertEvents(values: Insertable<TicketEventsTable>[]): Promise<void> {
    if (values.length > 0) await this.db.insertInto('ticketEvents').values(values).execute();
  }

  eventsOf(ticketId: number): Promise<TicketEventRow[]> {
    return this.db.selectFrom('ticketEvents').selectAll().where('ticketId', '=', ticketId).orderBy('id').execute();
  }

  // --- calls / callback attempts / recordings ----------------------------------------------------

  insertCall(values: Insertable<TicketCallsTable>): Promise<TicketCallRow> {
    return this.db.insertInto('ticketCalls').values(values).returningAll().executeTakeFirstOrThrow();
  }

  updateCall(id: number, values: Updateable<TicketCallsTable>): Promise<TicketCallRow | undefined> {
    return this.db.updateTable('ticketCalls').set(values).where('id', '=', id).returningAll().executeTakeFirst();
  }

  callsOf(ticketIds: number[]): Promise<TicketCallRow[]> {
    if (ticketIds.length === 0) return Promise.resolve([]);
    return this.db.selectFrom('ticketCalls').selectAll().where('ticketId', 'in', ticketIds).orderBy('id').execute();
  }

  findCall(ticketId: number, id: number): Promise<TicketCallRow | undefined> {
    return this.db
      .selectFrom('ticketCalls')
      .selectAll()
      .where('ticketId', '=', ticketId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  callsWithCallId(callId: string): Promise<TicketCallRow[]> {
    return this.db.selectFrom('ticketCalls').selectAll().where('callId', '=', callId).execute();
  }

  /** Callback attempts still waiting for AMI (dialing/answered) on an extension, newest first. */
  openAttemptsOnExtension(extension: string, since: Date): Promise<TicketCallRow[]> {
    return this.db
      .selectFrom('ticketCalls')
      .selectAll()
      .where('kind', '=', 'callback')
      .where('extension', '=', extension)
      .where('attemptStatus', 'in', ['dialing', 'answered'])
      .where('startedAt', '>=', since)
      .orderBy('id', 'desc')
      .execute();
  }

  /** Recordings due for a lookup. */
  dueRecordings(now: Date, limit: number): Promise<TicketCallRow[]> {
    return this.db
      .selectFrom('ticketCalls')
      .selectAll()
      .where('recordingStatus', '=', 'pending')
      .where('recordingNextAt', '<=', now)
      .orderBy('recordingNextAt')
      .limit(limit)
      .execute();
  }

  // --- read state (executives' unread counter) ---------------------------------------------------

  async markRead(userId: number, ticketId: number): Promise<void> {
    await this.db
      .insertInto('ticketReads')
      .values({ userId, ticketId, readAt: new Date() })
      .onConflict((oc) => oc.columns(['userId', 'ticketId']).doUpdateSet({ readAt: new Date() }))
      .execute();
  }

  async readsOf(userId: number, ticketIds: number[]): Promise<Map<number, Date>> {
    if (ticketIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('ticketReads')
      .select(['ticketId', 'readAt'])
      .where('userId', '=', userId)
      .where('ticketId', 'in', ticketIds)
      .execute();
    return new Map(rows.map((r) => [r.ticketId, new Date(r.readAt)]));
  }

  /** `new` tickets of these regions that the user has not opened since they arrived there. */
  async unreadCount(userId: number, regionIds: number[]): Promise<number> {
    if (regionIds.length === 0) return 0;
    const row = await this.db
      .selectFrom('tickets as t')
      .leftJoin('ticketReads as r', (j) => j.onRef('r.ticketId', '=', 't.id').on('r.userId', '=', userId))
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('t.status', '=', 'new')
      .where('t.regionId', 'in', regionIds)
      .where((eb) => eb.or([eb('r.readAt', 'is', null), eb('r.readAt', '<', eb.ref('t.regionChangedAt'))]))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  // --- comments / attachments --------------------------------------------------------------------

  async attachmentsOf(ticketIds: number[]): Promise<TicketAttachmentRow[]> {
    if (ticketIds.length === 0) return [];
    return this.db
      .selectFrom('ticketAttachments')
      .selectAll()
      .where('ticketId', 'in', ticketIds)
      .orderBy('id')
      .execute();
  }

  async countsOf(ticketIds: number[]): Promise<{ comments: Map<number, number>; attachments: Map<number, number> }> {
    if (ticketIds.length === 0) return { comments: new Map(), attachments: new Map() };
    const [c, a] = await Promise.all([
      this.db
        .selectFrom('ticketComments')
        .select(['ticketId', (eb) => eb.fn.countAll<string>().as('n')])
        .where('ticketId', 'in', ticketIds)
        .groupBy('ticketId')
        .execute(),
      this.db
        .selectFrom('ticketAttachments')
        .select(['ticketId', (eb) => eb.fn.countAll<string>().as('n')])
        .where('ticketId', 'in', ticketIds)
        .groupBy('ticketId')
        .execute(),
    ]);
    return {
      comments: new Map(c.map((r) => [r.ticketId, Number(r.n)])),
      attachments: new Map(a.map((r) => [r.ticketId, Number(r.n)])),
    };
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

  async storageKeysOf(ticketIds: number[]): Promise<string[]> {
    if (ticketIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('ticketAttachments')
      .select('storageKey')
      .where('ticketId', 'in', ticketIds)
      .execute();
    return rows.map((r) => r.storageKey);
  }

  async allStorageKeys(): Promise<Set<string>> {
    const rows = await this.db.selectFrom('ticketAttachments').select('storageKey').execute();
    return new Set(rows.map((r) => r.storageKey));
  }

  // --- people ------------------------------------------------------------------------------------

  activeUsers(): Promise<ActiveUser[]> {
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'extension'])
      .where('isActive', '=', true)
      .orderBy('id')
      .execute();
  }

  activeUserByExtension(extension: string): Promise<ActiveUser | undefined> {
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'extension'])
      .where('extension', '=', extension)
      .where('isActive', '=', true)
      .orderBy('id')
      .executeTakeFirst();
  }

  async regionIdsOf(userId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('ticketExecutiveRegions')
      .select('regionId')
      .where('userId', '=', userId)
      .execute();
    return rows.map((r) => r.regionId);
  }

  /** userId → region ids, for every executive assignment. */
  async allExecutiveRegions(): Promise<Map<number, number[]>> {
    const rows = await this.db.selectFrom('ticketExecutiveRegions').select(['userId', 'regionId']).execute();
    const map = new Map<number, number[]>();
    for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r.regionId]);
    return map;
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
