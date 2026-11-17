import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { realtime, useRealtimeEvent, useRealtimeStatus } from '@/shared/api';
import { onlineUsersKey } from '../api/online.api';

const PING_MS = 10_000;

/** Tells the server which page this tab is on and whether it is in the foreground (legacy presence_ping). */
export function usePresencePing(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const status = useRealtimeStatus();
  // The socket opens before the server has authenticated it; report again once it is ready.
  useRealtimeEvent('session.ready', () => realtime.send('presence.ping', { tab: pathname, visible: !document.hidden }));
  useEffect(() => {
    if (status !== 'open') return;
    const ping = () => realtime.send('presence.ping', { tab: pathname, visible: !document.hidden });
    ping();
    const timer = setInterval(ping, PING_MS);
    document.addEventListener('visibilitychange', ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ping);
    };
  }, [pathname, status]);
}

/** Keeps the online list in the Query cache current from `presence.online` events. */
export function useOnlineUsersSync(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent('presence.online', (list) => queryClient.setQueryData(onlineUsersKey, list));
}
