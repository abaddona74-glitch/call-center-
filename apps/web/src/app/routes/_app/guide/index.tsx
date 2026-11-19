import { createFileRoute } from '@tanstack/react-router';
import { GuideTreePage } from '@/pages/guide';
import { requirePermission } from '../../../lib/require-role';

/**
 * "Tizimlar va Rollar Daraxti" (legacy `guide.html`, public there). Call-center staff (`monitor.view`); the content is static
 * and ships with the app, so there is no server check to mirror (like `/profile`).
 */
export const Route = createFileRoute('/_app/guide/')({
  // Call-center staff only: observers see just the overview dashboard (owner, 19.11.2026).
  beforeLoad: ({ context }) => requirePermission(context.user, 'monitor.view'),
  component: GuideTreePage,
});
