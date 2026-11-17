import { createFileRoute } from '@tanstack/react-router';
import { AuditSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/audit')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'audit.view'),
  component: AuditSettingsPage,
});
