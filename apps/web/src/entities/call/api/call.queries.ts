import {
  type CallHistoryQuery,
  CallDetailsResponseSchema,
  CallHistoryResponseSchema,
  type OperatorStatsQuery,
  OperatorStatsResponseSchema,
  type StatsQuery,
  StatsSeriesResponseSchema,
  StatsSummarySchema,
  type TopClientsQuery,
  TopClientsResponseSchema,
} from '@cc/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** Query params as sent to the API (optional fields may be omitted). */
export type CallHistoryParams = Partial<CallHistoryQuery>;

export const callKeys = {
  all: ['calls'] as const,
  history: (p: CallHistoryParams) => ['calls', 'history', p] as const,
  details: (id: string) => ['calls', 'details', id] as const,
  stats: ['calls', 'stats'] as const,
  summary: (q: StatsQuery) => ['calls', 'stats', 'summary', q] as const,
  series: (q: StatsQuery) => ['calls', 'stats', 'series', q] as const,
  operators: (q: OperatorStatsQuery) => ['calls', 'stats', 'operators', q] as const,
  topClients: (q: TopClientsQuery) => ['calls', 'stats', 'top-clients', q] as const,
};

/** Call history page (PBX CDR). Previous page stays on screen while the next one loads. */
export const callHistoryQuery = (p: CallHistoryParams) =>
  queryOptions({
    queryKey: callKeys.history(p),
    queryFn: ({ signal }) => api('/cdr/calls', { query: p, schema: CallHistoryResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });

export const callDetailsQuery = (id: string) =>
  queryOptions({
    queryKey: callKeys.details(id),
    queryFn: ({ signal }) => api(`/cdr/calls/${encodeURIComponent(id)}`, { schema: CallDetailsResponseSchema, signal }),
    staleTime: 60_000,
  });

export const statsSummaryQuery = (q: StatsQuery) =>
  queryOptions({
    queryKey: callKeys.summary(q),
    queryFn: ({ signal }) => api('/stats/summary', { query: q, schema: StatsSummarySchema, signal }),
    placeholderData: keepPreviousData,
  });

export const statsSeriesQuery = (q: StatsQuery) =>
  queryOptions({
    queryKey: callKeys.series(q),
    queryFn: ({ signal }) => api('/stats/series', { query: q, schema: StatsSeriesResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });

export const operatorStatsQuery = (q: OperatorStatsQuery) =>
  queryOptions({
    queryKey: callKeys.operators(q),
    queryFn: ({ signal }) => api('/stats/operators', { query: q, schema: OperatorStatsResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });

export const topClientsQuery = (q: TopClientsQuery) =>
  queryOptions({
    queryKey: callKeys.topClients(q),
    queryFn: ({ signal }) => api('/stats/top-clients', { query: q, schema: TopClientsResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });
