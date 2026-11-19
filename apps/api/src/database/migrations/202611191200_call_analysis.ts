import { type Kysely, sql } from 'kysely';

/**
 * AI call analysis (docs/rewrite/CALL-ANALYSIS.md, owner decision 2026-11-19): a job queue leased by the analysis
 * worker over HTTP, the transcript with speaker roles, the filled rubric, and the topic list the model picks from.
 * The topic list is a draft for the pilot; the owner approves the final list.
 */
const TOPICS: Array<[code: string, uz: string, ru: string, sort: number]> = [
  ['edo', 'EDO (ijro.uz): hujjat aylanishi', 'ЭДО (ijro.uz): документооборот', 10],
  ['ijro_discipline', 'Ijro intizomi: hisobotlar va muddatlar', 'Исполнительская дисциплина: отчёты и сроки', 20],
  ['e_huquqshunos', 'E-Huquqshunos: yuridik xizmatlar', 'E-Huquqshunos: юридические услуги', 30],
  ['eri_key', 'ERI kaliti (E-imzo), Uzcrypto', 'Ключ ЭЦП (E-imzo), Uzcrypto', 40],
  ['login_access', 'Tizimga kirish, parol, akkaunt', 'Вход в систему, пароль, учётная запись', 50],
  ['system_error', 'Tizim xatosi, ishlamayapti', 'Ошибка или сбой системы', 60],
  ['pc_setup', 'Kompyuter va brauzer sozlamalari', 'Настройка компьютера и браузера', 70],
  ['consultation', 'Foydalanish bo‘yicha maslahat', 'Консультация по работе в системе', 80],
  ['contract_payment', 'Shartnoma va to‘lov', 'Договор и оплата', 90],
  ['request_status', 'Murojaat holati', 'Статус обращения', 100],
  ['complaint', 'Shikoyat', 'Жалоба', 110],
  ['wrong_call', 'Noto‘g‘ri qo‘ng‘iroq yoki aloqa uzildi', 'Ошибочный или прерванный звонок', 120],
  ['other', 'Boshqa', 'Другое', 1000],
];

export async function up(db: Kysely<any>): Promise<void> {
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
  await db
    .insertInto('call_topics')
    .values(TOPICS.map(([code, nameUz, nameRu, sort]) => ({ code, name_uz: nameUz, name_ru: nameRu, sort })))
    .execute();

  await db.schema
    .createTable('call_analysis_jobs')
    // CallListItem.id: the Asterisk linkedid (uniqueid of the first leg without linkedid)
    .addColumn('call_id', 'text', (c) => c.primaryKey())
    .addColumn('call_started_at', 'timestamptz', (c) => c.notNull())
    /** Asia/Tashkent date of the call start (period filters). */
    .addColumn('call_date', 'date', (c) => c.notNull())
    .addColumn('direction', 'text', (c) => c.notNull())
    .addColumn('operator_ext', 'text')
    .addColumn('talk_sec', 'integer', (c) => c.notNull())
    .addColumn('recording_file', 'text')
    .addColumn('source', 'text', (c) => c.notNull().check(sql`source in ('auto', 'manual')`))
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('queued')
        .check(sql`status in ('queued', 'processing', 'done', 'failed', 'skipped')`),
    )
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    /** Retry delay after a retryable failure. */
    .addColumn('not_before', 'timestamptz')
    .addColumn('lease_owner', 'text')
    .addColumn('leased_at', 'timestamptz')
    .addColumn('lease_until', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('skip_reason', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamptz')
    .execute();
  // the lease scan: newest open jobs first
  await sql`create index call_analysis_jobs_open_idx on call_analysis_jobs (call_started_at desc)
            where status in ('queued', 'processing')`.execute(db);
  await db.schema.createIndex('call_analysis_jobs_date_idx').on('call_analysis_jobs').columns(['call_date']).execute();

  await db.schema
    .createTable('call_analysis_workers')
    .addColumn('worker_id', 'text', (c) => c.primaryKey())
    .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('call_transcripts')
    .addColumn('call_id', 'text', (c) => c.primaryKey().references('call_analysis_jobs.call_id').onDelete('cascade'))
    .addColumn('language', 'text', (c) => c.notNull())
    /** [{ start, end, role, speaker, text }] */
    .addColumn('segments', 'jsonb', (c) => c.notNull())
    .addColumn('audio_sec', 'real', (c) => c.notNull())
    .addColumn('stt_strategy', 'text', (c) => c.notNull())
    .addColumn('stt_model', 'text', (c) => c.notNull())
    .addColumn('stt_ms', 'integer', (c) => c.notNull())
    .addColumn('stt_rerun', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('call_analyses')
    .addColumn('call_id', 'text', (c) => c.primaryKey().references('call_analysis_jobs.call_id').onDelete('cascade'))
    .addColumn('prompt_version', 'text', (c) => c.notNull())
    .addColumn('llm_model', 'text', (c) => c.notNull())
    .addColumn('thinking', 'boolean', (c) => c.notNull())
    .addColumn('llm_ms', 'integer', (c) => c.notNull())
    .addColumn('llm_attempts', 'smallint', (c) => c.notNull())
    .addColumn('topic_code', 'text', (c) => c.notNull().references('call_topics.code').onUpdate('cascade'))
    /** {uz, ru} texts */
    .addColumn('subtopic', 'jsonb', (c) => c.notNull())
    .addColumn('problem', 'jsonb', (c) => c.notNull())
    .addColumn('summary', 'jsonb', (c) => c.notNull())
    .addColumn('recommendation', 'jsonb', (c) => c.notNull())
    .addColumn('outcome', 'text', (c) => c.notNull())
    .addColumn('score_greeting', 'smallint', (c) => c.notNull())
    .addColumn('score_politeness', 'smallint', (c) => c.notNull())
    .addColumn('score_understanding', 'smallint', (c) => c.notNull())
    .addColumn('score_solution', 'smallint', (c) => c.notNull())
    .addColumn('score_closing', 'smallint', (c) => c.notNull())
    .addColumn('overall', 'smallint', (c) => c.notNull())
    /** [{ code, note, at }] */
    .addColumn('red_flags', 'jsonb', (c) => c.notNull())
    .addColumn('red_flag_codes', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('sentiment_start', 'text', (c) => c.notNull())
    .addColumn('sentiment_end', 'text', (c) => c.notNull())
    .addColumn('language', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('call_analyses_topic_idx').on('call_analyses').columns(['topic_code']).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('call_analyses').execute();
  await db.schema.dropTable('call_transcripts').execute();
  await db.schema.dropTable('call_analysis_workers').execute();
  await db.schema.dropTable('call_analysis_jobs').execute();
  await db.schema.dropTable('call_topics').execute();
}
