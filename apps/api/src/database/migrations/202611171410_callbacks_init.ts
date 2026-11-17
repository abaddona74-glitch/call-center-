import { type Kysely, sql } from 'kysely';

/** Callbacks (citizens to call back), their timeline and the working-calendar settings. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('callback_settings')
    .addColumn('id', 'smallint', (c) =>
      c
        .primaryKey()
        .defaultTo(1)
        .check(sql`id = 1`),
    )
    .addColumn('work_days', sql`smallint[]`, (c) => c.notNull())
    .addColumn('work_start', 'text', (c) => c.notNull())
    .addColumn('work_end', 'text', (c) => c.notNull())
    .addColumn('holidays', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('min_talk_seconds', 'integer', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .execute();
  await sql`insert into callback_settings (id, work_days, work_start, work_end, holidays, min_talk_seconds)
            values (1, '{1,2,3,4,5}', '08:00', '21:00', '{}', 10)`.execute(db);

  await db.schema
    .createTable('callbacks')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('phone', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'resolved', 'dismissed')`),
    )
    .addColumn('source', 'text', (c) =>
      c.notNull().check(sql`source in ('abandoned', 'after_hours', 'operator_missed')`),
    )
    .addColumn('sources', sql`text[]`, (c) => c.notNull())
    .addColumn('first_missed_at', 'timestamptz', (c) => c.notNull())
    .addColumn('last_missed_at', 'timestamptz', (c) => c.notNull())
    .addColumn('missed_count', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('outbound_attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_outbound_at', 'timestamptz')
    .addColumn('last_outbound_extension', 'text')
    .addColumn('last_outbound_cause', 'text', (c) =>
      c.check(sql`last_outbound_cause in ('no_answer', 'busy', 'rejected', 'unavailable', 'short_call')`),
    )
    .addColumn('assigned_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('assigned_at', 'timestamptz')
    .addColumn('closed_at', 'timestamptz')
    .addColumn('closed_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('closed_by_label', 'text')
    .addColumn('close_method', 'text', (c) => c.check(sql`close_method in ('conversation', 'manual')`))
    .addColumn('resolution_type', 'text', (c) =>
      c.check(sql`resolution_type in ('client_inbound', 'operator_outbound')`),
    )
    .addColumn('close_reason', 'text')
    .addColumn('resolved_call_id', 'text')
    .addColumn('resolved_extension', 'text')
    .addColumn('resolved_talk_seconds', 'integer')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('callbacks_closed_consistent', sql`(status = 'pending') = (closed_at is null)`)
    .execute();
  // One open callback per citizen; history rows are kept (they stop old calls from resurrecting it).
  await sql`create unique index callbacks_pending_phone_uq on callbacks (phone) where status = 'pending'`.execute(db);
  await sql`create index callbacks_phone_closed_idx on callbacks (phone, closed_at desc)`.execute(db);
  await sql`create index callbacks_last_missed_idx on callbacks (last_missed_at desc)`.execute(db);
  await sql`create index callbacks_closed_at_idx on callbacks (closed_at desc) where closed_at is not null`.execute(db);

  await db.schema
    .createTable('callback_events')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('callback_id', 'bigint', (c) => c.notNull().references('callbacks.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) =>
      c
        .notNull()
        .check(
          sql`kind in ('missed', 'outbound_failed', 'short_conversation', 'resolved', 'dismissed', 'note', 'assigned')`,
        ),
    )
    .addColumn('at', 'timestamptz', (c) => c.notNull())
    .addColumn('source', 'text', (c) => c.check(sql`source in ('abandoned', 'after_hours', 'operator_missed')`))
    /** Asterisk linkedid; makes live AMI events and the CDR reconciliation idempotent. */
    .addColumn('call_id', 'text')
    .addColumn('extension', 'text')
    .addColumn('cause', 'text', (c) =>
      c.check(sql`cause in ('no_answer', 'busy', 'rejected', 'unavailable', 'short_call')`),
    )
    .addColumn('talk_seconds', 'integer')
    .addColumn('text', 'text')
    .addColumn('actor_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('actor_label', 'text', (c) => c.notNull().defaultTo('system'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index callback_events_callback_idx on callback_events (callback_id, at)`.execute(db);
  await sql`create unique index callback_events_call_uq on callback_events (kind, call_id) where call_id is not null`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('callback_events').execute();
  await db.schema.dropTable('callbacks').execute();
  await db.schema.dropTable('callback_settings').execute();
}
