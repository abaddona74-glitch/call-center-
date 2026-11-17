import { CallScopeSchema, IsoDateSchema, type StatsQuery } from '@cc/shared';
import { z } from 'zod';
import { monthEnd, monthStart } from '@/entities/call';

export const STATS_PERIODS = ['day', 'month', 'year', 'range'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/** URL search params of /statistics. Invalid values are dropped. */
export const statisticsSearchSchema = z.object({
  period: z.enum(STATS_PERIODS).optional().catch(undefined),
  /** day: the date; month: any date of the month; year: any date of the year; range: start. */
  from: IsoDateSchema.optional().catch(undefined),
  to: IsoDateSchema.optional().catch(undefined),
  scope: CallScopeSchema.optional().catch(undefined),
});
export type StatisticsSearch = z.infer<typeof statisticsSearchSchema>;

const min = (a: string, b: string) => (a < b ? a : b);

/** URL state → stats query (period resolved to a date range, never past today). */
export function statsQueryFrom(s: StatisticsSearch, today: string): StatsQuery & { period: StatsPeriod } {
  const period = s.period ?? 'day';
  const anchor = s.from ?? today;
  const scope = s.scope ?? 'working';
  switch (period) {
    case 'month':
      return { period, from: monthStart(anchor), to: min(monthEnd(anchor), today), scope };
    case 'year':
      return { period, from: `${anchor.slice(0, 4)}-01-01`, to: min(`${anchor.slice(0, 4)}-12-31`, today), scope };
    case 'range': {
      const to = s.to ?? anchor;
      return { period, from: min(anchor, to), to: to > anchor ? to : anchor, scope };
    }
    default:
      return { period: 'day', from: anchor, to: anchor, scope };
  }
}
