import type { LiveCounters, SituationSnapshot, SituationTickets } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/entities/call';
import { SituationLiveStatus, situationQuery, useSituationSync } from '@/entities/situation';
import { AmiStatusPill, LiveSnapshotProvider, LiveTimer, liveSnapshotSource, useElapsed } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { tashkentDateTime } from '@/shared/lib/tashkent-time';
import { useNow } from '@/shared/lib/use-now';
import { Icon } from '@/shared/ui/icon';
import { Panel } from '@/shared/ui/panel';
import { Skeleton } from '@/shared/ui/skeleton';
import { ActiveCalls } from '@/widgets/active-calls';
import { KpiCard } from '@/widgets/call-stats';
import { OperatorsBoard } from '@/widgets/operators-board';
import { QueueWaiters } from '@/widgets/queues';
import { TicketQueues, TicketWorkers } from '@/widgets/situation-tickets';
import { type TelephonyNow, percent, shiftState, telephonyNow, waitLevel } from '../model/now';
import '../i18n';

/** The live widgets (operators board, queue, calls) read the board's telephony part instead of the monitor's. */
const LIVE = liveSnapshotSource<SituationSnapshot>(situationQuery, (s) => s.telephony);

/**
 * «Hozirgi holat» — the live situation board (observers' landing page, the superuser too; owner, 19.11.2026).
 * Read-only: telephony now (citizen numbers in full) and tickets now, kept current by `situation.*` WS events.
 * Figures: docs/rewrite/METRICS.md §10.
 */
export function SituationPage() {
  const { t, i18n } = useTranslation('situationPage');
  useSituationSync();
  const { data, isError, dataUpdatedAt } = useQuery(situationQuery);
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ';
  const n = (v: number) => formatNumber(v, locale);

  if (!data) {
    return isError ? (
      <Panel className="text-center text-sm text-destructive">{t('error')}</Panel>
    ) : (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[120px] rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[145px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    );
  }

  const { telephony, tickets } = data;
  const now = telephonyNow(telephony);
  const unit = t('unit') || undefined;
  const amiProblem = !telephony.ami.enabled ? 'disabled' : telephony.ami.state !== 'connected' ? 'down' : null;

  return (
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-[320px]">
          <div className="mb-2 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-[10px] border border-positive/40 bg-positive/12">
              <Icon name="monitor" className="size-[18px] text-positive" />
            </span>
            <h2 className="text-[22px] font-bold text-ink">{t('title')}</h2>
          </div>
          <p className="text-sm text-foreground/85">{t('description')}</p>
          <ShiftLine workday={telephony.workday} />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <SituationLiveStatus updatedAt={dataUpdatedAt} />
          <AmiStatusPill status={telephony.ami} className="h-9 px-3.5 text-[12.5px]" />
        </div>
      </Panel>

      {/* Telephony now on the first row (three tiles), tickets now on the second (two wider ones). */}
      <section aria-label={t('tilesLabel')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard
          className="lg:col-span-2"
          accent="green"
          image="/images/answered-calls-icon.png"
          label={t('tiles.online')}
          value={n(now.operators.online)}
          unit={t('tiles.onlineOf', { total: n(telephony.operators.length) })}
          sub={t('tiles.onlineSub', {
            talking: n(now.operators.talking + now.operators.ringing),
            idle: n(now.operators.idle),
            paused: n(now.operators.paused),
          })}
        />
        <WaitingTile now={now} />
        <KpiCard
          className="lg:col-span-2"
          accent="cyan"
          image="/images/incomingcall.png"
          label={t('tiles.calls')}
          value={n(now.conversations.total)}
          unit={unit}
          sub={t('tiles.callsSub', {
            inbound: n(now.conversations.inbound),
            outbound: n(now.conversations.outbound),
            ringing: n(now.ringing),
          })}
        />
        <KpiCard
          className="lg:col-span-3"
          accent="blue"
          icon="clipboard-text"
          label={t('tiles.open')}
          value={n(tickets.open.total)}
          unit={unit}
          sub={t('tiles.openSub', {
            new: n(tickets.open.new),
            working: n(tickets.open.assigned + tickets.open.inProgress),
            callback: n(tickets.open.callbackPending),
          })}
        />
        <KpiCard
          className="lg:col-span-3"
          accent="red"
          icon="timer"
          label={t('tiles.overdue')}
          value={n(tickets.overdue)}
          unit={unit}
          sub={t('tiles.overdueSub', { today: n(tickets.dueToday), callback: n(tickets.callbackOverdue) })}
        />
      </section>

      <TodayStrip counters={telephony.counters} tickets={tickets} />

      <section aria-label={t('sections.telephony')} className="flex flex-col gap-4">
        {amiProblem && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-xl border border-caution/40 bg-caution/10 px-4 py-3 text-sm font-medium text-caution-soft"
          >
            <Icon name="flash" className="size-4" />
            {t(`ami.${amiProblem}`)}
          </div>
        )}
        <LiveSnapshotProvider source={LIVE}>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            {/* First on phones (the people waiting matter most), on the right from xl. */}
            <div className="flex min-w-0 flex-col gap-4 xl:order-2">
              <QueueWaiters />
              <ActiveCalls />
            </div>
            <div className="min-w-0">
              <OperatorsBoard />
            </div>
          </div>
        </LiveSnapshotProvider>
      </section>

      <section
        aria-label={t('sections.tickets')}
        // Side by side only on wide screens: the workers table needs ~750 px; below that they stack.
        className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]"
      >
        <TicketWorkers rows={tickets.workers} />
        <TicketQueues data={tickets} />
      </section>
    </div>
  );
}

