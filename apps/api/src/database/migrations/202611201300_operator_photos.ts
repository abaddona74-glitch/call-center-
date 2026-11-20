import { type Kysely, sql } from 'kysely';

/**
 * Operator photos (owner, 20.11.2026): one row per extension that has a photo. The bytes live on disk under
 * OPERATOR_PHOTOS_DIR (a volume), named by `storage_key`; the row says which file and its detected type.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('operator_photos')
    .addColumn('extension', 'text', (c) => c.primaryKey())
    .addColumn('storage_key', 'text', (c) => c.notNull())
    .addColumn('mime_type', 'text', (c) => c.notNull())
    .addColumn('size_bytes', 'integer', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('operator_photos').execute();
}
