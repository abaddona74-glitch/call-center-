import { PasswordSchema } from '@cc/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { completePasswordReset, requestPasswordReset, verifyPasswordReset } from '@/entities/session';
import { isHttpError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { IconInfoCircle, IconKey, IconLock, IconShieldTick, IconSms, IconUser } from '@/shared/ui/inline-icons';
import { OtpInput } from '@/shared/ui/otp-input';
import '@/shared/ui/legacy-auth.css';
import '../i18n';

type Step = 'identify' | 'code' | 'password';

const RESEND_SECONDS = 60;

function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Three-step password recovery (legacy modal): login/email -> 6-digit code -> new password.
 * The code goes only to the email already bound to the account; the screen never says whether
 * the account exists.
 */
export function ForgotPasswordDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (identifier: string) => void;
}) {
  const { t } = useTranslation('authForgot');
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const left = useCountdown(expiresAt);
  const resendLeft = useCountdown(resendAt);

  useEffect(() => {
    if (!open) {
      setStep('identify');
      setCode('');
      setToken('');
      setPassword('');
      setConfirm('');
      setError(null);
      setExpiresAt(null);
    }
  }, [open]);

  const commonError = (err: unknown) => (isHttpError(err, 429) ? t('tooMany') : t('failed'));

  const request = useMutation({
    mutationFn: () => requestPasswordReset({ identifier: identifier.trim() }),
    onSuccess: (res) => {
      setError(null);
      setCode('');
      setExpiresAt(Date.now() + res.expiresInSeconds * 1000);
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setStep('code');
    },
    onError: (err) => setError(commonError(err)),
  });

  const verify = useMutation({
    mutationFn: () => verifyPasswordReset({ identifier: identifier.trim(), code }),
    onSuccess: (res) => {
      setError(null);
      setToken(res.resetToken);
      setStep('password');
    },
    onError: (err) => setError(isHttpError(err, 400) ? t('badCode') : commonError(err)),
  });

  const complete = useMutation({
    mutationFn: () => completePasswordReset({ resetToken: token, newPassword: password }),
    onSuccess: () => {
      onOpenChange(false);
      onDone(identifier.trim());
    },
    onError: (err) => {
      if (isHttpError(err, 400) && err.body?.message.includes('expired')) {
        setStep('identify');
        setError(t('expiredLink'));
      } else setError(isHttpError(err, 400) ? t('tooShort') : commonError(err));
    },
  });

  const submitPassword = () => {
    if (!PasswordSchema.safeParse(password).success) return setError(t('tooShort'));
    if (password !== confirm) return setError(t('mismatch'));
    complete.mutate();
  };

  const header = {
    identify: { icon: <IconKey size={24} />, tone: '', title: t('step1Title'), text: t('step1Text') },
    code: { icon: <IconSms size={24} />, tone: 'is-green', title: t('step2Title'), text: t('step2Text') },
    password: { icon: <IconLock size={24} />, tone: 'is-indigo', title: t('step3Title'), text: t('step3Text') },
  }[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-[440px] [&>button]:top-5 [&>button]:right-5 [&>button]:text-[#64748b]">
        <div className="lg-modal">
          <div className="lg-modal-header">
            <div className={cn('lg-modal-badge', header.tone)}>{header.icon}</div>
            <DialogTitle className="lg-modal-title">{header.title}</DialogTitle>
            <DialogDescription className="lg-modal-subtitle">{header.text}</DialogDescription>
          </div>

          {error && (
            <div className="lg-alert" role="alert">
              <IconInfoCircle size={16} className="mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'identify' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (identifier.trim()) request.mutate();
              }}
            >
              <div className="lg-group">
                <label className="lg-label" htmlFor="forgot-identifier">
                  {t('identifier')}
                </label>
                <div className="lg-input-wrap">
                  <div className="lg-input-icon">
                    <IconUser />
                  </div>
                  <input
                    id="forgot-identifier"
                    className="lg-input"
                    placeholder={t('identifierPlaceholder')}
                    autoComplete="username"
                    autoFocus
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className={cn('lg-submit', identifier.trim() && 'is-ready')} disabled={request.isPending}>
                <span className="lg-submit-content">{t('send')}</span>
              </button>
            </form>
          )}

          {step === 'code' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) verify.mutate();
              }}
            >
              <div className={cn('lg-countdown', left === 0 && 'is-expired')}>
                {left > 0 ? (
                  <span>
                    {t('validFor')}: <strong>{mmss(left)}</strong>
                  </span>
                ) : (
                  <span>{t('expired')}</span>
                )}
              </div>
              <div className="lg-warning">
                <IconShieldTick size={14} className="mt-px shrink-0" />
                <span>{t('attemptsWarning')}</span>
              </div>
              <div className="lg-group" style={{ marginBottom: 20 }}>
                <OtpInput value={code} onValueChange={setCode} autoFocus aria-label={t('step2Title')} />
              </div>
              <button
                type="submit"
                className={cn('lg-submit', code.length === 6 && 'is-ready')}
                disabled={verify.isPending || code.length !== 6}
              >
                <span className="lg-submit-content">{t('verify')}</span>
              </button>
              <div className="mt-3.5 flex justify-center">
                <button type="button" className="lg-link-btn" disabled={resendLeft > 0 || request.isPending} onClick={() => request.mutate()}>
                  {resendLeft > 0 ? t('resendIn', { seconds: resendLeft }) : t('resend')}
                </button>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitPassword();
              }}
            >
              <div className="lg-group">
                <label className="lg-label" htmlFor="forgot-new">
                  {t('newPassword')}
                </label>
                <div className="lg-input-wrap">
                  <div className="lg-input-icon">
                    <IconLock />
                  </div>
                  <input
                    id="forgot-new"
                    type="password"
                    className="lg-input"
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="lg-group">
                <label className="lg-label" htmlFor="forgot-confirm">
                  {t('confirmPassword')}
                </label>
                <div className="lg-input-wrap">
                  <div className="lg-input-icon">
                    <IconLock />
                  </div>
                  <input
                    id="forgot-confirm"
                    type="password"
                    className="lg-input"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className={cn('lg-submit', password && confirm && 'is-ready')} disabled={complete.isPending}>
                <span className="lg-submit-content">{t('save')}</span>
              </button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
