import type { OverviewTickets } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import type { TicketListRequest } from '@/entities/overview';
import { STATUS_STRIPE, TicketStatusBadge } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { NumberButton } from '@/shared/ui/number-button';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { deadlineSplit, lateBy, percentOf } from '../model/format';
import '../i18n';

/**
 * Deadlines (SLA `due_at`, callback `callback_due_at`): the state right now (overdue backlog, unclosed tickets by
 * status, the longest overdue ones) and how the period's tickets did against the SLA. Every number opens the tickets
 * behind it (`onOpenList`); a longest-overdue row opens its read-only card (`onOpenTicket`).
 */
export function DeadlinesPanel({
  data,
  onOpenList,
  onOpenTicket,
}: {
  data: OverviewTickets | undefined;
  onOpenList?: (request: TicketListRequest) => void;
  onOpenTicket?: (id: number) => void;
}) {
  const { t, i18n } = useTranslation('ticketOverview');
  const { t: tt } = useTranslation('ticket');
  const ru = i18n.language === 'ru';
  if (!data) return <Panel className="min-h-[300px] animate-pulse" />;

  const { now: current, totals } = data;
  // The server's clock when it counted (the figures refresh every minute).
  const now = new Date(data.generatedAt);
  const backlog = current.byStatus.filter((s) => s.count > 0);
  const backlogTotal = backlog.reduce((a, s) => a + s.count, 0);
  const split = deadlineSplit(totals);
  const splitTotal = split.onTime + split.late + split.stillOverdue;
  const hours = (n: number | null) => (n === null ? t('deadlines.none') : t('deadlines.hours', { n }));
  const opener = (request: TicketListRequest) =>
    onOpenList && request.value > 0 ? () => onOpenList(request) : undefined;

  return (
    <Panel className="flex flex-col gap-5">
      <PanelHeader className="mb-0">
        <PanelTitle>
          <Icon name="timer" className="size-[18px] text-danger" />
          {t('deadlines.title')}
        </PanelTitle>
        <span className="rounded-md border border-tint/10 bg-tint/5 px-2 py-0.5 text-[11px] text-mute">
          {t('deadlines.norm', { sla: data.slaWorkingDays, cb: data.callbackSlaWorkingDays })}
        </span>
      </PanelHeader>

      {/* Now */}
      <section className="flex flex-col gap-3">
        <h4 className="text-[11px] font-bold tracking-[0.5px] text-mute uppercase">{t('deadlines.nowTitle')}</h4>
        <div className="grid grid-cols-2 gap-3">
          <Big
            value={current.overdue}
            label={t('deadlines.overdueNow')}
            tone={current.overdue ? 'danger' : 'mute'}
            onOpen={opener({ metric: 'nowOverdue', value: current.overdue })}
          />
          <Big
            value={current.callbackOverdue}
            label={t('deadlines.callbackOverdueNow')}
            tone={current.callbackOverdue ? 'caution' : 'mute'}
            onOpen={opener({ metric: 'nowCallbackOverdue', value: current.callbackOverdue })}
          />
        </div>
        {backlogTotal > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-mute">
              <span>{t('deadlines.backlog')}</span>
              <NumberButton
                label={t('deadlines.backlog')}
                value={backlogTotal}
                className="font-bold text-ink"
                onOpen={opener({ metric: 'nowOpen', value: backlogTotal })}
              />
            </div>
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
              {backlog.map((s) => (
                <div
                  key={s.status}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(s.count / backlogTotal) * 100}%`, background: STATUS_STRIPE[s.status] }}
                  title={`${s.count}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {backlog.map((s) => (
                <span key={s.status} className="inline-flex items-center gap-1 text-xs text-ink tabular-nums">
                  <TicketStatusBadge status={s.status} />
                  <NumberButton
                    label={`${t('deadlines.backlog')} — ${tt(`status.${s.status}`)}`}
                    value={s.count}
                    className="font-bold"
                    onOpen={opener({ metric: 'nowStatus', status: s.status, value: s.count })}
                  />
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* The period */}
      <section className="flex flex-col gap-2.5">
        <h4 className="text-[11px] font-bold tracking-[0.5px] text-mute uppercase">{t('deadlines.periodTitle')}</h4>
        {splitTotal > 0 && (
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
            <div className="h-full bg-chart-2" style={{ width: `${(split.onTime / splitTotal) * 100}%` }} />
            <div className="h-full bg-chart-5" style={{ width: `${(split.late / splitTotal) * 100}%` }} />
            <div className="h-full bg-chart-8" style={{ width: `${(split.stillOverdue / splitTotal) * 100}%` }} />
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          <Row
            dot="bg-chart-2"
            label={t('deadlines.onTime')}
            value={split.onTime}
            pct={percentOf(split.onTime, splitTotal)}
            onOpen={opener({ metric: 'onTime', value: split.onTime })}
          />
          <Row
            dot="bg-chart-5"
            label={t('deadlines.late')}
            value={split.late}
            pct={percentOf(split.late, splitTotal)}
            onOpen={opener({ metric: 'overdueLate', value: split.late })}
          />
          <Row
            dot="bg-chart-8"
            label={t('deadlines.stillOverdue')}
            value={split.stillOverdue}
            pct={percentOf(split.stillOverdue, splitTotal)}
            onOpen={opener({ metric: 'overdueOpen', value: split.stillOverdue })}
          />
        </dl>
        <div className="grid grid-cols-3 gap-3 border-t border-tint/8 pt-3 text-xs">
          <Stat
            label={t('deadlines.avgResolution')}
            shown={hours(totals.avgResolutionHours)}
            value={totals.done + totals.rejected}
            onOpen={opener({ metric: 'resolved', value: totals.done + totals.rejected })}
          />
          <Stat
            label={t('deadlines.avgClose')}
            shown={hours(totals.avgCloseHours)}
            value={totals.closed}
            onOpen={opener({ metric: 'closeTimed', value: totals.closed })}
          />
          <Stat
            label={t('deadlines.callbackOverdue')}
            shown={String(totals.callbackOverdue)}
            value={totals.callbackOverdue}
            tone={totals.callbackOverdue ? 'text-caution' : 'text-ink'}
            onOpen={opener({ metric: 'callbackOverdue', value: totals.callbackOverdue })}
          />
        </div>
      </section>

      {/* The longest overdue */}
      <section className="flex flex-col gap-2">
        <h4 className="text-[11px] font-bold tracking-[0.5px] text-mute uppercase">{t('deadlines.oldest')}</h4>
        {current.oldestOverdue.length === 0 ? (
          <p className="text-xs text-mute">{t('deadlines.noOverdue')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-tint/6 rounded-xl border border-tint/8">
            {current.oldestOverdue.map((x) => {
              const late = lateBy(x.dueAt, now);
              const lateText =
                late.unit === 'days' ? t('deadlines.lateBy', { n: late.n }) : t('deadlines.lateByHours', { n: late.n });
              const body = (
                <>
                  <span className="font-mono font-bold text-ink">{x.code}</span>
                  <span className="min-w-0 flex-1 truncate text-left text-ink-2">
                    {ru ? x.regionNameRu : x.regionNameUz}
                    <span className="text-mute"> · {x.executive ?? t('deadlines.queue')}</span>
                  </span>
                  <span className="shrink-0 font-bold whitespace-nowrap text-danger">+{lateText}</span>
                </>
              );
              return (
                <li key={x.id}>
                  {onOpenTicket ? (
                    <button
                      type="button"
                      onClick={() => onOpenTicket(x.id)}
                      aria-haspopup="dialog"
                      aria-label={t('deadlines.openTicket', { code: x.code, late: lateText })}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-xs outline-none hover:bg-tint/5 focus-visible:bg-tint/8 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2.5 px-3 py-2 text-xs">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Panel>
  );
}

function Big({
  value,
  label,
  tone,
  onOpen,
}: {
  value: number;
  label: string;
  tone: 'danger' | 'caution' | 'mute';
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <div
        className={cn(
          'text-[28px] leading-none font-extrabold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'caution' && 'text-caution',
          tone === 'mute' && 'text-ink',
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-tight text-mute">{label}</div>
    </>
  );
  const box = 'rounded-xl border border-tint/8 bg-tint/[0.03] px-3.5 py-3 text-left';
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${label}: ${value}`}
      className={cn(
        box,
        'cursor-pointer outline-none transition-colors hover:border-primary/35 hover:bg-tint/[0.06] focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {inner}
    </button>
  ) : (
    <div className={box}>{inner}</div>
  );
}

function Row({
  dot,
  label,
  value,
  pct,
  onOpen,
}: {
  dot: string;
  label: string;
  value: number;
  pct?: number;
  onOpen?: () => void;
}) {
  return (
    <>
      <span className={cn('size-2.5 rounded-full', dot)} />
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right font-bold text-ink tabular-nums">
        <NumberButton label={label} value={value} onOpen={onOpen} />
        {pct !== undefined && <span className="ml-1.5 text-[11px] font-medium text-mute">{pct}%</span>}
      </dd>
    </>
  );
}

function Stat({
  label,
  shown,
  tone = 'text-ink',
  onOpen,
}: {
  label: string;
  /** What is displayed (an average, a count); the list behind it is what it is computed over. */
  shown: string;
  /** How many tickets the list behind it has (used by the caller to decide whether it opens). */
  value: number;
  tone?: string;
  onOpen?: () => void;
}) {
  return (
    <div className="flex flex-col justify-between">
      <div className="leading-tight text-mute">{label}</div>
      <div className={cn('mt-1 text-base font-bold', tone)}>
        <NumberButton label={label} value={shown} onOpen={onOpen}>
          {shown}
        </NumberButton>
      </div>
    </div>
  );
}
