import { type Kysely, sql } from 'kysely';

/**
 * One working calendar for statistics, callbacks and ticket deadlines (owner decision 2026-11-18).
 * Replaces the WORKING_* environment variables and the calendar columns of callback_settings;
 * the values the callbacks screen already holds are carried over.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('working_calendar')
    .addColumn('id', 'smallint', (c) =>
      c
        .primaryKey()
        .defaultTo(1)
        .check(sql`id = 1`),
    )
    .addColumn('days', sql`smallint[]`, (c) => c.notNull())
    .addColumn('start_time', 'text', (c) => c.notNull())
    .addColumn('end_time', 'text', (c) => c.notNull())
    .addColumn('holidays', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .execute();

  await sql`
    insert into working_calendar (id, days, start_time, end_time, holidays)
    select 1, work_days, work_start, work_end, holidays from callback_settings where id = 1
  `.execute(db);
  await sql`
    insert into working_calendar (id, days, start_time, end_time, holidays)
    values (1, '{1,2,3,4,5}', '08:00', '21:00', '{}')
    on conflict (id) do nothing
  `.execute(db);

  await db.schema
    .alterTable('callback_settings')
    .dropColumn('work_days')
    .dropColumn('work_start')
    .dropColumn('work_end')
    .dropColumn('holidays')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('callback_settings')
    .addColumn('work_days', sql`smallint[]`, (c) => c.notNull().defaultTo(sql`'{1,2,3,4,5}'`))
    .addColumn('work_start', 'text', (c) => c.notNull().defaultTo('08:00'))
    .addColumn('work_end', 'text', (c) => c.notNull().defaultTo('21:00'))
    .addColumn('holidays', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .execute();
  // Yearly "MM-DD" holidays did not exist in callback_settings: only exact dates go back.
  await sql`
    update callback_settings s
    set work_days = c.days, work_start = c.start_time, work_end = c.end_time,
        holidays = array(select h from unnest(c.holidays) h where h ~ '^\\d{4}-\\d{2}-\\d{2}$')
    from working_calendar c
    where s.id = 1 and c.id = 1
  `.execute(db);
  await db.schema.dropTable('working_calendar').execute();
}
