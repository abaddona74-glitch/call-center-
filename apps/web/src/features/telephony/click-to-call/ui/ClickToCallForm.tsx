import type { LiveOperator } from '@cc/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { telephonyActions } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import '../i18n';
import './call-ready.css';

/** Digits of a whole Uzbek number (90 123 45 67); from here the button pulses "ready to call". */
const FULL_NUMBER_DIGITS = 9;

/**
 * Click-to-call: rings the operator's own phone first, then dials the number (async Originate).
 * Admins pick the operator (`operators` given); operators always call from their own extension.
 */
export function ClickToCallForm({
  operators,
  defaultFrom,
  className,
}: {
  operators?: LiveOperator[];
  defaultFrom?: string | null;
  className?: string;
}) {
  const { t } = useTranslation('telephonyActions');
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(defaultFrom ?? '');
  const mutation = useMutation({
    mutationFn: () => telephonyActions.originate({ to, from: operators ? from || undefined : undefined }),
    onSuccess: () => {
      toast.success(t('call.started'));
      setTo('');
    },
    onError: (err) => toast.error(err.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (to.trim()) mutation.mutate();
  };
  const ready = !mutation.isPending && to.replace(/\D/g, '').length >= FULL_NUMBER_DIGITS;
  const field =
    'h-9 rounded-lg border border-tint/10 bg-sidebar/75 px-3 text-sm text-foreground outline-none focus:border-[#6366f1]/60';

  return (
    <form onSubmit={submit} className={cn('flex flex-wrap items-center gap-2', className)} aria-label={t('call.title')}>
      {operators && (
        <select
          className={cn(field, 'cursor-pointer')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={t('call.from')}
          required
        >
          <option value="">{t('call.from')}</option>
          {operators
            .filter((o) => o.presence !== 'offline')
            .map((o) => (
              <option key={o.extension} value={o.extension}>
                {o.extension} · {o.name}
              </option>
            ))}
        </select>
      )}
      <input
        className={cn(field, 'w-44 font-semibold tabular-nums')}
        inputMode="tel"
        autoComplete="off"
        placeholder={t('call.placeholder')}
        value={to}
        maxLength={32}
        onChange={(e) => setTo(e.target.value.replace(/[^\d+()\s-]/g, ''))}
      />
      <button
        type="submit"
        disabled={mutation.isPending || !to.trim()}
        className={cn(
          'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-positive px-3 text-sm font-semibold text-white shadow-sm dark:text-[#052e1f] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70',
          ready && 'call-ready',
        )}
      >
        <Icon name="call" className="call-ready-icon size-4" />
        {t('call.button')}
      </button>
    </form>
  );
}
