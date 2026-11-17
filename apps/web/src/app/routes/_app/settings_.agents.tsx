import { createFileRoute } from '@tanstack/react-router';
import { agentDevicesQuery, agentStatusQuery } from '@/entities/agent';
import { AgentsPage } from '@/pages/settings-agents';
import { requireRole } from '../../lib/require-role';

export const Route = createFileRoute('/_app/settings_/agents')({
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(agentDevicesQuery),
      context.queryClient.ensureQueryData(agentStatusQuery),
    ]),
  component: AgentsPage,
});
