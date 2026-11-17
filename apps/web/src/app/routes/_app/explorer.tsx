import { createFileRoute } from '@tanstack/react-router';
import { ExplorerPage } from '@/pages/explorer';
import { requireRole } from '../../lib/require-role';

/** Recordings browser — admins only (the API enforces the same). */
export const Route = createFileRoute('/_app/explorer')({
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  component: ExplorerPage,
});
