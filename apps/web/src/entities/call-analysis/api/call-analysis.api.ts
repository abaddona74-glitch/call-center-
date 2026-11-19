import {
  type CallAnalysisBackfillRequest,
  type CallAnalysisBackfillResponse,
  CallAnalysisBackfillResponseSchema,
  CallAnalysisDetailsSchema,
  CallAnalysisQueueSchema,
  type CallAnalysisRetryResponse,
  CallAnalysisRetryResponseSchema,
  type CallAnalysisStatsQuery,
  CallAnalysisStatsSchema,
  CallAnalysisStatusResponseSchema,
} from '@cc/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** Query params as sent to the API (optional filters may be omitted). */
export type CallAnalysisStatsParams = Pick<CallAnalysisStatsQuery, 'from' | 'to'> &
  Partial<Pick<CallAnalysisStatsQuery, 'operator' | 'topic' | 'promptVersion'>>;

export const callAnalysisKeys = {
  all: ['call-analysis'] as const,
  call: (callId: string) => ['call-analysis', 'call', callId] as const,
  status: (ids: readonly string[]) => ['call-analysis', 'status', ids] as const,
  stats: (q: CallAnalysisStatsParams) => ['call-analysis', 'stats', q] as const,
  queue: ['call-analysis', 'queue'] as const,
};

/** Transcript + rubric of one call (`CDR_ACCESS['analysis.call']`). Polls while the job is queued or running. */
export const callAnalysisQuery = (callId: string) =>
  queryOptions({
    queryKey: callAnalysisKeys.call(callId),
    queryFn: ({ signal }) =>
      api(`/call-analysis/calls/${encodeURIComponent(callId)}`, { schema: CallAnalysisDetailsSchema, signal }),
    staleTime: 30_000,
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === 'queued' || status === 'processing' ? 15_000 : false;
    },
  });

/** Analysis status of the calls on one page (max 200 ids). */
export const callAnalysisStatusQuery = (ids: readonly string[]) =>
  queryOptions({
    queryKey: callAnalysisKeys.status(ids),
    queryFn: ({ signal }) =>
      api('/call-analysis/status', { query: { ids: ids.join(',') }, schema: CallAnalysisStatusResponseSchema, signal }),
    staleTime: 30_000,
    enabled: ids.length > 0,
  });

/** Aggregates across operators (`CDR_ACCESS['analysis.stats']`). */
export const callAnalysisStatsQuery = (q: CallAnalysisStatsParams) =>
  queryOptions({
    queryKey: callAnalysisKeys.stats(q),
    queryFn: ({ signal }) => api('/call-analysis/stats', { query: q, schema: CallAnalysisStatsSchema, signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** Queue progress (`analysis.manage`), refreshed while the page is open. */
export const callAnalysisQueueQuery = queryOptions({
  queryKey: callAnalysisKeys.queue,
  queryFn: ({ signal }) => api('/call-analysis/queue', { schema: CallAnalysisQueueSchema, signal }),
  refetchInterval: 15_000,
});

export function backfillCallAnalysis(body: CallAnalysisBackfillRequest): Promise<CallAnalysisBackfillResponse> {
  return api('/call-analysis/backfill', { method: 'POST', body, schema: CallAnalysisBackfillResponseSchema });
}

export function retryFailedCallAnalysis(): Promise<CallAnalysisRetryResponse> {
  return api('/call-analysis/queue/retry-failed', {
    method: 'POST',
    body: {},
    schema: CallAnalysisRetryResponseSchema,
  });
}

/** Re-score analysed calls of a period with the current prompt version (the worker re-runs only the LLM). */
export function reanalyzeCallAnalysis(body: CallAnalysisBackfillRequest): Promise<CallAnalysisRetryResponse> {
  return api('/call-analysis/reanalyze', { method: 'POST', body, schema: CallAnalysisRetryResponseSchema });
}
