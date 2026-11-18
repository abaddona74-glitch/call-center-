import { useQueryClient } from '@tanstack/react-query';
import { callKeys } from '@/entities/call';
import { excludedOperatorsKeys } from '@/entities/excluded-operator';
import { telephonyKeys } from '@/entities/telephony';
import { useRealtimeEvent } from '@/shared/api';

/** Data that depends on the excluded operators list (the server filters it). */
export function invalidateExcludedDependents(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: excludedOperatorsKeys.all });
  void queryClient.invalidateQueries({ queryKey: callKeys.stats });
  // The open board gets `telephony.operators` anyway; a cached snapshot elsewhere must not show old rows.
  void queryClient.invalidateQueries({ queryKey: telephonyKeys.snapshot });
}

/** Someone changed the list: refetch per-operator statistics and the board (mounted once in the app shell). */
export function useExcludedOperatorsSync(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent('excludedOperators.changed', () => invalidateExcludedDependents(queryClient));
}
