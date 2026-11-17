import type { EmailChangeStatus } from '@cc/shared';
import { AccountEmailSchema } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { sessionKeys } from '@/entities/session';
import { accountKeys, cancelEmailChange, emailStatusQuery, startEmailChange, verifyEmailChange } from '@/entities/user';
import { isHttpError } from '@/shared/api';
import { registerTranslations } from '@/shared/i18n';
import { IconInfoCircle, IconSms } from '@/shared/ui/inline-icons';
import { OtpInput } from '@/shared/ui/otp-input';
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

registerTranslations('authEmail', {
  uz: {
    title: 'Email (Gmail) manzili',
    description: 'Parolni unutganingizda tiklash kodi faqat shu manzilga yuboriladi.',
    hint: 'Parolni unutganingizda, 6 xonali tasdiqlash kodi ushbu manzilga yuboriladi va kirishni o‘zingiz tiklay olasiz.',
    current: 'Joriy email',
    none: 'Ulanmagan',
    bound: 'Ulangan',
    password: 'Joriy hisob paroli',
    passwordHint: 'Begona shaxs hisobingizga boshqa email ulab olmasligi uchun parolingizni tasdiqlang.',
    newEmail: 'Yangi email',
    bind: 'Ulash',
    change: 'O‘zgartirish',
    unbind: 'Emailni uzish',
    codeToCurrent: 'Avval joriy manzilingizni tasdiqlang: kod {{to}} ga yuborildi.',
    codeToNew: 'Kod yangi manzilga yuborildi: {{to}}.',
    codeLabel: 'Tasdiqlash kodi',
    validFor: 'Amal qilish vaqti: {{time}}',
    verify: 'Tasdiqlash',
    cancel: 'Bekor qilish',
    invalidEmail: 'Email manzili noto‘g‘ri',
    needPassword: 'Joriy parolni kiriting',
    wrongPassword: 'Joriy parol noto‘g‘ri',
    taken: 'Bu email boshqa hisobga ulangan',
    same: 'Bu email allaqachon ulangan',
    badCode: 'Kod noto‘g‘ri yoki muddati o‘tgan',
    tooMany: 'Juda ko‘p urinish. Birozdan so‘ng urinib ko‘ring',
    sendFailed: 'Xat yuborilmadi. Keyinroq urinib ko‘ring',
    failed: 'Xatolik yuz berdi',
    boundDone: 'Email ulandi',
    unboundDone: 'Email uzildi',
  },
  ru: {
    title: 'Email (Gmail)',
    description: 'Если забудете пароль, код восстановления придёт только на этот адрес.',
    hint: 'Если забудете пароль, 6-значный код придёт на этот адрес, и вы сможете восстановить доступ сами.',
    current: 'Текущий email',
    none: 'Не привязан',
    bound: 'Привязан',
    password: 'Текущий пароль',
    passwordHint: 'Подтвердите пароль, чтобы посторонний не мог привязать к вашей учётной записи свой email.',
    newEmail: 'Новый email',
    bind: 'Привязать',
    change: 'Изменить',
    unbind: 'Отвязать email',
    codeToCurrent: 'Сначала подтвердите текущий адрес: код отправлен на {{to}}.',
    codeToNew: 'Код отправлен на новый адрес: {{to}}.',
    codeLabel: 'Код подтверждения',
    validFor: 'Действует: {{time}}',
    verify: 'Подтвердить',
    cancel: 'Отмена',
    invalidEmail: 'Неверный email',
    needPassword: 'Введите текущий пароль',
    wrongPassword: 'Текущий пароль неверен',
    taken: 'Этот email привязан к другой учётной записи',
    same: 'Этот email уже привязан',
    badCode: 'Неверный или просроченный код',
    tooMany: 'Слишком много попыток. Попробуйте позже',
    sendFailed: 'Письмо не отправлено. Попробуйте позже',
    failed: 'Произошла ошибка',
    boundDone: 'Email привязан',
    unboundDone: 'Email отвязан',
  },
});

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Bind / change / unbind the email used for password recovery. Requires the current password;
 * an already bound address confirms the change first, then the new one gets its own code.
 */
