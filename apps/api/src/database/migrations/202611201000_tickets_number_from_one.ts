import { type Kysely, sql } from 'kysely';

/**
 * Ticket numbers start at TK-1 (owner decision 20.11.2026; they used to start at TK-1001 like legacy).
 * Existing tickets keep their numbers: with rows the sequence continues after the highest id, so a number is
 * never reused; on an empty table the next ticket is TK-1.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table tickets alter column id set start with 1`.execute(db);
  await sql`
    select setval(pg_get_serial_sequence('tickets', 'id'), coalesce(max(id), 1), max(id) is not null) from tickets
  `.execute(db);
}

/** Back to TK-1001; tickets numbered below it stay as they are. */
export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table tickets alter column id set start with 1001`.execute(db);
  await sql`select setval(pg_get_serial_sequence('tickets', 'id'), greatest(coalesce(max(id), 0), 1000)) from tickets`.execute(
    db,
  );
}
