import { type Kysely, sql } from 'kysely';

/** Phonebook of citizens keyed by the normalized phone (legacy `client_contacts`). */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('contacts')
    .addColumn('phone', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('organization', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('language', 'text', (c) => c.check(sql`language in ('uz', 'ru', 'en', 'other')`))
    .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('telegram', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('updated_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .execute();
  await sql`create index contacts_name_idx on contacts (lower(name))`.execute(db);
  await sql`create index contacts_organization_idx on contacts (lower(organization))`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('contacts').execute();
}
