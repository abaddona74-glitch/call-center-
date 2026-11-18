import { createFileRoute } from '@tanstack/react-router';
import { GuideTreePage } from '@/pages/guide';

/**
 * "Tizimlar va Rollar Daraxti" (legacy `guide.html`, public there). Every signed-in user: the content is static
 * and ships with the app, so there is no server check to mirror (like `/profile`).
 */
export const Route = createFileRoute('/_app/guide/')({
  component: GuideTreePage,
});
