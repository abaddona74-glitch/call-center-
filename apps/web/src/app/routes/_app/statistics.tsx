import { createFileRoute } from '@tanstack/react-router';
import {
  businessToday,
  operatorStatsQuery,
  statsSeriesQuery,
  statsSummaryQuery,
  topClientsQuery,
} from '@/entities/call';
import { StatisticsPage, statisticsSearchSchema, statsQueryFrom } from '@/pages/statistics';
import { requireRole } from '../../lib/require-role';

export const Route = createFileRoute('/_app/statistics')({
  validateSearch: statisticsSearchSchema,
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  loaderDeps: ({ search }) => search,
  // PBX errors are shown inside the page, so failed prefetches must not block navigation.
  loader: ({ context: { queryClient }, deps }) => {
    const { period: _period, ...q } = statsQueryFrom(deps, businessToday());
    return Promise.all([
      queryClient.ensureQueryData(statsSummaryQuery(q)),
      queryClient.ensureQueryData(statsSeriesQuery(q)),
      queryClient.ensureQueryData(operatorStatsQuery(q)),
      queryClient.ensureQueryData(topClientsQuery({ ...q, limit: 10 })),
    ]).catch(() => undefined);
  },
  component: StatisticsPage,
});
