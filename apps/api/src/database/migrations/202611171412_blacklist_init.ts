import { type Kysely, sql } from 'kysely';

/**
 * Blocked numbers. Postgres holds the desired state; the AstDB families (`blacklist`,
 * `blacklist_<ext>`) are brought in line through AMI and `sync_state` tracks that.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('blocked_numbers')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('number', 'text', (c) => c.notNull())
    .addColumn('variants', sql`text[]`, (c) => c.notNull())
    .addColumn('scope', 'text', (c) => c.notNull().check(sql`scope in ('global', 'operator')`))
    .addColumn('extension', 'text')
    .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('sync_state', 'text', (c) =>
      c
        .notNull()
        .defaultTo('pending')
        .check(sql`sync_state in ('synced', 'pending', 'error', 'removing')`),
    )
    .addColumn('sync_error', 'text')
    .addColumn('synced_at', 'timestamptz')
    .addColumn('created_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_by_label', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('blocked_numbers_scope_extension', sql`(scope = 'operator') = (extension is not null)`)
    .execute();
  await sql`create unique index blocked_numbers_uq on blocked_numbers (number, scope, coalesce(extension, ''))`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('blocked_numbers').execute();
}
