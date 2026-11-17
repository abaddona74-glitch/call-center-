import { type Kysely, sql } from 'kysely';

/**
 * Tickets (legacy viewer/data/tickets.json → tables).
 * Ids come from an identity sequence (never reused; legacy took max+1, so deleted ids came back).
 * The sequence starts at 1001 like legacy "TK-1001"; the data migration may setval past legacy ids.
 * Person columns keep a label snapshot so history survives user renames/deletions.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('tickets')
    .addColumn('id', sql`bigint generated always as identity (start with 1001)`, (c) => c.primaryKey())
    .addColumn('status', 'text', (c) =>
      c.notNull().defaultTo('open').check(sql`status in ('open', 'accepted', 'completed', 'rejected')`),
    )
    .addColumn('body', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('customer_phone', 'text')
    .addColumn('is_urgent', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('creator_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('creator_label', 'text', (c) => c.notNull())
    .addColumn('creator_extension', 'text')
    .addColumn('creator_party', 'text', (c) => c.notNull().check(sql`creator_party in ('admin', 'creator')`))
    .addColumn('target_all', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('target_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('target_label', 'text')
    .addColumn('target_extension', 'text')
    .addColumn('assignee_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('assignee_label', 'text')
    .addColumn('assignee_extension', 'text')
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('completed_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('completed_by_label', 'text')
    .addColumn('completed_by_extension', 'text')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('rejected_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('rejected_by_label', 'text')
    .addColumn('rejected_by_extension', 'text')
    .addColumn('rejected_at', 'timestamptz')
    .addColumn('reject_reason', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('tickets_target_chk', sql`target_all or target_label is not null`)
    .execute();
  await db.schema.createIndex('tickets_status_idx').on('tickets').column('status').execute();
  await db.schema.createIndex('tickets_created_at_idx').on('tickets').column('created_at').execute();
  await db.schema.createIndex('tickets_target_user_idx').on('tickets').column('target_user_id').execute();
  await db.schema.createIndex('tickets_creator_user_idx').on('tickets').column('creator_user_id').execute();

  await db.schema
    .createTable('ticket_comments')
    .addColumn('id', 'bigint', (c) => c.primaryKey().generatedAlwaysAsIdentity())
    .addColumn('ticket_id', 'bigint', (c) => c.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('author_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('author_label', 'text', (c) => c.notNull())
    .addColumn('author_extension', 'text')
    .addColumn('body', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('ticket_comments_ticket_idx').on('ticket_comments').column('ticket_id').execute();

  await db.schema
    .createTable('ticket_attachments')
    .addColumn('id', 'bigint', (c) => c.primaryKey().generatedAlwaysAsIdentity())
    .addColumn('ticket_id', 'bigint', (c) => c.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('comment_id', 'bigint', (c) => c.references('ticket_comments.id').onDelete('cascade'))
    // random server-side name of the file in TICKETS_UPLOAD_DIR (never user input)
    .addColumn('storage_key', 'text', (c) => c.notNull().unique())
    .addColumn('file_name', 'text', (c) => c.notNull())
    .addColumn('mime_type', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('image', 'pdf', 'docx')`))
    .addColumn('size_bytes', 'integer', (c) => c.notNull())
    .addColumn('uploaded_by_user_id', 'bigint', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('ticket_attachments_ticket_idx').on('ticket_attachments').column('ticket_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ticket_attachments').execute();
  await db.schema.dropTable('ticket_comments').execute();
  await db.schema.dropTable('tickets').execute();
}