export function EmailBindingCard() {
  const { t } = useTranslation('authEmail');
  const queryClient = useQueryClient();
  const { data: status } = useQuery(emailStatusQuery);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!status?.expiresInSeconds) return;
    setNow(Date.now());
    setDeadline(Date.now() + status.expiresInSeconds * 1000);
  }, [status?.expiresInSeconds, status?.step]);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;

  const apply = (next: EmailChangeStatus) => {
    queryClient.setQueryData(accountKeys.email, (prev: EmailChangeStatus | undefined) => ({
      ...next,
      email: next.step === 'done' ? next.email : (prev?.email ?? null),
    }));
    setCode('');
    setError(null);
    if (next.step === 'done') {
      setPassword('');
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      toast.success(next.email ? t('boundDone') : t('unboundDone'));
    }
  };

  const explain = (err: unknown) => {
    if (isHttpError(err, 409)) return t('taken');
    if (isHttpError(err, 429)) return t('tooMany');
    if (isHttpError(err, 400)) {
      const m = err.body?.message ?? '';
      if (m.includes('Current password')) return t('wrongPassword');
      if (m.includes('already bound')) return t('same');
      if (m.includes('could not be sent')) return t('sendFailed');
      if (m.includes('Too many')) return t('tooMany');
      if (m.includes('code')) return t('badCode');
    }
    return t('failed');
  };

  const start = useMutation({
    mutationFn: (action: 'bind' | 'unbind') =>
      startEmailChange(action === 'bind' ? { action, email, password } : { action, password }),
    onSuccess: apply,
    onError: (err) => setError(explain(err)),
  });
  const verify = useMutation({
    mutationFn: () => verifyEmailChange(code),
    onSuccess: apply,
    onError: (err) => setError(explain(err)),
  });
  const cancel = useMutation({
    mutationFn: cancelEmailChange,
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: accountKeys.email });
    },
  });

  const begin = (action: 'bind' | 'unbind') => {
    if (!password) return setError(t('needPassword'));
    if (action === 'bind' && !AccountEmailSchema.safeParse(email).success) return setError(t('invalidEmail'));
    start.mutate(action);
  };

  const current = status?.email ?? null;
  const pending = status && status.step !== 'done';

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<IconSms size={20} />}
        title={t('title')}
        description={t('description')}
        actions={current ? <Pill tone="green">{t('bound')}</Pill> : <Pill tone="amber">{t('none')}</Pill>}
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-[rgba(56,189,248,0.25)] bg-[rgba(56,189,248,0.08)] px-3.5 py-3 text-xs leading-relaxed text-[#cbd5e1]">
        <IconInfoCircle size={18} className="mt-px shrink-0 text-[#38bdf8]" />
        <span>{t('hint')}</span>
      </div>

      <div className="mb-3.5 flex items-center justify-between rounded-xl border border-white/8 bg-[rgba(30,41,59,0.6)] px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.5px] text-[#94a3b8] uppercase">{t('current')}</div>
          <div className="mt-0.5 text-[15px] font-bold text-[#f1f5f9]">{current ?? '—'}</div>
        </div>
      </div>

      {pending ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) verify.mutate();
          }}
        >
          <p className="text-xs text-[#cbd5e1]">
            {status.step === 'verify_current' ? t('codeToCurrent', { to: status.sentTo }) : t('codeToNew', { to: status.sentTo })}
          </p>
          <FieldLabel htmlFor="email-code">
            {t('codeLabel')}
            <span className={left > 0 ? 'text-[#93c5fd]' : 'text-[#fca5a5]'}>{t('validFor', { time: mmss(left) })}</span>
          </FieldLabel>
          <OtpInput id="email-code" value={code} onValueChange={setCode} autoFocus />
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <SettingsButton tone="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {t('cancel')}
            </SettingsButton>
            <SettingsButton type="submit" disabled={code.length !== 6 || verify.isPending}>
              {t('verify')}
            </SettingsButton>
          </div>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            begin('bind');
          }}
        >
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="email-password">
              {t('password')}
              <span className="text-[11px] text-[#f59e0b]">🔒</span>
            </FieldLabel>
            <SettingsInput
              id="email-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FieldHint>{t('passwordHint')}</FieldHint>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="email-new">{t('newEmail')}</FieldLabel>
            <SettingsInput
              id="email-new"
              type="email"
              autoComplete="email"
              placeholder="misol@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <FieldError>{error}</FieldError>
          <div className="flex flex-wrap justify-end gap-2">
            {current && (
              <SettingsButton tone="danger" onClick={() => begin('unbind')} disabled={start.isPending}>
                {t('unbind')}
              </SettingsButton>
            )}
            <SettingsButton type="submit" disabled={start.isPending}>
              {current ? t('change') : t('bind')}
            </SettingsButton>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}
