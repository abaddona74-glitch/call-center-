import {
  type AddBlockedNumberRequest,
  BlacklistResponseSchema,
  BlacklistSyncResultSchema,
  BlockedNumberSchema,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const blacklistKeys = { all: ['blacklist'] as const };

export const blacklistQuery = queryOptions({
  queryKey: blacklistKeys.all,
  queryFn: ({ signal }) => api('/blacklist', { schema: BlacklistResponseSchema, signal }),
});

export function addBlockedNumber(body: AddBlockedNumberRequest) {
  return api('/blacklist', { body, schema: BlockedNumberSchema });
}

export function removeBlockedNumber(id: number): Promise<void> {
  return api(`/blacklist/${id}`, { method: 'DELETE' });
}

export function syncBlacklist() {
  return api('/blacklist/sync', { method: 'POST', schema: BlacklistSyncResultSchema });
}
