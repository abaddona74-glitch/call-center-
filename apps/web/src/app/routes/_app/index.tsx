import { createFileRoute } from '@tanstack/react-router';
import { liveSnapshotQuery } from '@/entities/telephony';
import { DashboardPage } from '@/pages/dashboard';

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(liveSnapshotQuery),
  component: DashboardPage,
});
