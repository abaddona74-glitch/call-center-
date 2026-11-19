import type { LiveOperator } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { grandTotal, groupForBoard, leaderboard, nextInLine, ranks, starLevel, surveyPercent, tierOf } from './board';

const op = (
  extension: string,
  presence: LiveOperator['presence'],
  answered: number,
  callsTaken: number | null,
): LiveOperator => ({
  extension,
  name: `Operator ${extension}`,
  presence,
  presenceSince: '2026-11-17T05:00:00.000Z',
  registered: presence !== 'offline',
  ip: null,
  paused: presence === 'paused',
  pauseReason: null,
  call: null,
  queue: callsTaken === null ? null : { callsTaken, lastCallAt: null },
  today: {
    answered,
    outbound: 1,
    outboundAttempts: 1,
    missed: 0,
    missedNoAnswer: 0,
    missedRejected: 0,
    transfersIn: 0,
    transfersOut: 0,
    talkSeconds: 0,
    clientHangups: 0,
    operatorHangups: 0,
  },
});

describe('operators board model', () => {
  const ops = [
    op('101', 'idle', 5, 7),
    op('103', 'idle', 9, 3),
    op('106', 'talking', 2, 1),
    op('119', 'paused', 0, 0),
    op('120', 'offline', 0, null),
  ];

  it('ranks by today total', () => {
    expect(grandTotal(ops[0])).toBe(6);
    expect([...ranks(ops).entries()]).toEqual([
      ['103', 0],
      ['101', 1],
      ['106', 2],
      ['119', 3],
      ['120', 4],
    ]);
  });

  it('builds the portal leaderboard: everyone with calls, talk time breaks ties', () => {
    const a = op('111', 'idle', 4, null);
    const b = { ...op('112', 'idle', 4, null), today: { ...a.today, talkSeconds: 90 } };
    const none = { ...op('199', 'idle', 0, null), today: { ...a.today, answered: 0, outbound: 0 } };
    expect([...leaderboard([a, b, none, ...ops]).entries()]).toEqual([
      ['103', 0],
      ['101', 1],
      ['112', 2],
      ['111', 3],
      ['106', 4],
      ['119', 5],
      ['120', 6],
    ]);
  });

  it('maps ranks to tiers: Diamond, Gold, Silver ×2, then none', () => {
    expect([0, 1, 2, 3, 4, undefined].map(tierOf)).toEqual(['diamond', 'gold', 'silver', 'silver', null, null]);
  });

  it('counts stars like legacy (1 / 10 / 20 / 30 / 40 calls)', () => {
    expect(starLevel(0)).toEqual({ level: 0, toNext: 1 });
    expect(starLevel(1)).toEqual({ level: 1, toNext: 9 });
    expect(starLevel(19)).toEqual({ level: 2, toNext: 1 });
    expect(starLevel(39)).toEqual({ level: 4, toNext: 1 });
    expect(starLevel(40)).toEqual({ level: 5, toNext: 0 });
  });

  it('turns the average client rating into a share of 5', () => {
    expect(surveyPercent(5)).toBe(100);
    expect(surveyPercent(4.6)).toBe(92);
    expect(surveyPercent(3)).toBe(60);
    expect(surveyPercent(1)).toBe(20);
    expect(surveyPercent(null)).toBeNull();
    expect(surveyPercent(undefined)).toBeNull();
  });

  it('predicts the next free operator with the fewest calls', () => {
    expect(nextInLine(ops)).toBe('103');
    expect(nextInLine([ops[2], ops[3]])).toBeNull();
  });

  it('groups like legacy: talking, ready (next first), offline', () => {
    const g = groupForBoard(ops, '103');
    expect(g.talking.map((o) => o.extension)).toEqual(['106']);
    expect(g.ready.map((o) => o.extension)).toEqual(['103', '101', '119']);
    expect(g.offline.map((o) => o.extension)).toEqual(['120']);
  });
});
