#!/usr/bin/env node
/**
 * FAKE tickets for the overview dashboard in a local dev database (never production).
 * Prints SQL for Postgres; every date is relative to "now", so it never goes stale:
 *
 *   node infra/dev-seed/overview-tickets.mjs | docker exec -i callcenter-dev-postgres-1 psql -U callcenter -d callcenter_<slice>
 *
 * Creates executives ("Mas'ul shaxslar", users `devseed_*`, role executive, cannot log in), assigns them to the 14
 * regions, and ~420 tickets over the last 60 days in every state: queue, taken, in progress, done / rejected
 * waiting for the callback, closed; some late, some still overdue; a few without a region. The ticket timeline
 * gets the matching events. Nothing personal: no citizen numbers or names, placeholder organizations,
 * executives are named after their region. Re-running replaces only these rows (creator label `devseed`).
 * Options: --days 60, --tickets 420, --seed 20261119.
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const DAYS = Number(args.days ?? 60);
const COUNT = Number(args.tickets ?? 420);
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
const TZ_OFFSET = 5 * HOUR; // Asia/Tashkent, no DST

/** [code, relative ticket volume, executives] */
const REGIONS = [
  ['toshkent-shahri', 22, 3],
  ['toshkent-viloyati', 10, 2],
  ['samarqand', 10, 2],
  ['fargona', 9, 2],
  ['andijon', 8, 1],
  ['namangan', 7, 1],
  ['qashqadaryo', 7, 1],
  ['buxoro', 5, 1],
  ['surxondaryo', 5, 1],
  ['xorazm', 4, 1],
  ['navoiy', 3, 1],
  ['jizzax', 3, 1],
  ['sirdaryo', 2, 1],
  ['qoraqalpogiston', 3, 0], // nobody assigned: the queue just grows
];
/** Per-region speed: some regions are slow (more overdue), to colour the map. */
const SLOWNESS = {
  'toshkent-shahri': 0.8,
  fargona: 1.6,
  qashqadaryo: 1.9,
  xorazm: 1.4,
  qoraqalpogiston: 3,
  andijon: 1.1,
};

const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const ts = (ms) => (ms === null ? 'NULL' : `'${new Date(ms).toISOString()}'`);
const isWorkday = (ms) => {
  const d = new Date(ms + TZ_OFFSET).getUTCDay();
  return d !== 0 && d !== 6;
};
/** N working days later, same wall time (weekends skipped; the real calendar also skips holidays). */
function addWorkingDays(ms, n) {
  let t = ms;
  if (!isWorkday(t)) {
    while (!isWorkday(t)) t += 24 * HOUR;
    const wall = new Date(t + TZ_OFFSET);
    t = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - TZ_OFFSET;
  }
  for (let i = 0; i < n;) {
    t += 24 * HOUR;
    if (isWorkday(t)) i++;
  }
  return t;
}
/** A working-hours moment `daysAgo` days back. */
function createdAt(daysAgo) {
  const wall = new Date(Date.now() + TZ_OFFSET - daysAgo * 24 * HOUR);
  const day = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - TZ_OFFSET;
  let t = day + (8 + rand() * 12) * HOUR;
  if (!isWorkday(t) && rand() < 0.8) t -= 24 * HOUR * (new Date(t + TZ_OFFSET).getUTCDay() === 0 ? 2 : 1);
  return Math.min(t, Date.now() - 5 * 60_000);
}

const now = Date.now();
const out = [];
out.push('BEGIN;');
out.push(`DELETE FROM tickets WHERE creator_label = 'devseed';`);
out.push(`DELETE FROM users WHERE username LIKE 'devseed\\_%';`);

const executives = []; // { username, label, region }
for (const [code, , n] of REGIONS) {
  for (let i = 1; i <= n; i++) {
    const username = `devseed_${code.replace(/-/g, '_')}_${i}`;
    const place = code
      .replace('toshkent-shahri', 'toshkent sh.')
      .replace('toshkent-viloyati', 'toshkent vil.')
      .replace(/^./, (c) => c.toUpperCase());
    const label = `Mas'ul ${place}-${i}`;
    executives.push({ username, label, region: code });
    out.push(
      `INSERT INTO users (username, password_hash, role, is_active) VALUES (${q(username)}, 'devseed-no-login', 'executive', true);`,
    );
    out.push(
      `INSERT INTO ticket_executive_regions (user_id, region_id) SELECT u.id, r.id FROM users u, ticket_regions r WHERE u.username = ${q(username)} AND r.code = ${q(code)};`,
    );
  }
}
// One executive also covers the neighbouring region.
out.push(
  `INSERT INTO ticket_executive_regions (user_id, region_id) SELECT u.id, r.id FROM users u, ticket_regions r WHERE u.username = 'devseed_toshkent_viloyati_1' AND r.code = 'sirdaryo';`,
);

