import { createFileRoute, redirect } from '@tanstack/react-router';
import { sessionQuery } from '@/entities/session';
import { ForcedPasswordChangePage } from '@/pages/change-password';

/** Forced password change (outside the app shell): the server allows nothing else until it is done. */
export const Route = createFileRoute('/change-password')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login' });
    if (!user.mustChangePassword || user.impersonation) throw redirect({ to: '/' });
    return { user };
  },
  component: ChangePasswordRoute,
});

function ChangePasswordRoute() {
  const { user } = Route.useRouteContext();
  return <ForcedPasswordChangePage username={user.username} onDone={() => window.location.assign('/')} />;
}
