import type { Callback, CallbackCategory } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callbackPhone, callbacksQuery, relativeTime, useCallbacksLive } from '@/entities/callback';
import { useContactLookup, useContactsLive } from '@/entities/contact';
import { usePermission } from '@/entities/session';
import { DismissCallbackButton } from '@/features/callbacks/dismiss';
import { DismissAllCallbacksButton } from '@/features/callbacks/dismiss-all';
import { SyncCallbacksButton } from '@/features/callbacks/sync';
import { cn } from '@/shared/lib/cn';
import { shortTashkentTime } from '@/shared/lib/tashkent-time';

type DateFilter = 'today' | 'all';
type Tab = Exclude<CallbackCategory, 'dismissed'>;
const TABS: Tab[] = ['pending', 'unreachable', 'resolved'];

/** Re-render every 30 s so relative times ("5 daq oldin") stay fresh. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * "Qayta bog'lanish kerak" — the callbacks card of the legacy dashboard's right sidebar
 * (legacy/public/index.html #callbacksPanel). Mounted by the dashboard; live via `callbacks.updated`.
 */
export function CallbacksPanel({ className }: { className?: string }) {
  const { t } = useTranslation('callbacksPanel');
  const isAdmin = usePermission('callbacks.manage');
  const [date, setDate] = useState<DateFilter>('today');
  const [tab, setTab] = useState<Tab>('pending');
  useCallbacksLive();
  useContactsLive();
  const contactOf = useContactLookup();
  const now = useNow();

  const { data, isLoading, isError } = useQuery(callbacksQuery({ date, category: tab, pageSize: 200 }));
  const counts = data?.counts ?? { pending: 0, unreachable: 0, resolved: 0, dismissed: 0 };
  const items = data?.items ?? [];

  return (
    <div className={cn('rounded-[14px] border border-tint/10 bg-sidebar/65 p-[14px] backdrop-blur-[12px]', className)}>
      <div className="mb-[14px] flex items-center justify-between gap-2 px-0.5">
        <h2 className="m-0 flex-1 text-[15px] font-semibold text-ink">{t('title')}</h2>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex overflow-hidden rounded-lg border border-tint/10 bg-well/25">
            {(['today', 'all'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                className={cn(
                  'px-2 py-[3px] text-[11px] font-medium text-muted-foreground transition-all duration-150 hover:text-ink',
                  date === d && 'bg-foreground font-semibold text-background hover:text-background',
                )}
              >
                {t(`date.${d}`)}
              </button>
            ))}
          </div>
          {isAdmin && <SyncCallbacksButton />}
          {isAdmin && <DismissAllCallbacksButton count={counts.pending + counts.unreachable} date={date} />}
        </div>
      </div>

      <div className="mb-3 flex w-full flex-nowrap gap-[5px]">
        {TABS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTab(c)}
            className={cn(
              'inline-flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-border px-1 py-[5px] text-[11px] font-medium text-muted-foreground transition-all duration-150 hover:bg-tint/5 hover:text-foreground',
              tab === c && 'border-warning bg-warning font-bold text-background hover:bg-warning hover:text-background',
            )}
          >
            {t(`tab.${c}`)} <span>{counts[c]}</span>
          </button>
        ))}
      </div>

      <div>
        {isLoading ? (
          <div className="px-0 py-3 text-center text-xs text-muted-foreground">{t('loading')}</div>
        ) : isError ? (
          <div className="p-3.5 text-center text-[11px] text-destructive">{t('error')}</div>
        ) : items.length === 0 ? (
          <div className="p-3.5 text-center text-[11px] text-dim">{t(`empty.${tab}`)}</div>
        ) : (
          items.map((cb) => (
            <CallbackRow
              key={cb.id}
              cb={cb}
              tab={tab}
              date={date}
              now={now}
              contactName={contactOf(cb.phone)?.name || contactOf(cb.phone)?.organization || ''}
              canDismiss={isAdmin && cb.status === 'pending'}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CallbackRow({
  cb,
  tab,
  date,
  now,
  contactName,
  canDismiss,
}: {
  cb: Callback;
  tab: Tab;
  date: DateFilter;
  now: number;
  contactName: string;
  canDismiss: boolean;
}) {
  const { t } = useTranslation('callbacksPanel');
  const { t: tc } = useTranslation('callback');
  const [flash, setFlash] = useState(false);
  const phone = callbackPhone(cb.phone);
  const attempts = date === 'today' ? Math.max(cb.missedToday, 1) : cb.missedCount;

  let status: string;
  if (cb.status === 'resolved') {
    const who = cb.resolvedExtension ? `Operator ${cb.resolvedExtension}` : cb.closedBy;
    status = who ? `${who} · ${t('resolved')}` : t('resolved');
  } else if (cb.category === 'unreachable') {
    status = t('unreachable', { n: cb.outboundAttempts || 1 });
    if (cb.lastOutboundCause) status += ` · ${tc(`cause.${cb.lastOutboundCause}`)}`;
  } else {
    status = tc(`source.${cb.source}`);
  }
  const sub = contactName ? `${contactName} · ${status}` : status;
  const shownAt = tab === 'resolved' && cb.closedAt ? cb.closedAt : cb.lastMissedAt;
  const rel = relativeTime(cb.lastMissedAt, tc, now);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success(t('copied', { phone }));
    } catch {
      toast.info(t('copyFallback', { phone }));
    }
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      title={t('copyTitle', { phone })}
      onClick={() => void copy()}
      onKeyDown={(e) => e.key === 'Enter' && void copy()}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2.5 rounded-lg border-t border-tint/[0.06] p-2 transition-[background,transform] duration-150 first:border-t-0 first:pt-1 hover:bg-tint/[0.04]',
        flash && 'scale-[0.98] bg-success/15',
      )}
    >
      <div className="flex min-w-0 flex-col">
        <div className="inline-flex items-center gap-1.5 text-sm leading-tight font-semibold tracking-[0.1px] text-foreground tabular-nums">
          {phone}
          {attempts > 1 && (
            <span className="inline-flex items-center gap-[5px] rounded-md bg-blue-400/15 px-2 py-0.5 text-[11px] leading-[1.3] font-semibold whitespace-nowrap text-link">
              {t('times', { n: attempts })}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs font-normal text-muted-foreground">{sub}</div>
      </div>
      <div className="ml-auto shrink-0 text-right text-xs leading-[1.35] text-muted-foreground tabular-nums">
        <div>{shortTashkentTime(shownAt, new Date(now))}</div>
        {rel && <div className="mt-px text-[11px] text-dim">{rel}</div>}
      </div>
      {canDismiss && <DismissCallbackButton id={cb.id} phone={cb.phone} />}
    </div>
  );
}
