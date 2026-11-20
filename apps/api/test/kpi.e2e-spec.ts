import { CALL_ANALYSIS_PROMPT_VERSION } from '@cc/shared';
import '../src/modules/call-analysis/call-analysis.tables.js';
import '../src/modules/operator-presence/operator-presence.tables.js';
import { CdrRepository } from '../src/pbx/calls/cdr.repository.js';
import { inbound, outbound } from '../src/pbx/calls/testing/cdr-fixtures.js';
import { FakeCdrRepository } from './cdr/fake-cdr-repository.js';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT } from './support/e2e-app.js';

/**
 * The staff KPI page «KPI xodimlar» (owner, 19.11.2026): observers and the superuser only. Operators' calls must equal
 * /api/stats/operators; executives are attributed by the ticket events; online time comes from the presence log.
 *   E2E_DATABASE_URL=postgres://callcenter:callcenter@127.0.0.1:54320/callcenter_kpi_test pnpm --filter @cc/api test:e2e kpi
 */
let e2e: E2eApp;
let root: Client;
let observer: Client;
let executive: Client;
let operator: Client;
let anon: Client;
const ids: Record<string, number> = {};

// Monday 2026-11-16.
const a = inbound({
  at: '2026-11-16 09:00:00',
  caller: '998901234567',
  outcome: 'answered',
  answeredBy: '101',
  talk: 100,
});
const b = inbound({
  at: '2026-11-16 09:30:00',
  caller: '935551122',
  rung: ['103'],
  outcome: 'answered',
  answeredBy: '101',
  talk: 30,
});
const c = inbound({
  at: '2026-11-16 10:00:00',
  caller: '901234567',
  outcome: 'answered',
  answeredBy: '103',
  talk: 50,
  transfers: [{ to: '120', talk: 40 }],
});
const d = outbound({ at: '2026-11-16 11:00:00', ext: '103', number: '935551122', disposition: 'ANSWERED', talk: 60 });
const e = inbound({ at: '2026-11-16 22:00:00', caller: '907777777', outcome: 'answered', answeredBy: '101', talk: 20 });
const cdr = [...a, ...b, ...c, ...d, ...e];
const callId = (rows: { linkedid: string; uniqueid: string }[]) => rows[0].linkedid || rows[0].uniqueid;
const ratings = [
  { uniqueid: callId(a), linkedid: callId(a), operatorExt: '101', score: 5 },
  { uniqueid: callId(c), linkedid: callId(c), operatorExt: '103', score: 2 }, // transferred: 120 talked last
];
const names = [
  { extension: '101', name: 'Aziza' },
  { extension: '103', name: 'Bobur' },
  { extension: '120', name: 'Kamola' },
];

const DAY = 'from=2026-11-16&to=2026-11-16';
/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`${wall}+05:00`);
/** Deadlines far ahead: "overdue now" must not depend on today's date. */
const FAR = tk('2027-06-01T09:00:00');

