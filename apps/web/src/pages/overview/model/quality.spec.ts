import type { OverviewQuality } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { overallAccent, qualityView } from './quality';

const q = (over: Partial<OverviewQuality> = {}): OverviewQuality => ({
  range: { from: '2026-11-01', to: '2026-11-19' },
  promptVersion: 'v4',
  analyzed: 4,
  answeredCalls: 10,
  analyzedShare: 40,
  avgOverall: 7.25,
  avgScores: { greeting: null, politeness: 4, understanding: 4, solution: 4, closing: 4 },
  redFlagCalls: 1,
  redFlags: [
    { code: 'rudeness', count: 1 },
    { code: 'no_greeting', count: 0 },
    { code: 'long_hold', count: 2 },
  ],
  outcomes: [
    { outcome: 'resolved', count: 1 },
    { outcome: 'unresolved', count: 0 },
    { outcome: 'info_only', count: 3 },
  ],
  handledRate: 100,
  sentimentEnd: { positive: 3, neutral: 0, negative: 1 },
  ...over,
});

describe('quality block', () => {
  it('accent follows the score thresholds', () => {
    expect([9, 7, 5, 2, null].map(overallAccent)).toEqual(['green', 'blue', 'amber', 'red', 'indigo']);
  });

  it('shares, outcomes by frequency without zeros, the most frequent red flag', () => {
    const v = qualityView(q());
    expect(v.empty).toBe(false);
    expect(v.redFlagShare).toBe(25);
    expect(v.positiveShare).toBe(75);
    expect(v.outcomes).toEqual([
      { outcome: 'info_only', count: 3, share: 75 },
      { outcome: 'resolved', count: 1, share: 25 },
    ]);
    expect(v.topFlag).toBe('long_hold');
    expect(v.flags.map((f) => f.code)).toEqual(['long_hold', 'rudeness']);
    expect(v.sentiment.map((s) => s.share)).toEqual([75, 0, 25]);
  });

  it('empty while nothing is analysed', () => {
    const v = qualityView(
      q({
        analyzed: 0,
        redFlagCalls: 0,
        redFlags: [],
        outcomes: [],
        sentimentEnd: { positive: 0, neutral: 0, negative: 0 },
      }),
    );
    expect(v).toMatchObject({ empty: true, redFlagShare: null, positiveShare: null, topFlag: null, outcomes: [] });
  });
});
