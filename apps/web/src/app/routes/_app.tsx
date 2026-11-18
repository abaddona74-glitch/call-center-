import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { sessionKeys, sessionQuery } from '@/entities/session';
import { realtime } from '@/shared/api';
import { AppShell } from '@/widgets/app-shell';

/** Authenticated layout: every route under `_app/` requires a session. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href } });
    // The server refuses everything else until a forced password change is done.
    if (user.mustChangePassword && !user.impersonation) throw redirect({ to: '/change-password' });
    // The gate below does the rest (unmount, clean up, go to the login page).
    realtime.onSessionLost = () => context.queryClient.setQueryData(sessionQuery.queryKey, null);
    realtime.connect();
    return { user };
  },
  component: AuthenticatedLayout,
});

/**
 * The session can end while the app is open: logout, an expired session seen by a background `/auth/me`,
 * or the WebSocket closed with "session gone". The shell and every page read the user with
 * `useSessionUser()`, so they must not render once it is `null`: the gate unmounts them first
 * (a parent renders before its children) and then sends the browser to the login page.
 */
function AuthenticatedLayout() {
  const { data: user } = useSuspenseQuery(sessionQuery);
  return user ? <AppShell /> : <SessionEnded />;
}

function SessionEnded() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  // The page the user was on, taken once: the location changes while the redirect is in progress.
  const [back] = useState(() => router.state.location.href);

  useEffect(() => {
    realtime.disconnect();
    // Nothing of the previous user may show to whoever logs in next.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionKeys.me[0] });
    void navigate({ to: '/login', search: { redirect: back }, replace: true });
  }, [queryClient, navigate, back]);

  return null;
}
