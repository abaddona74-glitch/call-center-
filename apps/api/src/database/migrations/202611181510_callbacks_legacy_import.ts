import { type Kysely, sql } from 'kysely';

/**
 * Legacy callbacks import (scripts/migrate-legacy, callbacks mapper):
 *  - `callbacks.legacy_id`: legacy `pending_callbacks.id` of an imported row, so a re-run never duplicates it;
 *  - `callback_settings.legacy_imported_until`: the latest moment the imported legacy history covers. Legacy
 *    rows carry no Asterisk linkedid, so the CDR reconciliation cannot tell a call legacy already counted from
 *    a new one by id; it skips calls at or before this moment instead (legacy handled them).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('callbacks').addColumn('legacy_id', 'bigint').execute();
  await sql`create unique index callbacks_legacy_id_uq on callbacks (legacy_id) where legacy_id is not null`.execute(
    db,
  );
  await db.schema.alterTable('callback_settings').addColumn('legacy_imported_until', 'timestamptz').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('callback_settings').dropColumn('legacy_imported_until').execute();
  await sql`drop index if exists callbacks_legacy_id_uq`.execute(db);
  await db.schema.alterTable('callbacks').dropColumn('legacy_id').execute();
}
