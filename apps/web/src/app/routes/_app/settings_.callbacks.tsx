import { createFileRoute } from '@tanstack/react-router';
import { callbackSettingsQuery } from '@/entities/callback';
import { CallbackSettingsPage } from '@/pages/settings-callbacks';
import { requirePermission } from '../../lib/require-role';

export const Route = createFileRoute('/_app/settings_/callbacks')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'settings.manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(callbackSettingsQuery),
  component: CallbackSettingsPage,
});
