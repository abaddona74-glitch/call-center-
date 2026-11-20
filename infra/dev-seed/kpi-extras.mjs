#!/usr/bin/env node
/**
 * FAKE data for the staff KPI page («KPI xodimlar») in a local dev database (never production). Prints SQL for Postgres;
 * run it AFTER overview-tickets.mjs (it decorates those `devseed` tickets):
 *
 *   node infra/dev-seed/overview-tickets.mjs | docker exec -i callcenter-dev-postgres-1 psql -U callcenter -d callcenter_<slice>
 *   node infra/dev-seed/kpi-extras.mjs       | docker exec -i callcenter-dev-postgres-1 psql -U callcenter -d callcenter_<slice>
 *
 *  - gives the devseed tickets an operator extension (who opened / who closed them) from the dev PBX operators;
 *  - adds 1–2 fake callback attempts (`ticket_calls`, kind callback, no numbers) for done / rejected / closed tickets;
 *  - writes a fake presence history (`operator_presence_log`) for the last --days days (default 7) before today:
 *    operators online in working hours with lunch / meeting / no-reason pauses, offline at night.
 * Nothing personal. Re-running replaces only these rows. Options: --days 7, --seed 20261119.
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const DAYS = Number(args.days ?? 7);
let state = Number(args.seed ?? 20261119) >>> 0;
function rand() {
  // mulberry32
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const HOUR = 3_600_000;
const MIN = 60_000;
const TZ_OFFSET = 5 * HOUR; // Asia/Tashkent, no DST
const q = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const OPERATORS = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111'];
const PAUSES = ['Tushlik', 'Tushlik', "Yig'ilish", 'Texnik nosozlik', null];

const out = ['BEGIN;'];

// Tickets: who opened and who closed them (deterministic by id).
const opArray = `ARRAY[${OPERATORS.map(q).join(', ')}]`;
out.push(
  `UPDATE tickets SET creator_extension = (${opArray})[1 + (id * 7) % ${OPERATORS.length}] WHERE creator_label = 'devseed';`,
  `UPDATE tickets SET closed_by_extension = (${opArray})[1 + (id * 3) % ${OPERATORS.length}], closed_by_label = 'devseed'` +
    ` WHERE creator_label = 'devseed' AND status = 'closed' AND callback_outcome IS DISTINCT FROM 'forced';`,
);

// Callback attempts: one or two per done/rejected ticket, before its close (or within a day of the resolution).
out.push(
  `DELETE FROM ticket_calls WHERE kind = 'callback' AND user_label = 'devseed';`,
  `INSERT INTO ticket_calls (ticket_id, kind, extension, user_label, started_at, ended_at, talk_seconds, attempt_status, recording_status, recording_deadline)
   SELECT t.id, 'callback', COALESCE(t.closed_by_extension, (${opArray})[1 + (t.id * 5) % ${OPERATORS.length}]), 'devseed',
          s.at, s.at + interval '2 minutes', CASE WHEN s.n = 1 AND t.status = 'closed' THEN 95 ELSE 0 END,
          CASE WHEN s.n = 1 AND t.status = 'closed' THEN 'connected' ELSE 'not_connected' END, 'none', s.at
     FROM tickets t
     CROSS JOIN LATERAL (
       SELECT n, COALESCE(t.closed_at - (n * interval '20 minutes'), t.resolved_at + (n * interval '3 hours')) AS at
         FROM generate_series(1, 1 + (t.id % 2)) AS n
     ) s
    WHERE t.creator_label = 'devseed' AND t.resolved_at IS NOT NULL AND s.at < now();`,
);

// Presence history: the last DAYS days before today (today is written live by the API).
const todayStart = (() => {
  const local = new Date(Date.now() + TZ_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TZ_OFFSET;
})();
const from = todayStart - DAYS * 24 * HOUR;
out.push(
  `DELETE FROM operator_presence_log WHERE started_at < ${q(new Date(todayStart).toISOString())} AND started_at >= ${q(new Date(from).toISOString())};`,
);
const rows = [];
for (const ext of OPERATORS) {
  let cursor = from;
  for (let d = 0; d < DAYS; d++) {
    const day = from + d * 24 * HOUR;
    const weekday = new Date(day + TZ_OFFSET).getUTCDay(); // 0 = Sunday
    if (weekday === 0 || weekday === 6 || rand() < 0.08) continue; // weekend or a day off
    const start = day + 8 * HOUR + Math.floor(rand() * 40) * MIN - 15 * MIN;
    const end = day + 20 * HOUR + Math.floor(rand() * 75) * MIN;
    rows.push([ext, 'offline', null, cursor, start]);
    // the working day: online, with 1–3 pauses
    let at = start;
    const pauses = 1 + Math.floor(rand() * 3);
    for (let p = 0; p < pauses; p++) {
      const pauseAt = at + (60 + Math.floor(rand() * 180)) * MIN;
      const reason = pick(PAUSES);
      const len = (reason === 'Tushlik' ? 40 : 10) * MIN + Math.floor(rand() * 25) * MIN;
      if (pauseAt + len > end) break;
      rows.push([ext, 'online', null, at, pauseAt]);
      rows.push([ext, 'paused', reason, pauseAt, pauseAt + len]);
      at = pauseAt + len;
    }
    rows.push([ext, 'online', null, at, end]);
    cursor = end;
  }
  rows.push([ext, 'offline', null, cursor, todayStart - 1000]);
}
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  out.push(
    `INSERT INTO operator_presence_log (extension, state, pause_reason, started_at, ended_at, last_seen_at) VALUES\n` +
      chunk
        .map(([ext, state, reason, a, b]) => {
          return `(${q(ext)}, ${q(state)}, ${q(reason)}, ${q(new Date(a).toISOString())}, ${q(new Date(b).toISOString())}, ${q(new Date(b).toISOString())})`;
        })
        .join(',\n') +
      ';',
  );
}
out.push('COMMIT;');
console.log(out.join('\n'));
