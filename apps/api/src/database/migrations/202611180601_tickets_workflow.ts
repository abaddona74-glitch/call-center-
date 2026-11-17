import { type Kysely, sql } from 'kysely';

/**
 * Ticket workflow (docs/rewrite/TICKETS.md) replaces the legacy viewer board model of 202611171430:
 *   new → assigned → in_progress → done | rejected → callback_pending → closed (+ forward to another region).
 *
 * Existing rows (dev databases only — nothing was deployed) are converted: open → new, accepted → in_progress,
 * completed / rejected → closed with that resolution. They have no region (= triage by the superuser).
 * New tables: ticket_events (timeline), ticket_calls (the ticket's call + callback attempts, with the
 * recording found in the CDR), ticket_reads (executives' unread state).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table tickets drop constraint if exists tickets_status_check`.execute(db);
  await sql`alter table tickets drop constraint if exists tickets_target_chk`.execute(db);
  await sql`alter table tickets drop constraint if exists tickets_creator_party_check`.execute(db);
  await sql`alter table tickets rename column body to description`.execute(db);
  await sql`alter table tickets rename column accepted_at to assigned_at`.execute(db);

  await db.schema
    .alterTable('tickets')
    .addColumn('customer_name', 'text')
    .addColumn('region_id', 'integer', (c) => c.references('ticket_regions.id').onDelete('restrict'))
    .addColumn('city_id', 'integer', (c) => c.references('ticket_cities.id').onDelete('set null'))
    .addColumn('category_id', 'integer', (c) => c.references('ticket_categories.id').onDelete('restrict'))
    .addColumn('origin_call_id', 'text')
    .addColumn('started_at', 'timestamptz')
    .addColumn('resolution', 'text', (c) => c.check(sql`resolution in ('done', 'rejected')`))
    .addColumn('resolution_note', 'text')
    .addColumn('resolved_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('resolved_by_label', 'text')
    .addColumn('resolved_by_extension', 'text')
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('due_at', 'timestamptz')
    .addColumn('closed_at', 'timestamptz')
    .addColumn('closed_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('closed_by_label', 'text')
    .addColumn('closed_by_extension', 'text')
    .addColumn('callback_outcome', 'text', (c) =>
      c.check(sql`callback_outcome in ('informed', 'unresolved', 'other', 'not_reached', 'forced')`),
    )
    .addColumn('callback_note', 'text')
    .addColumn('callback_attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_contact_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('last_contact_label', 'text')
    .addColumn('last_contact_extension', 'text')
    .addColumn('last_contact_at', 'timestamptz')
    // When the ticket last entered its current region's queue (unread state of executives).
    .addColumn('region_changed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // Optimistic lock: every change bumps it; concurrent clicks get 409.
    .addColumn('version', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  // Legacy board rows → the new model.
  await sql`
    update tickets set
      resolution = case status when 'completed' then 'done' when 'rejected' then 'rejected' end,
      resolution_note = case status when 'rejected' then reject_reason end,
      resolved_by_user_id = case status when 'completed' then completed_by_user_id when 'rejected' then rejected_by_user_id end,
      resolved_by_label = case status when 'completed' then completed_by_label when 'rejected' then rejected_by_label end,
      resolved_by_extension = case status when 'completed' then completed_by_extension when 'rejected' then rejected_by_extension end,
      resolved_at = case status when 'completed' then completed_at when 'rejected' then rejected_at end,
      closed_at = case when status in ('completed', 'rejected') then coalesce(completed_at, rejected_at, updated_at) end,
      started_at = case when status <> 'open' then assigned_at end,
      status = case status when 'open' then 'new' when 'accepted' then 'in_progress' else 'closed' end
  `.execute(db);

  await db.schema
    .alterTable('tickets')
    .dropColumn('is_urgent')
    .dropColumn('creator_party')
    .dropColumn('target_all')
    .dropColumn('target_user_id')
    .dropColumn('target_label')
    .dropColumn('target_extension')
    .dropColumn('completed_by_user_id')
    .dropColumn('completed_by_label')
    .dropColumn('completed_by_extension')
    .dropColumn('completed_at')
    .dropColumn('rejected_by_user_id')
    .dropColumn('rejected_by_label')
    .dropColumn('rejected_by_extension')
    .dropColumn('rejected_at')
    .dropColumn('reject_reason')
    .execute();
  await sql`alter table tickets alter column status set default 'new'`.execute(db);
  await sql`
    alter table tickets add constraint tickets_status_check
    check (status in ('new', 'assigned', 'in_progress', 'done', 'rejected', 'callback_pending', 'closed'))
  `.execute(db);
  await db.schema.createIndex('tickets_region_status_idx').on('tickets').columns(['region_id', 'status']).execute();
  await db.schema.createIndex('tickets_assignee_idx').on('tickets').column('assignee_user_id').execute();
  await db.schema.createIndex('tickets_phone_idx').on('tickets').column('customer_phone').execute();
  await db.schema.createIndex('tickets_origin_call_idx').on('tickets').column('origin_call_id').execute();

  await db.schema
    .createTable('ticket_events')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('ticket_id', 'bigint', (c) => c.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) =>
      c
        .notNull()
        .check(
          sql`kind in ('created', 'assigned', 'started', 'done', 'rejected', 'returned', 'forwarded', 'callback_attempt', 'closed')`,
        ),
    )
    .addColumn('from_status', 'text')
    .addColumn('to_status', 'text')
    .addColumn('from_region_id', 'integer', (c) => c.references('ticket_regions.id').onDelete('set null'))
    .addColumn('to_region_id', 'integer', (c) => c.references('ticket_regions.id').onDelete('set null'))
    // null actor = the system (automatic step)
    .addColumn('actor_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('actor_label', 'text')
    .addColumn('actor_extension', 'text')
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('ticket_events_ticket_idx').on('ticket_events').columns(['ticket_id', 'id']).execute();

  await db.schema
    .createTable('ticket_calls')
    .addColumn('id', 'bigint', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('ticket_id', 'bigint', (c) => c.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('origin', 'callback')`))
    // Asterisk linkedid; null while a callback has not been answered/matched yet
    .addColumn('call_id', 'text')
    .addColumn('phone', 'text')
    .addColumn('extension', 'text')
    .addColumn('user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('user_label', 'text')
    .addColumn('started_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('answered_at', 'timestamptz')
    .addColumn('ended_at', 'timestamptz')
    .addColumn('talk_seconds', 'integer')
    .addColumn('attempt_status', 'text', (c) =>
      c.check(sql`attempt_status in ('dialing', 'answered', 'connected', 'not_connected', 'failed')`),
    )
    .addColumn('outcome', 'text', (c) => c.check(sql`outcome in ('informed', 'unresolved', 'other', 'not_reached')`))
    .addColumn('outcome_note', 'text')
    .addColumn('outcome_at', 'timestamptz')
    .addColumn('recording_status', 'text', (c) =>
      c.notNull().defaultTo('pending').check(sql`recording_status in ('pending', 'found', 'none', 'unavailable')`),
    )
    // monitor-relative path of the recording (validated, never user input)
    .addColumn('recording_path', 'text')
    .addColumn('recording_checks', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('recording_next_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('recording_deadline', 'timestamptz', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('ticket_calls_ticket_idx').on('ticket_calls').column('ticket_id').execute();
  await db.schema.createIndex('ticket_calls_call_idx').on('ticket_calls').column('call_id').execute();
  await db.schema
    .createIndex('ticket_calls_recording_due_idx')
    .on('ticket_calls')
    .column('recording_next_at')
    .where(sql.ref('recording_status'), '=', 'pending')
    .execute();
  await db.schema
    .createIndex('ticket_calls_open_attempt_idx')
    .on('ticket_calls')
    .columns(['extension', 'started_at'])
    .where(sql.ref('attempt_status'), 'in', ['dialing', 'answered'])
    .execute();

  await db.schema
    .createTable('ticket_reads')
    .addColumn('user_id', 'bigint', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('ticket_id', 'bigint', (c) => c.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('read_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('ticket_reads_pk', ['user_id', 'ticket_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ticket_reads').execute();
  await db.schema.dropTable('ticket_calls').execute();
  await db.schema.dropTable('ticket_events').execute();
  await db.schema.dropIndex('tickets_origin_call_idx').execute();
  await db.schema.dropIndex('tickets_phone_idx').execute();
  await db.schema.dropIndex('tickets_assignee_idx').execute();
  await db.schema.dropIndex('tickets_region_status_idx').execute();
  await sql`alter table tickets drop constraint tickets_status_check`.execute(db);

  await db.schema
    .alterTable('tickets')
    .addColumn('is_urgent', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('creator_party', 'text', (c) => c.notNull().defaultTo('creator'))
    .addColumn('target_all', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('target_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('target_label', 'text')
    .addColumn('target_extension', 'text')
    .addColumn('completed_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('completed_by_label', 'text')
    .addColumn('completed_by_extension', 'text')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('rejected_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('rejected_by_label', 'text')
    .addColumn('rejected_by_extension', 'text')
    .addColumn('rejected_at', 'timestamptz')
    .addColumn('reject_reason', 'text')
    .execute();
  await sql`
    update tickets set
      completed_by_user_id = case when resolution = 'done' then resolved_by_user_id end,
      completed_by_label = case when resolution = 'done' then resolved_by_label end,
      completed_by_extension = case when resolution = 'done' then resolved_by_extension end,
      completed_at = case when resolution = 'done' then resolved_at end,
      rejected_by_user_id = case when resolution = 'rejected' then resolved_by_user_id end,
      rejected_by_label = case when resolution = 'rejected' then resolved_by_label end,
      rejected_by_extension = case when resolution = 'rejected' then resolved_by_extension end,
      rejected_at = case when resolution = 'rejected' then resolved_at end,
      reject_reason = case when resolution = 'rejected' then resolution_note end,
      status = case
        when status in ('new') then 'open'
        when status in ('assigned', 'in_progress') then 'accepted'
        when resolution = 'rejected' then 'rejected'
        else 'completed' end
  `.execute(db);
  await db.schema
    .alterTable('tickets')
    .dropColumn('customer_name')
    .dropColumn('region_id')
    .dropColumn('city_id')
    .dropColumn('category_id')
    .dropColumn('origin_call_id')
    .dropColumn('started_at')
    .dropColumn('resolution')
    .dropColumn('resolution_note')
    .dropColumn('resolved_by_user_id')
    .dropColumn('resolved_by_label')
    .dropColumn('resolved_by_extension')
    .dropColumn('resolved_at')
    .dropColumn('due_at')
    .dropColumn('closed_at')
    .dropColumn('closed_by_user_id')
    .dropColumn('closed_by_label')
    .dropColumn('closed_by_extension')
    .dropColumn('callback_outcome')
    .dropColumn('callback_note')
    .dropColumn('callback_attempts')
    .dropColumn('last_contact_user_id')
    .dropColumn('last_contact_label')
    .dropColumn('last_contact_extension')
    .dropColumn('last_contact_at')
    .dropColumn('region_changed_at')
    .dropColumn('version')
    .execute();
  await sql`alter table tickets rename column assigned_at to accepted_at`.execute(db);
  await sql`alter table tickets rename column description to body`.execute(db);
  await sql`alter table tickets alter column status set default 'open'`.execute(db);
  await sql`alter table tickets add constraint tickets_status_check check (status in ('open', 'accepted', 'completed', 'rejected'))`.execute(
    db,
  );
  await sql`alter table tickets add constraint tickets_creator_party_check check (creator_party in ('admin', 'creator'))`.execute(db);
  await sql`alter table tickets add constraint tickets_target_chk check (target_all or target_label is not null)`.execute(db);
}
