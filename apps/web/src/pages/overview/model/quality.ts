import type { OverviewQuality, RedFlagCode, Sentiment } from '@cc/shared';

/** Whole percent of `part` in `whole`; null when there is nothing to divide by. */
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Card accent of the average overall score (1–10), the «Tahlil» page's thresholds (80 / 60 / 40 %). */
export function overallAccent(avg: number | null): 'green' | 'blue' | 'amber' | 'red' | 'indigo' {
  if (avg === null) return 'indigo';
  const r = avg / 10;
  if (r >= 0.8) return 'green';
  if (r >= 0.6) return 'blue';
  if (r >= 0.4) return 'amber';
  return 'red';
}

/** Figures the quality block shows next to the API totals. */
export function qualityView(q: OverviewQuality) {
  const sentimentTotal = q.sentimentEnd.positive + q.sentimentEnd.neutral + q.sentimentEnd.negative;
  const topFlag = [...q.redFlags].filter((f) => f.count > 0).sort((a, b) => b.count - a.count)[0];
  return {
    empty: q.analyzed === 0,
    redFlagShare: share(q.redFlagCalls, q.analyzed),
    positiveShare: share(q.sentimentEnd.positive, sentimentTotal),
    sentiment: (['positive', 'neutral', 'negative'] as Sentiment[]).map((s) => ({
      sentiment: s,
      count: q.sentimentEnd[s],
      share: share(q.sentimentEnd[s], sentimentTotal) ?? 0,
    })),
    outcomes: [...q.outcomes]
      .filter((o) => o.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((o) => ({ ...o, share: share(o.count, q.analyzed) ?? 0 })),
    topFlag: (topFlag?.code ?? null) as RedFlagCode | null,
    flags: [...q.redFlags]
      .filter((f) => f.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
