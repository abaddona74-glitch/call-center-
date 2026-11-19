import { hasPermission } from '@cc/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { liveSnapshotQuery } from '@/entities/telephony';
import { DashboardPage } from '@/pages/dashboard';

export const Route = createFileRoute('/_app/')({
  // Observers have no live monitor: their home (and only page) is the overview dashboard (owner, 19.11.2026).
  beforeLoad: ({ context }) => {
    if (!hasPermission(context.user, 'monitor.view') && hasPermission(context.user, 'overview.view')) {
      throw redirect({ to: '/overview', replace: true });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(liveSnapshotQuery),
  component: DashboardPage,
});
