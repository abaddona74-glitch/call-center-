import { createFileRoute } from '@tanstack/react-router';
import { operatorGroupsQuery } from '@/entities/user';
import { GroupsSettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/_app/settings/groups')({
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorGroupsQuery),
  component: GroupsSettingsPage,
});
