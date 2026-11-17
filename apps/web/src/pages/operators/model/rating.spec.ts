import { describe, expect, it } from 'vitest';
import { medals, ratingOf } from './rating';

describe('operator rating', () => {
  it.each([
    [0, 0, 1],
    [1, 1, 9],
    [9, 1, 1],
    [10, 2, 10],
    [29, 3, 1],
    [39, 4, 1],
    [40, 5, 0],
    [75, 5, 0],
  ])('%i calls -> %i stars, %i to next', (total, stars, toNext) => {
    expect(ratingOf(total)).toEqual({ stars, toNext });
  });

  it('gives medals to the top three with calls', () => {
    const m = medals([
      { extension: '101', total: 12 },
      { extension: '103', total: 40 },
      { extension: '106', total: 12 },
      { extension: '111', total: 3 },
      { extension: '119', total: 0 },
    ]);
    expect([...m.entries()]).toEqual([
      ['103', 'diamond'],
      ['101', 'gold'],
      ['106', 'silver'],
    ]);
  });
});
