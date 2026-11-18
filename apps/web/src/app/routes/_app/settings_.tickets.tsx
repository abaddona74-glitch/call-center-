import { ticketCapabilities } from '@cc/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { ticketDirectoriesQuery } from '@/entities/ticket';
import { TicketSettingsPage } from '@/pages/settings-tickets';

/** Superuser: regions, cities/districts, categories, executive ↔ regions. */
export const Route = createFileRoute('/_app/settings_/tickets')({
  beforeLoad: ({ context }) => {
    if (!ticketCapabilities(context.user).manageDirectories) throw redirect({ to: '/' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(ticketDirectoriesQuery),
  component: TicketSettingsPage,
});