const weights = REGIONS.map(([, w]) => w);
const totalW = weights.reduce((a, b) => a + b, 0);
function pickRegion() {
  if (rand() < 0.03) return null; // "Hududsiz"
  let x = rand() * totalW;
  for (const [code, w] of REGIONS) {
    if ((x -= w) < 0) return code;
  }
  return REGIONS[0][0];
}

const userRef = (username) => (username ? `(SELECT id FROM users WHERE username = ${q(username)})` : 'NULL');
const regionRef = (code) => (code ? `(SELECT id FROM ticket_regions WHERE code = ${q(code)})` : 'NULL');

for (let n = 0; n < COUNT; n++) {
  // More tickets recently (the system is new), a few older ones.
  const daysAgo = Math.floor(Math.pow(rand(), 1.4) * DAYS);
  const created = createdAt(daysAgo);
  const region = pickRegion();
  const due = addWorkingDays(created, 3);
  const slow = SLOWNESS[region] ?? 1;
  const execs = executives.filter((e) => e.region === region);
  const exec = execs.length ? pick(execs) : null;

  // Timeline: taken after some hours, resolved after ~1–5 days (slower regions later), closed a few hours after.
  const takenAt = exec ? created + (0.5 + rand() * 20 * slow) * HOUR : null;
  const resolvedAt = takenAt ? takenAt + (4 + rand() * 70 * slow) * HOUR : null;
  const rejected = rand() < 0.18;
  const callbackDue = resolvedAt ? addWorkingDays(resolvedAt, 1) : null;
  const closedAt = resolvedAt ? resolvedAt + (0.5 + rand() * (rand() < 0.2 ? 60 : 14)) * HOUR : null;

  let status = 'new';
  let assignee = null;
  let assignedAt = null;
  let startedAt = null;
  let resolution = null;
  let resolver = null;
  let resolved = null;
  let closed = null;
  if (takenAt && takenAt < now) {
    status = 'assigned';
    assignee = exec;
    assignedAt = takenAt;
    if (takenAt + HOUR < now && rand() < 0.85) {
      status = 'in_progress';
      startedAt = takenAt + HOUR;
    }
    if (resolvedAt < now) {
      status = 'callback_pending';
      resolution = rejected ? 'rejected' : 'done';
      resolver = exec;
      resolved = resolvedAt;
      startedAt ??= takenAt + 0.5 * HOUR;
      if (closedAt < now) {
        status = 'closed';
        closed = closedAt;
      }
    }
  }
  const category = 1 + Math.floor(rand() * 4);
  const description = `devseed: test murojaat #${n + 1}`;
  const org = `Test tashkilot ${1 + Math.floor(rand() * 300)}`;
  out.push(
    `WITH t AS (INSERT INTO tickets (status, description, organization_name, region_id, category_id, creator_label,` +
      ` assignee_user_id, assignee_label, assigned_at, started_at, resolution, resolution_note, resolved_by_user_id,` +
      ` resolved_by_label, resolved_at, due_at, callback_due_at, closed_at, closed_by_label, callback_outcome,` +
      ` created_at, updated_at, region_changed_at) VALUES (` +
      [
        q(status),
        q(description),
        q(org),
        regionRef(region),
        category,
        q('devseed'),
        userRef(assignee?.username),
        q(assignee?.label),
        ts(assignedAt),
        ts(startedAt),
        q(resolution),
        q(resolution ? (resolution === 'rejected' ? 'devseed: rad etildi' : 'devseed: hal qilindi') : null),
        userRef(resolver?.username),
        q(resolver?.label),
        ts(resolved),
        ts(due),
        ts(resolved ? callbackDue : null),
        ts(closed),
        q(closed ? 'Operator 101' : null),
        q(closed ? 'informed' : null),
        ts(created),
        ts(closed ?? resolved ?? startedAt ?? assignedAt ?? created),
        ts(created),
      ].join(', ') +
      `) RETURNING id)`,
  );
  const events = [[`'created'`, 'NULL', 'NULL', ts(created)]];
  if (assignedAt) events.push([`'assigned'`, userRef(assignee.username), q(assignee.label), ts(assignedAt)]);
  if (startedAt) events.push([`'started'`, userRef(assignee.username), q(assignee.label), ts(startedAt)]);
  if (resolved) events.push([q(resolution), userRef(resolver.username), q(resolver.label), ts(resolved)]);
  if (closed) events.push([`'closed'`, 'NULL', q('Operator 101'), ts(closed)]);
  out.push(
    `INSERT INTO ticket_events (ticket_id, kind, actor_user_id, actor_label, created_at) SELECT t.id, e.kind, e.actor, e.label, e.at FROM t, (VALUES ` +
      events.map((e) => `(${e[0]}::text, ${e[1]}::bigint, ${e[2]}::text, ${e[3]}::timestamptz)`).join(', ') +
      `) AS e(kind, actor, label, at);`,
  );
}
out.push('COMMIT;');
console.log(out.join('\n'));
