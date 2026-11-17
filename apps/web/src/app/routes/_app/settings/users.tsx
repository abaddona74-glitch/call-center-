import { createFileRoute } from '@tanstack/react-router';
import { operatorGroupsQuery, usersQuery } from '@/entities/user';
import { UsersSettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/_app/settings/users')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(usersQuery({})),
      context.queryClient.ensureQueryData(operatorGroupsQuery),
    ]),
  component: UsersSettingsPage,
});
