import { createFileRoute } from '@tanstack/react-router';
import { toolsConfigQuery } from '@/entities/tool';
import { ToolsPage } from '@/pages/tools';
import { requirePermission } from '../../lib/require-role';

/** Tools ("Asboblar") — `tools.view`; the converter inside needs `tools.use` (the API checks both). */
export const Route = createFileRoute('/_app/tools')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'tools.view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(toolsConfigQuery),
  component: ToolsPage,
});
