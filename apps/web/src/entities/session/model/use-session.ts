import type { SessionUser } from '@cc/shared';
import { useSuspenseQuery } from '@tanstack/react-query';
import { sessionQuery } from '../api/session.queries';

let lastKnown: SessionUser | null = null;

/**
 * Current user inside the authenticated part of the app
 * (the `_app` layout route guarantees the session is loaded and not null).
 *
 * When the session ends (logout, expiry, "session gone" on the WebSocket) the cached user becomes `null`.
 * React Query notifies each component on its own, so a page can re-render before the `_app` gate
 * that unmounts it; until the gate does, the page keeps the last user instead of crashing.
 */
export function useSessionUser(): SessionUser {
  const { data } = useSuspenseQuery(sessionQuery);
  if (data) {
    lastKnown = data;
    return data;
  }
  if (lastKnown) return lastKnown;
  throw new Error('useSessionUser used outside an authenticated route');
}