/** Callers waiting: calm while nobody waits, amber once someone does, red after 3 minutes (METRICS.md §10.1). */
function WaitingTile({ now }: { now: TelephonyNow }) {
  const { t, i18n } = useTranslation('situationPage');
  const longest = useElapsed(now.longestSince);
  const level = waitLevel(now.waiting, longest);
  return (
    <KpiCard
      className="lg:col-span-2"
      accent={level === 'long' ? 'red' : level === 'waiting' ? 'amber' : 'indigo'}
      image="/images/stillinqueue.png"
      label={t('tiles.waiting')}
      value={formatNumber(now.waiting, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ')}
      unit={t('unit') || undefined}
      sub={
        now.longestSince ? (
          <>
            {t('tiles.longest')}: <LiveTimer since={now.longestSince} thresholds className="font-bold" />
          </>
        ) : (
          t('tiles.queueEmpty')
        )
      }
    />
  );
}

function ShiftLine({ workday }: { workday: { working: boolean; start: string; end: string; date: string } }) {
  const { t } = useTranslation('situationPage');
  const now = useNow();
  const state = shiftState(workday, tashkentDateTime(new Date(now)).slice(11, 16));
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-mute">
      <Icon name="clock" className="size-3.5" />
      <span>{t('shift.hours', { start: workday.start, end: workday.end })}</span>
      <span
        className={cn('font-semibold', state === 'working' ? 'text-positive' : 'text-caution-soft')}
      >{`· ${t(`shift.${state}`)}`}</span>
    </p>
  );
}

/** Today's counters: calls (the dashboard's live counters, METRICS.md §5a) and tickets. */
function TodayStrip({ counters: c, tickets }: { counters: LiveCounters; tickets: SituationTickets }) {
  const { t, i18n } = useTranslation('situationPage');
  const n = (v: number) => formatNumber(v, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ');
  const calls: TodayItem[] = [
    { key: 'inbound', value: n(c.inbound), tone: 'text-link-soft' },
    { key: 'answered', value: n(c.answered), tone: 'text-positive', badge: `${c.answerRate}%` },
    {
      key: 'abandoned',
      value: n(c.abandoned),
      tone: 'text-caution-soft',
      badge: `${percent(c.abandoned, c.inbound)}%`,
    },
    { key: 'missed', value: n(c.operatorMissed), tone: 'text-danger-soft', hint: t('today.missedHint') },
    {
      key: 'callbacks',
      value: n(tickets.callbacks.total),
      tone: 'text-brand-soft',
      badge: t('today.callbacksPending', { n: n(tickets.callbacks.pending) }),
      hint: t('today.callbacksHint'),
    },
  ];
  const ticketItems: TodayItem[] = [
    { key: 'opened', value: n(tickets.today.opened), tone: 'text-lilac-soft' },
    { key: 'resolved', value: n(tickets.today.resolved), tone: 'text-positive' },
    { key: 'closed', value: n(tickets.today.closed), tone: 'text-ink-2', hint: t('today.closedHint') },
  ];
  // Two separate panels side by side (stacked on narrow screens): calls and tickets read apart at a glance.
  return (
    <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
      <TodayPanel
        icon="call"
        iconTone="text-link-soft"
        title={t('today.calls')}
        note={
          c.seededThrough ? t('today.seeded', { time: tashkentDateTime(c.seededThrough).slice(11, 16) }) : undefined
        }
        items={calls}
        className="grid-cols-2 sm:grid-cols-5"
      />
      <TodayPanel
        icon="clipboard-text"
        iconTone="text-lilac-soft"
        title={t('today.tickets')}
        items={ticketItems}
        className="grid-cols-3"
      />
    </div>
  );
}

interface TodayItem {
  key: string;
  value: string;
  tone: string;
  badge?: string;
  hint?: string;
}

function TodayPanel({
  icon,
  iconTone,
  title,
  note,
  items,
  className,
}: {
  icon: string;
  iconTone: string;
  title: string;
  note?: string;
  items: TodayItem[];
  className: string;
}) {
  const { t } = useTranslation('situationPage');
  return (
    <Panel className="flex flex-col py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Icon name={icon} className={cn('size-[18px]', iconTone)} />
          {title}
        </h3>
        {note && <span className="text-[11px] text-mute">{note}</span>}
      </div>
      <dl className={cn('grid flex-1 gap-2.5', className)}>
        {items.map((it) => (
          <div
            key={it.key}
            className="flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-tint/8 bg-card px-3.5 py-3"
            title={it.hint}
          >
            <dt className={cn('text-[11px] leading-tight font-bold tracking-[0.4px] uppercase', it.tone)}>
              {t(`today.${it.key}`)}
            </dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="text-2xl leading-none font-extrabold text-ink">{it.value}</span>
              {it.badge && <span className="text-[11px] font-semibold text-ink-2">{it.badge}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
