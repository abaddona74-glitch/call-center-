import { describe, expect, it } from 'vitest';
import { parseWall } from '../../../common/time/business-time.js';
import { calls, inbound, internal, outbound } from '../../../pbx/calls/testing/cdr-fixtures.js';
import { operatorStats, summarize } from '../../stats/domain/metrics.js';
import {
  addCallsToSeed,
  callIdEpochMs,
  dayStartMs,
  emptySeed,
  startedBefore,
  withSeed,
  emptyOperatorToday,
} from './cdr-seed.js';

const TZ = 'Asia/Tashkent';
const DATE = '2026-11-17'; // Tuesday
const at = (wall: string) => parseWall(wall).epochMs;
const seedFor = (through: string) => emptySeed(DATE, dayStartMs(DATE, TZ), at(through));

/** A morning before an API restart at 12:00 (+ calls of the day before and after the restart). */
const day = calls(
  inbound({ at: '2026-11-16 23:50:00', caller: '901010101', outcome: 'answered', answeredBy: '101', talk: 30 }),
  inbound({
    at: '2026-11-17 09:10:00',
    caller: '901111111',
    rung: ['103'],
    outcome: 'answered',
    answeredBy: '101',
    talk: 100,
  }),
  inbound({ at: '2026-11-17 09:40:00', caller: '902222222', rung: ['101'], outcome: 'abandoned', abandonAfter: 20 }),
  inbound({ at: '2026-11-17 10:05:00', caller: '903333333', outcome: 'ivr' }),
  inbound({
    at: '2026-11-17 10:30:00',
    caller: '904444444',
    outcome: 'answered',
    answeredBy: '106',
    talk: 30,
    transfers: [{ to: '103', talk: 20 }],
  }),
  inbound({ at: '2026-11-17 07:30:00', caller: '905555555', outcome: 'after_hours' }),
  outbound({ at: '2026-11-17 11:00:00', ext: '101', number: '902222222', disposition: 'ANSWERED', talk: 80 }),
  outbound({ at: '2026-11-17 11:05:00', ext: '103', number: '906666666', disposition: 'NO ANSWER' }),
  internal({ at: '2026-11-17 11:10:00', from: '101', to: '103' }),
  inbound({ at: '2026-11-17 12:00:05', caller: '907777777', outcome: 'answered', answeredBy: '103', talk: 40 }),
);
const idAt = (wall: string) => day.find((c) => c.start === wall)!.id;

describe('callIdEpochMs / startedBefore', () => {
  it('reads the epoch of an Asterisk id, with or without a system name', () => {
    expect(callIdEpochMs('1794891600.12')).toBe(1_794_891_600_000);
    expect(callIdEpochMs('pbx-1-1794891600.3')).toBe(1_794_891_600_000);
    expect(callIdEpochMs('1.1')).toBeNull();
    expect(callIdEpochMs('abc')).toBeNull();
  });

  it('splits calls by the id epoch, falling back to the start time', () => {
    const boundary = 1_794_891_601_000;
    expect(startedBefore(boundary, '1794891600.9', boundary + 60_000)).toBe(true); // id wins over a late first sight
    expect(startedBefore(boundary, '1794891601.1', 0)).toBe(false);
    expect(startedBefore(boundary, 'x', boundary - 1)).toBe(true);
    expect(startedBefore(boundary, 'x', boundary)).toBe(false);
  });
});

