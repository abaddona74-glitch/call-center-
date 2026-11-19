import type { CallAnalysisStats } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { calls, inbound, internal, outbound } from '../../../pbx/calls/testing/cdr-fixtures.js';
import { operatorStats } from '../../stats/domain/metrics.js';
import {
  buildOperatorKpi,
  type OperatorKpiInput,
  type OperatorTicketFact,
  qualityByOperator,
  talkSince,
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
        tickets: new Map([['118', { created: 3, callbacks: 0, closed: 0, closedLate: 0 }]]),
        presence: new Map([['118', { onlineSec: 100, pauseSec: 0, pauses: [] }]]),
      }),
    );
    expect(rows.some((r) => r.ext === '118')).toBe(false);
  });

  it('operators known only from tickets / presence get a row with zero calls', () => {
    const rows = buildOperatorKpi(
      base({ tickets: new Map([['150', { created: 2, callbacks: 1, closed: 1, closedLate: 0 }]]) }),
    );
    expect(rows.find((r) => r.ext === '150')).toMatchObject({
      name: null,
      calls: { total: 0, talkSec: 0 },
      tickets: { created: 2, callbacks: 1, closed: 1, closedLate: 0 },
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
  it('talk since the presence log started / online time, one decimal, capped at 100', () => {
    const since = tk('2026-11-17T10:00:00').getTime();
    const talk = talkSince(day, 'working', since);
    // 101: only the 10:30 call (60 s; the 09:10 one is before the log, the 21:30 one after hours).
    expect(talk.get('101')).toBe(60);
    expect(talk.get('103')).toBe(40 + 80);
    const rows = buildOperatorKpi(
      base({
        talkForShare: talk,
        presence: new Map([
          ['101', { onlineSec: 1800, pauseSec: 0, pauses: [] }],
          ['103', { onlineSec: 60, pauseSec: 0, pauses: [] }],
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

describe('ticketsByOperator', () => {
  const period = [tk('2026-11-17T00:00:00'), tk('2026-11-18T00:00:00')] as const;
  const t = (over: Partial<OperatorTicketFact>): OperatorTicketFact => ({
    creatorExtension: null,
    createdAt: tk('2026-11-10T10:00:00'),
    closedByExtension: null,
    closedAt: null,
    callbackDueAt: null,
    callbackOutcome: null,
    ...over,
  });

  it('created, callbacks, closed and closed after the callback deadline — in the period only', () => {
    const out = ticketsByOperator(
      [
        t({ creatorExtension: '101', createdAt: tk('2026-11-17T09:00:00') }),
        t({ creatorExtension: '101', createdAt: tk('2026-11-16T23:59:59') }), // before the period
        t({
          closedByExtension: '103',
          closedAt: tk('2026-11-17T11:00:00'),
          callbackDueAt: tk('2026-11-17T12:00:00'),
          callbackOutcome: 'informed',
        }),
        t({
          closedByExtension: '103',
          closedAt: tk('2026-11-17T15:00:00'),
          callbackDueAt: tk('2026-11-17T12:00:00'),
          callbackOutcome: 'informed',
        }),
        // force-closed by the superuser: not an operator's callback
        t({ closedByExtension: '100', closedAt: tk('2026-11-17T15:00:00'), callbackOutcome: 'forced' }),
      ],
      [
        { extension: '103', startedAt: tk('2026-11-17T10:55:00') },
        { extension: '103', startedAt: tk('2026-11-17T14:50:00') },
        { extension: '103', startedAt: tk('2026-11-18T00:00:00') }, // after the period
        { extension: null, startedAt: tk('2026-11-17T14:00:00') },
      ],
      period,
    );
    expect(Object.fromEntries(out)).toEqual({
      '101': { created: 1, callbacks: 0, closed: 0, closedLate: 0 },
      '103': { created: 0, callbacks: 2, closed: 2, closedLate: 1 },
    });
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
