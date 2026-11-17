import { createFileRoute, redirect } from '@tanstack/react-router';
import { firstSettingsTab } from '@/pages/settings';

export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: firstSettingsTab(context.user) });
  },
});
