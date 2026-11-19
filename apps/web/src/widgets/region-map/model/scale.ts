import type { OverviewRegionRow } from '@cc/shared';

/** What colours the map (owner, 19.11.2026: received / closed / overdue share). */
export const MAP_METRICS = ['received', 'closed', 'overdueShare'] as const;
export type MapMetric = (typeof MAP_METRICS)[number];

/** Most colour steps; bin 0 is the lightest. */
export const BIN_COUNT = 5;

/**
 * The value a region is coloured by: received / closed are counts; overdue share is the percent (one decimal)
 * of the region's received tickets that missed the SLA, null when it received none.
 */
export function metricValue(
  row: Pick<OverviewRegionRow, 'received' | 'closed' | 'overdue'>,
  metric: MapMetric,
): number | null {
  if (metric === 'overdueShare') return row.received > 0 ? Math.round((row.overdue / row.received) * 1000) / 10 : null;
  return row[metric];
}

/** Fixed share steps (%): 0 · ≤10 · ≤20 · ≤35 · more. Fixed, so a colour means the same in every period. */
const SHARE_THRESHOLDS = [0, 10, 20, 35];

/**
 * Upper bounds of the bins below the top one (bin `thresholds.length` = above the last). Counts: quintile breaks
 * of the regions with tickets (Tashkent city alone would flatten equal-width bins), fewer bins when values repeat;
 * shares: the fixed steps above.
 */
export function thresholdsFor(metric: MapMetric, values: readonly (number | null)[]): number[] {
  if (metric === 'overdueShare') return SHARE_THRESHOLDS;
  const xs = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (xs.length === 0) return [1, 2, 3, 4];
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))];
  const breaks = [0.2, 0.4, 0.6, 0.8].map(at).filter((v) => v < xs[xs.length - 1]);
  return [...new Set(breaks)];
}

/** Colour step of a value; null = no colour (no tickets: a count of 0, or a share without tickets). */
export function binOf(value: number | null, metric: MapMetric, thresholds: readonly number[]): number | null {
  if (value === null) return null;
  if (metric !== 'overdueShare' && value <= 0) return null;
  const i = thresholds.findIndex((t) => value <= t);
  return i === -1 ? thresholds.length : i;
}

/** Legend labels of the bins: "1–7", "8", …, "17+" for counts; "0%", "0–10%", …, "35%+" for shares. */
export function binLabels(metric: MapMetric, thresholds: readonly number[]): string[] {
  if (metric === 'overdueShare') {
    return thresholds
      .map((t, i) => (i === 0 ? `${t}%` : `${thresholds[i - 1]}–${t}%`))
      .concat(`${thresholds.at(-1)}%+`);
  }
  return thresholds
    .map((t, i) => {
      const lo = i === 0 ? 1 : thresholds[i - 1] + 1;
      return lo === t ? String(t) : `${lo}–${t}`;
    })
    .concat(`${(thresholds.at(-1) ?? 0) + 1}+`);
}

/** Hue per metric (one hue, light → strong); the steps are mixed into the panel surface, so both themes work. */
export const METRIC_HUE: Record<MapMetric, string> = {
  received: 'var(--chart-6)',
  closed: 'var(--chart-2)',
  overdueShare: 'var(--chart-8)',
};
const STEP_MIX = [24, 42, 60, 78, 96];

/** Fill of bin `bin` out of `bins`; fewer bins are spread over the whole light → strong range. */
export function binFill(metric: MapMetric, bin: number | null, bins = BIN_COUNT): string {
  if (bin === null) return 'var(--panel-2)';
  const step = bins <= 1 ? STEP_MIX.length - 1 : Math.round((bin * (STEP_MIX.length - 1)) / (bins - 1));
  return `color-mix(in oklab, ${METRIC_HUE[metric]} ${STEP_MIX[step]}%, var(--muted))`;
}
