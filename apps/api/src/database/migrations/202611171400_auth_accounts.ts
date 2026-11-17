import { type Kysely, sql } from 'kysely';

/**
 * S1 auth/admin: operator groups, passkeys (legacy-compatible), login throttling,
 * emailed verification codes, auth settings.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // --- operator groups (replaces the hard-coded "extension >= 200" rule) ---
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
    // WebAuthn user handle. Legacy stored a UUID string and used its UTF-8 bytes as the handle.
    .addColumn('webauthn_user_id', 'uuid', (c) => c.notNull().defaultTo(sql`gen_random_uuid()`))
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('last_login_ip', 'text')
    .execute();
  await db.schema.createIndex('users_webauthn_user_id_uq').on('users').column('webauthn_user_id').unique().execute();
  await db.schema.createIndex('users_group_id_idx').on('users').column('group_id').execute();

  // --- passkeys (same id/public key/counter format as legacy auth_passkeys) ---
  await db.schema
    .createTable('passkeys')
    // credential id, base64url string
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'bigint', (c) => c.notNull().references('users.id').onDelete('cascade'))
    // COSE-encoded public key bytes
    .addColumn('public_key', 'bytea', (c) => c.notNull())
    .addColumn('counter', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('device_type', 'text')
    .addColumn('backed_up', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('transports', sql`text[]`)
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('passkeys_user_id_idx').on('passkeys').column('user_id').execute();

  // Sessions opened with a passkey end when that passkey is deleted.
  await db.schema
    .alterTable('sessions')
    .addColumn('passkey_id', 'text', (c) => c.references('passkeys.id').onDelete('cascade'))
    .execute();
  await db.schema.createIndex('sessions_passkey_id_idx').on('sessions').column('passkey_id').execute();

  // --- settings of the auth module (lockout policy) ---
  await db.schema
    .createTable('auth_settings')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'jsonb', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .execute();

  // --- failed login tracking: one row per (kind, key) ---
  await db.schema
    .createTable('auth_login_throttle')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('user_ip', 'ip', 'user')`))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('username', 'text')
    .addColumn('ip', 'text')
    .addColumn('failures', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('lock_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('first_failure_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_failure_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('auth_login_throttle_kind_key_uq', ['kind', 'key'])
    .execute();
  await db.schema.createIndex('auth_login_throttle_locked_until_idx').on('auth_login_throttle').column('locked_until').execute();

  // --- one-time codes sent by email (password reset, email binding). Only hashes are stored. ---
  await db.schema
    .createTable('auth_codes')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('user_id', 'bigint', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('purpose', 'text', (c) =>
      c.notNull().check(sql`purpose in ('password_reset', 'email_current', 'email_new')`),
    )
    // where the code was sent
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('code_hash', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('consumed_at', 'timestamptz')
    // email change: the address to bind after the current one is confirmed (null = unbind)
    .addColumn('new_email', 'text')
    // password reset: sha256 of the one-time reset token issued after the code was verified
    .addColumn('token_hash', 'text')
    .addColumn('token_expires_at', 'timestamptz')
    .addColumn('ip', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('auth_codes_user_purpose_idx').on('auth_codes').columns(['user_id', 'purpose']).execute();
  await db.schema.createIndex('auth_codes_token_hash_idx').on('auth_codes').column('token_hash').execute();

  // --- seed: the two legacy operator groups ---
  await sql`
    insert into operator_groups (name, description, permissions) values
      ('Asosiy', 'Main group (legacy extensions 100-199)',
       '{"canSeeContacts":true,"canEditContacts":true,"canUseRemoteDesktop":true,"canRequestHelp":true,"canUseTools":true}'::jsonb),
      ('Zangiota', 'Zangiota 42 (legacy extensions 200+)',
       '{"canSeeContacts":false,"canEditContacts":false,"canUseRemoteDesktop":false,"canRequestHelp":false,"canUseTools":false}'::jsonb)
  `.execute(db);
  // Keep the legacy behavior for accounts that already exist: operators with extension >= 200 -> Zangiota.
  await sql`
    update users set group_id = (select id from operator_groups where name = 'Zangiota')
    where role = 'operator'
      and (case when extension ~ '^[0-9]{1,9}$' then extension::int else 0 end) >= 200
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('auth_codes').execute();
  await db.schema.dropTable('auth_login_throttle').execute();
  await db.schema.dropTable('auth_settings').execute();
  await db.schema.alterTable('sessions').dropColumn('passkey_id').execute();
  await db.schema.dropTable('passkeys').execute();
  await db.schema
    .alterTable('users')
    .dropColumn('group_id')
    .dropColumn('webauthn_user_id')
    .dropColumn('last_login_at')
    .dropColumn('last_login_ip')
    .execute();
  await db.schema.dropTable('operator_groups').execute();
}
