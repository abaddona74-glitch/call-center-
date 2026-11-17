import { createFileRoute } from '@tanstack/react-router';
import { liveSnapshotQuery } from '@/entities/telephony';
import { OperatorsPage } from '@/pages/operators';

export const Route = createFileRoute('/_app/operators')({
  loader: ({ context }) => context.queryClient.ensureQueryData(liveSnapshotQuery),
  component: OperatorsPage,
});
