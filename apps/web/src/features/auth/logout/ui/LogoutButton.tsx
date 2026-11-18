import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { logout, sessionKeys } from '@/entities/session';
import { realtime } from '@/shared/api';
import { Button } from '@/shared/ui/button';

export function LogoutButton() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: logout,
    // Clearing the session makes the `_app` gate unmount the pages, drop cached data and open the login page.
    onSettled: () => {
      realtime.disconnect();
      queryClient.setQueryData(sessionKeys.me, null);
    },
  });

  return (
    <Button variant="ghost" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      <LogOut className="size-4" />
      {t('auth.signOut')}
    </Button>
  );
}
