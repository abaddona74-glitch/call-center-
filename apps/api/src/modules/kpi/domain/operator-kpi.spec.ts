import type { CallAnalysisStats } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { calls, inbound, internal, outbound } from '../../../pbx/calls/testing/cdr-fixtures.js';
import { operatorStats, surveyByOperator } from '../../stats/domain/metrics.js';
import {
  buildOperatorKpi,
  matchesOperatorCall,
  operatorTicketIds,
  ratedCallScores,
  type OperatorKpiInput,
  type OperatorTicketFact,
  qualityByOperator,
  talkWhileOnline,
  ticketsByOperator,
} from './operator-kpi.js';

/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`${wall}+05:00`);

// Tue 2026-11-17: 101 answers (100 s, after 103's phone rang), 103 rejects nothing; 101 → 103 transfer; outbound by 103;
// an after-hours answered call by 101 (outside the working calendar) and an internal call (never counted).
const day = calls(
  inbound({
    at: '2026-11-17 09:10:00',
    caller: '998901111111',
    rung: ['103'],
    outcome: 'answered',
    answeredBy: '101',
    talk: 100,
  }),
  inbound({
    at: '2026-11-17 10:30:00',
    caller: '901111111',
    outcome: 'answered',
    answeredBy: '101',
    talk: 60,
    transfers: [{ to: '103', talk: 40 }],
  }),
  outbound({ at: '2026-11-17 12:00:00', ext: '103', number: '902222222', disposition: 'ANSWERED', talk: 80 }),
  outbound({ at: '2026-11-17 12:05:00', ext: '103', number: '905555555', disposition: 'NO ANSWER' }),
  internal({ at: '2026-11-17 12:10:00', from: '101', to: '103' }),
  inbound({ at: '2026-11-17 21:30:00', caller: '906666666', outcome: 'answered', answeredBy: '101', talk: 30 }),
);

const names = new Map([
  ['101', 'Aziza'],
  ['103', 'Bobur'],
  ['118', 'Excluded'],
]);
const base = (over: Partial<OperatorKpiInput> = {}): OperatorKpiInput => ({
  calls: day,
  scope: 'working',
  names,
  groupOf: () => 'main',
  excluded: new Set(['118']),
  tickets: new Map(),
  quality: new Map(),
  presence: new Map(),
  talkForShare: new Map(),
  ...over,
});

describe('buildOperatorKpi — calls', () => {
  it('calls are exactly the statistics page rows (same function, same scope)', () => {
    const rows = buildOperatorKpi(base());
    const stats = operatorStats(day, {
      scope: 'working',
      names,
      groupOf: () => 'main',
      knownExtensions: names.keys(),
      excluded: new Set(['118']),
    });
    expect(rows.map((r) => r.ext)).toEqual(stats.map((s) => s.ext));
    for (const s of stats) {
      const { ext, name, group, surveyCount, surveyAvg, ...calls } = s;
      const row = rows.find((r) => r.ext === ext)!;
      expect(row).toMatchObject({ name, group, calls, survey: { count: surveyCount, avg: surveyAvg } });
    }
    expect(rows.find((r) => r.ext === '101')?.calls).toMatchObject({ answered: 1, transferredOut: 1, talkSec: 160 });
    expect(rows.find((r) => r.ext === '103')?.calls).toMatchObject({
      transferredIn: 1,
      outbound: 1,
      outboundAttempts: 2,
      missed: 1,
      missedNoAnswer: 1,
    });
  });

  it('scope "all" adds the after-hours call', () => {
    const rows = buildOperatorKpi(base({ scope: 'all' }));
    expect(rows.find((r) => r.ext === '101')?.calls?.answered).toBe(2);
  });

  it('excluded operators get no row even with tickets, quality or online time', () => {
    const rows = buildOperatorKpi(
      base({
        tickets: new Map([['118', { created: 3, callbacks: 0, callbackAttempts: 0, closed: 0, closedLate: 0 }]]),
        presence: new Map([['118', { onlineSec: 100, pauseSec: 0, pauses: [] }]]),
      }),
    );
    expect(rows.some((r) => r.ext === '118')).toBe(false);
  });

  it('operators known only from tickets / presence get a row with zero calls', () => {
    const rows = buildOperatorKpi(
      base({
        tickets: new Map([['150', { created: 2, callbacks: 1, callbackAttempts: 2, closed: 1, closedLate: 0 }]]),
      }),
    );
    expect(rows.find((r) => r.ext === '150')).toMatchObject({
      name: null,
      calls: { total: 0, talkSec: 0 },
      tickets: { created: 2, callbacks: 1, callbackAttempts: 2, closed: 1, closedLate: 0 },
      quality: null,
    });
  });

  it('PBX unavailable: no call figures and no talk share, the rest stays', () => {
    const rows = buildOperatorKpi(
      base({
        calls: null,
        presence: new Map([['101', { onlineSec: 3600, pauseSec: 600, pauses: [{ reason: 'Tushlik', sec: 600 }] }]]),
      }),
    );
    expect(rows.find((r) => r.ext === '101')).toMatchObject({
      calls: null,
      presence: { onlineSec: 3600, pauseSec: 600, talkShare: null },
    });
  });
});

