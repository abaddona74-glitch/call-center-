import { type Kysely, sql } from 'kysely';

/**
 * Operator presence history for the staff KPI page (owner, 19.11.2026; docs/rewrite/METRICS.md §11.1). Only the live
 * state existed (AMI, in memory); this log keeps one row per state interval of an operator phone:
 *   offline — not registered; online — registered and taking queue calls; paused — registered, paused in the queue.
 * An open interval has `ended_at` null; `last_seen_at` is refreshed while the API watches it, so intervals left open
 * by a crash are closed at the last time they were seen. No row = unknown (API down or AMI disconnected).
 * History starts at deploy; old rows go after PRESENCE_LOG_RETENTION_DAYS.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('operator_presence_log')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('extension', 'text', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull().check(sql`state in ('offline', 'online', 'paused')`))
    .addColumn('pause_reason', 'text')
    .addColumn('started_at', 'timestamptz', (c) => c.notNull())
    .addColumn('ended_at', 'timestamptz')
    .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull())
    .addCheckConstraint('operator_presence_log_reason_only_paused', sql`state = 'paused' or pause_reason is null`)
    .addCheckConstraint('operator_presence_log_order', sql`ended_at is null or ended_at >= started_at`)
    .execute();
  // Period queries: intervals overlapping [from, to).
  await db.schema
    .createIndex('operator_presence_log_period_idx')
    .on('operator_presence_log')
    .columns(['started_at', 'ended_at'])
    .execute();
  // At most one open interval per phone.
  await sql`create unique index operator_presence_log_open_idx on operator_presence_log (extension) where ended_at is null`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('operator_presence_log').execute();
}
