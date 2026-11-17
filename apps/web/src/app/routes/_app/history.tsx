import { createFileRoute } from '@tanstack/react-router';
import { businessToday, callHistoryQuery } from '@/entities/call';
import { HistoryPage, historyParams, historySearchSchema } from '@/pages/history';
import { requireRole } from '../../lib/require-role';

export const Route = createFileRoute('/_app/history')({
  validateSearch: historySearchSchema,
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  loaderDeps: ({ search }) => search,
  // PBX errors are shown inside the page, so a failed prefetch must not block navigation.
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(callHistoryQuery(historyParams(deps, businessToday()))).catch(() => undefined),
  component: HistoryPage,
});
