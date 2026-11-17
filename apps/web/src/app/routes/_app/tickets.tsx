import { createFileRoute } from '@tanstack/react-router';
import { TicketsPage } from '@/pages/tickets';

/** Tickets board — every role; the API decides what each user sees and may do. */
export const Route = createFileRoute('/_app/tickets')({
  component: TicketsPage,
});
