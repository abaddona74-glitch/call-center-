import { type Kysely, sql } from 'kysely';

/** 3CX desktop agent: per-device API keys, last status, raw call events, releases and OTA logs. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('agent_devices')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('extension', 'text', (c) => c.notNull())
    /** sha256(key) hex — the key itself is shown once and never stored. */
    .addColumn('key_hash', 'text', (c) => c.notNull().unique())
    .addColumn('key_prefix', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_by_label', 'text')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_by_label', 'text')
    .addColumn('last_seen_at', 'timestamptz')
    .addColumn('last_ip', 'text')
    .addColumn('hostname', 'text')
    .addColumn('app_version', 'text')
    .execute();
  await sql`create index agent_devices_extension_idx on agent_devices (extension)`.execute(db);

  await db.schema
    .createTable('agent_status')
    .addColumn('extension', 'text', (c) => c.primaryKey())
    .addColumn('device_id', 'bigint', (c) => c.references('agent_devices.id').onDelete('set null'))
    .addColumn('auth_mode', 'text', (c) => c.notNull().check(sql`auth_mode in ('key', 'legacy')`))
    .addColumn('hostname', 'text')
    .addColumn('app_version', 'text')
    .addColumn('ip', 'text')
    .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('agent_call_events')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('device_id', 'bigint', (c) => c.references('agent_devices.id').onDelete('set null'))
    .addColumn('auth_mode', 'text', (c) => c.notNull().check(sql`auth_mode in ('key', 'legacy')`))
    .addColumn('extension', 'text', (c) => c.notNull())
    .addColumn('event_type', 'text', (c) =>
      c
        .notNull()
        .check(
          sql`event_type in ('RINGING', 'ANSWERED', 'ENDED', 'MISSED', 'DIALLED', 'OUTBOUND', 'INCOMING', 'REJECT', 'INFO', 'UNKNOWN')`,
        ),
    )
    .addColumn('raw_event_type', 'text', (c) => c.notNull())
    .addColumn('caller_id', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('phone', 'text')
    .addColumn('duration_sec', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('started_at', 'timestamptz')
    .addColumn('ended_at', 'timestamptz')
    .addColumn('raw_start_time', 'text', (c) => c.notNull().defaultTo(''))
    /** started_at when the agent sent a parseable time, else received_at — used for day filters. */
    .addColumn('event_at', 'timestamptz', (c) => c.notNull())
    .addColumn('hostname', 'text')
    .addColumn('details', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('ip', 'text')
    .addColumn('received_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  // Re-sent events (sync-batch replays) are ignored; different event types of one call are all kept.
  await sql`create unique index agent_call_events_dedupe_uq
            on agent_call_events (extension, event_type, caller_id, raw_start_time) where raw_start_time <> ''`.execute(
    db,
  );
  await sql`create index agent_call_events_event_at_idx on agent_call_events (event_at desc)`.execute(db);
  await sql`create index agent_call_events_ext_event_at_idx on agent_call_events (extension, event_at desc)`.execute(
    db,
  );

  await db.schema
    .createTable('agent_releases')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('version', 'text', (c) => c.notNull())
    .addColumn('release_notes', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('min_version', 'text')
    .addColumn('update_url', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_by_label', 'text')
    .execute();

  await db.schema
    .createTable('agent_update_logs')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('extension', 'text', (c) => c.notNull())
    .addColumn('device_id', 'bigint', (c) => c.references('agent_devices.id').onDelete('set null'))
    .addColumn('hostname', 'text')
    .addColumn('version', 'text')
    .addColumn('target_version', 'text')
    .addColumn('step', 'text', (c) =>
      c.notNull().check(sql`step in ('DOWNLOADING', 'DOWNLOADED', 'INSTALLING', 'SUCCESS', 'ERROR', 'INFO')`),
    )
    .addColumn('message', 'text', (c) => c.notNull().defaultTo(''))
    .execute();
  await sql`create index agent_update_logs_at_idx on agent_update_logs (at desc)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('agent_update_logs').execute();
  await db.schema.dropTable('agent_releases').execute();
  await db.schema.dropTable('agent_call_events').execute();
  await db.schema.dropTable('agent_status').execute();
  await db.schema.dropTable('agent_devices').execute();
}
