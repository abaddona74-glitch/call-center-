#!/usr/bin/env node
/**
 * Generates realistic fake CDR history for the mock PBX MariaDB (infra/compose.dev.yml, service pbx-db).
 *
 * Prints SQL to stdout (or writes it to --out). Every datetime in it is relative to "today in Asia/Tashkent"
 * at load time, so the SQL never goes stale. Load it into the running dev container (root is needed to write):
 *
 *   pnpm dev:pbx:seed
 *   # = node infra/dev-pbx/seed/generate-cdr-seed.mjs | docker exec -i callcenter-dev-pbx-db-1 mariadb -uroot -pdevroot
 *
 * Options: --days 14, --seed 20261117, --out <file>. Writing it to infra/dev-pbx/mariadb-init/03-cdr-history.sql
 * makes a fresh pbx-db volume load it on first start (that file is git-ignored: ~2.5 MB of generated SQL).
 *
 * Row shapes follow Asterisk 13 + FreePBX/Issabel conventions as described in docs/rewrite/legacy/data.md §3
 * (trunk SIP/712020159, queue 2020159 in ext-queues, members Local/<ext>@from-queue, IVR ivr-4,
 * transfers in from-internal-xfer, outbound from-internal). Covered call types:
 *   queue answered (first ring / after ring-no-answer), queue abandoned, IVR-only hang-up, after-hours IVR
 *   announcement, hidden number, blind transfer (1 and 2 hops, one unanswered), outbound answered / no answer /
 *   busy / failed, internal operator-to-operator, weekend calls, repeat callers and callbacks.
 * All rows are tagged accountcode='devseed' so re-running replaces only generated data.
 * Phone numbers are random and fake; operator names are placeholders.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const DAYS = Number(args.days ?? 14);
const seedState = Number(args.seed ?? 20261117) >>> 0;

// mulberry32 — deterministic output for the same seed
function mulberry32(state) {
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seedState);
// Survey answers draw from their own stream, so adding them did not change the generated CDR history.
const surveyRand = mulberry32((seedState ^ 0x9e3779b9) >>> 0);
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

const TRUNK = '712020159';
const QUEUE = '2020159';
const MAIN_OPS = ['101', '103', '106', '111', '114', '119', '120'];
const SECONDARY_OPS = ['200', '203', '204', '205'];
const PREFIXES = ['90', '91', '93', '94', '95', '97', '98', '99', '33', '88', '77'];

// A pool of clients: some call often (top clients), most once.
const clients = Array.from({ length: 420 }, () => `${pick(PREFIXES)}${String(int(0, 9_999_999)).padStart(7, '0')}`);
const frequentClients = clients.slice(0, 12);
const cityNumbers = Array.from({ length: 10 }, () => `71${String(int(0, 9_999_999)).padStart(7, '0')}`);

/** How the trunk presents the caller: mostly 12-digit 998…, sometimes 9-digit national. */
function presentedNumber(n) {
  return n.length === 9 && chance(0.7) ? `998${n}` : n;
}

let seq = 1;
let chanCounter = 0x1a00;
const chan = () => (chanCounter++).toString(16).padStart(8, '0');

const rows = [];
/** asteriskcdrdb.operator_baho value tuples (post-call survey answers). */
const ratings = [];
const ts = (d, s) => `(@base - INTERVAL ${d} DAY + INTERVAL ${s} SECOND)`;
const uid = (d, s, n) => `CONCAT(UNIX_TIMESTAMP(${ts(d, s)}), '.', ${n})`;
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

/**
 * @param {object} r row with SQL-ready expressions for calldate/uniqueid/linkedid/recordingfile
 */
function row(r) {
  rows.push(
    `(${r.calldate}, ${q(r.clid ?? '')}, ${q(r.src)}, ${q(r.dst)}, ${q(r.dcontext)}, ${q(r.channel)}, ${q(r.dstchannel ?? '')}, ` +
      `${q(r.lastapp ?? '')}, ${q(r.lastdata ?? '')}, ${r.duration}, ${r.billsec}, ${q(r.disposition)}, ${r.uniqueid}, ` +
      `${r.linkedid}, ${r.recordingfile ?? "''"}, ${q(r.did ?? '')}, 'devseed')`,
  );
}

