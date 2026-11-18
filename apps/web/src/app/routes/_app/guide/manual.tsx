import { createFileRoute } from '@tanstack/react-router';
import { type ManualTab, OperatorManualPage, manualSearchSchema } from '@/pages/guide';

/** Operator manual (legacy viewer modal), `?tab=` picks the tab. Every signed-in user, like `/guide`. */
export const Route = createFileRoute('/_app/guide/manual')({
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
