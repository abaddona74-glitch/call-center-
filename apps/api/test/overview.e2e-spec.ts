import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CALL_ANALYSIS_PROMPT_VERSION } from '@cc/shared';
import '../src/modules/call-analysis/call-analysis.tables.js';
import type { CdrRecordingRow } from '../src/modules/recordings/domain/cdr-recording.js';
import { RecordingsRepository } from '../src/modules/recordings/recordings.repository.js';
import { LocalRecordingStorage } from '../src/modules/recordings/storage/local-recording-storage.js';
import { RECORDING_STORAGE } from '../src/modules/recordings/storage/recording-storage.port.js';
import { CdrRepository } from '../src/pbx/calls/cdr.repository.js';
import { inbound, outbound } from '../src/pbx/calls/testing/cdr-fixtures.js';
import { FakeCdrRepository } from './cdr/fake-cdr-repository.js';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT } from './support/e2e-app.js';

/**
 * The overview dashboard (owner, 19.11.2026): observers see ONLY it (no other page or API), the superuser
 * sees it too, executives and operators do not. Figures over tickets seeded straight into Postgres and fixture
 * CDR rows (FakeCdrRepository); the calls block must equal /api/stats for the same period.
 *   E2E_DATABASE_URL=postgres://callcenter:callcenter@127.0.0.1:54320/callcenter_ov_test pnpm --filter @cc/api test:e2e overview
 */
let e2e: E2eApp;
let root: Client;
let observer: Client;
let executive: Client;
let operator: Client;
let anon: Client;
const ids: Record<string, number> = {};

// 2026-11-16 (Monday), working hours.
const cdr = [
  inbound({ at: '2026-11-16 09:00:00', caller: '998901234567', outcome: 'answered', answeredBy: '101', talk: 100 }),
  inbound({ at: '2026-11-16 09:30:00', caller: '935551122', outcome: 'abandoned', rung: ['101'] }),
  inbound({ at: '2026-11-16 10:30:00', caller: 'anonymous', outcome: 'ivr' }),
  outbound({ at: '2026-11-16 11:00:00', ext: '101', number: '935551122', disposition: 'ANSWERED', talk: 60 }),
].flat();

const ANSWERED_ID = (() => {
  const leg = cdr.find((r) => r.recordingfile)!;
  return leg.linkedid || leg.uniqueid;
})();

/** Recording lookup over the fixture CDR (the real repository reads the PBX). */
class FakeRecordingsRepository {
  async rowsForCall(uid: string): Promise<CdrRecordingRow[]> {
    return cdr
      .filter((r) => r.uniqueid === uid || r.linkedid === uid)
      .map((r) => ({
        calldate: r.calldate,
        uniqueid: r.uniqueid,
        linkedid: r.linkedid ?? '',
        src: r.src,
        dst: r.dst,
        cnum: '',
        channel: r.channel,
        dstchannel: r.dstchannel,
        recordingfile: r.recordingfile,
      }));
  }
  async recordedCallsInRange(): Promise<CdrRecordingRow[]> {
    return [];
  }
}
let monitor: string;

const PERIOD = 'from=2026-11-01&to=2026-11-10';
/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`${wall}+05:00`);

