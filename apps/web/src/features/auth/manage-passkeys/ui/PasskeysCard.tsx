import type { Passkey } from '@cc/shared';
import {
  type PublicKeyCredentialCreationOptionsJSON,
  WebAuthnError,
  browserSupportsWebAuthn,
  startRegistration,
} from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  accountKeys,
  deletePasskey,
  myPasskeysQuery,
  passkeyRegistrationOptions,
  passkeyRegistrationVerify,
  renamePasskey,
} from '@/entities/user';
import { isHttpError } from '@/shared/api';
import { registerTranslations } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Icon } from '@/shared/ui/icon';
import { IconFingerprint } from '@/shared/ui/inline-icons';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  Pill,
  SettingsButton,
  SettingsCard,
  SettingsCardHeader,
  SettingsInput,
} from '@/shared/ui/settings-panel';

registerTranslations('authPasskeys', {
  uz: {
    title: 'Passkey (barmoq izi / Face ID)',
    description: 'Parolsiz tezkor kirish. Har bir qurilma uchun alohida kalit ulanadi (ko‘pi bilan 10 ta).',
    empty: 'Hali passkey ulanmagan',
    created: 'Ulangan',
    lastUsed: 'Oxirgi kirish',
    never: 'hali ishlatilmagan',
    synced: 'Sinxronlanadi',
    deviceName: 'Qurilma nomi',
    deviceNamePlaceholder: 'Masalan: Ish kompyuteri',
    password: 'Joriy parol',
    add: 'Passkey qo‘shish',
    adding: 'Qurilmani tasdiqlang…',
    rename: 'Nomini o‘zgartirish',
    save: 'Saqlash',
    cancel: 'Bekor qilish',
    remove: 'O‘chirish',
    confirmTitle: 'Passkey o‘chirilsinmi?',
    confirmText: '«{{name}}» o‘chiriladi va u orqali ochilgan sessiyalar yopiladi.',
    added: 'Passkey ulandi',
    removed: 'Passkey o‘chirildi',
    insecure: 'Passkey faqat HTTPS orqali ishlaydi',
    unsupported: 'Brauzer passkeyni qo‘llab-quvvatlamaydi',
    cancelled: 'Bekor qilindi',
    duplicate: 'Bu qurilma allaqachon ulangan',
    wrongPassword: 'Joriy parol noto‘g‘ri',
    needFields: 'Qurilma nomi va joriy parolni kiriting',
    limit: 'Ko‘pi bilan 10 ta passkey',
    failed: 'Passkeyni ulab bo‘lmadi',
  },
  ru: {
    title: 'Passkey (отпечаток / Face ID)',
    description: 'Быстрый вход без пароля. Для каждого устройства свой ключ (не больше 10).',
    empty: 'Passkey ещё не добавлены',
    created: 'Добавлен',
    lastUsed: 'Последний вход',
    never: 'ещё не использовался',
    synced: 'Синхронизируется',
    deviceName: 'Название устройства',
    deviceNamePlaceholder: 'Например: Рабочий компьютер',
    password: 'Текущий пароль',
    add: 'Добавить passkey',
    adding: 'Подтвердите на устройстве…',
    rename: 'Переименовать',
    save: 'Сохранить',
    cancel: 'Отмена',
    remove: 'Удалить',
    confirmTitle: 'Удалить passkey?',
    confirmText: '«{{name}}» будет удалён, а сеансы, открытые с ним, — завершены.',
    added: 'Passkey добавлен',
    removed: 'Passkey удалён',
    insecure: 'Passkey работают только по HTTPS',
    unsupported: 'Браузер не поддерживает passkey',
    cancelled: 'Отменено',
    duplicate: 'Это устройство уже добавлено',
    wrongPassword: 'Текущий пароль неверен',
    needFields: 'Введите название устройства и текущий пароль',
    limit: 'Не больше 10 passkey',
    failed: 'Не удалось добавить passkey',
  },
});

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return '';
}

