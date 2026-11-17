import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { logout, sessionKeys } from '@/entities/session';
import { realtime } from '@/shared/api';
import { PATHS } from '@/shared/config';
import { Button } from '@/shared/ui/button';

export function LogoutButton() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: logout,
    onSettled: async () => {
      realtime.disconnect();
      queryClient.setQueryData(sessionKeys.me, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      await navigate({ to: PATHS.login });
    },
  });

  return (
    <Button variant="ghost" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      <LogOut className="size-4" />
      {t('auth.signOut')}
    </Button>
  );
}
