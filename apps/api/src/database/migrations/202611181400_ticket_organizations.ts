import { type Kysely, sql } from 'kysely';

/**
 * Organizations for tickets (owner decision 18.11.2026: a ticket names the citizen's organization).
 *
 * `ticket_organizations` holds the registry export the superuser imports from .xlsx (Settings → Tickets),
 * ~47 000 rows: upserted by the registry id, rows missing from a later file are deactivated (never
 * deleted while tickets point to them). The data is not committed: it is imported on each server.
 *
 * A ticket keeps a snapshot (name, INN) next to the optional registry id, so it reads the same after the
 * registry changes, and an organization the registry does not have can be typed by hand.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ticket_organizations')
    .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('external_id', 'text', (c) => c.notNull().unique())
    .addColumn('tin', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    // Lower-case Latin + Cyrillic + Russian names, INN and district, apostrophes removed (see organization-import.ts).
    .addColumn('search_text', 'text', (c) => c.notNull())
    .addColumn('region_id', 'integer', (c) => c.references('ticket_regions.id').onDelete('set null'))
    .addColumn('district', 'text')
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('imported_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('ticket_organizations_region_idx')
    .on('ticket_organizations')
    .column('region_id')
    .execute();
  await db.schema.createIndex('ticket_organizations_tin_idx').on('ticket_organizations').column('tin').execute();

  await db.schema
    .alterTable('tickets')
    .addColumn('organization_id', 'integer', (c) => c.references('ticket_organizations.id').onDelete('set null'))
    .addColumn('organization_name', 'text')
    .addColumn('organization_tin', 'text')
    .execute();
  await db.schema.createIndex('tickets_organization_idx').on('tickets').column('organization_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('tickets_organization_idx').execute();
  await db.schema
    .alterTable('tickets')
    .dropColumn('organization_tin')
    .dropColumn('organization_name')
    .dropColumn('organization_id')
    .execute();
  await db.schema.dropTable('ticket_organizations').execute();
}
