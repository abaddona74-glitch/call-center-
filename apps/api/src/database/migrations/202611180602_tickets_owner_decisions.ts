import { type Kysely, sql } from 'kysely';

/**
 * Owner decisions of 18.11.2026 (docs/rewrite/TICKETS.md, "Решения владельца"):
 *  - `release`: an executive gives a taken ticket back to the queue of its region → timeline kind `released`;
 *  - operators keep read access to closed tickets they called back on → `callback_user_ids`
 *    (every user who made a callback attempt, kept on the row so lists and the WS filter need no join);
 *  - a separate SLA for the callback step → `callback_due_at` (done/rejected + N working days).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tickets')
    .addColumn('callback_due_at', 'timestamptz')
    .addColumn('callback_user_ids', sql`integer[]`, (c) => c.notNull().defaultTo(sql`'{}'::integer[]`))
    .execute();

  await sql`
    update tickets t
       set callback_user_ids = coalesce((
             select array_agg(distinct c.user_id order by c.user_id)
               from ticket_calls c
              where c.ticket_id = t.id
                and c.kind = 'callback'
                and c.user_id is not null
                and c.attempt_status is distinct from 'failed'
           ), '{}'::integer[])
  `.execute(db);

  await sql`alter table ticket_events drop constraint if exists ticket_events_kind_check`.execute(db);
  await sql`
    alter table ticket_events add constraint ticket_events_kind_check
    check (kind in ('created', 'assigned', 'started', 'done', 'rejected', 'returned', 'forwarded', 'released',
                    'callback_attempt', 'closed'))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('ticket_events').where('kind', '=', 'released').execute();
  await sql`alter table ticket_events drop constraint if exists ticket_events_kind_check`.execute(db);
  await sql`
    alter table ticket_events add constraint ticket_events_kind_check
    check (kind in ('created', 'assigned', 'started', 'done', 'rejected', 'returned', 'forwarded',
                    'callback_attempt', 'closed'))
  `.execute(db);
  await db.schema.alterTable('tickets').dropColumn('callback_user_ids').dropColumn('callback_due_at').execute();
}
