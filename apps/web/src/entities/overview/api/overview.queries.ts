import {
  CallHistoryResponseSchema,
  type OverviewCallListQuery,
  type OverviewQualityListQuery,
  type OverviewTicketListQuery,
  OverviewTicketListSchema,
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
  ticketList: (q: TicketListParams) => ['overview', 'tickets', 'list', q] as const,
  callList: (q: CallListParams) => ['overview', 'calls', 'list', q] as const,
  qualityList: (q: QualityListParams) => ['overview', 'quality', 'list', q] as const,
};

/** Query params as sent to the API (defaults may be omitted). */
export type TicketListParams = Omit<OverviewTicketListQuery, 'page' | 'pageSize' | 'search'> & {
  page?: number;
  pageSize?: number;
  search?: string;
};
export type CallListParams = Omit<OverviewCallListQuery, 'page' | 'pageSize' | 'scope' | 'search'> &
  Partial<Pick<OverviewCallListQuery, 'page' | 'pageSize' | 'scope'>> & { search?: string };
export type QualityListParams = Omit<OverviewQualityListQuery, 'page' | 'pageSize' | 'search'> & {
  page?: number;
  pageSize?: number;
  search?: string;
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

/** The tickets behind a ticket number (same filters as the number). */
export const overviewTicketListQuery = (q: TicketListParams) =>
  queryOptions({
    queryKey: overviewKeys.ticketList(q),
    queryFn: ({ signal }) => api('/overview/tickets/list', { query: q, schema: OverviewTicketListSchema, signal }),
    placeholderData: keepPreviousData,
  });

/** The calls behind a call number. */
export const overviewCallListQuery = (q: CallListParams) =>
  queryOptions({
    queryKey: overviewKeys.callList(q),
    queryFn: ({ signal }) => api('/overview/calls/list', { query: q, schema: CallHistoryResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });

/** The analysed calls behind a call-quality number. */
export const overviewQualityListQuery = (q: QualityListParams) =>
  queryOptions({
    queryKey: overviewKeys.qualityList(q),
    queryFn: ({ signal }) => api('/overview/quality/list', { query: q, schema: CallHistoryResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });
