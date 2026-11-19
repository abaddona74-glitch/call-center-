import {
  CallHistoryResponseSchema,
  type KpiExecutiveTicketListQuery,
  type KpiOperatorCallListQuery,
  type KpiOperatorTicketListQuery,
  OverviewTicketListSchema,
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
  operatorCalls: (q: KpiOperatorCallListParams) => ['kpi', 'operators', 'calls', q] as const,
  operatorTickets: (q: KpiOperatorTicketListParams) => ['kpi', 'operators', 'tickets', q] as const,
  executiveTickets: (q: KpiExecutiveTicketListParams) => ['kpi', 'executives', 'tickets', q] as const,
};

/** List params as sent to the API (defaults may be omitted). */
type Paged<T> = Omit<T, 'page' | 'pageSize' | 'search'> & { page?: number; pageSize?: number; search?: string };
export type KpiOperatorCallListParams = Omit<Paged<KpiOperatorCallListQuery>, 'scope'> &
  Partial<Pick<KpiOperatorCallListQuery, 'scope'>>;
export type KpiOperatorTicketListParams = Paged<KpiOperatorTicketListQuery>;
export type KpiExecutiveTicketListParams = Paged<KpiExecutiveTicketListQuery>;

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

/** The calls behind one operator's call or quality number (the overview dashboard's list shape). */
export const kpiOperatorCallListQuery = (q: KpiOperatorCallListParams) =>
  queryOptions({
    queryKey: kpiKeys.operatorCalls(q),
    queryFn: ({ signal }) => api('/kpi/operators/calls', { query: q, schema: CallHistoryResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });

/** The tickets behind one operator's ticket number. */
export const kpiOperatorTicketListQuery = (q: KpiOperatorTicketListParams) =>
  queryOptions({
    queryKey: kpiKeys.operatorTickets(q),
    queryFn: ({ signal }) => api('/kpi/operators/tickets', { query: q, schema: OverviewTicketListSchema, signal }),
    placeholderData: keepPreviousData,
  });

/** The tickets behind one Mas'ul number (whole row or one region). */
export const kpiExecutiveTicketListQuery = (q: KpiExecutiveTicketListParams) =>
  queryOptions({
    queryKey: kpiKeys.executiveTickets(q),
    queryFn: ({ signal }) => api('/kpi/executives/tickets', { query: q, schema: OverviewTicketListSchema, signal }),
    placeholderData: keepPreviousData,
  });
