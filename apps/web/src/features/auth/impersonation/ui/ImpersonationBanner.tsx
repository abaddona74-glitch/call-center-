import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stopImpersonation, useSessionUser } from '@/entities/session';
import { registerTranslations } from '@/shared/i18n';
import { IconUser } from '@/shared/ui/inline-icons';

registerTranslations('authImpersonation', {
  uz: {
    acting: '{{by}}, siz hozir {{user}} sifatida ishlayapsiz',
    hint: 'Barcha amallar audit jurnaliga sizning nomingizdan yoziladi.',
    left: 'Qolgan vaqt: {{time}}',
    stop: 'To‘xtatish',
  },
  ru: {
    acting: '{{by}}, вы сейчас работаете как {{user}}',
    hint: 'Все действия пишутся в журнал аудита от вашего имени.',
    left: 'Осталось: {{time}}',
    stop: 'Завершить',
  },
});

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Always-visible bar while a superuser acts as another user ("log in as"), with the time left and a stop
 * button. A full page reload follows start/stop so every cache and the WebSocket switch identity.
 */
export function ImpersonationBanner() {
  const { t } = useTranslation('authImpersonation');
  const user = useSessionUser();
  const info = user.impersonation;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!info) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [info]);

  const stop = useMutation({
    mutationFn: stopImpersonation,
    onSettled: (res) => window.location.assign(res ? '/' : '/login'),
  });

  if (!info) return null;
  const left = Math.max(0, Math.ceil((new Date(info.expiresAt).getTime() - now) / 1000));

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(245,158,11,0.45)] bg-[linear-gradient(90deg,rgba(245,158,11,0.22),rgba(239,68,68,0.18))] px-6 py-2.5 text-[13px] text-[#fde68a] shadow-[0_4px_18px_rgba(245,158,11,0.18)]"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.25)] text-caution">
          <IconUser size={16} />
        </span>
        <div>
          <div className="font-bold text-[#fef3c7] light:text-caution">
            {t('acting', { by: info.by.username, user: user.username })}
          </div>
          <div className="text-[11.5px] text-caution-soft/80">{t('hint')}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-[#fde68a] light:text-caution">{t('left', { time: mmss(left) })}</span>
        <button
          type="button"
          disabled={stop.isPending}
          onClick={() => stop.mutate()}
          className="cursor-pointer rounded-lg border border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.25)] px-3.5 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-[rgba(239,68,68,0.4)] disabled:opacity-50"
        >
          {t('stop')}
        </button>
      </div>
    </div>
  );
}