/** Inbound call through IVR → queue. Returns nothing; pushes all legs. */
function inboundCall(d, start, opts) {
  const {
    caller, // presented src ('' or 'anonymous' for hidden)
    outcome, // 'answered' | 'abandoned' | 'ivr' | 'after_hours'
    members, // operators rung before the answering one (ring-no-answer)
    answeredBy,
    talk = 0,
    transfers = [], // [{ to, talk, answered }]
  } = opts;
  const n0 = seq++;
  const U = uid(d, start, n0);
  const trunkChan = `SIP/${TRUNK}-${chan()}`;
  const clid = caller && caller !== 'anonymous' ? `"${caller}" <${caller}>` : '"Anonymous" <anonymous>';

  if (outcome === 'after_hours') {
    const len = int(12, 35);
    row({
      calldate: ts(d, start), clid, src: caller, dst: 's', dcontext: 'ivr-4', channel: trunkChan,
      lastapp: 'Playback', lastdata: 'custom/music-working-time', duration: len, billsec: len - 1,
      disposition: 'ANSWERED', uniqueid: U, linkedid: U, did: TRUNK,
    });
    return;
  }

  const ivrSec = int(6, 24);
  if (outcome === 'ivr') {
    row({
      calldate: ts(d, start), clid, src: caller, dst: 's', dcontext: 'ivr-4', channel: trunkChan,
      lastapp: 'BackGround', lastdata: 'custom/welcome-menu', duration: ivrSec, billsec: ivrSec - 1,
      disposition: 'ANSWERED', uniqueid: U, linkedid: U, did: TRUNK,
    });
    return;
  }

  // IVR leg (answered by the IVR, never counts as an operator answer)
  row({
    calldate: ts(d, start), clid, src: caller, dst: 's', dcontext: 'ivr-4', channel: trunkChan,
    lastapp: 'BackGround', lastdata: 'custom/welcome-menu', duration: ivrSec, billsec: ivrSec - 1,
    disposition: 'ANSWERED', uniqueid: U, linkedid: U, did: TRUNK,
  });

  let t = start + ivrSec;
  // ring-no-answer attempts
  for (const ext of members) {
    const ring = int(12, 20);
    const lc = `Local/${ext}@from-queue-${chan()};`;
    row({
      calldate: ts(d, t), clid, src: caller, dst: QUEUE, dcontext: 'ext-queues', channel: trunkChan,
      dstchannel: `${lc}1`, lastapp: 'Queue', lastdata: `${QUEUE},t,,,300`, duration: ring, billsec: 0,
      disposition: 'NO ANSWER', uniqueid: U, linkedid: U, did: TRUNK,
    });
    row({
      calldate: ts(d, t), clid, src: caller, dst: ext, dcontext: 'from-queue', channel: `${lc}2`,
      dstchannel: `SIP/${ext}-${chan()}`, lastapp: 'Dial', lastdata: `SIP/${ext},,trM(auto-blkvm)`, duration: ring, billsec: 0,
      disposition: 'NO ANSWER', uniqueid: uid(d, t, seq++), linkedid: U, did: TRUNK,
    });
    t += ring + int(1, 3);
  }

  if (outcome === 'abandoned') {
    const wait = int(5, 90);
    row({
      calldate: ts(d, start + ivrSec), clid, src: caller, dst: QUEUE, dcontext: 'ext-queues', channel: trunkChan,
      lastapp: 'Queue', lastdata: `${QUEUE},t,,,300`, duration: t - start - ivrSec + wait,
      billsec: t - start - ivrSec + wait, disposition: 'ANSWERED', uniqueid: U, linkedid: U, did: TRUNK,
    });
    return;
  }

  // answered by `answeredBy` after `ring` seconds
  const ring = int(3, 15);
  const lc = `Local/${answeredBy}@from-queue-${chan()};`;
  const totalTalk = talk + transfers.reduce((s, x) => s + (x.answered ? x.talk : 0), 0);
  const recDigits = caller && caller !== 'anonymous' ? caller : 'anonymous';
  row({
    calldate: ts(d, t), clid, src: caller, dst: QUEUE, dcontext: 'ext-queues', channel: trunkChan, dstchannel: `${lc}1`,
    lastapp: 'Queue', lastdata: `${QUEUE},t,,,300`, duration: ring + totalTalk, billsec: totalTalk, disposition: 'ANSWERED',
    uniqueid: U, linkedid: U, did: TRUNK,
    recordingfile: `CONCAT('q-${QUEUE}-${recDigits}-', DATE_FORMAT(${ts(d, t + ring)}, '%Y%m%d-%H%i%s'), '-', ${U}, '.wav')`,
  });
  row({
    calldate: ts(d, t), clid, src: caller, dst: answeredBy, dcontext: 'from-queue', channel: `${lc}2`,
    dstchannel: `SIP/${answeredBy}-${chan()}`, lastapp: 'Dial', lastdata: `SIP/${answeredBy},,trM(auto-blkvm)`,
    duration: ring + talk, billsec: talk, disposition: 'ANSWERED', uniqueid: uid(d, t, seq++), linkedid: U, did: TRUNK,
  });
  // post-call survey: only when the operator hangs up without transferring (the PBX sends the client to
  // [operator-baho]); about half of the clients stay on the line and press 1–5
  if (transfers.length === 0 && surveyRand() < 0.45) {
    const rated = t + ring + talk + 4 + Math.floor(surveyRand() * 6);
    const score = [5, 5, 5, 5, 4, 4, 4, 3, 2, 1][Math.floor(surveyRand() * 10)];
    ratings.push(
      `(${ts(d, rated)}, ${U}, ${U}, ${q(QUEUE)}, ${q(answeredBy)}, ${q(`Operator ${answeredBy}`)}, ` +
        `${q(`Local/${answeredBy}@from-queue/n`)}, ${q(caller)}, ${score})`,
    );
  }
  // blind transfers: the operator's Local;2 peer is redirected to from-internal-xfer
  let tx = t + ring + talk;
  for (const x of transfers) {
    const xring = int(3, 12);
    row({
      calldate: ts(d, tx), clid, src: caller, dst: x.to, dcontext: 'from-internal-xfer', channel: `${lc}2`,
      dstchannel: `SIP/${x.to}-${chan()}`, lastapp: 'Dial', lastdata: `SIP/${x.to},,tr`,
      duration: xring + (x.answered ? x.talk : 0), billsec: x.answered ? x.talk : 0,
      disposition: x.answered ? 'ANSWERED' : 'NO ANSWER', uniqueid: uid(d, tx, seq++), linkedid: U, did: TRUNK,
    });
    if (!x.answered) break;
    tx += xring + x.talk;
  }
}

