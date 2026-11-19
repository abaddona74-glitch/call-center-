import { Injectable } from '@nestjs/common';
import { type DbHost, InjectDb } from '../../database/db.js';
import type { SituationExecutive, SituationRegion, SituationTicketFact } from './domain/ticket-situation.js';

/**
 * Read-only queries over the tickets module's tables (types: tickets.tables.ts) for the live situation board.
 * Only the columns the board needs: no descriptions, citizen numbers or organizations leave the database.
 */
@Injectable()
export class SituationRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Every ticket that is not closed. */
  notClosed(): Promise<SituationTicketFact[]> {
    return this.db
      .selectFrom('tickets')
      .select([
        'id',
        'status',
        'regionId',
        'assigneeUserId',
        'assignedAt',
        'createdAt',
        'dueAt',
        'resolvedAt',
        'callbackDueAt',
        'closedAt',
        'regionChangedAt',
      ])
      .where('status', '!=', 'closed')
      .execute();
  }

  /** Tickets created / finished by executives / closed since `from`. */
  async countsSince(from: Date): Promise<{ opened: number; resolved: number; closed: number }> {
    const row = await this.db
      .selectFrom('tickets')
      .select((eb) => [
        eb.fn.countAll<string>().filterWhere('createdAt', '>=', from).as('opened'),
        eb.fn.countAll<string>().filterWhere('resolvedAt', '>=', from).as('resolved'),
        eb.fn.countAll<string>().filterWhere('closedAt', '>=', from).as('closed'),
      ])
      .where((eb) => eb.or([eb('createdAt', '>=', from), eb('resolvedAt', '>=', from), eb('closedAt', '>=', from)]))
      .executeTakeFirst();
    return { opened: Number(row?.opened ?? 0), resolved: Number(row?.resolved ?? 0), closed: Number(row?.closed ?? 0) };
  }

  /** userId → tickets that user finished (done / rejected) since `from`. */
  async resolvedSinceBy(from: Date): Promise<Map<number, number>> {
    const rows = await this.db
      .selectFrom('tickets')
      .select((eb) => ['resolvedByUserId', eb.fn.countAll<string>().as('n')])
      .where('resolvedAt', '>=', from)
      .where('resolvedByUserId', 'is not', null)
      .groupBy('resolvedByUserId')
      .execute();
    return new Map(rows.map((r) => [Number(r.resolvedByUserId), Number(r.n)]));
  }

  /** Every region (deactivated ones too: old tickets still point at them), in directory order. */
  regions(): Promise<SituationRegion[]> {
    return this.db
      .selectFrom('ticketRegions')
      .select(['id', 'code', 'nameUz', 'nameRu'])
      .orderBy('sortOrder')
      .orderBy('nameUz')
      .execute();
  }

  /** Active users assigned to regions (`ticket_executive_regions`). */
  async executives(): Promise<SituationExecutive[]> {
    const rows = await this.db
      .selectFrom('ticketExecutiveRegions as x')
      .innerJoin('users as u', 'u.id', 'x.userId')
      .select(['u.id', 'u.username', 'x.regionId'])
      .where('u.isActive', '=', true)
      .orderBy('u.username')
      .orderBy('x.regionId')
      .execute();
    const byUser = new Map<number, SituationExecutive>();
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
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'username'])
      .where('id', 'in', [...ids])
      .execute();
    return new Map(rows.map((r) => [Number(r.id), r.username]));
  }
}
