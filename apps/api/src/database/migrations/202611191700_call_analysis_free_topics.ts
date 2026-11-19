import { type Kysely, sql } from 'kysely';

/**
 * Call analysis v4 (owner decisions 2026-11-19): no fixed topic list — the model writes the topic in its own words and
 * statistics group by a normalised key; the greeting is not scored any more — the operator's greeting phrase is stored.
 * Existing rows keep their greeting score and get their old topic name as text.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('call_analyses')
    .addColumn('topic', 'jsonb')
    .addColumn('topic_key', 'text')
    .addColumn('greeting_phrase', 'text')
    .execute();
  await sql`
    update call_analyses a
       set topic = jsonb_build_object('uz', t.name_uz, 'ru', t.name_ru),
           topic_key = lower(replace(regexp_replace(trim(t.name_ru), '\\s+', ' ', 'g'), 'ё', 'е'))
      from call_topics t
     where t.code = a.topic_code`.execute(db);
  await sql`update call_analyses set topic = '{"uz": "Boshqa", "ru": "Другое"}', topic_key = 'другое'
             where topic is null`.execute(db);
  await db.schema
    .alterTable('call_analyses')
    .alterColumn('topic', (c) => c.setNotNull())
    .alterColumn('topic_key', (c) => c.setNotNull())
    .alterColumn('score_greeting', (c) => c.dropNotNull())
    .dropColumn('topic_code')
    .execute();
  await db.schema.createIndex('call_analyses_topic_key_idx').on('call_analyses').column('topic_key').execute();
  await db.schema.createIndex('call_analyses_prompt_version_idx').on('call_analyses').column('prompt_version').execute();
  await db.schema.dropTable('call_topics').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('call_topics')
    .addColumn('code', 'text', (c) => c.primaryKey())
    .addColumn('name_uz', 'text', (c) => c.notNull())
    .addColumn('name_ru', 'text', (c) => c.notNull())
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(100))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`insert into call_topics (code, name_uz, name_ru, sort) values ('other', 'Boshqa', 'Другое', 1000)`.execute(db);
  await db.schema.dropIndex('call_analyses_prompt_version_idx').execute();
  await db.schema.dropIndex('call_analyses_topic_key_idx').execute();
  await sql`update call_analyses set score_greeting = 3 where score_greeting is null`.execute(db);
  await db.schema
    .alterTable('call_analyses')
    .addColumn('topic_code', 'text', (c) => c.notNull().defaultTo('other').references('call_topics.code').onUpdate('cascade'))
    .alterColumn('score_greeting', (c) => c.setNotNull())
    .dropColumn('topic')
    .dropColumn('topic_key')
    .dropColumn('greeting_phrase')
    .execute();
}
