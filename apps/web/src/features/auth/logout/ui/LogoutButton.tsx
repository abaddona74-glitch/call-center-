import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { logout, sessionKeys } from '@/entities/session';
import { realtime } from '@/shared/api';
import { Button } from '@/shared/ui/button';

type LogoutButtonProps = Omit<React.ComponentProps<typeof Button>, 'children'> & {
  /** Icon only (the label becomes the accessible name), e.g. at the foot of the sidebar. */
  compact?: boolean;
};

/** Extra props (and a ref) reach the button, so it can sit inside a `TooltipTrigger asChild`. */
export function LogoutButton({ compact = false, onClick, ...props }: LogoutButtonProps) {
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

  const label = t('auth.signOut');
  return (
    <Button
      variant="ghost"
      size={compact ? 'icon-sm' : 'sm'}
      aria-label={compact ? label : undefined}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        mutation.mutate();
      }}
      disabled={mutation.isPending}
    >
      <LogOut className="size-4" />
      {!compact && label}
    </Button>
  );
}
