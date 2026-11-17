import { type Role, type SessionUser, hasRoleAtLeast } from '@cc/shared';
import { useSuspenseQuery } from '@tanstack/react-query';
import { sessionQuery } from '../api/session.queries';

/**
 * Current user inside the authenticated part of the app
 * (the `_app` layout route guarantees the session is loaded and not null).
 */
export function useSessionUser(): SessionUser {
  const { data } = useSuspenseQuery(sessionQuery);
  if (!data) throw new Error('useSessionUser used outside an authenticated route');
  return data;
}

export function useHasRole(minimum: Role): boolean {
  return hasRoleAtLeast(useSessionUser().role, minimum);
}
