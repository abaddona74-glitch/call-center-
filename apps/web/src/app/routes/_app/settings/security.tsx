import { createFileRoute } from '@tanstack/react-router';
import { SecuritySettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/security')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'security.manage'),
  component: SecuritySettingsPage,
});