describe('talk share', () => {
  it('talk while online in the log / online time, one decimal, capped at 100', () => {
    const iv = (extension: string, state: 'online' | 'paused' | 'offline', from: string, to: string | null) => ({
      extension,
      state,
      pauseReason: null,
      startedAt: tk(`2026-11-17T${from}`),
      endedAt: to ? tk(`2026-11-17T${to}`) : null,
    });
    const talk = talkWhileOnline(
      day,
      'working',
      [
        iv('101', 'offline', '00:00:00', '10:00:00'),
        iv('101', 'online', '10:00:00', null),
        iv('103', 'paused', '09:00:00', '11:00:00'),
        iv('103', 'offline', '11:00:00', null),
      ],
      tk('2026-11-17T23:00:00').getTime(),
    );
    // 101: only the 10:30 call (the 09:10 one was before 101 was online, the 21:30 one is after hours).
    expect(talk.get('101')).toBe(60);
    // 103: the 10:30 transfer (paused counts as online), not the 12:00 outbound (offline then).
    expect(talk.get('103')).toBe(40);
    const rows = buildOperatorKpi(
      base({
        talkForShare: talk,
        presence: new Map([
          ['101', { onlineSec: 1800, pauseSec: 0, pauses: [] }],
          ['103', { onlineSec: 30, pauseSec: 0, pauses: [] }],
        ]),
      }),
    );
    expect(rows.find((r) => r.ext === '101')?.presence.talkShare).toBe(3.3);
    expect(rows.find((r) => r.ext === '103')?.presence.talkShare).toBe(100);
  });

  it('no online time: no share', () => {
    const rows = buildOperatorKpi(base({ talkForShare: new Map([['101', 60]]) }));
    expect(rows.find((r) => r.ext === '101')?.presence).toEqual({
      onlineSec: 0,
      pauseSec: 0,
      pauses: [],
      talkShare: null,
    });
  });
});

describe('ticketsByOperator / operatorTicketIds', () => {
  const period = [tk('2026-11-17T00:00:00'), tk('2026-11-18T00:00:00')] as const;
  let id = 0;
  const t = (over: Partial<OperatorTicketFact>): OperatorTicketFact => ({
    id: ++id,
    creatorExtension: null,
    createdAt: tk('2026-11-10T10:00:00'),
    closedByExtension: null,
    closedAt: null,
    callbackDueAt: null,
    callbackOutcome: null,
    ...over,
  });
  const tickets = [
    t({ id: 1, creatorExtension: '101', createdAt: tk('2026-11-17T09:00:00') }),
    t({ id: 2, creatorExtension: '101', createdAt: tk('2026-11-16T23:59:59') }), // before the period
    t({
      id: 3,
      closedByExtension: '103',
      closedAt: tk('2026-11-17T11:00:00'),
      callbackDueAt: tk('2026-11-17T12:00:00'),
      callbackOutcome: 'informed',
    }),
    t({
      id: 4,
      closedByExtension: '103',
      closedAt: tk('2026-11-17T15:00:00'),
      callbackDueAt: tk('2026-11-17T12:00:00'),
      callbackOutcome: 'informed',
    }),
    // force-closed by the superuser: not an operator's callback
    t({ id: 5, closedByExtension: '100', closedAt: tk('2026-11-17T15:00:00'), callbackOutcome: 'forced' }),
  ];
  const attempts = [
    { ticketId: 3, extension: '103', startedAt: tk('2026-11-17T10:55:00') },
    { ticketId: 4, extension: '103', startedAt: tk('2026-11-17T14:00:00') },
    { ticketId: 4, extension: '103', startedAt: tk('2026-11-17T14:50:00') },
    { ticketId: 4, extension: '103', startedAt: tk('2026-11-18T00:00:00') }, // after the period
    { ticketId: 3, extension: null, startedAt: tk('2026-11-17T14:00:00') },
  ];

  it('created, callbacks (tickets and attempts), closed and closed after the callback deadline — in the period only', () => {
    expect(Object.fromEntries(ticketsByOperator(tickets, attempts, period))).toEqual({
      '101': { created: 1, callbacks: 0, callbackAttempts: 0, closed: 0, closedLate: 0 },
      '103': { created: 0, callbacks: 2, callbackAttempts: 3, closed: 2, closedLate: 1 },
    });
  });

  it('the lists behind the numbers', () => {
    const ids = operatorTicketIds(tickets, attempts, period);
    expect([...(ids.get('101')?.created ?? [])]).toEqual([1]);
    expect([...(ids.get('103')?.callbacks ?? [])].sort()).toEqual([3, 4]);
    expect([...(ids.get('103')?.closedLate ?? [])]).toEqual([4]);
    expect(ids.has('100')).toBe(false);
  });
});