beforeAll(async () => {
  e2e = await createE2eApp((builder) =>
    builder.overrideProvider(CdrRepository).useValue(new FakeCdrRepository(cdr, names, ratings)),
  );
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  anon = new Client(e2e);
  ids.observer = await createUser(root, { username: 'kuzatuvchi', password: 'Watch-Pass-123', role: 'observer' });
  ids.e1 = await createUser(root, { username: 'masul_toshkent', password: 'Exec-Pass-1234', role: 'executive' });
  ids.e2 = await createUser(root, { username: 'masul_samarqand', password: 'Exec-Pass-1234', role: 'executive' });
  ids.op101 = await createUser(root, { username: 'op101', password: 'Oper-Pass-1234', extension: '101' });
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

  const insert = async (v: Record<string, unknown>) =>
    (
      await e2e.db
        .insertInto('tickets')
        .values({ creatorLabel: 'Aziza', dueAt: FAR, ...v })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  // --- operators: tickets opened by 101, callbacks and closes by 103 ---------------------------------
  await insert({ creatorExtension: '101', createdAt: tk('2026-11-16T09:05:00'), regionId: ids.tash });
  await insert({ creatorExtension: '101', createdAt: tk('2026-11-16T09:35:00'), regionId: ids.tash });
  await insert({ creatorExtension: '101', createdAt: tk('2026-11-10T09:00:00'), regionId: ids.tash }); // before
  const closedLate = await insert({
    status: 'closed',
    createdAt: tk('2026-11-10T09:00:00'),
    callbackDueAt: tk('2026-11-16T10:00:00'),
    closedAt: tk('2026-11-16T12:00:00'),
    closedByExtension: '103',
    closedByLabel: 'Bobur',
    callbackOutcome: 'informed',
  });
  await insert({
    status: 'closed',
    createdAt: tk('2026-11-10T09:00:00'),
    callbackDueAt: tk('2026-11-16T18:00:00'),
    closedAt: tk('2026-11-16T15:00:00'),
    closedByExtension: '103',
    closedByLabel: 'Bobur',
    callbackOutcome: 'unresolved',
  });
  await insert({
    status: 'closed',
    createdAt: tk('2026-11-10T09:00:00'),
    closedAt: tk('2026-11-16T16:00:00'),
    closedByExtension: '100',
    closedByLabel: 'root',
    callbackOutcome: 'forced', // the superuser's force-close is no operator callback
  });
  await e2e.db
    .insertInto('ticketCalls')
    .values(
      ['2026-11-16T11:50:00', '2026-11-16T11:55:00'].map((at) => ({
        ticketId: closedLate,
        kind: 'callback' as const,
        extension: '103',
        startedAt: tk(at),
        recordingDeadline: tk(at),
      })),
    )
    .execute();

  // --- executives: T1 taken and done by e1; T2 forwarded by e1 to Samarqand, taken by e2 --------------
  ids.t1 = await insert({
    status: 'callback_pending',
    createdAt: tk('2026-11-16T09:00:00'),
    regionId: ids.tash,
    resolution: 'done',
    resolvedByUserId: ids.e1,
    resolvedByLabel: 'masul_toshkent',
    resolvedAt: tk('2026-11-16T12:00:00'),
  });
  ids.t2 = await insert({
    status: 'in_progress',
    createdAt: tk('2026-11-16T09:30:00'),
    regionId: ids.sam,
    assigneeUserId: ids.e2,
    assigneeLabel: 'masul_samarqand',
  });
  await e2e.db
    .insertInto('ticketEvents')
    .values([
      { ticketId: ids.t1, kind: 'created', toRegionId: ids.tash, createdAt: tk('2026-11-16T09:00:00') },
      { ticketId: ids.t1, kind: 'assigned', actorUserId: ids.e1, createdAt: tk('2026-11-16T10:00:00') },
      { ticketId: ids.t1, kind: 'done', actorUserId: ids.e1, createdAt: tk('2026-11-16T12:00:00') },
      { ticketId: ids.t1, kind: 'returned', createdAt: tk('2026-11-16T12:00:00') },
      { ticketId: ids.t2, kind: 'created', toRegionId: ids.tash, createdAt: tk('2026-11-16T09:30:00') },
      {
        ticketId: ids.t2,
        kind: 'forwarded',
        actorUserId: ids.e1,
        fromRegionId: ids.tash,
        toRegionId: ids.sam,
        createdAt: tk('2026-11-16T10:30:00'),
      },
      { ticketId: ids.t2, kind: 'assigned', actorUserId: ids.e2, createdAt: tk('2026-11-16T11:30:00') },
    ])
    .execute();

  // --- presence log of 101: offline overnight, online 08–12, lunch 12–13, online 13–22 ----------------
  await e2e.db
    .insertInto('operatorPresenceLog')
    .values(
      (
        [
          ['offline', null, '2026-11-15T20:00:00', '2026-11-16T08:00:00'],
          ['online', null, '2026-11-16T08:00:00', '2026-11-16T12:00:00'],
          ['paused', 'Tushlik', '2026-11-16T12:00:00', '2026-11-16T13:00:00'],
          ['online', null, '2026-11-16T13:00:00', '2026-11-16T22:00:00'],
        ] as const
      ).map(([state, pauseReason, from, to]) => ({
        extension: '101',
        state,
        pauseReason,
        startedAt: tk(from),
        endedAt: tk(to),
        lastSeenAt: tk(to),
      })),
    )
    .execute();

  // --- AI analyses of 101 (two of the current prompt version, one older one that never mixes in) -------
  const text = (ru: string) => JSON.stringify({ uz: ru, ru });
  const analyses: Array<[id: string, version: string, overall: number, outcome: string, flags: string[]]> = [
    [callId(a), CALL_ANALYSIS_PROMPT_VERSION, 9, 'resolved', []],
    [callId(b), CALL_ANALYSIS_PROMPT_VERSION, 4, 'unresolved', ['rudeness']],
    ['kpi-old', 'v1-old', 2, 'resolved', []],
  ];
  for (const [id, promptVersion, overall, outcome, flags] of analyses) {
    await e2e.db
      .insertInto('callAnalysisJobs')
      .values({
        callId: id,
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
        callId: id,
        promptVersion,
        llmModel: 'e2e',
        thinking: false,
        llmMs: 1,
        llmAttempts: 1,
        topic: text('Ключ ЭЦП'),
        topicKey: 'ключ эцп',
        subtopic: text('срок'),
        problem: text('проблема'),
        summary: text('итог'),
        recommendation: text('совет'),
        outcome,
        scoreGreeting: null,
        greetingPhrase: null,
        scorePoliteness: 5,
        scoreUnderstanding: 4,
        scoreSolution: overall > 5 ? 5 : 2,
        scoreClosing: 3,
        overall,
        redFlags: JSON.stringify(flags.map((code) => ({ code, note: 'x', at: null }))),
        redFlagCodes: flags,
        sentimentStart: 'neutral',
        sentimentEnd: 'neutral',
        language: 'uz',
      } as never)
      .execute();
  }
});
afterAll(async () => {
  await e2e?.close();
});

describe('access', () => {
  it('needs a session', async () => {
    expect((await anon.get(`/kpi/operators?${DAY}`)).status).toBe(401);
    expect((await anon.get(`/kpi/executives?${DAY}`)).status).toBe(401);
  });

  it('observer and superuser: 200; operator and executive ("Mas\'ul"): 403', async () => {
    for (const [name, client, status] of [
      ['observer', observer, 200],
      ['superuser', root, 200],
      ['executive', executive, 403],
      ['operator', operator, 403],
    ] as const) {
      expect((await client.get(`/kpi/operators?${DAY}`)).status, name).toBe(status);
      expect((await client.get(`/kpi/executives?${DAY}`)).status, name).toBe(status);
    }
  });

  it('observer: the overview dashboard and the KPI page, nothing else', async () => {
    const me = (await observer.get('/auth/me')).body.user;
    expect(me.permissions).toEqual(['situation.view', 'overview.view', 'kpi.view']);
    for (const path of [
      `/stats/operators?${DAY}`,
      `/call-analysis/stats?${DAY}`,
      '/live/snapshot',
      '/tickets?view=all',
    ])
      expect((await observer.get(path)).status, path).toBe(403);
  });

  it('validates the period and the scope', async () => {
    expect((await root.get('/kpi/operators?from=2026-11-17&to=2026-11-16')).status).toBe(400);
    expect((await root.get(`/kpi/operators?${DAY}&scope=night`)).status).toBe(400);
    expect((await root.get('/kpi/operators?from=2024-01-01&to=2026-11-16')).status).toBe(400);
    expect((await root.get('/kpi/executives?from=2024-01-01&to=2026-11-16')).status).toBe(400);
    expect((await root.get('/kpi/executives?from=16.11.2026&to=2026-11-16')).status).toBe(400);
  });
});

describe('operators', () => {
  type Row = { ext: string; [k: string]: unknown };
  const byExt = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.ext, r]));

  it.each(['working', 'all'] as const)('calls and ratings equal /api/stats/operators (scope %s)', async (scope) => {
    const [kpi, stats] = await Promise.all([
      observer.get(`/kpi/operators?${DAY}&scope=${scope}`),
      root.get(`/stats/operators?${DAY}&scope=${scope}`),
    ]);
    expect(kpi.status).toBe(200);
    expect(stats.status).toBe(200);
    expect(kpi.body).toMatchObject({ callsAvailable: true, surveyAvailable: true, range: { scope } });
    const rows = byExt(kpi.body.operators);
    expect(stats.body.operators.length).toBeGreaterThan(0);
    for (const s of stats.body.operators) {
      const { ext, name, group, surveyCount, surveyAvg, ...calls } = s;
      expect(rows[ext], ext).toMatchObject({ name, group, calls, survey: { count: surveyCount, avg: surveyAvg } });
    }
  });

  it('the after-hours call counts only for scope "all"', async () => {
    const working = byExt((await root.get(`/kpi/operators?${DAY}`)).body.operators);
    const all = byExt((await root.get(`/kpi/operators?${DAY}&scope=all`)).body.operators);
    expect(working['101']).toMatchObject({ calls: { answered: 2 }, survey: { count: 1, avg: 5 } });
    expect(all['101']).toMatchObject({ calls: { answered: 3 } });
    expect(working['103']).toMatchObject({ calls: { outbound: 1, missed: 1, missedNoAnswer: 1 } });
    expect(working['120']).toMatchObject({ calls: { transferredIn: 1 }, survey: { count: 1, avg: 2 } });
  });

  it('tickets and callbacks by extension', async () => {
    const rows = byExt((await observer.get(`/kpi/operators?${DAY}`)).body.operators);
    expect(rows['101'].tickets).toEqual({ created: 2, callbacks: 0, callbackAttempts: 0, closed: 0, closedLate: 0 });
    // two calls to the citizen of one ticket: one ticket called back, two attempts
    expect(rows['103'].tickets).toEqual({ created: 0, callbacks: 1, callbackAttempts: 2, closed: 2, closedLate: 1 });
    expect(rows['100']).toBeUndefined(); // the force-close is not counted
  });

  it('AI quality: the current prompt version only, with the coverage of the period', async () => {
    const r = (await observer.get(`/kpi/operators?${DAY}`)).body;
    expect(r.quality).toEqual({
      promptVersion: CALL_ANALYSIS_PROMPT_VERSION,
      analysed: 2,
      answeredCalls: 5, // a, b, c, e answered + d connected, all hours
      days: ['2026-11-16'],
    });
    expect(byExt(r.operators)['101'].quality).toEqual({
      analysed: 2,
      avgOverall: 6.5,
      avgScores: { politeness: 5, understanding: 4, solution: 3.5, closing: 3 },
      redFlagCalls: 1,
      handledRate: 50,
    });
    expect(byExt(r.operators)['103'].quality).toBeNull();
    // nothing analysed on another day
    const other = (await observer.get('/kpi/operators?from=2026-11-17&to=2026-11-17')).body;
    expect(other.quality).toMatchObject({ analysed: 0, days: [] });
  });

  it('online and pause time from the presence log, clipped to working time; talk share', async () => {
    const working = (await observer.get(`/kpi/operators?${DAY}`)).body;
    expect(working.presence).toEqual({ since: tk('2026-11-15T20:00:00').toISOString(), partial: false });
    expect(byExt(working.operators)['101'].presence).toEqual({
      onlineSec: 13 * 3600, // 08:00–21:00 (the 21:00–22:00 part is after hours)
      pauseSec: 3600,
      pauses: [{ reason: 'Tushlik', sec: 3600 }],
      talkShare: 0.3, // 130 s of working-time talk / 13 h
    });
    const all = (await observer.get(`/kpi/operators?${DAY}&scope=all`)).body;
    expect(byExt(all.operators)['101'].presence).toMatchObject({ onlineSec: 14 * 3600, pauseSec: 3600 });
    // A period that starts before the log: incomplete online time.
    const longer = (await observer.get('/kpi/operators?from=2026-11-14&to=2026-11-16')).body;
    expect(longer.presence.partial).toBe(true);
  });
});

