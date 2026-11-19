import { Injectable } from '@nestjs/common';
import { type DbHost, InjectDb } from '../../database/db.js';
import type { OverviewExecutiveRef, OverviewRegionRef, OverviewTicketFact } from './domain/ticket-overview.js';

const FACT_COLUMNS = [
  'id',
  'status',
  'regionId',
  'assigneeUserId',
  'assigneeLabel',
  'resolvedByUserId',
  'resolvedByLabel',
  'resolution',
  'createdAt',
  'dueAt',
  'resolvedAt',
  'callbackDueAt',
  'closedAt',
] as const;

/**
 * Read-only queries over the tickets module's tables (types: tickets.tables.ts) for the overview dashboard.
 * Only the columns the aggregates need: no descriptions, citizen numbers or organizations leave the database.
 */
@Injectable()
export class OverviewRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Tickets created in [from, to). */
  createdBetween(from: Date, to: Date): Promise<OverviewTicketFact[]> {
    return this.db
      .selectFrom('tickets')
      .select(FACT_COLUMNS)
      .where('createdAt', '>=', from)
      .where('createdAt', '<', to)
      .execute();
  }

  /** Tickets not closed yet. */
  notClosed(): Promise<OverviewTicketFact[]> {
    return this.db.selectFrom('tickets').select(FACT_COLUMNS).where('status', '!=', 'closed').execute();
  }

  /** Ticket id → users who took it ("assigned" events), for the tickets created in [from, to). */
  async takersOfCreatedBetween(from: Date, to: Date): Promise<Map<number, number[]>> {
    const rows = await this.db
      .selectFrom('ticketEvents as e')
      .innerJoin('tickets as t', 't.id', 'e.ticketId')
      .select(['e.ticketId', 'e.actorUserId'])
      .distinct()
      .where('e.kind', '=', 'assigned')
      .where('e.actorUserId', 'is not', null)
      .where('t.createdAt', '>=', from)
      .where('t.createdAt', '<', to)
      .execute();
    const out = new Map<number, number[]>();
    for (const r of rows) {
      const list = out.get(r.ticketId) ?? [];
      list.push(Number(r.actorUserId));
      out.set(r.ticketId, list);
    }
    return out;
  }

  /** Every region (deactivated ones too: old tickets still point at them), in directory order. */
  regions(): Promise<OverviewRegionRef[]> {
    return this.db
      .selectFrom('ticketRegions')
      .select(['id', 'code', 'nameUz', 'nameRu', 'isActive'])
      .orderBy('sortOrder')
      .orderBy('nameUz')
      .execute();
  }

  /** Active users assigned to regions (`ticket_executive_regions`). */
  async executives(): Promise<OverviewExecutiveRef[]> {
    const rows = await this.db
      .selectFrom('ticketExecutiveRegions as x')
      .innerJoin('users as u', 'u.id', 'x.userId')
      .select(['u.id', 'u.username', 'x.regionId'])
      .where('u.isActive', '=', true)
      .orderBy('u.username')
      .orderBy('x.regionId')
      .execute();
    const byUser = new Map<number, OverviewExecutiveRef>();
    for (const r of rows) {
      const id = Number(r.id);
      const e = byUser.get(id) ?? { userId: id, username: r.username, regionIds: [] };
      e.regionIds.push(r.regionId);
      byUser.set(id, e);
    }
    return [...byUser.values()];
  }
}
