import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { telephonyActions } from '@/entities/telephony';
import '../i18n';

/** "Tugatish" — two-step (click, then confirm within 4 s) to avoid accidental hangups. */
export function HangupCallButton({ callId, className }: { callId: string; className?: string }) {
  const { t } = useTranslation('telephonyActions');
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4_000);
    return () => clearTimeout(timer);
  }, [armed]);
  const mutation = useMutation({
    mutationFn: () => telephonyActions.hangup({ callId }),
    onSuccess: () => toast.success(t('hangup.done')),
    onError: (err) => toast.error(err.message),
    onSettled: () => setArmed(false),
  });

  return (
    <button
      type="button"
      className={className}
      data-armed={armed || undefined}
      disabled={mutation.isPending}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) mutation.mutate();
        else setArmed(true);
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 3l18 18M10.5 6.2A16 16 0 0 1 21 5v4l-3 1.5M5 4h4l2 5-2.5 1.5a11 11 0 0 0 3 3.5" />
      </svg>
      <span>{armed ? t('hangup.confirm') : t('hangup.button')}</span>
    </button>
  );
}
