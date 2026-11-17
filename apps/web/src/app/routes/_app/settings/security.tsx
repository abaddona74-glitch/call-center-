import { createFileRoute } from '@tanstack/react-router';
import { SecuritySettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/_app/settings/security')({
  component: SecuritySettingsPage,
});