export function PasskeysCard() {
  const { t } = useTranslation('authPasskeys');
  const queryClient = useQueryClient();
  const { data: passkeys, isLoading } = useQuery(myPasskeysQuery);
  const [name, setName] = useState(defaultDeviceName);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<Passkey | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.passkeys });

  const add = useMutation({
    mutationFn: async () => {
      const options = await passkeyRegistrationOptions({ name: name.trim(), password });
      const credential = await startRegistration({
        optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      return passkeyRegistrationVerify(credential);
    },
    onSuccess: () => {
      setPassword('');
      setError(null);
      toast.success(t('added'));
      void refresh();
    },
    onError: (err) => {
      if (err instanceof WebAuthnError) {
        setError(err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' ? t('duplicate') : t('cancelled'));
      } else if (err instanceof Error && err.name === 'NotAllowedError') setError(t('cancelled'));
      else if (isHttpError(err, 409)) setError(t('duplicate'));
      else if (isHttpError(err, 400) && err.body?.message.includes('password')) setError(t('wrongPassword'));
      else if (isHttpError(err, 400) && err.body?.message.includes('At most')) setError(t('limit'));
      else setError(t('failed'));
    },
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => renamePasskey(v.id, v.name.trim()),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePasskey(id),
    onSuccess: () => {
      setToDelete(null);
      toast.success(t('removed'));
      void refresh();
    },
  });

  const startAdd = () => {
    if (!window.isSecureContext) return setError(t('insecure'));
    if (!browserSupportsWebAuthn()) return setError(t('unsupported'));
    if (!name.trim() || !password) return setError(t('needFields'));
    setError(null);
    add.mutate();
  };

  return (
    <SettingsCard>
      <SettingsCardHeader icon={<IconFingerprint size={20} />} title={t('title')} description={t('description')} />

      <ul className="mb-4 flex flex-col gap-2">
        {!isLoading && passkeys?.length === 0 && <li className="py-3 text-center text-xs text-mute">{t('empty')}</li>}
        {passkeys?.map((pk) => (
          <li
            key={pk.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tint/5 bg-glass-2/50 px-3 py-2.5 transition-colors hover:border-tint/10 hover:bg-glass-2/80"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(56,189,248,0.15)] text-info">
                <IconFingerprint size={16} />
              </div>
              {editing?.id === pk.id ? (
                <SettingsInput
                  autoFocus
                  className="h-8 max-w-56 py-1"
                  value={editing.name}
                  maxLength={60}
                  onChange={(e) => setEditing({ id: pk.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editing.name.trim()) rename.mutate(editing);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-[13px] font-semibold text-foreground">
                    {pk.name}
                    {pk.backedUp && <Pill tone="blue">{t('synced')}</Pill>}
                  </div>
                  <div className="text-[11px] text-mute">
                    {t('created')}: {formatDateTime(pk.createdAt)} · {t('lastUsed')}:{' '}
                    {pk.lastUsedAt ? formatDateTime(pk.lastUsedAt) : t('never')}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-1.5">
              {editing?.id === pk.id ? (
                <>
                  <SettingsButton size="sm" tone="ghost" onClick={() => setEditing(null)}>
                    {t('cancel')}
                  </SettingsButton>
                  <SettingsButton
                    size="sm"
                    tone="success"
                    disabled={!editing.name.trim()}
                    onClick={() => rename.mutate(editing)}
                  >
                    {t('save')}
                  </SettingsButton>
                </>
              ) : (
                <>
                  <SettingsButton
                    size="sm"
                    tone="ghost"
                    title={t('rename')}
                    onClick={() => setEditing({ id: pk.id, name: pk.name })}
                  >
                    <Icon name="edit" className="size-3.5" />
                  </SettingsButton>
                  <SettingsButton size="sm" tone="danger" title={t('remove')} onClick={() => setToDelete(pk)}>
                    <Icon name="trash" className="size-3.5" />
                  </SettingsButton>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          startAdd();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="pk-name">{t('deviceName')}</FieldLabel>
          <SettingsInput
            id="pk-name"
            maxLength={60}
            placeholder={t('deviceNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="pk-password">{t('password')}</FieldLabel>
          <SettingsInput
            id="pk-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <SettingsButton type="submit" tone="success" disabled={add.isPending}>
          <IconFingerprint size={15} />
          {add.isPending ? t('adding') : t('add')}
        </SettingsButton>
      </form>
      <div className="mt-2">
        <FieldError>{error}</FieldError>
        {!error && <FieldHint>{t('description')}</FieldHint>}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('confirmTitle')}
        description={t('confirmText', { name: toDelete?.name ?? '' })}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        pending={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </SettingsCard>
  );
}
