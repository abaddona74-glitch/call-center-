import { describe, expect, it } from 'vitest';
import { PHOTO_MAX_SIDE, fitWithin } from './shrink-photo';

describe('fitWithin', () => {
  it('scales the longest side down to the limit, keeping the proportions', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 360, height: PHOTO_MAX_SIDE });
    expect(fitWithin(1104, 1280, 480)).toEqual({ width: 414, height: 480 });
    expect(fitWithin(2000, 1000, 480)).toEqual({ width: 480, height: 240 });
  });

  it('never enlarges a small photo', () => {
    expect(fitWithin(200, 300)).toEqual({ width: 200, height: 300 });
  });
});
