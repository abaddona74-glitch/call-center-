import { TicketViewSchema } from '@cc/shared';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ticketContextQuery } from '@/entities/ticket';
import { TicketsPage } from '@/pages/tickets';
import { requirePermission } from '../../lib/require-role';

const SearchSchema = z.object({
  view: TicketViewSchema.optional().catch(undefined),
  open: z.coerce.number().int().positive().optional().catch(undefined),
});

/**
 * Tickets board — whoever has a ticket permission (same list as the sidebar item); the API decides what each user
 * sees and may do. Without one (the observer: dashboards only) `/` sends them to their own landing page.
 */
export const Route = createFileRoute('/_app/tickets')({
  validateSearch: SearchSchema,
  beforeLoad: ({ context }) =>
    requirePermission(context.user, 'tickets.create', 'tickets.callback', 'tickets.process', 'tickets.viewAll'),
  loader: ({ context }) => context.queryClient.ensureQueryData(ticketContextQuery),
  component: TicketsRoute,
});

function TicketsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TicketsPage
      view={search.view}
      openId={search.open}
      onSearch={(s) => void navigate({ search: s, replace: true })}
    />
  );
}
