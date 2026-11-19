import { hasPermission } from '@cc/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { liveSnapshotQuery } from '@/entities/telephony';
import { DashboardPage } from '@/pages/dashboard';
import { homePath } from '@/widgets/app-shell';

export const Route = createFileRoute('/_app/')({
  // `/` is also where login and every refused route land: whoever has no dashboard goes to their first page.
  beforeLoad: ({ context }) => {
    if (!hasPermission(context.user, 'monitor.view')) throw redirect({ to: homePath(context.user), replace: true });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(liveSnapshotQuery),
  component: DashboardPage,
});
