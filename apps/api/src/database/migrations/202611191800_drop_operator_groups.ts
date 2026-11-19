import { type Kysely, sql } from 'kysely';

/**
 * Operator groups are gone (owner decision 19.11.2026): every operator gets the operator role's permissions,
 * the legacy "200 group" restrictions included. The "Asosiy / Zangiota" tabs of the board, statistics and
 * exports never used this table: they come from extension ranges (`OPERATOR_GROUPS`).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('users_group_id_idx').ifExists().execute();
  await db.schema.alterTable('users').dropColumn('group_id').execute();
  await db.schema.dropTable('operator_groups').execute();
}

/** Brings back the structure and the two seeded groups; who was in which group is not restored. */
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('operator_groups')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('permissions', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index operator_groups_name_lower_uq on operator_groups (lower(name))`.execute(db);
  await db.schema
    .alterTable('users')
    .addColumn('group_id', 'bigint', (c) => c.references('operator_groups.id').onDelete('set null'))
    .execute();
  await db.schema.createIndex('users_group_id_idx').on('users').column('group_id').execute();
  await sql`
    insert into operator_groups (name, description, permissions) values
      ('Asosiy', 'Main group (legacy extensions 100-199)',
       '{"canSeeContacts":true,"canEditContacts":true,"canUseRemoteDesktop":true,"canRequestHelp":true,"canUseTools":true}'::jsonb),
      ('Zangiota', 'Zangiota 42 (legacy extensions 200+)',
       '{"canSeeContacts":false,"canEditContacts":false,"canUseRemoteDesktop":false,"canRequestHelp":false,"canUseTools":false}'::jsonb)
  `.execute(db);
}
