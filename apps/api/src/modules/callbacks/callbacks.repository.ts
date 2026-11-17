import type {
  Callback,
  CallbackCategory,
  CallbackCounts,
  CallbackEvent,
  CallbackListQuery,
  CallbackSettings,
  CallbackSource,
} from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { type Expression, type ExpressionBuilder, type Insertable, type SqlBool, type Updateable, sql } from 'kysely';
import { type DB, type DbHost, InjectDb } from '../../database/db.js';
import type { CallbackEventsTable, CallbacksTable } from './callbacks.tables.js';
import { type CallbackState, categoryOf } from './domain/callback-rules.js';

/** Instants bounding a business day, used for "today" counters and date filters. */
export interface DayWindow {
  start: Date;
  end: Date;
}

type CallbackEb = ExpressionBuilder<DB & { c: CallbacksTable }, 'c'>;

function iso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}
function isoOrNull(d: Date | string | null): string | null {
  return d === null ? null : iso(d);
}

/** Kysely queries for callbacks. No business decisions here — see domain/callback-rules.ts. */
@Injectable()
export class CallbacksRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  // ------------------------------------------------------------ settings

  async getSettings(): Promise<CallbackSettings> {
    const row = await this.txHost.tx
      .selectFrom('callbackSettings')
      .select(['workDays', 'workStart', 'workEnd', 'holidays', 'minTalkSeconds'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return {
      workDays: row.workDays.map(Number),
      workStart: row.workStart,
      workEnd: row.workEnd,
      holidays: [...row.holidays].sort(),
      minTalkSeconds: row.minTalkSeconds,
    };
  }

  async saveSettings(s: CallbackSettings, userId: number | null): Promise<void> {
    await this.txHost.tx
      .updateTable('callbackSettings')
      .set({
        workDays: sql<number[]>`${sql.val(s.workDays)}::smallint[]`,
        workStart: s.workStart,
        workEnd: s.workEnd,
        holidays: sql<string[]>`${sql.val([...s.holidays].sort())}::text[]`,
        minTalkSeconds: s.minTalkSeconds,
        updatedAt: sql<Date>`now()`,
        updatedByUserId: userId,
      })
      .where('id', '=', 1)
      .execute();
  }

  // ------------------------------------------------------------ engine reads/writes

  async eventExists(kind: CallbackEventsTable['kind'], callId: string): Promise<boolean> {
    const row = await this.txHost.tx
      .selectFrom('callbackEvents')
      .select('id')
      .where('kind', '=', kind)
      .where('callId', '=', callId)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The open callback of a phone, row-locked until the transaction ends. */
  async findOpenForUpdate(phone: string): Promise<CallbackState | null> {
    const row = await this.txHost.tx
      .selectFrom('callbacks')
      .select(['id', 'status', 'firstMissedAt', 'lastMissedAt', 'closedAt', 'sources'])
      .where('phone', '=', phone)
      .where('status', '=', 'pending')
      .forUpdate()
      .executeTakeFirst();
    return row ? { ...row, sources: [...row.sources] } : null;
  }

  async findByIdForUpdate(
    id: number,
  ): Promise<(CallbackState & { phone: string; assignedUserId: number | null }) | null> {
    const row = await this.txHost.tx
      .selectFrom('callbacks')
      .select(['id', 'phone', 'status', 'firstMissedAt', 'lastMissedAt', 'closedAt', 'sources', 'assignedUserId'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ? { ...row, sources: [...row.sources] } : null;
  }

  async findLastClosed(phone: string): Promise<{ closedAt: Date } | null> {
    const row = await this.txHost.tx
      .selectFrom('callbacks')
      .select('closedAt')
      .where('phone', '=', phone)
      .where('status', '!=', 'pending')
      .orderBy('closedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.closedAt ? { closedAt: row.closedAt } : null;
  }

  async insertCallback(values: { phone: string; source: CallbackSource; at: Date }): Promise<number> {
    const row = await this.txHost.tx
      .insertInto('callbacks')
      .values({
        phone: values.phone,
        source: values.source,
        sources: sql<CallbackSource[]>`${sql.val([values.source])}::text[]`,
        firstMissedAt: values.at,
        lastMissedAt: values.at,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateCallback(id: number, patch: Updateable<CallbacksTable>): Promise<void> {
    const { sources, ...rest } = patch;
    await this.txHost.tx
      .updateTable('callbacks')
      .set({
        ...rest,
        ...(sources ? { sources: sql<CallbackSource[]>`${sql.val(sources)}::text[]` } : {}),
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .execute();
  }

  async incrementMissed(
    id: number,
    v: { firstMissedAt: Date; lastMissedAt: Date; sources: CallbackSource[]; isNewest: boolean },
  ): Promise<void> {
    await this.txHost.tx
      .updateTable('callbacks')
      .set((eb) => ({
        firstMissedAt: v.firstMissedAt,
        lastMissedAt: v.lastMissedAt,
        sources: sql<CallbackSource[]>`${sql.val(v.sources)}::text[]`,
        missedCount: eb('missedCount', '+', 1),
        // A new call from the citizen is a fresh request: earlier failed attempts no longer make it "unreachable".
        ...(v.isNewest ? { outboundAttempts: 0 } : {}),
        updatedAt: sql<Date>`now()`,
      }))
      .where('id', '=', id)
      .execute();
  }

  async incrementOutboundAttempts(
    id: number,
    v: { at: Date; extension: string | null; cause: CallbacksTable['lastOutboundCause'] },
  ): Promise<void> {
    await this.txHost.tx
      .updateTable('callbacks')
      .set((eb) => ({
        outboundAttempts: eb('outboundAttempts', '+', 1),
        lastOutboundAt: v.at,
        lastOutboundExtension: v.extension,
        lastOutboundCause: v.cause,
        updatedAt: sql<Date>`now()`,
      }))
      .where('id', '=', id)
      .execute();
  }

  /** Returns false when an event with the same (kind, callId) exists (idempotency). */
  async insertEvent(values: Insertable<CallbackEventsTable>): Promise<boolean> {
    const res = await this.txHost.tx
      .insertInto('callbackEvents')
      .values(values)
      .onConflict((oc) => oc.columns(['kind', 'callId']).where('callId', 'is not', null).doNothing())
      .executeTakeFirst();
    return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  async pendingIds(window: DayWindow | null): Promise<number[]> {
    let q = this.txHost.tx.selectFrom('callbacks').select('id').where('status', '=', 'pending');
    if (window) q = q.where('lastMissedAt', '>=', window.start).where('lastMissedAt', '<', window.end);
    return (await q.forUpdate().execute()).map((r) => r.id);
  }

  async userExists(userId: number): Promise<{ id: number; username: string } | null> {
    const row = await this.txHost.tx
      .selectFrom('users')
      .select(['id', 'username'])
      .where('id', '=', userId)
      .where('isActive', '=', true)
      .executeTakeFirst();
    return row ?? null;
  }

  // ------------------------------------------------------------ reads for the API

  private dateFilter(eb: CallbackEb, window: DayWindow | null): Expression<SqlBool> {
    if (!window) return eb.lit(true);
    return eb.or([
      eb.and([
        eb('c.status', '=', 'pending'),
        eb('c.lastMissedAt', '>=', window.start),
        eb('c.lastMissedAt', '<', window.end),
      ]),
      eb.and([
        eb('c.status', '!=', 'pending'),
        eb('c.closedAt', '>=', window.start),
        eb('c.closedAt', '<', window.end),
      ]),
    ]);
  }

  private categoryFilter(eb: CallbackEb, category: CallbackCategory): Expression<SqlBool> {
    switch (category) {
      case 'pending':
        return eb.and([eb('c.status', '=', 'pending'), eb('c.outboundAttempts', '=', 0)]);
      case 'unreachable':
        return eb.and([eb('c.status', '=', 'pending'), eb('c.outboundAttempts', '>', 0)]);
      case 'resolved':
        return eb('c.status', '=', 'resolved');
      case 'dismissed':
        return eb('c.status', '=', 'dismissed');
    }
  }

  private baseFilter(
    eb: CallbackEb,
    q: CallbackListQuery,
    window: DayWindow | null,
    userId: number,
  ): Expression<SqlBool> {
    const parts: Expression<SqlBool>[] = [this.dateFilter(eb, window)];
    if (q.source) parts.push(sql<SqlBool>`${q.source} = any(${eb.ref('c.sources')})`);
    if (q.phone) {
      const escaped = q.phone.replace(/[\\%_]/g, (m) => `\\${m}`);
      // Typed digits may include the country code: match the national and the 998-prefixed form.
      parts.push(eb.or([eb('c.phone', 'like', `%${escaped}%`), eb(sql`'998' || c.phone`, 'like', `%${escaped}%`)]));
    }
    if (q.assignee === 'me') parts.push(eb('c.assignedUserId', '=', userId));
    else if (q.assignee === 'none') parts.push(eb('c.assignedUserId', 'is', null));
    else if (typeof q.assignee === 'number') parts.push(eb('c.assignedUserId', '=', q.assignee));
    return eb.and(parts);
  }

  async counts(q: CallbackListQuery, window: DayWindow | null, userId: number): Promise<CallbackCounts> {
    const row = await this.txHost.tx
      .selectFrom('callbacks as c')
      .where((eb) => this.baseFilter(eb, q, window, userId))
      .select([
        sql<number>`count(*) filter (where c.status = 'pending' and c.outbound_attempts = 0)::int`.as('pending'),
        sql<number>`count(*) filter (where c.status = 'pending' and c.outbound_attempts > 0)::int`.as('unreachable'),
        sql<number>`count(*) filter (where c.status = 'resolved')::int`.as('resolved'),
        sql<number>`count(*) filter (where c.status = 'dismissed')::int`.as('dismissed'),
      ])
      .executeTakeFirstOrThrow();
    return row;
  }

  async list(
    q: CallbackListQuery,
    window: DayWindow | null,
    today: DayWindow,
    userId: number,
  ): Promise<{ items: Callback[]; total: number }> {
    const where = (eb: CallbackEb) =>
      q.category === 'all'
        ? this.baseFilter(eb, q, window, userId)
        : eb.and([this.baseFilter(eb, q, window, userId), this.categoryFilter(eb, q.category as CallbackCategory)]);

    const { total } = await this.txHost.tx
      .selectFrom('callbacks as c')
      .where(where)
      .select(sql<number>`count(*)::int`.as('total'))
      .executeTakeFirstOrThrow();

    const rows = await this.selectDto(today)
      .where(where)
      // open work first (untried before unreachable), newest first; then closed by close time
      .orderBy(sql`case when c.status = 'pending' then 0 else 1 end`)
      .orderBy(sql`case when c.outbound_attempts = 0 then 0 else 1 end`)
      .orderBy(sql`case when c.status = 'pending' then c.last_missed_at else c.closed_at end`, 'desc')
      .orderBy('c.id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items: rows.map((r) => this.toDto(r)), total };
  }

  async getMany(ids: readonly number[], today: DayWindow): Promise<Callback[]> {
    if (ids.length === 0) return [];
    const rows = await this.selectDto(today)
      .where('c.id', 'in', [...ids])
      .orderBy('c.id')
      .execute();
    return rows.map((r) => this.toDto(r));
  }

  async events(callbackId: number): Promise<CallbackEvent[]> {
    const rows = await this.txHost.tx
      .selectFrom('callbackEvents')
      .select(['id', 'kind', 'at', 'source', 'callId', 'extension', 'cause', 'talkSeconds', 'text', 'actorLabel'])
      .where('callbackId', '=', callbackId)
      .orderBy('at', 'desc')
      .orderBy('id', 'desc')
      .limit(500)
      .execute();
    return rows.map(({ actorLabel, at, ...r }) => ({ ...r, at: iso(at), actor: actorLabel }));
  }

  private selectDto(today: DayWindow) {
    return this.txHost.tx
      .selectFrom('callbacks as c')
      .leftJoin('users as au', 'au.id', 'c.assignedUserId')
      .selectAll('c')
      .select([
        'au.username as assigneeUsername',
        (eb) =>
          eb
            .selectFrom('callbackEvents as e')
            .select(sql<number>`count(*)::int`.as('n'))
            .whereRef('e.callbackId', '=', 'c.id')
            .where('e.kind', '=', 'missed')
            .where('e.at', '>=', today.start)
            .where('e.at', '<', today.end)
            .as('missedToday'),
        (eb) =>
          eb
            .selectFrom('callbackEvents as e')
            .select(sql<number>`count(*)::int`.as('n'))
            .whereRef('e.callbackId', '=', 'c.id')
            .where('e.kind', '=', 'outbound_failed')
            .where('e.at', '>=', today.start)
            .where('e.at', '<', today.end)
            .as('outboundAttemptsToday'),
        (eb) =>
          eb
            .selectFrom('callbackEvents as e')
            .select(
              sql<{
                text: string;
                at: string;
                author: string;
              }>`json_build_object('text', e.text, 'at', e.at, 'author', e.actor_label)`.as('note'),
            )
            .whereRef('e.callbackId', '=', 'c.id')
            .where('e.kind', '=', 'note')
            .orderBy('e.at', 'desc')
            .orderBy('e.id', 'desc')
            .limit(1)
            .as('lastNote'),
      ]);
  }

  private toDto(r: Awaited<ReturnType<ReturnType<CallbacksRepository['selectDto']>['execute']>>[number]): Callback {
    return {
      id: r.id,
      phone: r.phone,
      status: r.status,
      category: categoryOf(r),
      source: r.source,
      sources: [...r.sources],
      firstMissedAt: iso(r.firstMissedAt),
      lastMissedAt: iso(r.lastMissedAt),
      missedCount: r.missedCount,
      missedToday: r.missedToday ?? 0,
      outboundAttempts: r.outboundAttempts,
      outboundAttemptsToday: r.outboundAttemptsToday ?? 0,
      lastOutboundAt: isoOrNull(r.lastOutboundAt),
      lastOutboundExtension: r.lastOutboundExtension,
      lastOutboundCause: r.lastOutboundCause,
      assignee:
        r.assignedUserId !== null && r.assigneeUsername ? { id: r.assignedUserId, username: r.assigneeUsername } : null,
      lastNote: r.lastNote ? { text: r.lastNote.text, at: iso(r.lastNote.at), author: r.lastNote.author } : null,
      closedAt: isoOrNull(r.closedAt),
      closedBy: r.closedByLabel,
      closeMethod: r.closeMethod,
      resolutionType: r.resolutionType,
      closeReason: r.closeReason,
      resolvedExtension: r.resolvedExtension,
      resolvedTalkSeconds: r.resolvedTalkSeconds,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  }
}
