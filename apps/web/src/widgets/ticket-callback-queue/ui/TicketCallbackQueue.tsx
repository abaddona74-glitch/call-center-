import { formatUzPhone } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RegionBadge, personName, refName, ticketContextQuery, ticketListQuery, timeAgo } from '@/entities/ticket';
import { CallbackCallButton, CallbackOutcomeModal } from '@/features/tickets/callback-call';
import { useTicketLive } from '@/features/tickets/notifications';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const LIMIT = 6;

/**
 * Operator dashboard: the shared callback queue — tickets the regions resolved, citizens who last talked
 * to me first. "Call" dials from my own extension; the outcome dialog follows the call live.
 */
export function TicketCallbackQueue() {
  const { t, i18n } = useTranslation('ticket');
  const ctx = useQuery(ticketContextQuery);
  const enabled = Boolean(ctx.data?.capabilities.callback);
  const list = useQuery({ ...ticketListQuery({ view: 'callback' }), enabled, refetchInterval: 60_000 });
  const [outcomeFor, setOutcomeFor] = useState<number | null>(null);
  useTicketLive({ openTicketId: outcomeFor, onRevoked: () => undefined });
  if (!enabled) return null;

  const items = list.data?.items ?? [];
  return (
    <section className="rounded-2xl border border-white/8 bg-[#131d31] px-5 py-4" aria-label={t('callback.queueTitle')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold text-white">
            <Icon name="call" className="size-4 text-[#2dd4bf]" />
            {t('callback.queueTitle')}
            <span className="rounded-[10px] bg-[rgba(45,212,191,0.18)] px-[7px] py-px text-[11px] font-extrabold text-[#5eead4]">
              {list.data?.counts.callback ?? 0}
            </span>
          </h2>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">{t('callback.queueHint')}</p>
        </div>
        <Link
          to="/tickets"
          search={{ view: 'callback' }}
          className="text-xs font-semibold text-[#38bdf8] hover:underline"
        >
          {t('callback.openAll')} →
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="py-4 text-center text-[13px] text-muted-foreground">
          {list.isPending ? '…' : t('callback.queueEmpty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.slice(0, LIMIT).map((tk) => (
            <li
              key={tk.id}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/6 bg-[rgba(15,23,42,0.6)] px-3.5 py-2.5',
                tk.lastContactIsMe && 'border-[rgba(56,189,248,0.45)] bg-[rgba(14,165,233,0.08)]',
              )}
            >
              <Link
                to="/tickets"
                search={{ view: 'callback', open: tk.id }}
                className="font-mono text-[12px] font-extrabold text-[#38bdf8] hover:underline"
              >
                {tk.code}
              </Link>
              <span className="text-[13px] font-bold text-white">
                {tk.customerPhone ? formatUzPhone(tk.customerPhone) : '—'}
              </span>
              {tk.region && <RegionBadge label={refName(tk.region, i18n.language)} />}
              {tk.resolution && (
                <span
                  className={cn(
                    'text-[11px] font-bold',
                    tk.resolution === 'done' ? 'text-[#34d399]' : 'text-[#f87171]',
                  )}
                >
                  {t(`resolution.${tk.resolution}`)}
                </span>
              )}
              <span
                className={cn('text-[11px]', tk.lastContactIsMe ? 'font-bold text-[#38bdf8]' : 'text-muted-foreground')}
              >
                {tk.lastContactIsMe
                  ? `★ ${t('callback.yourCitizen')}`
                  : tk.lastContact
                    ? t('callback.lastBy', { name: personName(tk.lastContact) })
                    : timeAgo(tk.resolvedAt, t)}
              </span>
              {tk.callbackAttempts > 0 && (
                <span className="text-[11px] text-[#fbbf24]">{t('card.attempts', { n: tk.callbackAttempts })}</span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {tk.actions.recordOutcome && (
                  <button
                    type="button"
                    onClick={() => setOutcomeFor(tk.id)}
                    className="text-[11.5px] font-semibold text-[#c084fc] hover:underline"
                  >
                    {t('box.outcome')}
                  </button>
                )}
                {tk.actions.call && (
                  <CallbackCallButton ticketId={tk.id} compact onCalled={() => setOutcomeFor(tk.id)} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <CallbackOutcomeModal ticketId={outcomeFor} open={outcomeFor !== null} onClose={() => setOutcomeFor(null)} />
    </section>
  );
}