function outboundCall(d, start, ext, number, outcome) {
  const n0 = seq++;
  const V = uid(d, start, n0);
  const ring = int(5, 30);
  const talk = outcome === 'ANSWERED' ? int(20, 420) : 0;
  const dialed = chance(0.15) ? `0${number}` : number;
  row({
    calldate: ts(d, start), clid: `"Operator ${ext}" <${ext}>`, src: ext, dst: dialed, dcontext: 'from-internal',
    channel: `SIP/${ext}-${chan()}`, dstchannel: outcome === 'FAILED' ? '' : `SIP/${TRUNK}-${chan()}`, lastapp: 'Dial',
    lastdata: `SIP/${TRUNK}/${dialed},300,Tt`, duration: outcome === 'FAILED' ? 1 : ring + talk, billsec: talk,
    disposition: outcome, uniqueid: V, linkedid: V,
    recordingfile:
      outcome === 'ANSWERED'
        ? `CONCAT('out-${dialed}-${ext}-', DATE_FORMAT(${ts(d, start)}, '%Y%m%d-%H%i%s'), '-', ${V}, '.wav')`
        : "''",
  });
}

function internalCall(d, start, from, to) {
  const n0 = seq++;
  const V = uid(d, start, n0);
  const answered = chance(0.8);
  const talk = answered ? int(10, 120) : 0;
  row({
    calldate: ts(d, start), clid: `"Operator ${from}" <${from}>`, src: from, dst: to, dcontext: 'from-internal',
    channel: `SIP/${from}-${chan()}`, dstchannel: `SIP/${to}-${chan()}`, lastapp: 'Dial', lastdata: `SIP/${to},20,tr`,
    duration: talk + int(3, 15), billsec: talk, disposition: answered ? 'ANSWERED' : 'NO ANSWER', uniqueid: V, linkedid: V,
  });
}

