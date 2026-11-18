import { Injectable } from '@nestjs/common';
import type { Insertable, Updateable } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import type {
  TicketCategoriesTable,
  TicketCategoryRow,
  TicketCitiesTable,
  TicketCityRow,
  TicketRegionRow,
  TicketRegionsTable,
} from './tickets.tables.js';

/** Regions, cities/districts, categories and executive ↔ region links. */
@Injectable()
export class TicketDirectoriesRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  regions(): Promise<TicketRegionRow[]> {
    return this.db.selectFrom('ticketRegions').selectAll().orderBy('sortOrder').orderBy('id').execute();
  }

  cities(): Promise<TicketCityRow[]> {
    return this.db.selectFrom('ticketCities').selectAll().orderBy('nameUz').execute();
  }

  categories(): Promise<TicketCategoryRow[]> {
    return this.db.selectFrom('ticketCategories').selectAll().orderBy('sortOrder').orderBy('id').execute();
  }

  findRegion(id: number): Promise<TicketRegionRow | undefined> {
    return this.db.selectFrom('ticketRegions').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findCity(id: number): Promise<TicketCityRow | undefined> {
    return this.db.selectFrom('ticketCities').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findCategory(id: number): Promise<TicketCategoryRow | undefined> {
    return this.db.selectFrom('ticketCategories').selectAll().where('id', '=', id).executeTakeFirst();
  }

  insertRegion(v: Insertable<TicketRegionsTable>): Promise<TicketRegionRow> {
    return this.db.insertInto('ticketRegions').values(v).returningAll().executeTakeFirstOrThrow();
  }

  updateRegion(id: number, v: Updateable<TicketRegionsTable>): Promise<TicketRegionRow | undefined> {
    return this.db
      .updateTable('ticketRegions')
      .set({ ...v, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteRegion(id: number): Promise<void> {
    await this.db.deleteFrom('ticketRegions').where('id', '=', id).execute();
  }

  insertCity(v: Insertable<TicketCitiesTable>): Promise<TicketCityRow> {
    return this.db.insertInto('ticketCities').values(v).returningAll().executeTakeFirstOrThrow();
  }

  updateCity(id: number, v: Updateable<TicketCitiesTable>): Promise<TicketCityRow | undefined> {
    return this.db
      .updateTable('ticketCities')
      .set({ ...v, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteCity(id: number): Promise<void> {
    await this.db.deleteFrom('ticketCities').where('id', '=', id).execute();
  }

  insertCategory(v: Insertable<TicketCategoriesTable>): Promise<TicketCategoryRow> {
    return this.db.insertInto('ticketCategories').values(v).returningAll().executeTakeFirstOrThrow();
  }

  updateCategory(id: number, v: Updateable<TicketCategoriesTable>): Promise<TicketCategoryRow | undefined> {
    return this.db
      .updateTable('ticketCategories')
      .set({ ...v, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteCategory(id: number): Promise<void> {
    await this.db.deleteFrom('ticketCategories').where('id', '=', id).execute();
  }

  /** Is a region / city / category referenced by any ticket (or timeline)? */
  async regionInUse(id: number): Promise<boolean> {
    const t = await this.db.selectFrom('tickets').select('id').where('regionId', '=', id).limit(1).executeTakeFirst();
    if (t) return true;
    const c = await this.db
      .selectFrom('ticketCities')
      .select('id')
      .where('regionId', '=', id)
      .limit(1)
      .executeTakeFirst();
    return Boolean(c);
  }

  async cityInUse(id: number): Promise<boolean> {
    return Boolean(
      await this.db.selectFrom('tickets').select('id').where('cityId', '=', id).limit(1).executeTakeFirst(),
    );
  }

  async categoryInUse(id: number): Promise<boolean> {
    return Boolean(
      await this.db.selectFrom('tickets').select('id').where('categoryId', '=', id).limit(1).executeTakeFirst(),
    );
  }

  usersWithRoles(
    roles: readonly string[],
  ): Promise<Array<{ id: number; username: string; role: string; extension: string | null }>> {
    // `role` is compared as text so S1's new role names work before and after its migration.
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'extension'])
      .where('isActive', '=', true)
      .where((eb) => eb(eb.cast('role', 'text'), 'in', roles))
      .orderBy('username')
      .execute();
  }

  findActiveUser(id: number): Promise<{ id: number; username: string; role: string } | undefined> {
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'role'])
      .where('id', '=', id)
      .where('isActive', '=', true)
      .executeTakeFirst();
  }

  async setExecutiveRegions(userId: number, regionIds: number[]): Promise<void> {
    await this.db.deleteFrom('ticketExecutiveRegions').where('userId', '=', userId).execute();
    if (regionIds.length > 0) {
      await this.db
        .insertInto('ticketExecutiveRegions')
        .values(regionIds.map((regionId) => ({ userId, regionId })))
        .execute();
    }
  }
}
