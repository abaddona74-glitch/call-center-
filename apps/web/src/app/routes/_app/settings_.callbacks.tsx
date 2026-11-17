import { createFileRoute } from '@tanstack/react-router';
import { callbackSettingsQuery } from '@/entities/callback';
import { CallbackSettingsPage } from '@/pages/settings-callbacks';
import { requireRole } from '../../lib/require-role';

export const Route = createFileRoute('/_app/settings_/callbacks')({
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  loader: ({ context }) => context.queryClient.ensureQueryData(callbackSettingsQuery),
  component: CallbackSettingsPage,
});
