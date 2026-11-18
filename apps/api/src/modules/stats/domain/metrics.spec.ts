import { wallToIso } from '../../../common/time/business-time.js';
import { calls, inbound, internal, outbound, TEST_CALENDAR } from '../../../pbx/calls/testing/cdr-fixtures.js';
import {
  dailySeries,
  hourlySeries,
  lostClients,
  operatorStats,
  percent,
  summarize,
  surveyByOperator,
  topClients,
} from './metrics.js';

/**
 * A small fixture day (Tue 2026-11-17) + one Saturday call and one evening call:
 *  A 09:10 901111111 answered by 101 after 103 rang (talk 100)
 *  B 09:40 902222222 abandoned after 101 rang (rings 15 s + waits 20 s)
 *  C 10:05 903333333 IVR-only
 *  D 10:30 901111111 answered by 101, transferred 101→103 (talk 60 + 40)
 *  E 11:00 904444444 answered by 106, transferred 106→103→111 (30 + 20 + 50)
 *  F 11:30 hidden     answered by 103 (talk 45)
 *  G 12:00 outbound 101 → 902222222 answered (talk 80)   — reaches B's caller
 *  H 12:05 outbound 103 → 905555555 no answer
 *  I 12:10 internal 101 → 103
 *  J 21:30 906666666 after-hours announcement
 *  K Sat 2026-11-14 10:00 907777777 answered by 101 (outside the working calendar)
 */
const day = calls(
  inbound({
    at: '2026-11-17 09:10:00',
    caller: '998901111111',
    rung: ['103'],
    outcome: 'answered',
    answeredBy: '101',
    talk: 100,
  }),
  inbound({ at: '2026-11-17 09:40:00', caller: '902222222', rung: ['101'], outcome: 'abandoned', abandonAfter: 20 }),
  inbound({ at: '2026-11-17 10:05:00', caller: '903333333', outcome: 'ivr' }),
  inbound({
    at: '2026-11-17 10:30:00',
    caller: '901111111',
    outcome: 'answered',
    answeredBy: '101',
    talk: 60,
    transfers: [{ to: '103', talk: 40 }],
  }),
  inbound({
    at: '2026-11-17 11:00:00',
    caller: '904444444',
    outcome: 'answered',
    answeredBy: '106',
    talk: 30,
    transfers: [
      { to: '103', talk: 20 },
      { to: '111', talk: 50 },
    ],
  }),
  inbound({ at: '2026-11-17 11:30:00', caller: 'anonymous', outcome: 'answered', answeredBy: '103', talk: 45 }),
  outbound({ at: '2026-11-17 12:00:00', ext: '101', number: '902222222', disposition: 'ANSWERED', talk: 80 }),
  outbound({ at: '2026-11-17 12:05:00', ext: '103', number: '905555555', disposition: 'NO ANSWER' }),
  internal({ at: '2026-11-17 12:10:00', from: '101', to: '103', talk: 20 }),
  inbound({ at: '2026-11-17 21:30:00', caller: '906666666', outcome: 'after_hours' }),
  inbound({ at: '2026-11-14 10:00:00', caller: '907777777', outcome: 'answered', answeredBy: '101', talk: 30 }),
);
const range = { from: '2026-11-14', to: '2026-11-17' };
const names = new Map([
  ['101', 'Op A'],
  ['103', 'Op B'],
]);
const groupOf = (ext: string) => (Number(ext) < 200 ? 'main' : 'secondary');

