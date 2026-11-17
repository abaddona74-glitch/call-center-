import {
  CallbackListResponseSchema,
  type CallbackListQueryInput,
  CallbackSchema,
  CallbackSyncResultSchema,
  DismissAllCallbacksResponseSchema,
} from '@cc/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const callbackKeys = {
  all: ['callbacks'] as const,
  list: (q: CallbackListQueryInput) => ['callbacks', 'list', q] as const,
};

export function callbacksQuery(q: CallbackListQueryInput) {
  return queryOptions({
    queryKey: callbackKeys.list(q),
    queryFn: ({ signal }) =>
      api('/callbacks', {
        query: q as Record<string, string | number | undefined>,
        schema: CallbackListResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function dismissCallback(id: number, reason: string) {
  return api(`/callbacks/${id}/dismiss`, { body: { reason }, schema: CallbackSchema });
}

export function dismissAllCallbacks(reason: string, date: 'today' | 'all') {
  return api('/callbacks/dismiss-all', { body: { reason, date }, schema: DismissAllCallbacksResponseSchema });
}

export function syncCallbacks(hours = 48) {
  return api('/callbacks/sync', { body: { hours }, schema: CallbackSyncResultSchema });
}
