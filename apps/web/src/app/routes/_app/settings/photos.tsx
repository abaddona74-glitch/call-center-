import { createFileRoute } from '@tanstack/react-router';
import { operatorPhotosQuery } from '@/entities/operator-photo';
import { OperatorPhotosSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/photos')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'settings.manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorPhotosQuery),
  component: OperatorPhotosSettingsPage,
});