describe('the calls behind each call number', () => {
  const stats = operatorStats(day, {
    scope: 'working',
    names,
    groupOf: () => 'main',
    knownExtensions: names.keys(),
  });
  const count = (
    ext: string,
    metric: Parameters<typeof matchesOperatorCall>[2],
    scope: 'working' | 'all' = 'working',
  ) => day.filter((c) => matchesOperatorCall(c, ext, metric, scope)).length;

  it.each(['101', '103'])('lists add up to the statistics numbers (%s)', (ext) => {
    const s = stats.find((r) => r.ext === ext)!;
    expect(count(ext, 'answered')).toBe(s.answered + s.transferredIn);
    expect(count(ext, 'missed')).toBe(s.missed);
    expect(count(ext, 'missedNoAnswer')).toBe(s.missedNoAnswer);
    expect(count(ext, 'missedRejected')).toBe(s.missedRejected);
    expect(count(ext, 'outbound')).toBe(s.outbound);
    expect(count(ext, 'outboundAttempts')).toBe(s.outboundAttempts);
    // talkSec / avgTalkSec are over the calls the operator talked on
    const talked = day.filter((c) => matchesOperatorCall(c, ext, 'talked', 'working'));
    expect(talked.reduce((sum, c) => sum + (c.operatorTalk[ext] ?? 0), 0)).toBe(s.talkSec);
    expect(Math.round(s.talkSec / talked.length)).toBe(s.avgTalkSec);
  });

  it('never internal calls; after-hours calls only for scope "all"', () => {
    expect(count('101', 'answered', 'all')).toBe(count('101', 'answered') + 1);
    expect(day.some((c) => c.direction === 'internal' && matchesOperatorCall(c, '101', 'talked', 'all'))).toBe(false);
  });

  it('rated calls follow the survey attribution (surveyByOperator)', () => {
    const answered = day.filter((c) => c.direction === 'inbound' && c.status === 'answered');
    const ratings = answered.map((c, i) => ({
      uniqueid: c.id,
      linkedid: c.id,
      operatorExt: c.firstOperator ?? '',
      score: (i % 5) + 1,
    }));
    for (const scope of ['working', 'all'] as const) {
      const totals = surveyByOperator(ratings, day, scope);
      for (const ext of ['101', '103']) {
        const scores = ratedCallScores(ratings, day, scope, ext);
        expect(scores.size, `${ext} ${scope}`).toBe(totals.get(ext)?.count ?? 0);
        // Each call carries the score the client pressed, and they add up to the operator's total.
        expect([...scores.values()].reduce((a, b) => a + b, 0), `${ext} ${scope}`).toBe(totals.get(ext)?.sum ?? 0);
        for (const [id, score] of scores) expect(score).toBe(ratings.find((r) => r.linkedid === id)?.score);
      }
    }
  });
});

describe('qualityByOperator', () => {
  it('maps the «Tahlil» operator aggregates (current version) without the legacy greeting score', () => {
    const ops: CallAnalysisStats['operators'] = [
      {
        ext: '101',
        name: null,
        analyzed: 4,
        avgOverall: 7.5,
        avgScores: { greeting: null, politeness: 4.5, understanding: 4, solution: 3.75, closing: 3 },
        redFlagCalls: 1,
        resolvedRate: 75,
      },
    ];
    expect(qualityByOperator(ops).get('101')).toEqual({
      analysed: 4,
      avgOverall: 7.5,
      avgScores: { politeness: 4.5, understanding: 4, solution: 3.75, closing: 3 },
      redFlagCalls: 1,
      handledRate: 75,
    });
  });
});
