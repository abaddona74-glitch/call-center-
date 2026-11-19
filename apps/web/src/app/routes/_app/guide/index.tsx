import { createFileRoute } from '@tanstack/react-router';
import { GuideTreePage } from '@/pages/guide';
import { requirePermission } from '../../../lib/require-role';

/**
 * "Tizimlar va Rollar Daraxti" (legacy `guide.html`, public there). `guide.view` (every role except "Mas'ul"):
 * the content is static and ships with the app, so there is no server check to mirror.
 */
export const Route = createFileRoute('/_app/guide/')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'guide.view'),
  component: GuideTreePage,
});
