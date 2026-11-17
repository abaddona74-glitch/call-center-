import { createFileRoute } from '@tanstack/react-router';
import { operatorGroupsQuery } from '@/entities/user';
import { GroupsSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/groups')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'users.manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorGroupsQuery),
  component: GroupsSettingsPage,
});
