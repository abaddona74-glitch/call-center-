import { createFileRoute } from '@tanstack/react-router';
import { toolsConfigQuery } from '@/entities/tool';
import { ToolsPage } from '@/pages/tools';
import { requirePermission } from '../../lib/require-role';

/**
 * Tools ("Asboblar") — `tools.view`; the converter inside needs `tools.use` (the API checks both).
 * The config only feeds the Telegram Form card, so it is prefetched, not awaited: if it fails, the
 * page still opens and the card shows "Sozlanmagan".
 */
export const Route = createFileRoute('/_app/tools')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'tools.view'),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(toolsConfigQuery);
  },
  component: ToolsPage,
});
