import { describe, expect, it } from 'vitest';
import { topCallers } from './top-callers.js';

describe('topCallers', () => {
  it('merges number variants of the same citizen and sorts by calls', () => {
    const result = topCallers(
      [
        { src: '901234567', calls: 2, answered: 1, talkSeconds: 60, lastCall: '2026-11-17 10:00:00' },
        { src: '998901234567', calls: 1, answered: 1, talkSeconds: 30, lastCall: '2026-11-17 12:00:00' },
        { src: '935551122', calls: 2, answered: 0, talkSeconds: 0, lastCall: '2026-11-17 11:00:00' },
        { src: '101', calls: 9, answered: 9, talkSeconds: 900, lastCall: '2026-11-17 11:00:00' },
      ],
      10,
    );
    expect(result).toEqual([
      { phone: '901234567', totalCalls: 3, answeredCalls: 2, totalTalkSeconds: 90, lastCall: '2026-11-17 12:00:00' },
      { phone: '935551122', totalCalls: 2, answeredCalls: 0, totalTalkSeconds: 0, lastCall: '2026-11-17 11:00:00' },
    ]);
  });

  it('applies the limit and breaks ties by the latest call', () => {
    const rows = [
      { src: '901111111', calls: 1, answered: 0, talkSeconds: 0, lastCall: '2026-11-17 09:00:00' },
      { src: '902222222', calls: 1, answered: 0, talkSeconds: 0, lastCall: '2026-11-17 10:00:00' },
    ];
    expect(topCallers(rows, 1).map((r) => r.phone)).toEqual(['902222222']);
  });
});
