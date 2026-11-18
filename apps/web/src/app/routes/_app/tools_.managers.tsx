import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { managersQuery } from '@/entities/tool';
import { ToolManagersPage } from '@/pages/tool-managers';
import { requirePermission } from '../../lib/require-role';

/** Legacy tools/managers.html (`?tab=` and `?q=` kept). */
export const Route = createFileRoute('/_app/tools_/managers')({
  validateSearch: z.object({ tab: z.string().optional().catch(undefined), q: z.string().optional().catch(undefined) }),
  beforeLoad: ({ context }) => requirePermission(context.user, 'tools.view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(managersQuery),
  component: ManagersRoute,
});

function ManagersRoute() {
  const { tab, q } = Route.useSearch();
  return <ToolManagersPage tab={tab} q={q} />;
}