describe('addCallsToSeed', () => {
  it('counts the calls of the day before the boundary with the statistics page definitions', () => {
    const { seed, added } = addCallsToSeed(seedFor('2026-11-17 12:00:00'), day);
    const morning = day.filter((c) => c.date === DATE && c.start < '2026-11-17 12:00:00');
    const s = summarize(morning, { from: DATE, to: DATE, scope: 'all' });

    expect(added.sort()).toEqual(morning.map((c) => c.id).sort());
    expect(seed.counters).toEqual({
      inbound: s.inbound.offered,
      answered: s.inbound.answered,
      abandoned: s.inbound.abandoned,
      ivrOnly: s.inbound.ivr,
      unanswered: s.inbound.abandoned + s.inbound.ivr + s.inbound.afterHours,
      outbound: s.outbound.attempts,
      outboundAnswered: s.outbound.connected,
      operatorMissed: 2, // 103 on 09:10, 101 on 09:40 (both let it ring out)
      operatorMissedNoAnswer: 2,
      operatorMissedRejected: 0,
      talkSeconds: s.talk.totalSec,
      unknownHangups: s.inbound.answered + s.outbound.connected,
    });
    expect(seed.counters).toMatchObject({
      inbound: 5,
      answered: 2,
      abandoned: 1,
      ivrOnly: 1,
      unanswered: 3,
      outbound: 2,
      outboundAnswered: 1,
      talkSeconds: 100 + 30 + 20 + 80,
    });
  });

  it('gives each operator the operators table figures (internal calls not counted)', () => {
    const { seed } = addCallsToSeed(seedFor('2026-11-17 12:00:00'), day);
    const rows = operatorStats(
      day.filter((c) => c.date === DATE && c.start < '2026-11-17 12:00:00'),
      { scope: 'all', names: new Map(), groupOf: () => null },
    );
    for (const r of rows) {
      expect(seed.operators.get(r.ext)).toEqual({
        answered: r.answered,
        outbound: r.outbound,
        outboundAttempts: r.outboundAttempts,
        missed: r.missed,
        missedNoAnswer: r.missedNoAnswer,
        missedRejected: r.missedRejected,
        transfersIn: r.transferredIn,
        transfersOut: r.transferredOut,
        talkSeconds: r.talkSec,
        clientHangups: 0,
        operatorHangups: 0,
      });
    }
    expect(seed.operators.get('101')).toMatchObject({ answered: 1, outbound: 1, outboundAttempts: 1, missed: 1 });
    expect(seed.operators.get('103')).toMatchObject({ transfersIn: 1, outboundAttempts: 1, missed: 1 });
    expect(seed.operators.get('106')).toMatchObject({ transfersOut: 1, talkSeconds: 30 });
  });

  it('leaves out calls of another day, calls at or after the boundary and skipped (in-progress) calls', () => {
    const { seed, added } = addCallsToSeed(seedFor('2026-11-17 12:00:05'), day, {
      skip: (id) => id === idAt('2026-11-17 09:40:00'),
    });
    expect(added).not.toContain(idAt('2026-11-16 23:50:00'));
    expect(added).not.toContain(idAt('2026-11-17 12:00:05')); // started exactly at the boundary: live
    expect(added).not.toContain(idAt('2026-11-17 09:40:00'));
    expect(seed.counters).toMatchObject({ inbound: 4, abandoned: 0 });
  });

  it('adds late calls once: seeds of disjoint call sets add up to the seed of all of them', () => {
    const late = idAt('2026-11-17 09:40:00');
    const first = addCallsToSeed(seedFor('2026-11-17 12:00:00'), day, { skip: (id) => id === late });
    const second = addCallsToSeed(first.seed, day, { only: new Set([late]) });
    const again = addCallsToSeed(second.seed, day, { only: new Set([late]) });
    const whole = addCallsToSeed(seedFor('2026-11-17 12:00:00'), day);

    expect(second.added).toEqual([late]);
    expect(again.added).toEqual([]);
    expect(again.seed).toBe(second.seed);
    expect(second.seed.counters).toEqual(whole.seed.counters);
    expect(second.seed.operators).toEqual(whole.seed.operators);
    expect(second.seed.callIds).toEqual(whole.seed.callIds);
    // the earlier seed is not changed
    expect(first.seed.counters.abandoned).toBe(0);
  });
});

describe('withSeed', () => {
  it('adds the seeded figures of an operator to the live ones', () => {
    const live = { ...emptyOperatorToday(), answered: 2, clientHangups: 1 };
    expect(withSeed(live, { ...emptyOperatorToday(), answered: 3, talkSeconds: 90 })).toEqual({
      ...emptyOperatorToday(),
      answered: 5,
      talkSeconds: 90,
      clientHangups: 1,
    });
    expect(withSeed(live, undefined)).toEqual(live);
    expect(withSeed(live, undefined)).not.toBe(live);
  });
});
