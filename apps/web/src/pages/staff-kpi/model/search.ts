import { CallScopeSchema, type CallScope, IsoDateSchema } from '@cc/shared';
import { z } from 'zod';
import { rangePresets } from '@/entities/call';
import { KPI_GROUPS, type KpiGroup } from '@/widgets/staff-kpi';

/** Period presets: «Bugun», «Kecha», «Oxirgi 7 kun», «Shu oy» and a custom range. */
export const KPI_PERIODS = ['today', 'yesterday', 'week', 'month', 'range'] as const;
export type KpiPeriod = (typeof KPI_PERIODS)[number];
export const DEFAULT_PERIOD: KpiPeriod = 'today';

export const KPI_VIEWS = ['operators', 'executives'] as const;
export type KpiView = (typeof KPI_VIEWS)[number];

/** URL search params of /kpi. Invalid values are dropped. */
export const kpiSearchSchema = z.object({
  view: z.enum(KPI_VIEWS).optional().catch(undefined),
  period: z.enum(KPI_PERIODS).optional().catch(undefined),
  /** range only */
  from: IsoDateSchema.optional().catch(undefined),
  to: IsoDateSchema.optional().catch(undefined),
  /** Operators: calls and online time in working time (default) or all hours. */
  scope: CallScopeSchema.optional().catch(undefined),
  /** Operators: which column group to show (all by default; one group fits a phone). */
  group: z.enum(KPI_GROUPS).optional().catch(undefined),
});
export type KpiSearch = z.infer<typeof kpiSearchSchema>;

export interface KpiState {
  view: KpiView;
  period: KpiPeriod;
  from: string;
  to: string;
  scope: CallScope;
  group: KpiGroup | 'all';
}

/** URL state → resolved period (never past today, `from` ≤ `to`) and view options. */
export function kpiStateFrom(s: KpiSearch, today: string): KpiState {
  const period = s.period ?? DEFAULT_PERIOD;
  let from: string;
  let to: string;
  if (period === 'range') {
    const a = s.from && s.from <= today ? s.from : today;
    const b = s.to && s.to <= today ? s.to : a;
    [from, to] = a <= b ? [a, b] : [b, a];
  } else {
    ({ from, to } = rangePresets(today)[period]);
  }
  return {
    view: s.view ?? 'operators',
    period,
    from,
    to,
    scope: s.scope ?? 'working',
    group: s.group ?? 'all',
  };
}
