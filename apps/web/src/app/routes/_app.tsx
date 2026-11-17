import { createFileRoute, redirect } from '@tanstack/react-router';
import { sessionQuery } from '@/entities/session';
import { realtime } from '@/shared/api';
import { AppShell } from '@/widgets/app-shell';

/** Authenticated layout: every route under `_app/` requires a session. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href } });
    realtime.onSessionLost = () => {
      context.queryClient.setQueryData(sessionQuery.queryKey, null);
      window.location.assign('/login');
    };
    realtime.connect();
    return { user };
  },
  component: AppShell,
});