describe('executives', () => {
  it('attributed by ticket events and the region at that moment', async () => {
    const r = await observer.get(`/kpi/executives?${DAY}`);
    expect(r.status).toBe(200);
    expect(r.body.slaWorkingDays).toBe(3);
    const rows = Object.fromEntries(
      r.body.executives.map((x: { name: string; totals: unknown }) => [x.name, x]),
    ) as Record<string, { totals: Record<string, unknown>; regions: Array<Record<string, unknown>> }>;
    expect(rows.masul_toshkent.totals).toEqual({
      arrived: 2, // T1 and T2 were created in Toshkent
      taken: 1,
      done: 1,
      rejected: 0,
      released: 0,
      forwarded: 1,
      late: 0,
      onTimeRate: 100,
      avgTakeHours: 1,
      avgResolveHours: 2,
      holdingNow: 0,
      overdueNow: 0,
    });
    expect(rows.masul_toshkent.regions).toEqual([
      expect.objectContaining({ code: 'toshkent-shahri', assigned: true, arrived: 2, taken: 1, forwarded: 1 }),
    ]);
    expect(rows.masul_samarqand.totals).toMatchObject({
      arrived: 1, // T2, forwarded in
      taken: 1,
      avgTakeHours: 1, // from the forward, not from the creation
      holdingNow: 1,
      overdueNow: 0,
    });
  });

  it('a day without events: assigned executives still listed with zeros', async () => {
    const r = await root.get('/kpi/executives?from=2026-11-17&to=2026-11-17');
    const names = r.body.executives.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(['masul_samarqand', 'masul_toshkent']);
    expect(r.body.executives.find((x: { name: string }) => x.name === 'masul_toshkent').totals).toMatchObject({
      arrived: 0,
      taken: 0,
      onTimeRate: null,
    });
  });

  it('no citizen data in the response', async () => {
    const body = JSON.stringify((await observer.get(`/kpi/executives?${DAY}`)).body);
    expect(body).not.toMatch(/9\d{8}/);
    const ops = JSON.stringify((await observer.get(`/kpi/operators?${DAY}`)).body);
    expect(ops).not.toContain('935551122');
    expect(ops).not.toContain('проблема');
  });
});

