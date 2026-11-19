import { createFileRoute } from '@tanstack/react-router';
import { type ManualTab, OperatorManualPage, manualSearchSchema } from '@/pages/guide';
import { requirePermission } from '../../../lib/require-role';

/** Operator manual (legacy viewer modal), `?tab=` picks the tab. Call-center staff, like `/guide`. */
export const Route = createFileRoute('/_app/guide/manual')({
  // Call-center staff only: observers see just the overview dashboard (owner, 19.11.2026).
  beforeLoad: ({ context }) => requirePermission(context.user, 'monitor.view'),
  validateSearch: manualSearchSchema,
  component: ManualRoute,
});

function ManualRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OperatorManualPage
      tab={tab ?? 'tree'}
      onTabChange={(next: ManualTab) => void navigate({ search: next === 'tree' ? {} : { tab: next }, replace: true })}
    />
  );
}
