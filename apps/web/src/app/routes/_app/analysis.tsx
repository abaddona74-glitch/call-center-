import { CDR_ACCESS } from '@cc/shared';
import { createFileRoute } from '@tanstack/react-router';
import { businessToday } from '@/entities/call';
import { callAnalysisStatsQuery } from '@/entities/call-analysis';
import { CallAnalysisPage, analysisQueryFrom, analysisSearchSchema } from '@/pages/call-analysis';
import { requirePermission } from '../../lib/require-role';

/** «Tahlil» — AI analysis of call recordings across operators (docs/rewrite/CALL-ANALYSIS.md). */
export const Route = createFileRoute('/_app/analysis')({
  validateSearch: analysisSearchSchema,
  beforeLoad: ({ context }) => requirePermission(context.user, CDR_ACCESS['analysis.stats']),
  loaderDeps: ({ search }) => search,
  // Errors are shown inside the page, so a failed prefetch must not block navigation.
  loader: ({ context: { queryClient }, deps }) =>
    queryClient
      .ensureQueryData(callAnalysisStatsQuery(analysisQueryFrom(deps, businessToday())))
      .catch(() => undefined),
  component: CallAnalysisPage,
});
