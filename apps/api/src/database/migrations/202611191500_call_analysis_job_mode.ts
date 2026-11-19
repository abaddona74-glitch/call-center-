import { type Kysely, sql } from 'kysely';

/**
 * Job mode (call analysis, 2026-11-19): `llm_only` re-runs only the LLM on the stored transcript — a new prompt/rubric
 * version re-scores calls in seconds instead of repeating speech recognition.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('call_analysis_jobs')
    .addColumn('mode', 'text', (c) =>
      c
        .notNull()
        .defaultTo('full')
        .check(sql`mode in ('full', 'llm_only')`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('call_analysis_jobs').dropColumn('mode').execute();
}
