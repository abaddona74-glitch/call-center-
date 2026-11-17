import { type OnlineUser, OnlineUsersSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const onlineUsersKey = ['presence', 'online'] as const;

export const onlineUsersQuery = queryOptions({
  queryKey: onlineUsersKey,
  queryFn: ({ signal }): Promise<OnlineUser[]> => api('/presence/online', { schema: OnlineUsersSchema, signal }),
  staleTime: Number.POSITIVE_INFINITY,
});
