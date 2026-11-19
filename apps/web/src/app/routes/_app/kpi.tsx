import { createFileRoute } from '@tanstack/react-router';
import { businessToday } from '@/entities/call';
import { kpiExecutivesQuery, kpiOperatorsQuery } from '@/entities/staff-kpi';
import { StaffKpiPage, kpiSearchSchema, kpiStateFrom } from '@/pages/staff-kpi';
import { requirePermission } from '../../lib/require-role';

/** «KPI xodimlar»: observers and the superuser (owner, 19.11.2026). */
export const Route = createFileRoute('/_app/kpi')({
  validateSearch: kpiSearchSchema,
  beforeLoad: ({ context }) => requirePermission(context.user, 'kpi.view'),
  loaderDeps: ({ search }) => search,
  // Errors are shown inside the page (the PBX may be down), so failed prefetches must not block navigation.
  loader: ({ context: { queryClient }, deps }) => {
    const s = kpiStateFrom(deps, businessToday());
    return (
      s.view === 'operators'
        ? queryClient.ensureQueryData(kpiOperatorsQuery({ from: s.from, to: s.to, scope: s.scope }))
        : queryClient.ensureQueryData(kpiExecutivesQuery({ from: s.from, to: s.to }))
    ).catch(() => undefined);
  },
  component: StaffKpiPage,
});
