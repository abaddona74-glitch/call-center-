import { LoginRequestSchema, type SessionUser } from '@cc/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { login } from '@/entities/session';
import { isHttpError, retryAfterFrom } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { IconArrowRight, IconEye, IconEyeSlash, IconInfoCircle, IconLock, IconUser } from '@/shared/ui/inline-icons';
import '@/shared/ui/legacy-auth.css';
import '../i18n';

export type LoginFieldFocus = 'username' | 'password' | 'password-visible' | null;

const ZIGZAG =
  'M0,6 Q10,0 20,6 T40,6 T60,6 T80,6 T100,6 T120,6 T140,6 T160,6 T180,6 T200,6 T220,6 T240,6 T260,6 T280,6 T300,6';

function Zigzag() {
  return (
    <svg className="lg-zigzag" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true">
      <path d={ZIGZAG} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Password login with the legacy look: floating labels, show-password toggle, zigzag error
 * underline, shake on error and a button that morphs into a spinner and a green check.
 * Reports focus/result so the page can animate the characters.
 */
export function LoginForm({
  onSuccess,
  onFocusChange,
  onError,
  onForgot,
  extra,
}: {
  onSuccess: (user: SessionUser) => void;
  onFocusChange?: (focus: LoginFieldFocus) => void;
  onError?: () => void;
  onForgot?: () => void;
  /** Rendered under the submit button (passkey login). */
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation('authLogin');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which fields get the red border + zigzag (legacy marks only the password on a wrong password). */
  const [errorField, setErrorField] = useState<'username' | 'password' | 'all' | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const mutation = useMutation({ mutationFn: login });

  const fail = (message: string, field: 'username' | 'password' | 'all' = 'all') => {
    setError(message);
    setErrorField(field);
    onError?.();
  };

  const form = useForm({
    defaultValues: { username: '', password: '' },
    onSubmit: async ({ value }) => {
      const parsed = LoginRequestSchema.safeParse(value);
      if (!parsed.success) return fail(t('required'), value.username.trim() ? 'password' : 'username');
      setError(null);
      setErrorField(null);
      try {
        const res = await mutation.mutateAsync(parsed.data);
        setSucceeded(true);
        // let the check mark draw before navigating (legacy timing)
        setTimeout(() => onSuccess(res.user), 650);
      } catch (err) {
        const seconds = retryAfterFrom(err);
        if (isHttpError(err, 429)) fail(seconds ? t('locked', { seconds }) : t('lockedNoTime'));
        else if (isHttpError(err, 401) || isHttpError(err, 400)) {
          const left = err.body?.message.match(/Attempts left: (\d+)/)?.[1];
          fail(left === undefined ? t('invalid') : `${t('invalid')}. ${t('attemptsLeft', { count: Number(left) })}`, 'password');
          // like legacy: clear the password and put the cursor back into it
          form.setFieldValue('password', '');
          document.getElementById('login-password')?.focus();
        } else fail(t('failed'));
      }
    },
  });

  const reportPassword = (focused: boolean, visible: boolean, hasValue: boolean) => {
    if (focused || hasValue) onFocusChange?.(visible ? 'password-visible' : 'password');
    else onFocusChange?.(null);
  };

  return (
    <form
      noValidate
      autoComplete="on"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {error && (
        <div className="lg-alert" role="alert">
          <IconInfoCircle size={16} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form.Field name="username">
        {(field) => (
          <div className="lg-group">
            <div className={cn('lg-input-wrap', error && !succeeded && errorField !== 'password' && 'has-error')}>
              <div className="lg-input-icon">
                <IconUser />
              </div>
              <input
                id="login-username"
                name="username"
                className="lg-input"
                placeholder=" "
                autoComplete="username webauthn"
                autoFocus
                value={field.state.value}
                onChange={(e) => {
                  setError(null);
                  field.handleChange(e.target.value);
                }}
                onFocus={() => onFocusChange?.('username')}
                onBlur={() => {
                  field.handleBlur();
                  onFocusChange?.(null);
                }}
              />
              <label className="lg-float-label" htmlFor="login-username">
                {t('username')}
              </label>
              <Zigzag />
            </div>
          </div>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <div className="lg-group">
            <div className={cn('lg-input-wrap', error && !succeeded && errorField !== 'username' && 'has-error')}>
              <div className="lg-input-icon">
                <IconLock />
              </div>
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="lg-input"
                placeholder=" "
                autoComplete="current-password"
                value={field.state.value}
                onChange={(e) => {
                  setError(null);
                  field.handleChange(e.target.value);
                  reportPassword(true, showPassword, e.target.value.length > 0);
                }}
                onFocus={() => {
                  setPasswordFocused(true);
                  reportPassword(true, showPassword, field.state.value.length > 0);
                }}
                onBlur={() => {
                  field.handleBlur();
                  setPasswordFocused(false);
                  reportPassword(false, showPassword, field.state.value.length > 0);
                }}
              />
              <label className="lg-float-label" htmlFor="login-password">
                {t('password')}
              </label>
              <Zigzag />
              <button
                type="button"
                className="lg-toggle-pw"
                title={showPassword ? t('hidePassword') : t('showPassword')}
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                onClick={() => {
                  const next = !showPassword;
                  setShowPassword(next);
                  reportPassword(passwordFocused, next, field.state.value.length > 0);
                }}
              >
                {showPassword ? <IconEyeSlash /> : <IconEye />}
              </button>
            </div>
          </div>
        )}
      </form.Field>

      {onForgot && (
        <div className="lg-forgot-row">
          <button type="button" className="lg-link" onClick={onForgot}>
            {t('forgot')}
          </button>
        </div>
      )}

      <form.Subscribe selector={(s) => s.values.username.trim().length > 0 && s.values.password.length > 0}>
        {(ready) => (
          <button
            type="submit"
            className={cn(
              'lg-submit',
              ready && 'is-ready',
              mutation.isPending && 'is-loading',
              succeeded && 'is-success',
            )}
          >
            <span className="lg-submit-content">
              {t('submit')}
              <IconArrowRight size={16} />
            </span>
            <span className="lg-spinner" />
            <svg className="lg-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 13L9 17L19 7" />
            </svg>
          </button>
        )}
      </form.Subscribe>

      {extra}
    </form>
  );
}
