import { createFileRoute } from '@tanstack/react-router';
import { AuditSettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/_app/settings/audit')({
  component: AuditSettingsPage,
});