// --- hourly traffic profile (weights for 08..20) ---
const HOUR_WEIGHTS = { 8: 4, 9: 8, 10: 11, 11: 12, 12: 8, 13: 7, 14: 10, 15: 11, 16: 10, 17: 8, 18: 5, 19: 3, 20: 2 };
function randomWorkSecond() {
  const total = Object.values(HOUR_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [h, w] of Object.entries(HOUR_WEIGHTS)) {
    r -= w;
    if (r <= 0) return Number(h) * 3600 + int(0, 3599);
  }
  return 20 * 3600;
}
function randomOffHoursSecond() {
  return chance(0.6) ? int(21 * 3600, 23 * 3600 + 3599) : int(6 * 3600, 8 * 3600 - 1);
}

const todayTashkent = new Date(Date.now() + 5 * 3600_000);
for (let d = DAYS - 1; d >= 0; d--) {
  const dayOfWeek = new Date(todayTashkent.getTime() - d * 86_400_000).getUTCDay(); // 0 Sun .. 6 Sat
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;
  const inboundCount = isSunday ? 0 : isSaturday ? int(12, 20) : int(110, 160);
  const offHoursCount = isSunday ? int(6, 12) : int(5, 12);
  const missedToday = [];

  for (let i = 0; i < inboundCount; i++) {
    const start = randomWorkSecond();
    const hidden = chance(0.03);
    const client = chance(0.25) ? pick(frequentClients) : chance(0.05) ? pick(cityNumbers) : pick(clients);
    const caller = hidden ? pick(['anonymous', '']) : presentedNumber(client);
    const roll = rand();
    const ops = isSaturday ? ['101', '111'] : chance(0.85) ? MAIN_OPS : [...MAIN_OPS, ...SECONDARY_OPS];
    if (roll < 0.07) {
      inboundCall(d, start, { caller, outcome: 'ivr' });
    } else if (roll < 0.22) {
      const rung = chance(0.6) ? [pick(ops)] : chance(0.5) ? [pick(ops), pick(ops)] : [];
      inboundCall(d, start, { caller, outcome: 'abandoned', members: [...new Set(rung)] });
      if (!hidden) missedToday.push({ client, at: start });
    } else {
      const answeredBy = pick(ops);
      const rung = chance(0.3) ? [pick(ops.filter((o) => o !== answeredBy))] : [];
      let transfers = [];
      if (chance(0.08)) {
        const to1 = pick(MAIN_OPS.filter((o) => o !== answeredBy));
        transfers = [{ to: to1, talk: int(30, 240), answered: chance(0.9) }];
        if (transfers[0].answered && chance(0.3)) {
          transfers.push({ to: pick(MAIN_OPS.filter((o) => o !== answeredBy && o !== to1)), talk: int(30, 200), answered: true });
        }
      }
      inboundCall(d, start, { caller, outcome: 'answered', members: rung, answeredBy, talk: int(15, 480), transfers });
    }
  }

  for (let i = 0; i < offHoursCount; i++) {
    const client = pick(clients);
    inboundCall(d, randomOffHoursSecond(), { caller: presentedNumber(client), outcome: 'after_hours' });
  }

  if (!isSunday) {
    // callbacks to today's abandoned callers + regular outbound work
    for (const m of missedToday) {
      if (!chance(0.7)) continue;
      const ext = pick(MAIN_OPS);
      const at = Math.min(m.at + int(300, 5400), 20 * 3600 + 3000);
      outboundCall(d, at, ext, m.client, pick(['ANSWERED', 'ANSWERED', 'ANSWERED', 'NO ANSWER', 'BUSY']));
    }
    const outboundCount = isSaturday ? int(3, 6) : int(25, 45);
    for (let i = 0; i < outboundCount; i++) {
      const ext = chance(0.75) ? pick(MAIN_OPS) : pick(SECONDARY_OPS);
      const outcome = pick(['ANSWERED', 'ANSWERED', 'ANSWERED', 'ANSWERED', 'NO ANSWER', 'NO ANSWER', 'BUSY', 'FAILED']);
      outboundCall(d, randomWorkSecond(), ext, chance(0.1) ? pick(cityNumbers) : pick(clients), outcome);
    }
    const internalCount = isSaturday ? 0 : int(2, 6);
    for (let i = 0; i < internalCount; i++) {
      const from = pick(MAIN_OPS);
      internalCall(d, randomWorkSecond(), from, pick(MAIN_OPS.filter((o) => o !== from)));
    }
  }
}