describe('percent', () => {
  it('rounds to one decimal and never divides by zero', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('summarize', () => {
  it('working scope: only calls inside the working calendar', () => {
    const s = summarize(day, { ...range, scope: 'working' });
    expect(s.inbound).toMatchObject({
      offered: 6,
      answered: 4,
      abandoned: 1,
      ivr: 1,
      afterHours: 0,
      answerRate: 66.7,
      abandonRate: 16.7,
      hiddenNumbers: 1,
    });
    expect(s.outbound).toMatchObject({ attempts: 2, connected: 1, notConnected: 1, connectRate: 50 });
    expect(s.internal.calls).toBe(1);
    // "Jami" = inbound offered + outbound connected
    expect(s.totalCalls).toBe(7);
    // talk = Σ operator legs of answered inbound + connected outbound (internal excluded)
    expect(s.talk.totalSec).toBe(100 + 100 + 100 + 45 + 80);
    expect(s.talk.avgSec).toBe(Math.round(425 / 5));
    expect(s.transfers).toBe(3);
    expect(s.inbound.avgAbandonWaitSec).toBe(35);
  });

  it('all scope adds the evening and Saturday calls', () => {
    const s = summarize(day, { ...range, scope: 'all' });
    expect(s.inbound).toMatchObject({ offered: 8, answered: 5, afterHours: 1 });
    expect(s.totalCalls).toBe(9);
  });

  it('client counts: distinct normalized numbers, hidden numbers excluded', () => {
    const s = summarize(day, { ...range, scope: 'working' });
    // 901111111 twice (once as 998…), 902222222, 903333333, 904444444
    expect(s.inbound.clients).toBe(4);
    expect(s.inbound.answeredClients).toBe(2);
    expect(s.outbound.clients).toBe(1);
    expect(s.clients).toBe(4);
  });

  it('lost clients: missed and never reached later', () => {
    // 902222222 was called back (G) → not lost; 903333333 (IVR) was never reached → lost
    expect(summarize(day, { ...range, scope: 'working' }).inbound.lostClients).toBe(1);
    // with nothing that reaches them: 902222222, 903333333 and the after-hours 906666666
    expect(lostClients(day, [])).toBe(3);
  });
});

describe('operatorStats', () => {
  const rows = operatorStats(day, { scope: 'working', names, groupOf, knownExtensions: ['120'] });
  const by = Object.fromEntries(rows.map((r) => [r.ext, r]));

  it('credits each answered inbound call to the operator who finished it', () => {
    expect(by['101']).toMatchObject({
      name: 'Op A',
      answered: 1,
      transferredIn: 0,
      transferredOut: 1,
      outbound: 1,
      outboundAttempts: 1,
      missed: 1,
    });
    expect(by['103']).toMatchObject({
      answered: 1,
      transferredIn: 1,
      transferredOut: 1,
      outbound: 0,
      outboundAttempts: 1,
      missed: 1,
    });
    expect(by['106']).toMatchObject({ answered: 0, transferredIn: 0, transferredOut: 1 });
    expect(by['111']).toMatchObject({ answered: 0, transferredIn: 1 });
    const credited = rows.reduce((s, r) => s + r.answered + r.transferredIn, 0);
    expect(credited).toBe(summarize(day, { ...range, scope: 'working' }).inbound.answered);
  });

  it('total = answered + transferredIn + outbound; talk from own legs; avg per talked call', () => {
    expect(by['101']).toMatchObject({ total: 2, talkSec: 100 + 60 + 80, avgTalkSec: 80 });
    expect(by['103']).toMatchObject({ total: 2, talkSec: 40 + 20 + 45, avgTalkSec: 35 });
  });

  it('lists known operators with zeros, sorted, filtered by group', () => {
    expect(by['120']).toMatchObject({ total: 0, talkSec: 0, group: 'main' });
    expect(rows.map((r) => r.ext)).toEqual(['101', '103', '106', '111', '120']);
    expect(operatorStats(day, { scope: 'working', names, groupOf, group: 'secondary' })).toEqual([]);
  });

  it('all scope includes the Saturday call', () => {
    const all = operatorStats(day, { scope: 'all', names, groupOf });
    expect(all.find((r) => r.ext === '101')?.answered).toBe(2);
  });
});

describe('surveyByOperator', () => {
  const at = (start: string) => {
    const c = day.find((x) => x.start === start);
    if (!c) throw new Error(`no fixture call at ${start}`);
    return c.id;
  };
  const A = at('2026-11-17 09:10:00'); // answered by 101
  const F = at('2026-11-17 11:30:00'); // answered by 103
  const K = at('2026-11-14 10:00:00'); // Saturday, answered by 101
  const ratings = [
    { linkedid: A, uniqueid: A, operatorExt: '101', score: 5 },
    { linkedid: A, uniqueid: A, operatorExt: '101', score: 1 }, // a second answer for the same call: ignored
    { linkedid: '', uniqueid: F, operatorExt: '', score: 3 }, // matched by uniqueid, operator from the call
    { linkedid: K, uniqueid: K, operatorExt: '101', score: 4 },
    { linkedid: 'nope', uniqueid: 'nope', operatorExt: '101', score: 1 }, // call outside the range
    { linkedid: F, uniqueid: F, operatorExt: '103', score: 7 }, // not a 1–5 answer
  ];

  it('counts each in-scope call once, falls back to the final operator', () => {
    expect(surveyByOperator(ratings, day, 'working')).toEqual(
      new Map([
        ['101', { count: 1, sum: 5 }],
        ['103', { count: 1, sum: 3 }],
      ]),
    );
  });

  it('all scope includes the Saturday call', () => {
    expect(surveyByOperator(ratings, day, 'all').get('101')).toEqual({ count: 2, sum: 9 });
  });

  it('feeds surveyCount / surveyAvg of the operator table', () => {
    const survey = surveyByOperator(ratings, day, 'all');
    const rows = operatorStats(day, { scope: 'all', names, groupOf, knownExtensions: ['120'], survey });
    const by = Object.fromEntries(rows.map((r) => [r.ext, r]));
    expect(by['101']).toMatchObject({ surveyCount: 2, surveyAvg: 4.5 });
    expect(by['103']).toMatchObject({ surveyCount: 1, surveyAvg: 3 });
    expect(by['120']).toMatchObject({ surveyCount: 0, surveyAvg: null });
    expect(operatorStats(day, { scope: 'all', names, groupOf })[0]).toMatchObject({ surveyCount: 0, surveyAvg: null });
  });
});

describe('series', () => {
  it('hourly buckets by start hour', () => {
    const points = hourlySeries(day, 'working', TEST_CALENDAR.workingHours());
    expect(points).toHaveLength(13);
    expect(points.find((p) => p.hour === 9)).toEqual({ hour: 9, inbound: 2, answered: 1, abandoned: 1, outbound: 0 });
    expect(points.find((p) => p.hour === 12)).toEqual({ hour: 12, inbound: 0, answered: 0, abandoned: 0, outbound: 1 });
    expect(hourlySeries(day, 'all', [21]).at(0)?.inbound).toBe(1);
  });

  it('daily points for every date of the range', () => {
    const points = dailySeries(day, 'all', ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'], (d) =>
      TEST_CALENDAR.isWorkingDay(d),
    );
    expect(points.map((p) => [p.date, p.inbound, p.workingDay])).toEqual([
      ['2026-11-14', 1, false],
      ['2026-11-15', 0, false],
      ['2026-11-16', 0, true],
      ['2026-11-17', 7, true],
    ]);
    expect(points[3]).toMatchObject({ answered: 4, abandoned: 1, outbound: 1, talkSec: 425 });
  });
});

describe('topClients', () => {
  it('ranks by inbound calls and merges number formats', () => {
    const top = topClients(day, 'working', 3, wallToIso);
    expect(top[0]).toMatchObject({
      number: '901111111',
      inbound: 2,
      answered: 2,
      missed: 0,
      outbound: 0,
      talkSec: 200,
    });
    expect(top[0].lastCallAt).toBe('2026-11-17T10:30:00+05:00');
    expect(top[1]).toMatchObject({ number: '902222222', inbound: 1, missed: 1, outbound: 1, talkSec: 80 });
    expect(top).toHaveLength(3);
  });
});
