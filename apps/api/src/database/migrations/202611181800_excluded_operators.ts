import { type Kysely, sql } from 'kysely';

/**
 * Excluded operators (legacy `system_settings.excluded_operators`, owner decision 2026-11-18): one settings
 * row with the extensions hidden from the operators board and the per-operator statistics. Starts empty;
 * the legacy values (118, 1111) come with the `excluded-operators` mapper of migrate-legacy.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('excluded_operators')
    .addColumn('id', 'smallint', (c) =>
      c
        .primaryKey()
        .defaultTo(1)
        .check(sql`id = 1`),
    )
    .addColumn('extensions', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .execute();
  await sql`insert into excluded_operators (id) values (1)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('excluded_operators').execute();
}
