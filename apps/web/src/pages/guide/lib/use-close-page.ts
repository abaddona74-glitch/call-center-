import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * The guide pages were modals in legacy; their "close" / "Tushunarli" buttons now go back to where the user came
 * from (the Tools section), or to the home page when the page was opened directly.
 */
export function useClosePage(): () => void {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  return useCallback(() => {
    if (canGoBack) router.history.back();
    else void navigate({ to: '/' });
  }, [canGoBack, router, navigate]);
}
