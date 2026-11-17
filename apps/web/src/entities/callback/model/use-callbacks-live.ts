import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeEvent } from '@/shared/api';
import { callbackKeys } from '../api/callback.queries';

/** Refetches callback lists whenever the server reports a change (`callbacks.updated`). */
export function useCallbacksLive(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent('callbacks.updated', () => {
    void queryClient.invalidateQueries({ queryKey: callbackKeys.all });
  });
}
