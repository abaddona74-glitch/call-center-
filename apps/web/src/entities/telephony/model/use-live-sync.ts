import type { LiveSnapshot } from '@cc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useRealtimeEvent, useRealtimeStatus } from '@/shared/api';
import { telephonyKeys } from '../api/telephony.api';

/**
 * Applies `telephony.*` WebSocket events to the snapshot in the TanStack Query cache.
 * Every event carries a full list, so the newest one simply replaces the old.
 * After a WS reconnect the snapshot is refetched (events may have been missed).
 */
export function useLiveTelephonySync(): void {
  const queryClient = useQueryClient();
  const patch = (fields: Partial<LiveSnapshot>) =>
    queryClient.setQueryData<LiveSnapshot>(telephonyKeys.snapshot, (old) => (old ? { ...old, ...fields } : old));

  useRealtimeEvent('telephony.operators', (operators) => patch({ operators }));
  useRealtimeEvent('telephony.calls', (calls) => patch({ calls }));
  useRealtimeEvent('telephony.queues', (queues) => patch({ queues }));
  useRealtimeEvent('telephony.counters', (counters) => patch({ counters }));
  useRealtimeEvent('telephony.ami', (ami) => patch({ ami }));

  const status = useRealtimeStatus();
  const wasOpen = useRef(status === 'open');
  useEffect(() => {
    if (status === 'open' && !wasOpen.current) void queryClient.invalidateQueries({ queryKey: telephonyKeys.snapshot });
    wasOpen.current = status === 'open';
  }, [status, queryClient]);
}
