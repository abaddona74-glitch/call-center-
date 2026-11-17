import type { LiveOperator } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { grandTotal, groupForBoard, nextInLine, ranks } from './board';

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