const COLUMNS =
  'calldate, clid, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, duration, billsec, disposition, uniqueid, linkedid, recordingfile, did, accountcode';
const chunks = [];
for (let i = 0; i < rows.length; i += 400) {
  chunks.push(`INSERT INTO cdr (${COLUMNS}) VALUES\n${rows.slice(i, i + 400).join(',\n')};`);
}
const SURVEY_COLUMNS = 'rated_at, uniqueid, linkedid, queue, operator_ext, operator_name, member_interface, src, baho';
const surveyChunks = [];
for (let i = 0; i < ratings.length; i += 400) {
  surveyChunks.push(`INSERT INTO operator_baho (${SURVEY_COLUMNS}) VALUES\n${ratings.slice(i, i + 400).join(',\n')};`);
}

const sql = `-- GENERATED by infra/dev-pbx/seed/generate-cdr-seed.mjs (days=${DAYS}). Do not edit by hand.
-- Fake CDR history relative to "today in Asia/Tashkent" at load time. Re-running replaces previous generated rows.
SET time_zone = '+05:00';
SET @base := DATE(UTC_TIMESTAMP() + INTERVAL 5 HOUR);

USE asterisk;
INSERT IGNORE INTO users (extension, name) VALUES
  ('203', 'Operator 203'), ('204', 'Operator 204'), ('205', 'Operator 205');

USE asteriskcdrdb;
DELETE FROM cdr WHERE accountcode = 'devseed';

${chunks.join('\n\n')}

-- Drop calls that would start in the future (today's traffic is generated for the whole day).
DELETE FROM cdr WHERE accountcode = 'devseed' AND linkedid IN (
  SELECT l FROM (
    SELECT linkedid AS l FROM cdr WHERE accountcode = 'devseed' GROUP BY linkedid
    HAVING MIN(calldate) > (UTC_TIMESTAMP() + INTERVAL 5 HOUR)
  ) AS future_calls
);

-- Post-call survey answers for the generated calls (the dev table holds generated rows only).
CREATE TABLE IF NOT EXISTS operator_baho (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT, rated_at DATETIME NOT NULL, uniqueid VARCHAR(32) NOT NULL,
  linkedid VARCHAR(32) NOT NULL DEFAULT '', queue VARCHAR(20) NOT NULL DEFAULT '',
  operator_ext VARCHAR(20) NOT NULL DEFAULT '', operator_name VARCHAR(80) NOT NULL DEFAULT '',
  member_interface VARCHAR(80) NOT NULL DEFAULT '', src VARCHAR(80) NOT NULL DEFAULT '', baho TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uq_uniqueid (uniqueid), KEY idx_rated_at (rated_at),
  KEY idx_operator (operator_ext, rated_at), KEY idx_linkedid (linkedid)
);
DELETE FROM operator_baho;

${surveyChunks.join('\n\n')}

DELETE FROM operator_baho WHERE uniqueid NOT IN (SELECT uniqueid FROM cdr WHERE accountcode = 'devseed');
`;

if (args.out) {
  const out = path.resolve(process.cwd(), args.out);
  writeFileSync(out, sql);
  console.error(
    `Wrote ${rows.length} CDR rows + ${ratings.length} survey answers (${DAYS} days) to ${path.relative(process.cwd(), out)}`,
  );
} else {
  process.stdout.write(sql);
  console.error(`Generated ${rows.length} CDR rows + ${ratings.length} survey answers (${DAYS} days)`);
}
