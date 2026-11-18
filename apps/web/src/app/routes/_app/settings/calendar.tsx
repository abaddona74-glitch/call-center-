import { createFileRoute } from '@tanstack/react-router';
import { callbackSettingsQuery } from '@/entities/callback';
import { workingCalendarQuery } from '@/entities/working-calendar';
import { WorkingCalendarSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/calendar')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'settings.manage'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(workingCalendarQuery),
      context.queryClient.ensureQueryData(callbackSettingsQuery),
    ]),
  component: WorkingCalendarSettingsPage,
});
