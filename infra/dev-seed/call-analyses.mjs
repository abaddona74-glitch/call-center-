#!/usr/bin/env node
/**
 * FAKE AI call analyses for a local dev database (never production), so the overview dashboard's quality block and
 * the «Tahlil» page have something to show without running the analysis worker. Prints SQL for Postgres:
 *
 *   pnpm --filter @cc/shared build   # the script reads the current prompt version from it
 *   node infra/dev-seed/call-analyses.mjs | docker exec -i callcenter-dev-postgres-1 psql -U callcenter -d callcenter_<slice>
 *
 * ~240 analyses over the last 14 days with the CURRENT prompt version (+ a few of an old version, which the pages must
 * leave out). Call ids are fake (`devseed-…`): there are no transcripts or recordings behind them, texts are
 * placeholders. Re-running replaces only these rows. Options: --days 14, --count 240, --seed 20261119.
 */
import { CALL_ANALYSIS_PROMPT_VERSION, CALL_OUTCOMES, RED_FLAGS } from '../../packages/shared/dist/index.js';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const DAYS = Number(args.days ?? 14);
const COUNT = Number(args.count ?? 240);
let state = Number(args.seed ?? 20261119) >>> 0;
function rand() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pickWeighted = (pairs) => {
  let x = rand() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((x -= w) < 0) return v;
  return pairs[0][0];
};
const q = (s) => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const json = (v) => `${q(JSON.stringify(v))}::jsonb`;
const text = (ru) => ({ uz: ru, ru });
const HOUR = 3_600_000;
const TZ = 5 * HOUR;

const OUTCOME_WEIGHTS = {
  resolved: 40,
  info_only: 25,
  ticket_opened: 12,
  callback_promised: 8,
  transferred: 6,
  unresolved: 9,
};
const TOPICS = ['Ключ ЭЦП', 'ЭДО', 'E-Huquqshunos', 'Пароль от кабинета', 'Другое'];

const out = ['BEGIN;'];
out.push(`DELETE FROM call_analyses WHERE call_id LIKE 'devseed-%';`);
out.push(`DELETE FROM call_analysis_jobs WHERE call_id LIKE 'devseed-%';`);
for (let i = 0; i < COUNT; i++) {
  const daysAgo = Math.floor(rand() * DAYS);
  const wall = new Date(Date.now() + TZ - daysAgo * 24 * HOUR);
  const day = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  const startedAt = new Date(Math.min(day - TZ + (8 + rand() * 12) * HOUR, Date.now() - HOUR));
  const callDate = new Date(startedAt.getTime() + TZ).toISOString().slice(0, 10);
  const callId = `devseed-${i}`;
  const outcome = pickWeighted(CALL_OUTCOMES.map((o) => [o, OUTCOME_WEIGHTS[o] ?? 5]));
  const bad = outcome === 'unresolved' || rand() < 0.1;
  const score = () => Math.max(1, Math.min(5, Math.round((bad ? 2.6 : 4.2) + (rand() - 0.5) * 2)));
  const overall = Math.max(1, Math.min(10, Math.round((bad ? 4.5 : 8) + (rand() - 0.5) * 3)));
  const flags = bad && rand() < 0.7 ? [RED_FLAGS[Math.floor(rand() * RED_FLAGS.length)]] : [];
  const end = bad
    ? pickWeighted([
        ['negative', 6],
        ['neutral', 3],
        ['positive', 1],
      ])
    : pickWeighted([
        ['positive', 6],
        ['neutral', 3],
        ['negative', 1],
      ]);
  const version = i % 40 === 0 ? 'v3-devseed-old' : CALL_ANALYSIS_PROMPT_VERSION;
  const topic = TOPICS[Math.floor(rand() * TOPICS.length)];
  out.push(
    `INSERT INTO call_analysis_jobs (call_id, call_started_at, call_date, direction, operator_ext, talk_sec, recording_file, source, status, finished_at) VALUES (${q(callId)}, ${q(startedAt.toISOString())}, ${q(callDate)}, ${q(rand() < 0.85 ? 'inbound' : 'outbound')}, ${q(String(101 + Math.floor(rand() * 9)))}, ${30 + Math.floor(rand() * 400)}, 'devseed.wav', 'manual', 'done', ${q(startedAt.toISOString())});`,
  );
  out.push(
    `INSERT INTO call_analyses (call_id, prompt_version, llm_model, thinking, llm_ms, llm_attempts, topic, topic_key, subtopic, problem, summary, recommendation, outcome, score_greeting, greeting_phrase, score_politeness, score_understanding, score_solution, score_closing, overall, red_flags, red_flag_codes, sentiment_start, sentiment_end, language) VALUES (${q(callId)}, ${q(version)}, 'devseed', false, 1, 1, ${json(text(topic))}, ${q(topic.toLowerCase())}, ${json(text('devseed'))}, ${json(text('devseed: проблема'))}, ${json(text('devseed: итог'))}, ${json(text('devseed'))}, ${q(outcome)}, NULL, NULL, ${score()}, ${score()}, ${score()}, ${score()}, ${overall}, ${json(flags.map((code) => ({ code, note: 'devseed', at: null })))}, ARRAY[${flags.map(q).join(',')}]::text[], 'neutral', ${q(end)}, 'uz');`,
  );
}
out.push('COMMIT;');
console.log(out.join('\n'));
