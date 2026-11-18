import { ticketCapabilities } from '@cc/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { TicketReportsPage } from '@/pages/ticket-reports';

/** Ticket reports: superuser, observer, executives (their regions only — enforced by the API). */
export const Route = createFileRoute('/_app/tickets_/reports')({
  beforeLoad: ({ context }) => {
    if (!ticketCapabilities(context.user).reports) throw redirect({ to: '/tickets' });
  },
  component: TicketReportsPage,
});
