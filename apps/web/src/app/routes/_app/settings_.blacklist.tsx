import { createFileRoute } from '@tanstack/react-router';
import { blacklistQuery } from '@/entities/blocked-number';
import { BlacklistPage } from '@/pages/settings-blacklist';
import { requireRole } from '../../lib/require-role';

export const Route = createFileRoute('/_app/settings_/blacklist')({
  beforeLoad: ({ context }) => requireRole(context.user, 'admin'),
  loader: ({ context }) => context.queryClient.ensureQueryData(blacklistQuery),
  component: BlacklistPage,
});
