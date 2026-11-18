import { createFileRoute } from '@tanstack/react-router';
import { excludedOperatorsQuery } from '@/entities/excluded-operator';
import { ExcludedOperatorsSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/exclude')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'settings.manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(excludedOperatorsQuery),
  component: ExcludedOperatorsSettingsPage,
});
