import { createFileRoute } from '@tanstack/react-router';
import { SettingsLayout } from '@/pages/settings';
import { requireRole } from '../../lib/require-role';

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  component: SettingsLayout,
});
