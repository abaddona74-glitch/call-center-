import { type SituationSnapshot, SituationSnapshotSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';
import { noteServerTime } from '@/shared/lib/server-clock';

export const situationKeys = {
  snapshot: ['situation'] as const,
};

/**
 * The live situation board: initial state; afterwards `useSituationSync` replaces its parts from the `situation.*`
 * WS events and refetches it after a reconnect.
 */
export const situationQuery = queryOptions({
  queryKey: situationKeys.snapshot,
  queryFn: async ({ signal }): Promise<SituationSnapshot> => {
    const started = Date.now();
    const data = await api('/situation', { schema: SituationSnapshotSchema, signal });
    noteServerTime(data.telephony.serverTime, started);
    return data;
  },
  staleTime: Number.POSITIVE_INFINITY,
});
