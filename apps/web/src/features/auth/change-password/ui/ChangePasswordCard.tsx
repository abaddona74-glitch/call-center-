import { PasswordSchema } from '@cc/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { accountKeys, changePassword } from '@/entities/user';
import { isHttpError, retryAfterFrom } from '@/shared/api';
import { registerTranslations } from '@/shared/i18n';
import { IconLock } from '@/shared/ui/inline-icons';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  SettingsButton,
  SettingsCard,
  SettingsCardHeader,
  SettingsInput,
} from '@/shared/ui/settings-panel';

registerTranslations('authChangePassword', {
  uz: {
    title: 'Parolni o‘zgartirish',
    description: 'Yangi parol saqlangach, boshqa qurilmalardagi barcha sessiyalar yopiladi.',
    current: 'Joriy parol',
    next: 'Yangi parol',
    confirm: 'Yangi parolni takrorlang',
    revokePasskeys: 'Barcha passkeylarimni ham o‘chirish (qurilma yo‘qolgan bo‘lsa)',
    submit: 'Parolni saqlash',
    tooShort: 'Kamida 10 ta belgi',
    mismatch: 'Parollar mos kelmadi',
    sameAsOld: 'Yangi parol joriy paroldan farq qilishi kerak',
    wrongCurrent: 'Joriy parol noto‘g‘ri',
    locked: 'Juda ko‘p xato urinish. {{seconds}} soniyadan so‘ng urinib ko‘ring',
    done: 'Parol o‘zgartirildi. Boshqa sessiyalar yopildi: {{count}}',
    failed: 'Parolni o‘zgartirib bo‘lmadi',
  },
  ru: {
    title: 'Смена пароля',
    description: 'После сохранения нового пароля все сеансы на других устройствах будут завершены.',
    current: 'Текущий пароль',
    next: 'Новый пароль',
    confirm: 'Повторите новый пароль',
    revokePasskeys: 'Удалить и все мои passkey (если устройство утеряно)',
    submit: 'Сохранить пароль',
    tooShort: 'Минимум 10 символов',
    mismatch: 'Пароли не совпадают',
    sameAsOld: 'Новый пароль должен отличаться от текущего',
    wrongCurrent: 'Текущий пароль неверен',
    locked: 'Слишком много ошибок. Повторите через {{seconds}} с',
    done: 'Пароль изменён. Завершено других сеансов: {{count}}',
    failed: 'Не удалось сменить пароль',
  },
});

export function ChangePasswordCard() {
  const { t } = useTranslation('authChangePassword');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: (res) => {
      toast.success(t('done', { count: res.revokedSessions }));
      void queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: accountKeys.passkeys });
      form.reset();
    },
  });

  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirm: '', revokePasskeys: false },
    onSubmit: ({ value }) =>
      mutation
        .mutateAsync({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokePasskeys: value.revokePasskeys,
        })
        .catch(() => undefined),
  });

  const serverError = mutation.error
    ? isHttpError(mutation.error, 429)
      ? t('locked', { seconds: retryAfterFrom(mutation.error) ?? 60 })
      : isHttpError(mutation.error, 400) && mutation.error.body?.message.includes('incorrect')
        ? t('wrongCurrent')
        : isHttpError(mutation.error, 400) && mutation.error.body?.message.includes('differ')
          ? t('sameAsOld')
          : t('failed')
    : null;

  return (
    <SettingsCard>
      <SettingsCardHeader icon={<IconLock size={20} />} title={t('title')} description={t('description')} />
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="currentPassword"
          validators={{ onSubmit: ({ value }) => (value ? undefined : t('wrongCurrent')) }}
        >
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="cp-current">{t('current')}</FieldLabel>
              <SettingsInput
                id="cp-current"
                type="password"
                autoComplete="current-password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
            </div>
          )}
        </form.Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <form.Field
            name="newPassword"
            validators={{
              onSubmit: ({ value }) => (PasswordSchema.safeParse(value).success ? undefined : t('tooShort')),
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="cp-new">{t('next')}</FieldLabel>
                <SettingsInput
                  id="cp-new"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError>{field.state.meta.errors[0]}</FieldError>
              </div>
            )}
          </form.Field>
          <form.Field
            name="confirm"
            validators={{
              onChangeListenTo: ['newPassword'],
              onSubmit: ({ value, fieldApi }) =>
                value === fieldApi.form.getFieldValue('newPassword') ? undefined : t('mismatch'),
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="cp-confirm">{t('confirm')}</FieldLabel>
                <SettingsInput
                  id="cp-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError>{field.state.meta.errors[0]}</FieldError>
              </div>
            )}
          </form.Field>
        </div>
        <form.Field name="revokePasskeys">
          {(field) => (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                className="size-4 accent-[#3b82f6]"
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
              />
              {t('revokePasskeys')}
            </label>
          )}
        </form.Field>
        {serverError && <FieldError>{serverError}</FieldError>}
        <div className="flex items-center justify-between gap-3">
          <FieldHint>{t('tooShort')}</FieldHint>
          <SettingsButton type="submit" disabled={mutation.isPending}>
            {t('submit')}
          </SettingsButton>
        </div>
      </form>
    </SettingsCard>
  );
}
