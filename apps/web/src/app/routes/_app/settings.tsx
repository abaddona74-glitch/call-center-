import { createFileRoute } from '@tanstack/react-router';
import { SettingsLayout } from '@/pages/settings';
import { requirePermission } from '../../lib/require-role';

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ context }) =>
    requirePermission(
      context.user,
      'users.manage',
      'sessions.manage',
      'security.manage',
      'settings.manage',
      'audit.view',
    ),
  component: SettingsLayout,
});
