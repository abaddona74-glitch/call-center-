import { createFileRoute, redirect } from '@tanstack/react-router';

/** Old address: the callbacks threshold moved to Settings → Ish vaqti together with the working calendar. */
export const Route = createFileRoute('/_app/settings_/callbacks')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/calendar' });
  },
});
