import {
  type OverviewCallsQuery,
  OverviewCallsSchema,
  type OverviewQualityQuery,
  OverviewQualitySchema,
  type OverviewTicketsQuery,
  OverviewTicketsSchema,
} from '@cc/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** The figures move during the day: refresh every minute while the page is open. */
const REFRESH_MS = 60_000;

export const overviewKeys = {
  all: ['overview'] as const,
  tickets: (q: OverviewTicketsQuery) => ['overview', 'tickets', q] as const,
  calls: (q: OverviewCallsQuery) => ['overview', 'calls', q] as const,
  quality: (q: OverviewQualityQuery) => ['overview', 'quality', q] as const,
};

/** Tickets: totals, now, regions (map), executives. The previous figures stay while a filter loads. */
export const overviewTicketsQuery = (q: OverviewTicketsQuery) =>
  queryOptions({
    queryKey: overviewKeys.tickets(q),
    queryFn: ({ signal }) => api('/overview/tickets', { query: q, schema: OverviewTicketsSchema, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });

/** Calls of the period from the CDR (same numbers as the statistics page). */
export const overviewCallsQuery = (q: OverviewCallsQuery) =>
  queryOptions({
    queryKey: overviewKeys.calls(q),
    queryFn: ({ signal }) => api('/overview/calls', { query: q, schema: OverviewCallsSchema, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });

/** AI call quality of the period (current prompt version, aggregates only; not split by region). */
export const overviewQualityQuery = (q: OverviewQualityQuery) =>
  queryOptions({
    queryKey: overviewKeys.quality(q),
    queryFn: ({ signal }) => api('/overview/quality', { query: q, schema: OverviewQualitySchema, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
