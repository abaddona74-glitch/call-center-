import { createFileRoute } from '@tanstack/react-router';
import { operatorGroupsQuery, usersQuery } from '@/entities/user';
import { UsersSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/users')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'users.manage'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(usersQuery({})),
      context.queryClient.ensureQueryData(operatorGroupsQuery),
    ]),
  component: UsersSettingsPage,
});
