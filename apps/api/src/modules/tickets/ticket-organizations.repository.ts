import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import type { OrganizationRecord } from './domain/organization-import.js';
import { likeEscape } from './tickets.repository.js';
import type { TicketOrganizationRow } from './tickets.tables.js';

/** Rows per INSERT … ON CONFLICT (8 parameters each, far below the 65 535 limit). */
const UPSERT_BATCH = 1000;

/** The organization registry (imported from .xlsx) and its search. */
@Injectable()
export class TicketOrganizationsRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  /**
   * Active organizations whose search text has every token. Order: the ticket's region, then
   * republic-level ones, then other regions; within that, where the first token appears earliest
   * (start of the Latin name first), then shorter names.
   */
  search(tokens: readonly string[], regionId: number | null, limit: number): Promise<TicketOrganizationRow[]> {
    let q = this.db.selectFrom('ticketOrganizations').selectAll().where('isActive', '=', true);
    for (const token of tokens) q = q.where('searchText', 'like', `%${likeEscape(token)}%`);
    if (regionId !== null) {
      q = q.orderBy(sql`case when region_id = ${regionId} then 0 when region_id is null then 1 else 2 end`);
    }
    return q
      .orderBy(sql`strpos(search_text, ${tokens[0] ?? ''})`)
      .orderBy(sql`length(name)`)
      .orderBy('name')
      .orderBy('id')
      .limit(limit)
      .execute();
  }

  findActive(id: number): Promise<TicketOrganizationRow | undefined> {
    return this.db
      .selectFrom('ticketOrganizations')
      .selectAll()
      .where('id', '=', id)
      .where('isActive', '=', true)
      .executeTakeFirst();
  }

  async summary(): Promise<{ active: number; total: number; importedAt: Date | null }> {
    const row = await this.db
      .selectFrom('ticketOrganizations')
      .select((eb) => [
        eb.fn.countAll<string>().as('total'),
        eb.fn.count<string>('id').filterWhere('isActive', '=', true).as('active'),
        eb.fn.max('importedAt').as('importedAt'),
      ])
      .executeTakeFirstOrThrow();
    return { active: Number(row.active), total: Number(row.total), importedAt: row.importedAt ?? null };
  }

  /** Inserts new registry rows and refreshes known ones (all stamped with `importedAt`). */
  async upsert(records: readonly OrganizationRecord[], importedAt: Date): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const rows = await this.db
        .insertInto('ticketOrganizations')
        .values(
          records.slice(i, i + UPSERT_BATCH).map((r) => ({ ...r, isActive: true, importedAt, updatedAt: importedAt })),
        )
        .onConflict((oc) =>
          oc.column('externalId').doUpdateSet((eb) => ({
            tin: eb.ref('excluded.tin'),
            name: eb.ref('excluded.name'),
            searchText: eb.ref('excluded.searchText'),
            regionId: eb.ref('excluded.regionId'),
            district: eb.ref('excluded.district'),
            isActive: true,
            importedAt: eb.ref('excluded.importedAt'),
            updatedAt: eb.ref('excluded.updatedAt'),
          })),
        )
        // xmax = 0 only for a freshly inserted row.
        .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
        .execute();
      const fresh = rows.filter((r) => r.inserted).length;
      added += fresh;
      updated += rows.length - fresh;
    }
    return { added, updated };
  }

  /** Organizations the latest import did not have: no longer offered (tickets keep their snapshot). */
  async deactivateMissing(importedAt: Date): Promise<number> {
    const res = await this.db
      .updateTable('ticketOrganizations')
      .set({ isActive: false, updatedAt: importedAt })
      .where('isActive', '=', true)
      .where('importedAt', '<', importedAt)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }
}
