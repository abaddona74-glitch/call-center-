import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSessionUser } from '@/entities/session';
import { RoleBadge, accountKeys, mySessionsQuery, revokeMySession } from '@/entities/user';
import { ChangePasswordCard } from '@/features/auth/change-password';
import { EmailBindingCard } from '@/features/auth/email-binding';
import { PasskeysCard } from '@/features/auth/manage-passkeys';
import { registerTranslations } from '@/shared/i18n';
import { describeUserAgent, formatDateTime } from '@/shared/lib/format-datetime';
import { Icon } from '@/shared/ui/icon';
import { IconUser } from '@/shared/ui/inline-icons';
import { Pill, SettingsButton, SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';

registerTranslations('profile', {
  uz: {
    title: 'Foydalanuvchi profili',
    subtitle: 'Parol, email, passkey va faol sessiyalar',
    account: 'Joriy hisob',
    extension: 'Operator ID',
    sessionsTitle: 'Faol sessiyalarim',
    sessionsText: 'Hisobingizga kirilgan qurilmalar. Tanimagan sessiyani darhol yoping va parolni o‘zgartiring.',
    current: 'Shu qurilma',
    passkey: 'Passkey',
    since: 'Kirgan',
    seen: 'Faol',
    end: 'Yopish',
    ended: 'Sessiya yopildi',
    impersonatedBy: '{{name}} kirgan',
  },
  ru: {
    title: 'Профиль пользователя',
    subtitle: 'Пароль, email, passkey и активные сеансы',
    account: 'Текущая учётная запись',
    extension: 'ID оператора',
    sessionsTitle: 'Мои активные сеансы',
    sessionsText: 'Устройства, где выполнен вход. Незнакомый сеанс сразу завершите и смените пароль.',
    current: 'Это устройство',
    passkey: 'Passkey',
    since: 'Вход',
    seen: 'Активен',
    end: 'Завершить',
    ended: 'Сеанс завершён',
    impersonatedBy: 'вошёл {{name}}',
  },
});

export function ProfilePage() {
  const { t } = useTranslation('profile');
  const user = useSessionUser();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-tint/12 bg-[linear-gradient(160deg,var(--glass-2)_0%,var(--sidebar)_100%)] px-5 py-4 shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_35%,transparent)]">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.15)] text-link">
            <IconUser size={20} />
          </span>
          <div>
            <h2 className="text-[17px] font-bold text-ink">{t('title')}</h2>
            <p className="text-xs text-mute">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-tint/8 bg-glass-2/60 px-4 py-2.5">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.5px] text-mute uppercase">{t('account')}</div>
            <div className="text-[15px] font-bold text-ink">{user.username}</div>
          </div>
          <div className="text-right">
            <RoleBadge role={user.role} />
            {user.extension && (
              <div className="mt-1 text-[11.5px] font-semibold text-info">
                {t('extension')}: {user.extension}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChangePasswordCard />
        <EmailBindingCard />
      </div>
      <PasskeysCard />
      <MySessionsCard />
    </div>
  );
}

function MySessionsCard() {
  const { t } = useTranslation('profile');
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery(mySessionsQuery);
  const revoke = useMutation({
    mutationFn: revokeMySession,
    onSuccess: () => {
      toast.success(t('ended'));
      void queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
    },
  });

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Icon name="monitor" className="size-5" />}
        title={t('sessionsTitle')}
        description={t('sessionsText')}
      />
      <ul className="flex flex-col gap-2">
        {sessions?.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tint/5 bg-glass-2/50 px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                {describeUserAgent(s.userAgent)}
                <span className="font-mono text-[11px] font-normal text-info">{s.ip ?? '—'}</span>
                {s.isCurrent && <Pill tone="green">{t('current')}</Pill>}
                {s.viaPasskey && <Pill tone="blue">{t('passkey')}</Pill>}
                {s.impersonatedBy && <Pill tone="amber">{t('impersonatedBy', { name: s.impersonatedBy })}</Pill>}
              </div>
              <div className="text-[11px] text-mute">
                {t('since')}: {formatDateTime(s.createdAt)} · {t('seen')}: {formatDateTime(s.lastSeenAt)}
              </div>
            </div>
            {s.canRevoke && (
              <SettingsButton size="sm" tone="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                {t('end')}
              </SettingsButton>
            )}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
