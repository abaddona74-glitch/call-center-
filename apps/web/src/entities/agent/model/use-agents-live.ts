import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeEvent } from '@/shared/api';
import { agentKeys } from '../api/agent.queries';

/** Live agent status and OTA log (admin-only WS events). */
export function useAgentsLive(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent('agents.status', () => {
    void queryClient.invalidateQueries({ queryKey: agentKeys.status });
    void queryClient.invalidateQueries({ queryKey: agentKeys.devices });
  });
  useRealtimeEvent('agents.updateLog', () => {
    void queryClient.invalidateQueries({ queryKey: agentKeys.updateLogs });
  });
}
