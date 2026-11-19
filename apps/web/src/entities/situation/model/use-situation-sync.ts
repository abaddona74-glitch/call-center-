import type { SituationSnapshot } from '@cc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useRealtimeEvent, useRealtimeStatus } from '@/shared/api';
import { situationKeys } from '../api/situation.queries';

/**
 * Applies the `situation.*` WS events to the snapshot in the query cache (each carries a whole part, the newest
 * replaces the old). After a WS reconnect the snapshot is refetched: events may have been missed meanwhile.
 */
export function useSituationSync(): void {
  const queryClient = useQueryClient();
  const patch = (fields: Partial<SituationSnapshot>) =>
    queryClient.setQueryData<SituationSnapshot>(situationKeys.snapshot, (old) => (old ? { ...old, ...fields } : old));

  useRealtimeEvent('situation.telephony', (telephony) => patch({ telephony }));
  useRealtimeEvent('situation.tickets', (tickets) => patch({ tickets }));

  const status = useRealtimeStatus();
  const wasOpen = useRef(status === 'open');
  useEffect(() => {
    if (status === 'open' && !wasOpen.current) void queryClient.invalidateQueries({ queryKey: situationKeys.snapshot });
    wasOpen.current = status === 'open';
  }, [status, queryClient]);
}
