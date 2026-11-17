import { createFileRoute, redirect } from '@tanstack/react-router';
import { contactAccessQuery, contactsQuery } from '@/entities/contact';
import { ClientsPage } from '@/pages/clients';

export const Route = createFileRoute('/_app/clients')({
  // Operator groups without phonebook access are sent home (the API refuses them anyway).
  beforeLoad: async ({ context }) => {
    const access = await context.queryClient.ensureQueryData(contactAccessQuery);
    if (!access.canView) throw redirect({ to: '/' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(contactsQuery),
  component: ClientsPage,
});
