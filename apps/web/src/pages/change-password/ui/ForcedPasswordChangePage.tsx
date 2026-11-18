import { PasswordSchema } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logout, sessionKeys } from '@/entities/session';
import { changePassword } from '@/entities/user';
import { isHttpError, realtime } from '@/shared/api';
import { registerTranslations } from '@/shared/i18n';
import { cn } from '@/shared/lib/cn';
import { IconInfoCircle, IconLock } from '@/shared/ui/inline-icons';
import '@/shared/ui/legacy-auth.css';

registerTranslations('forcedPassword', {
  uz: {
    title: 'Parolni almashtiring',
    text: 'Xavfsizlik uchun tizimdan foydalanishdan oldin o‘zingizning yangi parolingizni o‘rnating. Joriy (vaqtinchalik) parol endi ishlamaydi.',
    current: 'Joriy (vaqtinchalik) parol',
    next: 'Yangi parol (kamida 10 ta belgi)',
    confirm: 'Yangi parolni takrorlang',
    submit: 'Parolni saqlash va davom etish',
    signOut: 'Chiqish',
    tooShort: 'Parol kamida 10 ta belgidan iborat bo‘lishi kerak',
    mismatch: 'Parollar mos kelmadi',
    same: 'Yangi parol joriy paroldan farq qilishi kerak',
    wrong: 'Joriy parol noto‘g‘ri',
    failed: 'Parolni o‘zgartirib bo‘lmadi',
  },
  ru: {
    title: 'Смените пароль',
    text: 'Для безопасности задайте свой новый пароль, прежде чем продолжить. Текущий (временный) пароль перестанет действовать.',
    current: 'Текущий (временный) пароль',
    next: 'Новый пароль (минимум 10 символов)',
    confirm: 'Повторите новый пароль',
    submit: 'Сохранить пароль и продолжить',
    signOut: 'Выйти',
    tooShort: 'Пароль должен быть не короче 10 символов',
    mismatch: 'Пароли не совпадают',
    same: 'Новый пароль должен отличаться от текущего',
    wrong: 'Текущий пароль неверен',
    failed: 'Не удалось сменить пароль',
  },
});

/** Shown instead of the app while the account must replace its password (owner decision for operator200–209). */
export function ForcedPasswordChangePage({ username, onDone }: { username: string; onDone: () => void }) {
  const { t } = useTranslation('forcedPassword');
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      onDone();
    },
    onError: (err) => {
      const m = isHttpError(err, 400) ? (err.body?.message ?? '') : '';
      setError(m.includes('incorrect') ? t('wrong') : m.includes('differ') ? t('same') : t('failed'));
    },
  });

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      realtime.disconnect();
      queryClient.setQueryData(sessionKeys.me, null);
      window.location.assign('/login');
    },
  });

  const submit = () => {
    if (!PasswordSchema.safeParse(next).success) return setError(t('tooShort'));
    if (next !== confirm) return setError(t('mismatch'));
    setError(null);
    save.mutate();
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div className="lg-group">
      <label className="lg-label" htmlFor={id}>
        {label}
      </label>
      <div className={cn('lg-input-wrap', error && 'has-error')}>
        <div className="lg-input-icon">
          <IconLock />
        </div>
        <input
          id={id}
          type="password"
          className="lg-input"
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => {
            setError(null);
            set(e.target.value);
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="lg-page">
      <div className="lg-grid" />
      <div className="lg-modal" style={{ zIndex: 10 }}>
        <div className="lg-modal-header">
          <div className="lg-modal-badge is-indigo">
            <IconLock size={24} />
          </div>
          <h1 className="lg-modal-title">{t('title')}</h1>
          <p className="lg-modal-subtitle">
            <strong>{username}</strong> — {t('text')}
          </p>
        </div>
        {error && (
          <div className="lg-alert" role="alert">
            <IconInfoCircle size={16} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {field('fc-current', t('current'), current, setCurrent, 'current-password')}
          {field('fc-new', t('next'), next, setNext, 'new-password')}
          {field('fc-confirm', t('confirm'), confirm, setConfirm, 'new-password')}
          <button
            type="submit"
            className={cn('lg-submit', current && next && confirm && 'is-ready', save.isPending && 'is-loading')}
          >
            <span className="lg-submit-content">{t('submit')}</span>
            <span className="lg-spinner" />
          </button>
        </form>
        <div className="mt-4 flex justify-center">
          <button type="button" className="lg-link-btn" onClick={() => signOut.mutate()}>
            {t('signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
