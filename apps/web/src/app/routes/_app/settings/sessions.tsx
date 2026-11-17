import { createFileRoute } from '@tanstack/react-router';
import { SessionsSettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/_app/settings/sessions')({
  component: SessionsSettingsPage,
});
