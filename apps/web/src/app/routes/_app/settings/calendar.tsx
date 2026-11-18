import { createFileRoute } from '@tanstack/react-router';
import { workingCalendarQuery } from '@/entities/working-calendar';
import { WorkingCalendarSettingsPage } from '@/pages/settings';
import { requirePermission } from '../../../lib/require-role';

export const Route = createFileRoute('/_app/settings/calendar')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'settings.manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(workingCalendarQuery),
  component: WorkingCalendarSettingsPage,
});
