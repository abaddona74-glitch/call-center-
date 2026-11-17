import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { sessionQuery } from '@/entities/session';
import { LoginPage } from '@/pages/login';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user) throw redirect({ to: search.redirect ?? '/' });
  },
  component: LoginRoute,
});

function LoginRoute() {
  const navigate = Route.useNavigate();
  const { redirect: back } = Route.useSearch();
  // Only same-app paths are allowed as redirect targets.
  const target = back?.startsWith('/') && !back.startsWith('//') ? back : '/';
  return <LoginPage onLoggedIn={() => void navigate({ to: target })} />;
}
