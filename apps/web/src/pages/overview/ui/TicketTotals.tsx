import type { OverviewTickets } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/entities/call';
import type { TicketListRequest } from '@/entities/overview';
import { Skeleton } from '@/shared/ui/skeleton';
import { KpiCard } from '@/widgets/call-stats';
import { percentOf } from '@/widgets/ticket-overview';
import '../i18n';

/** The headline numbers above the map: received, closed, missed the deadline (the period) and overdue now. */
export function TicketTotals({
  data,
  onOpen,
}: {
  data: OverviewTickets | undefined;
  /** Opens the tickets behind a card's number. */
  onOpen?: (request: TicketListRequest) => void;
}) {
  const { t, i18n } = useTranslation('overviewPage');
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[145px] rounded-2xl" />
        ))}
      </div>
    );
  }
  const n = (v: number) => formatNumber(v, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ');
  const { totals, now } = data;
  const open = (request: TicketListRequest) => (onOpen && request.value > 0 ? () => onOpen(request) : undefined);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        accent="blue"
        icon="clipboard-text"
        label={t('tickets.received')}
        value={n(totals.received)}
        unit={t('tickets.ta')}
        sub={t('tickets.taken', { n: n(totals.taken) })}
        onOpen={open({ metric: 'received', value: totals.received })}
      />
      <KpiCard
        accent="green"
        icon="tick-circle"
        label={t('tickets.closed')}
        value={n(totals.closed)}
        unit={t('tickets.ta')}
        badge={`${percentOf(totals.closed, totals.received)}%`}
        sub={t('tickets.resolved', { n: n(totals.done + totals.rejected) })}
        onOpen={open({ metric: 'closed', value: totals.closed })}
      />
      <KpiCard
        accent="red"
        icon="timer"
        label={t('tickets.overdue')}
        value={n(totals.overdue)}
        unit={t('tickets.ta')}
        badge={`${percentOf(totals.overdue, totals.received)}%`}
        sub={t('tickets.overdueSplit', { open: n(totals.overdueOpen), late: n(totals.overdueLate) })}
        onOpen={open({ metric: 'overdue', value: totals.overdue })}
      />
      <KpiCard
        accent="amber"
        icon="clock"
        label={t('tickets.overdueNow')}
        value={n(now.overdue)}
        unit={t('tickets.ta')}
        sub={t('tickets.callbackOverdue', { n: n(now.callbackOverdue) })}
        onOpen={open({ metric: 'nowOverdue', value: now.overdue })}
      />
    </div>
  );
}
