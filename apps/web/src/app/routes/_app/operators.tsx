import { createFileRoute } from '@tanstack/react-router';
import { liveSnapshotQuery } from '@/entities/telephony';
import { OperatorsPage } from '@/pages/operators';
import { requirePermission } from '../../lib/require-role';

export const Route = createFileRoute('/_app/operators')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'monitor.view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(liveSnapshotQuery),
  component: OperatorsPage,
});
