import { PasswordSchema, type User } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { resetUserPassword, userKeys } from '@/entities/user';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { FieldError, FieldHint, FieldLabel, SettingsButton, SettingsInput } from '@/shared/ui/settings-panel';
import { userErrorText } from '../model/errors';

/** Admin sets a new password for a user; all their sessions end (passkeys too by default). */
export function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [revokePasskeys, setRevokePasskeys] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => resetUserPassword(user!.id, { password, revokePasskeys }),
    onSuccess: (res) => {
      toast.success(t('users.resetDone', { sessions: res.revokedSessions, passkeys: res.revokedPasskeys }));
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      close();
    },
    onError: (err) => setError(userErrorText(err, t)),
  });

  const close = () => {
    setPassword('');
    setRevokePasskeys(true);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-white/12 bg-[linear-gradient(160deg,#1e293b_0%,#0f172a_100%)] text-[#f8fafc] sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!PasswordSchema.safeParse(password).success) return setError(t('users.errors.password'));
            mutation.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('users.resetTitle', { name: user?.username ?? '' })}</DialogTitle>
            <DialogDescription className="text-[#94a3b8]">{t('users.resetText')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="reset-password">{t('users.newPassword')}</FieldLabel>
            <SettingsInput
              id="reset-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FieldHint>{t('users.passwordHint')}</FieldHint>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#cbd5e1]">
            <input
              type="checkbox"
              className="size-4 accent-[#3b82f6]"
              checked={revokePasskeys}
              onChange={(e) => setRevokePasskeys(e.target.checked)}
            />
            {t('users.revokePasskeys')}
          </label>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <SettingsButton tone="ghost" onClick={close}>
              {t('common.cancel')}
            </SettingsButton>
            <SettingsButton type="submit" disabled={mutation.isPending}>
              {t('users.resetPassword')}
            </SettingsButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
