import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { NotFoundPage } from '@/pages/not-found';
import { Toaster } from '@/shared/ui/sonner';
import type { RouterContext } from '../router/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <Toaster position="top-right" />
    </>
  ),
  notFoundComponent: NotFoundPage,
});
