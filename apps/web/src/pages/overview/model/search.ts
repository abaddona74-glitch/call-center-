import { CallScopeSchema, IsoDateSchema, type CallScope } from '@cc/shared';
import { z } from 'zod';
import { rangePresets } from '@/entities/call';
import { MAP_METRICS, type MapMetric } from '@/widgets/region-map';

/** Period presets like the statistics page: today, the last 7 days, this month, a custom range. */
export const OVERVIEW_PERIODS = ['today', 'week', 'month', 'range'] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];
/** Tickets have a 3-working-day SLA: a month shows a meaningful map from the first open. */
export const DEFAULT_PERIOD: OverviewPeriod = 'month';

/** URL search params of /overview. Invalid values are dropped. */
export const overviewSearchSchema = z.object({
  period: z.enum(OVERVIEW_PERIODS).optional().catch(undefined),
  /** range only */
  from: IsoDateSchema.optional().catch(undefined),
  to: IsoDateSchema.optional().catch(undefined),
  /** Region filter: a ticket region code or "none" (tickets without a region). */
  region: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .optional()
    .catch(undefined),
  /** What colours the map. */
  metric: z.enum(MAP_METRICS).optional().catch(undefined),
  /** Calls: working time (default) or all. */
  scope: CallScopeSchema.optional().catch(undefined),
});
export type OverviewSearch = z.infer<typeof overviewSearchSchema>;

export interface OverviewState {
  period: OverviewPeriod;
  from: string;
  to: string;
  region: string | null;
  metric: MapMetric;
  scope: CallScope;
}

/** URL state → resolved period (never past today, `from` ≤ `to`), filter and view options. */
export function overviewStateFrom(s: OverviewSearch, today: string): OverviewState {
  const period = s.period ?? DEFAULT_PERIOD;
  const presets = rangePresets(today);
  let from: string;
  let to: string;
  if (period === 'range') {
    const a = s.from && s.from <= today ? s.from : today;
    const b = s.to && s.to <= today ? s.to : a;
    [from, to] = a <= b ? [a, b] : [b, a];
  } else {
    ({ from, to } = presets[period]);
  }
  return {
    period,
    from,
    to,
    region: s.region ?? null,
    metric: s.metric ?? 'received',
    scope: s.scope ?? 'working',
  };
}
