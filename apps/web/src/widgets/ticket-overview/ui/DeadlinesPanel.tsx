import type { OverviewTickets } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { STATUS_STRIPE, TicketStatusBadge } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { deadlineSplit, lateBy, percentOf } from '../model/format';
import '../i18n';

/**
 * Deadlines (SLA `due_at`, callback `callback_due_at`): the state right now (overdue backlog, unclosed tickets by
 * status, the longest overdue ones) and how the period's tickets did against the SLA.
 */
export function DeadlinesPanel({ data }: { data: OverviewTickets | undefined }) {
  const { t, i18n } = useTranslation('ticketOverview');
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
          <Big value={current.overdue} label={t('deadlines.overdueNow')} tone={current.overdue ? 'danger' : 'mute'} />
          <Big
            value={current.callbackOverdue}
            label={t('deadlines.callbackOverdueNow')}
            tone={current.callbackOverdue ? 'caution' : 'mute'}
          />
        </div>
        {backlogTotal > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-mute">
              <span>{t('deadlines.backlog')}</span>
              <span className="font-bold text-ink tabular-nums">{backlogTotal}</span>
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
                  <b>{s.count}</b>
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
          />
          <Row
            dot="bg-chart-5"
            label={t('deadlines.late')}
            value={split.late}
            pct={percentOf(split.late, splitTotal)}
          />
          <Row
            dot="bg-chart-8"
            label={t('deadlines.stillOverdue')}
            value={split.stillOverdue}
            pct={percentOf(split.stillOverdue, splitTotal)}
          />
        </dl>
        <div className="grid grid-cols-3 gap-3 border-t border-tint/8 pt-3 text-xs">
          <div className="flex flex-col justify-between">
            <div className="leading-tight text-mute">{t('deadlines.avgResolution')}</div>
            <div className="mt-1 text-base font-bold text-ink">{hours(totals.avgResolutionHours)}</div>
          </div>
          <div className="flex flex-col justify-between">
            <div className="leading-tight text-mute">{t('deadlines.avgClose')}</div>
            <div className="mt-1 text-base font-bold text-ink">{hours(totals.avgCloseHours)}</div>
          </div>
          <div className="flex flex-col justify-between">
            <div className="leading-tight text-mute">{t('deadlines.callbackOverdue')}</div>
            <div className={cn('mt-1 text-base font-bold', totals.callbackOverdue ? 'text-caution' : 'text-ink')}>
              {totals.callbackOverdue}
            </div>
          </div>
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
              return (
                <li key={x.id} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                  <span className="font-mono font-bold text-ink">{x.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {ru ? x.regionNameRu : x.regionNameUz}
                    <span className="text-mute"> · {x.executive ?? t('deadlines.queue')}</span>
                  </span>
                  <span className="shrink-0 font-bold whitespace-nowrap text-danger">
                    +
                    {late.unit === 'days'
                      ? t('deadlines.lateBy', { n: late.n })
                      : t('deadlines.lateByHours', { n: late.n })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Panel>
  );
}

function Big({ value, label, tone }: { value: number; label: string; tone: 'danger' | 'caution' | 'mute' }) {
  return (
    <div className="rounded-xl border border-tint/8 bg-tint/[0.03] px-3.5 py-3">
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
    </div>
  );
}

function Row({ dot, label, value, pct }: { dot: string; label: string; value: number; pct?: number }) {
  return (
    <>
      <span className={cn('size-2.5 rounded-full', dot)} />
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right font-bold text-ink tabular-nums">
        {value}
        {pct !== undefined && <span className="ml-1.5 text-[11px] font-medium text-mute">{pct}%</span>}
      </dd>
    </>
  );
}
