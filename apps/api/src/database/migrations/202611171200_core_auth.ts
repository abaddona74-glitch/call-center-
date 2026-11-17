import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('username', 'text', (c) => c.notNull())
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('operator', 'admin', 'superuser')`))
    .addColumn('extension', 'text')
    .addColumn('email', 'text')
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index users_username_lower_uq on users (lower(username))`.execute(db);
  await sql`create unique index users_email_lower_uq on users (lower(email)) where email is not null`.execute(db);

  await db.schema
    .createTable('sessions')
    // sha256(token) in hex — the raw token is never stored
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'bigint', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('ip', 'text')
    .addColumn('user_agent', 'text')
    .execute();
  await db.schema.createIndex('sessions_user_id_idx').on('sessions').column('user_id').execute();
  await db.schema.createIndex('sessions_expires_at_idx').on('sessions').column('expires_at').execute();

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('actor_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('actor_label', 'text', (c) => c.notNull())
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('target', 'text')
    .addColumn('details', 'jsonb')
    .addColumn('ip', 'text')
    .addColumn('request_id', 'text')
    .execute();
  await db.schema.createIndex('audit_log_at_idx').on('audit_log').column('at').execute();
  await db.schema.createIndex('audit_log_action_idx').on('audit_log').column('action').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('audit_log').execute();
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('users').execute();
}
