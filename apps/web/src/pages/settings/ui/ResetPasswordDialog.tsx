import { PasswordSchema, type User } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { resetUserPassword, userKeys } from '@/entities/user';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { IconLock } from '@/shared/ui/inline-icons';
import { FieldError, SettingsButton, SettingsInput } from '@/shared/ui/settings-panel';
import { userErrorText } from '../model/errors';

/** Legacy "Parolni Tiklash / Yangilash" modal: new password + "revoke all biometric devices". */
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
      <DialogContent className="gap-0 rounded-2xl border-[rgba(56,189,248,0.3)] bg-[#0f172a] p-0 text-[#f8fafc] shadow-[0_25px_60px_rgba(0,0,0,0.7)] sm:max-w-[440px] [&>button]:top-[34px] [&>button]:right-[28px] [&>button]:rounded-md [&>button]:border [&>button]:border-white/10 [&>button]:bg-white/5 [&>button]:p-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!PasswordSchema.safeParse(password).success) return setError(t('users.errors.password'));
            mutation.mutate();
          }}
        >
          <div className="mx-5 flex items-center gap-2.5 border-b border-white/8 px-5 pt-10 pb-4">
            <span className="flex size-9 items-center justify-center rounded-[10px] border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.15)] text-[#60a5fa]">
              <IconLock size={18} />
            </span>
            <div>
              <DialogTitle className="text-[15px] font-bold text-white">{t('users.resetTitle')}</DialogTitle>
              <DialogDescription className="text-[11.5px] text-[#94a3b8]">
                {t('users.resetFor')}: <b className="text-[#38bdf8]">{user?.username}</b>
              </DialogDescription>
            </div>
          </div>

          <div className="flex flex-col gap-3.5 px-[42px] pt-6 pb-5">
            <label className="flex flex-col gap-2" htmlFor="reset-password">
              <span className="text-[12.5px] font-semibold text-[#e2e8f0]">{t('users.newPassword')}:</span>
              <SettingsInput
                id="reset-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                placeholder={t('users.passwordHint')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3.5 py-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[#0ea5e9]"
                checked={revokePasskeys}
                onChange={(e) => setRevokePasskeys(e.target.checked)}
              />
              <span>
                <span className="block text-[12.5px] font-semibold text-[#f1f5f9]">{t('users.revokePasskeys')}</span>
                <span className="block text-[11.5px] leading-snug text-[#94a3b8]">{t('users.revokePasskeysHint')}</span>
              </span>
            </label>
            <FieldError>{error}</FieldError>
            <div className="mt-6 flex justify-end gap-2">
              <SettingsButton tone="ghost" onClick={close}>
                {t('common.cancel')}
              </SettingsButton>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="cursor-pointer rounded-lg bg-[#0284c7] px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0369a1] disabled:opacity-50"
              >
                {t('users.resetSubmit')}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
