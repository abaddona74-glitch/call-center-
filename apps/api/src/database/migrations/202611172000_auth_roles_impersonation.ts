import { type Kysely, sql } from 'kysely';

/**
 * Owner decisions 2026-11-17 (docs/rewrite/DECISIONS.md):
 *  - roles become superuser / executive / observer / operator; existing `admin` accounts become superuser;
 *  - forced password change at next login (`must_change_password`);
 *  - "log in as another user": a separate session linked to the superuser's own session.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table users drop constraint if exists users_role_check`.execute(db);
  await sql`update users set role = 'superuser', updated_at = now() where role = 'admin'`.execute(db);
  await sql`
    alter table users add constraint users_role_check
      check (role in ('operator', 'observer', 'executive', 'superuser'))
  `.execute(db);

  await db.schema
    .alterTable('users')
    .addColumn('must_change_password', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();

  await db.schema
    .alterTable('sessions')
    // the superuser acting as this session's user; null for normal sessions
    .addColumn('impersonator_user_id', 'bigint', (c) => c.references('users.id').onDelete('cascade'))
    // the superuser's own session (by hash id); the impersonation dies with it
    .addColumn('parent_session_id', 'text')
    .execute();
  await db.schema.createIndex('sessions_parent_session_id_idx').on('sessions').column('parent_session_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('sessions_parent_session_id_idx').execute();
  await db.schema.alterTable('sessions').dropColumn('impersonator_user_id').dropColumn('parent_session_id').execute();
  await db.schema.alterTable('users').dropColumn('must_change_password').execute();
  await sql`alter table users drop constraint if exists users_role_check`.execute(db);
  // best effort: the old schema only knew operator / admin / superuser
  await sql`update users set role = 'admin' where role = 'executive'`.execute(db);
  await sql`update users set role = 'operator' where role = 'observer'`.execute(db);
  await sql`
    alter table users add constraint users_role_check check (role in ('operator', 'admin', 'superuser'))
  `.execute(db);
}