beforeAll(async () => {
  process.env.SFTP_HOST = '';
  monitor = await mkdtemp(path.join(tmpdir(), 'cc-overview-monitor-'));
  for (const leg of cdr.filter((r) => r.recordingfile)) {
    const day = leg.calldate.slice(0, 10).replace(/-/g, '/');
    await mkdir(path.join(monitor, day), { recursive: true });
    await writeFile(path.join(monitor, day, leg.recordingfile), Buffer.alloc(16_044, 7));
  }
  e2e = await createE2eApp((b) =>
    b
      .overrideProvider(CdrRepository)
      .useValue(new FakeCdrRepository(cdr, [{ extension: '101', name: 'Aziza' }]))
      .overrideProvider(RECORDING_STORAGE)
      .useValue(new LocalRecordingStorage(monitor))
      .overrideProvider(RecordingsRepository)
      .useValue(new FakeRecordingsRepository()),
  );
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  anon = new Client(e2e);
  ids.observer = await createUser(root, { username: 'kuzatuvchi', password: 'Watch-Pass-123', role: 'observer' });
  ids.e1 = await createUser(root, { username: 'masul_toshkent', password: 'Exec-Pass-1234', role: 'executive' });
  ids.e2 = await createUser(root, { username: 'masul_samarqand', password: 'Exec-Pass-1234', role: 'executive' });
  await createUser(root, { username: 'op101', password: 'Oper-Pass-1234', extension: '101' });
  observer = await loginAs(e2e, 'kuzatuvchi', 'Watch-Pass-123');
  executive = await loginAs(e2e, 'masul_toshkent', 'Exec-Pass-1234');
  operator = await loginAs(e2e, 'op101', 'Oper-Pass-1234');

  const regions = await e2e.db.selectFrom('ticketRegions').select(['id', 'code']).execute();
  const region = (code: string) => regions.find((r) => r.code === code)!.id;
  ids.tash = region('toshkent-shahri');
  ids.sam = region('samarqand');
  await e2e.db
    .insertInto('ticketExecutiveRegions')
    .values([
      { userId: ids.e1, regionId: ids.tash },
      { userId: ids.e2, regionId: ids.sam },
    ])
    .execute();

  const created = tk('2026-11-03T10:00:00');
  const due = tk('2026-11-06T10:00:00');
  const insert = async (v: Record<string, unknown>) =>
    (
      await e2e.db
        .insertInto('tickets')
        .values({ creatorLabel: 'Aziza', createdAt: created, dueAt: due, ...v })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  // Toshkent shahri: closed in time; held after the due date.
  ids.closed = await insert({
    status: 'closed',
    regionId: ids.tash,
    assigneeUserId: ids.e1,
    assigneeLabel: 'Masul Toshkent',
    resolvedByUserId: ids.e1,
    resolvedByLabel: 'Masul Toshkent',
    resolution: 'done',
    resolvedAt: tk('2026-11-04T10:00:00'),
    callbackDueAt: tk('2026-11-05T10:00:00'),
    closedAt: tk('2026-11-04T22:00:00'),
  });
  ids.held = await insert({
    status: 'in_progress',
    regionId: ids.tash,
    assigneeUserId: ids.e1,
    assigneeLabel: 'Masul Toshkent',
  });
  // Samarqand: rejected late, the callback is overdue too.
  ids.rejected = await insert({
    status: 'callback_pending',
    regionId: ids.sam,
    resolvedByUserId: ids.e2,
    resolvedByLabel: 'Masul Samarqand',
    resolution: 'rejected',
    resolvedAt: tk('2026-11-07T10:00:00'),
    callbackDueAt: tk('2026-11-09T10:00:00'),
  });
  // Without a region ("Hududsiz"), never taken.
  ids.noRegion = await insert({ status: 'new', regionId: null });
  // Created before the period: only "now" counts it.
  ids.older = await insert({
    status: 'new',
    regionId: ids.sam,
    createdAt: tk('2026-10-20T10:00:00'),
    dueAt: tk('2026-10-23T10:00:00'),
  });
  await e2e.db
    .insertInto('ticketEvents')
    .values([
      { ticketId: ids.closed, kind: 'assigned', actorUserId: ids.e1 },
      { ticketId: ids.held, kind: 'assigned', actorUserId: ids.e1 },
      { ticketId: ids.rejected, kind: 'assigned', actorUserId: ids.e2 },
    ])
    .execute();

  // AI analyses of 2026-11-16: two of the current prompt version, one of an older one (never mixed in).
  const analyses: Array<[id: string, version: string, overall: number, outcome: string, flags: string[], end: string]> =
    [
      [ANSWERED_ID, CALL_ANALYSIS_PROMPT_VERSION, 9, 'resolved', [], 'positive'],
      ['ov-a2', CALL_ANALYSIS_PROMPT_VERSION, 4, 'unresolved', ['rudeness'], 'negative'],
      ['ov-a3', 'v1-old', 2, 'resolved', [], 'neutral'],
    ];
  const text = (ru: string) => JSON.stringify({ uz: ru, ru });
  for (const [callId, promptVersion, overall, outcome, flags, end] of analyses) {
    await e2e.db
      .insertInto('callAnalysisJobs')
      .values({
        callId,
        callStartedAt: tk('2026-11-16T09:00:00'),
        callDate: '2026-11-16',
        direction: 'inbound',
        operatorExt: '101',
        talkSec: 100,
        recordingFile: 'fake.wav',
        source: 'manual',
        status: 'done',
      } as never)
      .execute();
    await e2e.db
      .insertInto('callAnalyses')
      .values({
        callId,
        promptVersion,
        llmModel: 'e2e',
        thinking: false,
        llmMs: 1,
        llmAttempts: 1,
        topic: text('Ключ ЭЦП'),
        topicKey: 'ключ эцп',
        subtopic: text('срок'),
        problem: text('секретная проблема'),
        summary: text('секретный итог'),
        recommendation: text('совет'),
        outcome,
        scoreGreeting: null,
        greetingPhrase: null,
        scorePoliteness: 4,
        scoreUnderstanding: 4,
        scoreSolution: 4,
        scoreClosing: 4,
        overall,
        redFlags: JSON.stringify(flags.map((code) => ({ code, note: 'x', at: null }))),
        redFlagCodes: flags,
        sentimentStart: 'neutral',
        sentimentEnd: end,
        language: 'uz',
      } as never)
      .execute();
  }
});
afterAll(async () => {
  await e2e?.close();
  if (monitor) await rm(monitor, { recursive: true, force: true });
});

describe('access', () => {
  it('needs a session', async () => {
    expect((await anon.get(`/overview/tickets?${PERIOD}`)).status).toBe(401);
    expect((await anon.get(`/overview/calls?${PERIOD}`)).status).toBe(401);
    expect((await anon.get(`/overview/quality?${PERIOD}`)).status).toBe(401);
  });

  it('observer and superuser see the overview; executives ("Mas\'ul shaxslar") and operators do not', async () => {
    for (const [name, c, status] of [
      ['observer', observer, 200],
      ['superuser', root, 200],
      ['executive', executive, 403],
      ['operator', operator, 403],
    ] as const) {
      expect((await c.get(`/overview/tickets?${PERIOD}`)).status, name).toBe(status);
      expect((await c.get('/overview/calls?from=2026-11-16&to=2026-11-16')).status, name).toBe(status);
      expect((await c.get('/overview/quality?from=2026-11-16&to=2026-11-16')).status, name).toBe(status);
    }
  });

  it('observer: the overview permission and nothing else', async () => {
    const me = (await observer.get('/auth/me')).body.user;
    // + the staff KPI page (kpi.e2e-spec.ts), owner 19.11.2026
    expect(me.permissions).toEqual(['overview.view', 'kpi.view']);
  });

  it('observer: every other API answers 403 (or 404 for tickets it cannot see)', async () => {
    const forbidden = [
      '/live/snapshot',
      '/presence/online',
      '/callbacks',
      '/callbacks/1',
      '/cdr/calls?from=2026-11-16&to=2026-11-16',
      '/stats/summary?from=2026-11-16&to=2026-11-16',
      '/stats/operators?from=2026-11-16&to=2026-11-16',
      '/stats/series?from=2026-11-16&to=2026-11-16',
      '/export/excel?from=2026-11-16&to=2026-11-16',
      '/recordings/tree',
      '/tickets?view=all',
      '/tickets/reports?from=2026-11-01&to=2026-11-10',
      '/tickets/directories',
      '/contacts',
      '/blacklist',
      '/excluded-operators',
      '/tools/config',
      '/users',
      '/audit',
      '/call-analysis/stats?from=2026-11-16&to=2026-11-16',
      '/call-analysis/calls/ov-a1',
    ];
    for (const path of forbidden) expect((await observer.get(path)).status, path).toBe(403);
    expect((await observer.get(`/tickets/${ids.held}`)).status).toBe(404);
    expect((await observer.post('/telephony/originate', { to: '901234567' })).status).toBe(403);
    expect((await observer.post('/callbacks/1/notes', { text: 'salom' })).status).toBe(403);
  });

  it('the live snapshot and callbacks stay open to the roles that have them (operator, superuser)', async () => {
    for (const c of [operator, root]) {
      expect((await c.get('/live/snapshot')).status).toBe(200);
      expect((await c.get('/callbacks')).status).toBe(200);
    }
    // "Mas'ul" (executive) works with tickets only (#14)
    expect((await executive.get('/live/snapshot')).status).toBe(403);
    expect((await executive.get('/callbacks')).status).toBe(403);
  });
});

describe('tickets', () => {
  it('the period: tickets created in it, in their current state (ticket-report SLA rules)', async () => {
    const r = await observer.get(`/overview/tickets?${PERIOD}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      range: { from: '2026-11-01', to: '2026-11-10' },
      region: null,
      slaWorkingDays: 3,
      callbackSlaWorkingDays: 1,
      totals: {
        received: 4,
        taken: 3,
        done: 1,
        rejected: 1,
        closed: 1,
        open: 3,
        overdue: 3,
        overdueOpen: 2,
        overdueLate: 1,
        callbackOverdue: 1,
        avgResolutionHours: 60, // (24 + 96) / 2
        avgCloseHours: 36,
      },
    });
    expect(r.body.byStatus).toContainEqual({ status: 'closed', count: 1 });
    expect(r.body.byStatus).toContainEqual({ status: 'callback_pending', count: 1 });
  });

  it('now: overdue and callback-overdue whatever the creation date, oldest first, no citizen data', async () => {
    const { now } = (await observer.get(`/overview/tickets?${PERIOD}`)).body;
    expect(now.overdue).toBe(3);
    expect(now.callbackOverdue).toBe(1);
    expect(now.oldestOverdue.map((t: { id: number }) => t.id)).toEqual([ids.older, ids.held, ids.noRegion]);
    expect(now.oldestOverdue[1]).toEqual({
      id: ids.held,
      code: `TK-${ids.held}`,
      regionCode: 'toshkent-shahri',
      regionNameUz: 'Toshkent shahri',
      regionNameRu: 'г. Ташкент',
      status: 'in_progress',
      dueAt: '2026-11-06T05:00:00.000Z',
      executive: 'Masul Toshkent',
    });
  });

  it('regions for the map: all 14, "Hududsiz" last; executives with their regions', async () => {
    const body = (await observer.get(`/overview/tickets?${PERIOD}`)).body;
    expect(body.regions).toHaveLength(15);
    const row = (code: string | null) => body.regions.find((x: { code: string | null }) => x.code === code);
    expect(row('toshkent-shahri')).toMatchObject({ received: 2, closed: 1, overdue: 1, overdueNow: 1, executives: 1 });
    expect(row('samarqand')).toMatchObject({ received: 1, overdue: 1, callbackOverdue: 1, overdueNow: 1 });
    expect(row('andijon')).toMatchObject({ received: 0, overdueNow: 0, executives: 0 });
    expect(body.regions.at(-1)).toMatchObject({ code: null, nameUz: 'Hududsiz', received: 1, overdueNow: 1 });

    expect(body.executives).toEqual([
      {
        userId: ids.e1,
        name: 'Masul Toshkent',
        regions: ['toshkent-shahri'],
        taken: 2,
        done: 1,
        rejected: 0,
        overdue: 1,
        avgResolutionHours: 24,
        holdingNow: 1,
        overdueNow: 1,
      },
      {
        userId: ids.e2,
        name: 'Masul Samarqand',
        regions: ['samarqand'],
        taken: 1,
        done: 0,
        rejected: 1,
        overdue: 1,
        avgResolutionHours: 96,
        holdingNow: 0,
        overdueNow: 0,
      },
    ]);
  });

  it('a region filter narrows everything but the map rows; "none" = without a region', async () => {
    const sam = (await observer.get(`/overview/tickets?${PERIOD}&region=samarqand`)).body;
    expect(sam.region).toBe('samarqand');
    expect(sam.totals.received).toBe(1);
    expect(sam.now.overdue).toBe(1);
    expect(sam.executives.map((e: { userId: number }) => e.userId)).toEqual([ids.e2]);
    expect(sam.regions).toHaveLength(15);

    const none = (await observer.get(`/overview/tickets?${PERIOD}&region=none`)).body;
    expect(none.totals.received).toBe(1);
    expect(none.executives).toEqual([]);
  });

  it('validates the query', async () => {
    expect((await observer.get(`/overview/tickets?${PERIOD}&region=atlantida`)).status).toBe(400);
    expect((await observer.get(`/overview/tickets?${PERIOD}&region=DROP%20TABLE`)).status).toBe(400);
    expect((await observer.get('/overview/tickets?from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect((await observer.get('/overview/tickets?from=2025-01-01&to=2026-11-10')).status).toBe(400);
    expect((await observer.get('/overview/tickets?from=yesterday&to=2026-11-10')).status).toBe(400);
  });
});

describe('calls', () => {
  it('the same numbers as the statistics page for the period and scope', async () => {
    const q = 'from=2026-11-16&to=2026-11-16';
    const overview = (await observer.get(`/overview/calls?${q}`)).body;
    const summary = (await root.get(`/stats/summary?${q}`)).body;
    const series = (await root.get(`/stats/series?${q}`)).body;
    expect(overview.summary).toEqual(summary);
    expect(overview.hourly).toEqual(series.hourly);
    expect(overview.daily).toEqual(series.daily);
    expect(overview.summary.inbound).toMatchObject({ offered: 3, answered: 1, abandoned: 1, ivr: 1 });
    expect(overview.summary.outbound.connected).toBe(1);

    const all = (await observer.get(`/overview/calls?${q}&scope=all`)).body;
    expect(all.summary.range.scope).toBe('all');
    expect(all.hourly).toHaveLength(24);
  });
});

describe('call quality (AI analysis)', () => {
  it('the «Tahlil» totals of the current prompt version, the share of answered calls, no texts', async () => {
    const q = '?from=2026-11-16&to=2026-11-16';
    const overview = (await observer.get(`/overview/quality${q}`)).body;
    const tahlil = (await root.get(`/call-analysis/stats${q}`)).body;
    expect(overview).toMatchObject({
      promptVersion: CALL_ANALYSIS_PROMPT_VERSION,
      analyzed: 2, // the v1-old row is left out
      answeredCalls: 2, // fixture: 1 answered inbound + 1 connected outbound
      analyzedShare: 100,
      avgOverall: 6.5,
      redFlagCalls: 1,
      handledRate: 50,
      sentimentEnd: { positive: 1, neutral: 0, negative: 1 },
    });
    expect(overview.avgOverall).toBe(tahlil.totals.avgOverall);
    expect(overview.outcomes).toEqual(tahlil.outcomes);
    expect(overview.redFlags).toEqual(tahlil.redFlags);
    expect(JSON.stringify(overview)).not.toMatch(/секрет|ov-a1|Ключ/);
  });

  it('a period without analysed calls (analysis off) is an empty, valid answer', async () => {
    const r = await observer.get('/overview/quality?from=2026-11-01&to=2026-11-10');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ analyzed: 0, avgOverall: null, handledRate: null, redFlagCalls: 0 });
  });

  it('validates the query', async () => {
    expect((await observer.get('/overview/quality?from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect((await observer.get('/overview/quality?from=x&to=2026-11-01')).status).toBe(400);
  });
});

describe('details: the records behind each number (list total == the number)', () => {
  const total = async (c: Client, query: string) => {
    const r = await c.get(query);
    expect(r.status, query).toBe(200);
    return r.body.total as number;
  };

  it('tickets: period totals, now, regions and Mas’ul rows', async () => {
    const o = (await observer.get(`/overview/tickets?${PERIOD}`)).body;
    for (const m of [
      'received',
      'taken',
      'done',
      'rejected',
      'closed',
      'open',
      'overdue',
      'overdueOpen',
      'overdueLate',
      'callbackOverdue',
    ]) {
      expect(await total(observer, `/overview/tickets/list?${PERIOD}&metric=${m}`), m).toBe(o.totals[m]);
    }
    expect(await total(observer, `/overview/tickets/list?${PERIOD}&metric=nowOverdue`)).toBe(o.now.overdue);
    expect(await total(observer, `/overview/tickets/list?${PERIOD}&metric=nowCallbackOverdue`)).toBe(
      o.now.callbackOverdue,
    );
    for (const s of o.now.byStatus) {
      expect(
        await total(observer, `/overview/tickets/list?${PERIOD}&metric=nowStatus&status=${s.status}`),
        s.status,
      ).toBe(s.count);
    }
    for (const row of o.regions) {
      const region = row.code ?? 'none';
      const q = `/overview/tickets/list?${PERIOD}&region=${region}`;
      expect(await total(observer, `${q}&metric=received`), region).toBe(row.received);
      expect(await total(observer, `${q}&metric=closed`), region).toBe(row.closed);
      expect(await total(observer, `${q}&metric=overdue`), region).toBe(row.overdue);
      expect(await total(observer, `${q}&metric=nowOverdue`), region).toBe(row.overdueNow);
    }
    for (const e of o.executives) {
      const q = `/overview/tickets/list?${PERIOD}&executive=${e.userId}`;
      expect(await total(observer, `${q}&metric=exTaken`), e.name).toBe(e.taken);
      expect(await total(observer, `${q}&metric=exDone`), e.name).toBe(e.done);
      expect(await total(observer, `${q}&metric=exRejected`), e.name).toBe(e.rejected);
      expect(await total(observer, `${q}&metric=exOverdue`), e.name).toBe(e.overdue);
      expect(await total(observer, `${q}&metric=exHolding`), e.name).toBe(e.holdingNow);
      expect(await total(observer, `${q}&metric=exOverdueNow`), e.name).toBe(e.overdueNow);
    }
    // with a region filter, the Mas’ul numbers of that region
    const sam = (await observer.get(`/overview/tickets?${PERIOD}&region=samarqand`)).body;
    expect(await total(observer, `/overview/tickets/list?${PERIOD}&region=samarqand&metric=received`)).toBe(
      sam.totals.received,
    );
  });

  it('tickets: list rows, search, pages, validation', async () => {
    const r = (await observer.get(`/overview/tickets/list?${PERIOD}&metric=received&pageSize=2`)).body;
    expect(r).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(r.items).toHaveLength(2);
    expect(Object.keys(r.items[0]).sort()).toEqual(
      [
        'closedAt',
        'code',
        'createdAt',
        'dueAt',
        'executive',
        'id',
        'organization',
        'overdueHours',
        'regionCode',
        'regionNameRu',
        'regionNameUz',
        'status',
      ].sort(),
    );
    const held = (await observer.get(`/overview/tickets/list?${PERIOD}&metric=received&search=TK-${ids.held}`)).body;
    expect(held.items.map((x: { id: number }) => x.id)).toEqual([ids.held]);
    expect(held.items[0]).toMatchObject({
      executive: 'Masul Toshkent',
      status: 'in_progress',
      regionCode: 'toshkent-shahri',
    });
    expect(held.items[0].overdueHours).toBeGreaterThan(24);
    const masul = (await observer.get(`/overview/tickets/list?${PERIOD}&metric=received&search=samarqand`)).body;
    expect(masul.total).toBe(1);
    expect((await observer.get(`/overview/tickets/list?${PERIOD}&metric=exTaken`)).status).toBe(400); // no executive
    expect((await observer.get(`/overview/tickets/list?${PERIOD}&metric=nowStatus`)).status).toBe(400); // no status
    expect((await observer.get(`/overview/tickets/list?${PERIOD}&metric=everything`)).status).toBe(400);
    expect((await executive.get(`/overview/tickets/list?${PERIOD}&metric=received`)).status).toBe(403);
    expect((await operator.get(`/overview/tickets/list?${PERIOD}&metric=received`)).status).toBe(403);
  });

  it('calls: every summary number, both scopes', async () => {
    for (const scope of ['working', 'all']) {
      const q = `from=2026-11-16&to=2026-11-16&scope=${scope}`;
      const s = (await observer.get(`/overview/calls?${q}`)).body.summary;
      const expected: Record<string, number> = {
        total: s.totalCalls,
        inbound: s.inbound.offered,
        outbound: s.outbound.connected,
        answered: s.inbound.answered,
        unanswered: s.inbound.offered - s.inbound.answered,
        abandoned: s.inbound.abandoned,
        ivr: s.inbound.ivr,
        afterHours: s.inbound.afterHours,
        talked: s.inbound.answered + s.outbound.connected,
      };
      for (const [metric, n] of Object.entries(expected)) {
        expect(await total(observer, `/overview/calls/list?${q}&metric=${metric}`), `${scope} ${metric}`).toBe(n);
      }
    }
    const list = (await observer.get('/overview/calls/list?from=2026-11-16&to=2026-11-16&metric=answered')).body;
    expect(list.items[0]).toMatchObject({
      id: ANSWERED_ID,
      clientNumber: '901234567',
      hasRecording: true,
      recordingFile: null,
    });
    const found = (
      await observer.get('/overview/calls/list?from=2026-11-16&to=2026-11-16&metric=total&search=901234567')
    ).body;
    expect(found.total).toBe(1);
  });

  it('quality: every number, the analysed calls of the current version', async () => {
    const q = 'from=2026-11-16&to=2026-11-16';
    const quality = (await observer.get(`/overview/quality?${q}`)).body;
    expect(await total(observer, `/overview/quality/list?${q}&metric=analyzed`)).toBe(quality.analyzed);
    expect(await total(observer, `/overview/quality/list?${q}&metric=flagged`)).toBe(quality.redFlagCalls);
    for (const f of quality.redFlags)
      expect(await total(observer, `/overview/quality/list?${q}&metric=flag&flag=${f.code}`), f.code).toBe(f.count);
    for (const o of quality.outcomes)
      expect(await total(observer, `/overview/quality/list?${q}&metric=outcome&outcome=${o.outcome}`), o.outcome).toBe(
        o.count,
      );
    for (const [s, n] of Object.entries(quality.sentimentEnd))
      expect(await total(observer, `/overview/quality/list?${q}&metric=sentiment&sentiment=${s}`), s).toBe(n);
    // the real CDR call comes with its client number; an analysed call the CDR lacks still makes a row
    const all = (await observer.get(`/overview/quality/list?${q}&metric=analyzed`)).body;
    expect(all.items.map((x: { id: string }) => x.id).sort()).toEqual([ANSWERED_ID, 'ov-a2'].sort());
    expect(all.items.find((x: { id: string }) => x.id === ANSWERED_ID).clientNumber).toBe('901234567');
    expect((await observer.get(`/overview/quality/list?${q}&metric=flag`)).status).toBe(400);
  });
});

describe('details: read-only cards', () => {
  it('a ticket card for the observer: any ticket, no actions, nothing changes', async () => {
    const d = await observer.get(`/overview/tickets/${ids.rejected}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ id: ids.rejected, code: `TK-${ids.rejected}`, status: 'callback_pending' });
    expect(Object.values(d.body.actions).some(Boolean)).toBe(false);
    expect((await observer.get('/overview/tickets/999999')).status).toBe(404);
    // the tickets API itself stays closed
    expect((await observer.get(`/tickets/${ids.rejected}`)).status).toBe(404);
    expect((await executive.get(`/overview/tickets/${ids.rejected}`)).status).toBe(403);
  });

  it('a call card, its analysis and its recording; every play is audited', async () => {
    const d = await observer.get(`/overview/calls/${ANSWERED_ID}`);
    expect(d.status).toBe(200);
    expect(d.body.call).toMatchObject({ id: ANSWERED_ID, hasRecording: true, recordingFile: null });
    expect(d.body.legs.length).toBeGreaterThan(0);
    const a = await observer.get(`/overview/calls/${ANSWERED_ID}/analysis`);
    expect(a.status).toBe(200);
    expect(a.body.analysis).toMatchObject({ overall: 9, outcome: 'resolved' });
    const rec = await observer.get(`/overview/calls/${ANSWERED_ID}/recording`);
    expect(rec.status).toBe(200);
    expect(rec.body.file.size).toBe(16_044);

    await e2e.db.deleteFrom('auditLog').where('action', 'like', 'recordings.%').execute();
    const stream = await observer.get(`/overview/calls/${ANSWERED_ID}/recording/stream`).set('Range', 'bytes=0-99');
    expect(stream.status).toBe(206);
    const download = await observer.get(`/overview/calls/${ANSWERED_ID}/recording/stream?download=1`);
    expect(download.status).toBe(200);
    const audit = await e2e.db
      .selectFrom('auditLog')
      .select(['action', 'target', 'actorUserId'])
      .where('action', 'like', 'recordings.%')
      .orderBy('id')
      .execute();
    expect(audit).toEqual([
      { action: 'recordings.play', target: `call:${ANSWERED_ID}`, actorUserId: ids.observer },
      { action: 'recordings.download', target: `call:${ANSWERED_ID}`, actorUserId: ids.observer },
    ]);
    // the recordings, history and analysis APIs stay closed to observers
    expect((await observer.get(`/recordings/calls/${ANSWERED_ID}/stream`)).status).toBe(403);
    expect((await observer.get(`/cdr/calls/${ANSWERED_ID}`)).status).toBe(403);
    expect((await observer.get(`/call-analysis/calls/${ANSWERED_ID}`)).status).toBe(403);
    for (const c of [executive, operator]) {
      expect((await c.get(`/overview/calls/${ANSWERED_ID}`)).status).toBe(403);
      expect((await c.get(`/overview/calls/${ANSWERED_ID}/recording/stream`)).status).toBe(403);
    }
  });

  it('the superuser keeps working as before (both the overview and the regular APIs)', async () => {
    expect((await root.get(`/overview/calls/${ANSWERED_ID}`)).status).toBe(200);
    expect((await root.get(`/cdr/calls/${ANSWERED_ID}`)).body.call.recordingFile).toMatch(/\.wav$/);
    expect((await root.get(`/tickets/${ids.rejected}`)).status).toBe(200);
  });
});
