import { createFileRoute } from '@tanstack/react-router';
import { ExplorerPage } from '@/pages/explorer';
import { requirePermission } from '../../lib/require-role';

/** Recordings browser — `recordings.listen` (the API enforces the same). */
export const Route = createFileRoute('/_app/explorer')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'recordings.listen'),
  component: ExplorerPage,
});
