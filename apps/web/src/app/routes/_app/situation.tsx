import { createFileRoute } from '@tanstack/react-router';
import { situationQuery } from '@/entities/situation';
import { SituationPage } from '@/pages/situation';
import { requirePermission } from '../../lib/require-role';

/** The live situation board: observers land here (owner, 19.11.2026), the superuser sees it too. */
export const Route = createFileRoute('/_app/situation')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'situation.view'),
  // A failed prefetch must not block navigation: the page shows the error itself.
  loader: ({ context }) => context.queryClient.ensureQueryData(situationQuery).catch(() => undefined),
  component: SituationPage,
});
