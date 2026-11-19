import type { SituationTickets, TicketStatus } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { formatAge } from '@/entities/situation';
import { STATUS_STRIPE, refName } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { serverClockOffset } from '@/shared/lib/server-clock';
import { useNow } from '@/shared/lib/use-now';
import { Icon } from '@/shared/ui/icon';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Skeleton } from '@/shared/ui/skeleton';
import '../i18n';

const OPEN: Array<[TicketStatus, keyof SituationTickets['open']]> = [
  ['new', 'new'],
  ['assigned', 'assigned'],
  ['in_progress', 'inProgress'],
  ['callback_pending', 'callbackPending'],
];

/**
 * Open tickets by status (a stacked bar with the numbers spelled out next to it, so colour is never the only carrier)
 * and the new tickets nobody has taken yet, per region.
 */
export function TicketQueues({ data }: { data: SituationTickets | undefined }) {
  const { t, i18n } = useTranslation('situationTickets');
  const { t: tt } = useTranslation('ticket');
  const lang = i18n.language;
  const now = useNow() + serverClockOffset();

  if (!data) return <Skeleton className="h-[420px] rounded-2xl" />;
  const { open, waiting } = data;

  return (
    // Two columns when the panel is wide (stacked under the workers table), one when it sits beside it.
    <Panel className="@container">
      <div className="grid gap-5 @2xl:grid-cols-2">
        <div>
          <PanelHeader className="mb-3">
            <div>
              <PanelTitle>
                <Icon name="clipboard-text" className="size-[18px] text-primary" />
                {t('queue.title')}
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-brand-soft">{open.total}</span>
              </PanelTitle>
              <p className="mt-1 text-xs text-mute">{t('queue.subtitle')}</p>
            </div>
          </PanelHeader>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-tint/8" aria-hidden="true">
            {OPEN.map(([status, key]) =>
              open[key] > 0 ? <i key={status} style={{ flex: open[key], background: STATUS_STRIPE[status] }} /> : null,
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {OPEN.map(([status, key]) => (
              <div key={status} className="flex items-center gap-2 rounded-lg border border-tint/8 bg-card px-3 py-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_STRIPE[status] }} />
                <dt className="min-w-0 flex-1 text-xs leading-tight text-ink-2">{tt(`status.${status}`)}</dt>
                <dd className="text-base font-bold text-ink">{open[key]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon name="clock" className="size-4 text-info" />
            {t('queue.waitingTitle')}
            <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs text-link-soft">{open.new}</span>
          </h4>
          <p className="mt-1 mb-3 text-xs text-mute">{t('queue.waitingSubtitle')}</p>
          {waiting.length === 0 ? (
            <div className="rounded-lg border border-dashed border-tint/12 px-3 py-4 text-center text-xs text-mute">
              {t('queue.empty')}
            </div>
          ) : (
            <ul className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-0.5">
              {waiting.map((r) => (
                <li
                  key={r.code ?? 'none'}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                    r.overdue > 0 ? 'border-danger/35 bg-danger/[0.06]' : 'border-tint/8 bg-card',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{refName(r, lang)}</div>
                    <div className="flex flex-wrap gap-x-2.5 text-[11px] text-mute">
                      <span className="text-ink-2">
                        {t('queue.oldest', { age: formatAge((now - Date.parse(r.oldestSince)) / 1000, lang) })}
                      </span>
                      {r.overdue > 0 && (
                        <span className="font-semibold text-danger-soft">{t('queue.overdue', { n: r.overdue })}</span>
                      )}
                      {r.code !== null && r.executives === 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
                          <Icon name="flash" className="size-3 text-caution" />
                          {t('queue.noExecutives')}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-lg font-bold text-ink">{t('queue.waiting', { n: r.waiting })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
