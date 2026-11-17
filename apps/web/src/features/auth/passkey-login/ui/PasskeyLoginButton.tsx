import type { SessionUser } from '@cc/shared';
import { WebAuthnError, browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { passkeyLoginOptions, passkeyLoginVerify } from '@/entities/session';
import { isHttpError } from '@/shared/api';
import { IconFingerprint } from '@/shared/ui/inline-icons';
import '@/shared/ui/legacy-auth.css';
import { registerTranslations } from '@/shared/i18n';

registerTranslations('authPasskeyLogin', {
  uz: {
    divider: 'yoki barmoq izi bilan',
    button: 'Barmoq izi bilan tezkor kirish',
    waiting: 'Qurilmangizni tasdiqlang…',
    insecure: 'Barmoq izi bilan kirish faqat xavfsiz (HTTPS) ulanishda ishlaydi',
    unsupported: 'Bu brauzer passkey (barmoq izi) bilan kirishni qo‘llab-quvvatlamaydi',
    cancelled: 'Bekor qilindi',
    failed: 'Kirish rad etildi. Passkey bu hisobga ulanmagan bo‘lishi mumkin',
    tooMany: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring',
  },
  ru: {
    divider: 'или по отпечатку',
    button: 'Быстрый вход по отпечатку',
    waiting: 'Подтвердите на устройстве…',
    insecure: 'Вход по отпечатку работает только по защищённому соединению (HTTPS)',
    unsupported: 'Этот браузер не поддерживает вход по passkey',
    cancelled: 'Отменено',
    failed: 'Вход отклонён. Возможно, этот passkey не привязан к учётной записи',
    tooMany: 'Слишком много попыток. Попробуйте позже',
  },
});

/** "Sign in with passkey" (discoverable credential: the device shows its own account picker). */
export function PasskeyLoginButton({
  onSuccess,
  onError,
}: {
  onSuccess: (user: SessionUser) => void;
  onError?: () => void;
}) {
  const { t } = useTranslation('authPasskeyLogin');
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const options = await passkeyLoginOptions();
      const credential = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      return passkeyLoginVerify(credential);
    },
    onSuccess: (res) => {
      setMessage(null);
      onSuccess(res.user);
    },
    onError: (err) => {
      if (err instanceof WebAuthnError && err.code === 'ERROR_CEREMONY_ABORTED') setMessage(t('cancelled'));
      else if (err instanceof Error && err.name === 'NotAllowedError') setMessage(t('cancelled'));
      else if (isHttpError(err, 429)) setMessage(t('tooMany'));
      else setMessage(t('failed'));
      onError?.();
    },
  });

  const start = () => {
    if (!window.isSecureContext) return setMessage(t('insecure'));
    if (!browserSupportsWebAuthn()) return setMessage(t('unsupported'));
    setMessage(null);
    mutation.mutate();
  };

  return (
    <div>
      <div className="lg-divider" role="presentation">
        <span>{t('divider')}</span>
      </div>
      <button type="button" className="lg-passkey-btn" onClick={start} disabled={mutation.isPending}>
        <IconFingerprint size={19} />
        <span>{mutation.isPending ? t('waiting') : t('button')}</span>
      </button>
      <div className="lg-passkey-msg" role="status">
        {message}
      </div>
    </div>
  );
}
