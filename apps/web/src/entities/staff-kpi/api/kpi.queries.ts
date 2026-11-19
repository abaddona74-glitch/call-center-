import {
  type KpiExecutivesQuery,
  KpiExecutivesResponseSchema,
  type KpiOperatorsQuery,
  KpiOperatorsResponseSchema,
} from '@cc/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** Today's figures move during the day: refresh every minute while the page is open. */
const REFRESH_MS = 60_000;

export const kpiKeys = {
  all: ['kpi'] as const,
  operators: (q: KpiOperatorsQuery) => ['kpi', 'operators', q] as const,
  executives: (q: KpiExecutivesQuery) => ['kpi', 'executives', q] as const,
};

/** Operators: calls, client ratings, tickets, AI quality, online / pause time (GET /api/kpi/operators). */
export const kpiOperatorsQuery = (q: KpiOperatorsQuery) =>
  queryOptions({
    queryKey: kpiKeys.operators(q),
    queryFn: ({ signal }) => api('/kpi/operators', { query: q, schema: KpiOperatorsResponseSchema, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });

/** "Mas'ul shaxslar": ticket processing per person and region (GET /api/kpi/executives). */
export const kpiExecutivesQuery = (q: KpiExecutivesQuery) =>
  queryOptions({
    queryKey: kpiKeys.executives(q),
    queryFn: ({ signal }) => api('/kpi/executives', { query: q, schema: KpiExecutivesResponseSchema, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