describe('details: the records behind each number', () => {
  const total = async (client: Client, path: string) => {
    const r = await client.get(path);
    expect(r.status, path).toBe(200);
    return r.body.total as number;
  };

  it('only observer and superuser; validated', async () => {
    const paths = [
      `/kpi/operators/calls?${DAY}&ext=101&metric=answered`,
      `/kpi/operators/tickets?${DAY}&ext=101&metric=created`,
      `/kpi/executives/tickets?${DAY}&user=${ids.e1}&metric=taken`,
    ];
    for (const path of paths) {
      expect((await anon.get(path)).status, path).toBe(401);
      expect((await operator.get(path)).status, path).toBe(403);
      expect((await executive.get(path)).status, path).toBe(403);
      expect((await observer.get(path)).status, path).toBe(200);
      expect((await root.get(path)).status, path).toBe(200);
    }
    expect((await root.get(`/kpi/operators/calls?${DAY}&ext=101&metric=nope`)).status).toBe(400);
    expect((await root.get(`/kpi/operators/calls?${DAY}&ext=1a&metric=answered`)).status).toBe(400);
    expect((await root.get(`/kpi/executives/tickets?${DAY}&user=${ids.e1}&metric=taken&region=atlantis`)).status).toBe(
      400,
    );
  });

  it('operator call lists add up to the operator numbers (scope working and all)', async () => {
    for (const scope of ['working', 'all'] as const) {
      const rows = Object.fromEntries(
        (await observer.get(`/kpi/operators?${DAY}&scope=${scope}`)).body.operators.map((r: { ext: string }) => [
          r.ext,
          r,
        ]),
      );
      for (const ext of ['101', '103', '120']) {
        const c = rows[ext].calls;
        const list = (metric: string) =>
          total(observer, `/kpi/operators/calls?${DAY}&scope=${scope}&ext=${ext}&metric=${metric}`);
        expect(await list('answered'), `${ext} ${scope}`).toBe(c.answered + c.transferredIn);
        expect(await list('missed')).toBe(c.missed);
        expect(await list('missedNoAnswer')).toBe(c.missedNoAnswer);
        expect(await list('missedRejected')).toBe(c.missedRejected);
        expect(await list('outbound')).toBe(c.outbound);
        expect(await list('outboundAttempts')).toBe(c.outboundAttempts);
        expect(await list('rated')).toBe(rows[ext].survey.count);
      }
    }
  });

  it("quality lists: the operator's analysed calls of the current prompt version", async () => {
    const list = (metric: string) => total(observer, `/kpi/operators/calls?${DAY}&ext=101&metric=${metric}`);
    expect(await list('analysed')).toBe(2);
    expect(await list('flagged')).toBe(1);
    expect(await list('handled')).toBe(1);
    expect(await total(observer, `/kpi/operators/calls?${DAY}&ext=103&metric=analysed`)).toBe(0);
    const items = (await observer.get(`/kpi/operators/calls?${DAY}&ext=101&metric=analysed`)).body.items;
    expect(items.map((i: { id: string }) => i.id).sort()).toEqual([callId(a), callId(b)].sort());
    expect(items[0]).not.toHaveProperty('recordingFile', expect.any(String));
  });

  it('operator ticket lists', async () => {
    const list = (ext: string, metric: string) =>
      total(observer, `/kpi/operators/tickets?${DAY}&ext=${ext}&metric=${metric}`);
    expect(await list('101', 'created')).toBe(2);
    expect(await list('103', 'callbacks')).toBe(1);
    expect(await list('103', 'closed')).toBe(2);
    expect(await list('103', 'closedLate')).toBe(1);
    const late = (await observer.get(`/kpi/operators/tickets?${DAY}&ext=103&metric=closedLate`)).body.items[0];
    expect(late).toMatchObject({ code: expect.stringMatching(/^TK-\d+$/), status: 'closed' });
    expect(JSON.stringify(late)).not.toMatch(/9\d{8}/);
  });

  it("Mas'ul ticket lists, whole row and per region, add up to the numbers", async () => {
    const list = (q: string) => total(observer, `/kpi/executives/tickets?${DAY}&${q}`);
    expect(await list(`user=${ids.e1}&metric=arrived`)).toBe(2);
    expect(await list(`user=${ids.e1}&metric=taken`)).toBe(1);
    expect(await list(`user=${ids.e1}&metric=forwarded`)).toBe(1);
    expect(await list(`user=${ids.e1}&metric=resolved`)).toBe(1);
    expect(await list(`user=${ids.e1}&metric=arrived&region=toshkent-shahri`)).toBe(2);
    expect(await list(`user=${ids.e1}&metric=arrived&region=samarqand`)).toBe(1);
    expect(await list(`user=${ids.e2}&metric=holding`)).toBe(1);
    expect(await list(`user=${ids.e2}&metric=taken&region=samarqand`)).toBe(1);
    expect(await list(`user=${ids.e2}&metric=taken&region=none`)).toBe(0);
    const taken = (await observer.get(`/kpi/executives/tickets?${DAY}&user=${ids.e1}&metric=taken`)).body.items;
    expect(taken.map((t: { id: number }) => t.id)).toEqual([ids.t1]);
  });

  it('the read-only cards come from the overview endpoints the observer already has', async () => {
    expect((await observer.get(`/overview/tickets/${ids.t1}`)).status).toBe(200);
    expect((await observer.get(`/overview/calls/${callId(a)}`)).status).toBe(200);
  });
});
