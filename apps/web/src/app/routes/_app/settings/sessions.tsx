import { createFileRoute } from '@tanstack/react-router';
import { SessionsSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/sessions')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'sessions.manage'),
  component: SessionsSettingsPage,
});
