import type { SessionUser } from '@cc/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authOptionsQuery, sessionKeys } from '@/entities/session';
import { ForgotPasswordDialog } from '@/features/auth/forgot-password';
import { type LoginFieldFocus, LoginForm } from '@/features/auth/login-form';
import { PasskeyLoginButton } from '@/features/auth/passkey-login';
import { ThemeSwitch } from '@/features/theme-switch';
import { cn } from '@/shared/lib/cn';
import { IconCall, IconShieldTick } from '@/shared/ui/inline-icons';
import { registerTranslations } from '@/shared/i18n';
import '@/shared/ui/legacy-auth.css';
import { CharactersStage, type StageMode, type StageMood } from './CharactersStage';

registerTranslations('loginPage', {
  uz: {
    title: 'Call Center Analytics',
    subtitle: 'Xavfsiz tizimga kirish paneli',
    stage: 'Call Center AI Interactive Stage',
    footer: 'Brute-force va Lockout himoyasi faol',
    resetDone: 'Parol yangilandi. Yangi parol bilan kiring.',
  },
  ru: {
    title: 'Call Center Analytics',
    subtitle: 'Защищённый вход в систему',
    stage: 'Call Center AI Interactive Stage',
    footer: 'Защита от перебора и блокировка включены',
    resetDone: 'Пароль обновлён. Войдите с новым паролем.',
  },
});

const MODE: Record<Exclude<LoginFieldFocus, null>, StageMode> = {
  username: 'looking',
  password: 'covering',
  'password-visible': 'peeking',
};

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation('loginPage');
  const queryClient = useQueryClient();
  const { data: options } = useQuery(authOptionsQuery);
  const [mode, setMode] = useState<StageMode>('idle');
  const [mood, setMood] = useState<StageMood>('none');
  const [shaking, setShaking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onError = () => {
    setMood('error');
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    window.setTimeout(() => setMood('none'), 850);
    window.setTimeout(() => setShaking(false), 550);
  };

  const onSuccess = (user: SessionUser) => {
    setMood('success');
    setLeaving(true);
    queryClient.setQueryData(sessionKeys.me, user);
    window.setTimeout(onLoggedIn, 450);
  };

  return (
    <div className="lg-page">
      <div className="lg-grid" />
      <ThemeSwitch className="absolute top-4 right-4 z-10 bg-glass/60 backdrop-blur" />
      <div className="lg-card">
        <CharactersStage mode={mode} mood={mood} caption={t('stage')} />

        <div className={cn('lg-form-col', shaking && 'is-shaking', leaving && 'is-leaving')}>
          <div className="lg-header">
            <div className="lg-logo">
              <IconCall size={28} />
            </div>
            <h1 className="lg-title">{t('title')}</h1>
            <p className="lg-subtitle">{t('subtitle')}</p>
          </div>

          {notice && (
            <div className="lg-alert is-success" role="status">
              <IconShieldTick size={16} className="mt-px shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <LoginForm
            onSuccess={onSuccess}
            onError={onError}
            onFocusChange={(f) => setMode(f ? MODE[f] : 'idle')}
            onForgot={options?.passwordReset ? () => setForgotOpen(true) : undefined}
            extra={options?.passkeys ? <PasskeyLoginButton onSuccess={onSuccess} onError={onError} /> : null}
          />

          <div className="lg-footer">
            <IconShieldTick size={13} className="text-info" />
            <span>{t('footer')}</span>
          </div>
        </div>
      </div>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} onDone={() => setNotice(t('resetDone'))} />
    </div>
  );
}
