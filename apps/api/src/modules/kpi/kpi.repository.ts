import { Injectable } from '@nestjs/common';
import { type DbHost, InjectDb } from '../../database/db.js';
import type {
  KpiExecutiveRef,
  KpiHoldingFact,
  KpiRegionRef,
  KpiTicketEventFact,
  KpiTicketFact,
} from './domain/executive-kpi.js';
import type { CallbackAttemptFact, OperatorTicketFact } from './domain/operator-kpi.js';

/** Event kinds that matter for the executives' figures (the rest is the operators' callback step). */
const REGION_EVENTS = ['created', 'assigned', 'done', 'rejected', 'forwarded', 'released'] as const;

/**
 * Read-only queries over the tickets module's tables (types: tickets.tables.ts) and users for the staff KPI page.
 * Only the columns the figures need: no descriptions, citizen numbers or organizations leave the database.
 */
@Injectable()
export class KpiRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Tickets created or closed in [from, to) (operators: created by / closed by). */
  operatorTickets(from: Date, to: Date): Promise<OperatorTicketFact[]> {
    return this.db
      .selectFrom('tickets')
      .select(['creatorExtension', 'createdAt', 'closedByExtension', 'closedAt', 'callbackDueAt', 'callbackOutcome'])
      .where((eb) =>
        eb.or([
          eb.and([eb('createdAt', '>=', from), eb('createdAt', '<', to)]),
          eb.and([eb('closedAt', '>=', from), eb('closedAt', '<', to)]),
        ]),
      )
      .execute();
  }

  /** Callback calls on done/rejected tickets started in [from, to). */
  callbackAttempts(from: Date, to: Date): Promise<CallbackAttemptFact[]> {
    return this.db
      .selectFrom('ticketCalls')
      .select(['extension', 'startedAt'])
      .where('kind', '=', 'callback')
      .where('startedAt', '>=', from)
      .where('startedAt', '<', to)
      .execute();
  }

  /** Every region event before `to` of the tickets that have a region event in [from, to). */
  async regionEvents(from: Date, to: Date): Promise<{ events: KpiTicketEventFact[]; tickets: KpiTicketFact[] }> {
    const touched = this.db
      .selectFrom('ticketEvents')
      .select('ticketId')
      .where('kind', 'in', REGION_EVENTS)
      .where('createdAt', '>=', from)
      .where('createdAt', '<', to);
    const [events, tickets] = await Promise.all([
      this.db
        .selectFrom('ticketEvents')
        .select(['id', 'ticketId', 'kind', 'actorUserId', 'fromRegionId', 'toRegionId', 'createdAt'])
        .where('ticketId', 'in', touched)
        .where('kind', 'in', REGION_EVENTS)
        .where('createdAt', '<', to)
        .execute(),
      this.db.selectFrom('tickets').select(['id', 'regionId', 'dueAt']).where('id', 'in', touched).execute(),
    ]);
    return {
      events: events.map((e) => ({
        ...e,
        id: Number(e.id),
        actorUserId: e.actorUserId === null ? null : Number(e.actorUserId),
      })),
      tickets,
    };
  }

  /** Tickets held right now (assigned / in progress). */
  async holding(): Promise<KpiHoldingFact[]> {
    const rows = await this.db
      .selectFrom('tickets')
      .select(['id', 'assigneeUserId', 'regionId', 'dueAt'])
      .where('status', 'in', ['assigned', 'in_progress'])
      .where('assigneeUserId', 'is not', null)
      .execute();
    return rows.map((r) => ({ ...r, assigneeUserId: Number(r.assigneeUserId) }));
  }

  /** Every region (deactivated ones too: old tickets still point at them), in directory order. */
  regions(): Promise<KpiRegionRef[]> {
    return this.db
      .selectFrom('ticketRegions')
      .select(['id', 'code', 'nameUz', 'nameRu'])
      .orderBy('sortOrder')
      .orderBy('nameUz')
      .execute();
  }

  /** Active users assigned to regions (`ticket_executive_regions`). */
  async executives(): Promise<KpiExecutiveRef[]> {
    const rows = await this.db
      .selectFrom('ticketExecutiveRegions as x')
      .innerJoin('users as u', 'u.id', 'x.userId')
      .select(['u.id', 'u.username', 'x.regionId'])
      .where('u.isActive', '=', true)
      .orderBy('u.username')
      .orderBy('x.regionId')
      .execute();
    const byUser = new Map<number, KpiExecutiveRef>();
    for (const r of rows) {
      const id = Number(r.id);
      const e = byUser.get(id) ?? { userId: id, username: r.username, regionIds: [] };
      e.regionIds.push(r.regionId);
      byUser.set(id, e);
    }
    return [...byUser.values()];
  }

  /** userId → username. */
  async usernames(ids: readonly number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.selectFrom('users').select(['id', 'username']).where('id', 'in', ids).execute();
    return new Map(rows.map((r) => [Number(r.id), r.username]));
  }

  /** Extension → username of the users that have an extension (names while the PBX directory is unavailable). */
  async usernamesByExtension(): Promise<Map<string, string>> {
    const rows = await this.db
      .selectFrom('users')
      .select(['extension', 'username'])
      .where('extension', 'is not', null)
      .where('isActive', '=', true)
      .execute();
    return new Map(rows.map((r) => [r.extension as string, r.username]));
  }
}
