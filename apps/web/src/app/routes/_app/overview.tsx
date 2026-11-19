import { createFileRoute } from '@tanstack/react-router';
import { businessToday } from '@/entities/call';
import { overviewCallsQuery, overviewQualityQuery, overviewTicketsQuery } from '@/entities/overview';
import { OverviewPage, overviewSearchSchema, overviewStateFrom } from '@/pages/overview';
import { requirePermission } from '../../lib/require-role';

/** The overview dashboard: observers' only page (owner, 19.11.2026), the superuser sees it too. */
export const Route = createFileRoute('/_app/overview')({
  validateSearch: overviewSearchSchema,
  beforeLoad: ({ context }) => requirePermission(context.user, 'overview.view'),
  loaderDeps: ({ search }) => search,
  // Errors are shown inside the page (the PBX may be down), so failed prefetches must not block navigation.
  loader: ({ context: { queryClient }, deps }) => {
    const s = overviewStateFrom(deps, businessToday());
    return Promise.all([
      queryClient.ensureQueryData(
        overviewTicketsQuery({ from: s.from, to: s.to, ...(s.region ? { region: s.region } : {}) }),
      ),
      queryClient.ensureQueryData(overviewCallsQuery({ from: s.from, to: s.to, scope: s.scope })),
      queryClient.ensureQueryData(overviewQualityQuery({ from: s.from, to: s.to })),
    ]).catch(() => undefined);
  },
  component: OverviewPage,
});
