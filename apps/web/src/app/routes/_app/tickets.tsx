import { TicketViewSchema } from '@cc/shared';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ticketContextQuery } from '@/entities/ticket';
import { TicketsPage } from '@/pages/tickets';

const SearchSchema = z.object({
  view: TicketViewSchema.optional().catch(undefined),
  open: z.coerce.number().int().positive().optional().catch(undefined),
});

/** Tickets board — every role; the API decides what each user sees and may do. */
export const Route = createFileRoute('/_app/tickets')({
  validateSearch: SearchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(ticketContextQuery),
  component: TicketsRoute,
});

function TicketsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <TicketsPage view={search.view} openId={search.open} onSearch={(s) => void navigate({ search: s, replace: true })} />;
}
