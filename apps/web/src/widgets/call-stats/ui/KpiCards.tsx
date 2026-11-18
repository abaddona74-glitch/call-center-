import type { StatsSummary } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { formatDuration, formatHoursMinutes, formatNumber } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { Skeleton } from '@/shared/ui/skeleton';
import '../i18n';

type Accent = 'blue' | 'cyan' | 'purple' | 'green' | 'amber' | 'red' | 'indigo' | 'teal';

/** Legacy `.kpi-card.<color>`: top border + label color. */
const ACCENTS: Record<Accent, { border: string; label: string; badge: string; sub: string }> = {
  blue: { border: 'border-t-chart-6', label: 'text-shade-chart-6', badge: '', sub: 'text-shade-chart-6' },
  cyan: { border: 'border-t-chart-7', label: 'text-shade-chart-7', badge: '', sub: 'text-shade-chart-7' },
  purple: {
    border: 'border-t-chart-3',
    label: 'text-outbound',
    badge: 'border border-chart-3/30 bg-chart-3/20 text-outbound',
    sub: 'text-shade-chart-3',
  },
  green: {
    border: 'border-t-chart-2',
    label: 'text-success',
    badge: 'bg-chart-2/20 text-success',
    sub: 'text-shade-chart-2',
  },
  amber: {
    border: 'border-t-chart-5',
    label: 'text-warning',
    badge: 'bg-chart-5/20 text-warning',
    sub: 'text-shade-chart-5',
  },
  red: {
    border: 'border-t-chart-8',
    label: 'text-destructive',
    badge: 'bg-chart-8/20 text-destructive',
    sub: 'text-shade-chart-8',
  },
  indigo: { border: 'border-t-primary', label: 'text-primary', badge: '', sub: 'text-primary' },
  teal: { border: 'border-t-success', label: 'text-success', badge: '', sub: 'text-success' },
};

export function KpiCard({
  accent,
  image,
  icon,
  label,
  value,
  unit,
  badge,
  sub,
  title,
}: {
  accent: Accent;
  image?: string;
  icon?: string;
  label: string;
  value: React.ReactNode;
  unit?: string;
  badge?: string;
  sub?: React.ReactNode;
  title?: string;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      title={title}
      className={cn(
        'group relative flex min-h-[145px] items-center gap-3.5 overflow-hidden rounded-2xl border border-t-[3px] border-tint/8 bg-muted px-[22px] py-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/30',
        a.border,
      )}
    >
      <div className="flex size-[54px] min-w-[54px] items-center justify-center rounded-xl 2xl:size-[62px] 2xl:min-w-[62px]">
        {image ? (
          <img
            src={image}
            alt=""
            width={54}
            height={54}
            className="size-[54px] object-contain drop-shadow-[0_4px_10px_color-mix(in_srgb,var(--shadow-color)_45%,transparent)] transition-transform duration-200 group-hover:scale-110"
          />
        ) : (
          <Icon name={icon ?? 'chart'} className={cn('size-10', a.label)} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p
          className={cn('mb-1 line-clamp-2 text-[11.5px] leading-tight font-bold tracking-[0.4px] uppercase', a.label)}
        >
          {label}
        </p>
        <h3 className="mb-0.5 flex items-baseline gap-1.5 text-[32px] leading-tight font-extrabold whitespace-nowrap">
          <span>{value}</span>
          {unit && <span className="text-[13px] font-semibold text-muted-foreground">{unit}</span>}
          {badge && (
            <span className={cn('ml-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold', a.badge)}>{badge}</span>
          )}
        </h3>
        {sub && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Icon name="user" className={cn('size-3', a.sub)} />
            <span>{sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <b className="font-bold text-shade-chart-4">{children}</b>;
}

/** Legacy dashboard KPI grid, fed from the CDR summary of the chosen period. */
export function KpiCards({ summary }: { summary: StatsSummary | undefined }) {
  const { t, i18n } = useTranslation('callStats');
  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[145px] rounded-2xl" />
        ))}
      </div>
    );
  }
  const n = (v: number) => formatNumber(v, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ');
  const { inbound: inb, outbound: out } = summary;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        accent="blue"
        image="/images/totalcalls.png"
        label={t('kpi.total')}
        value={n(summary.totalCalls)}
        unit={t('kpi.ta')}
        sub={<B>{t('kpi.clients', { n: n(summary.clients) })}</B>}
      />
      <KpiCard
        accent="cyan"
        image="/images/incomingcall.png"
        label={t('kpi.inbound')}
        value={n(inb.offered)}
        unit={t('kpi.ta')}
        sub={<B>{t('kpi.clients', { n: n(inb.clients) })}</B>}
      />
      <KpiCard
        accent="purple"
        image="/images/outgoingcall.png"
        label={t('kpi.outbound')}
        value={n(out.connected)}
        unit={t('kpi.ta')}
        badge={`${out.connectRate}%`}
        sub={<B>{t('kpi.attempts', { n: n(out.attempts) })}</B>}
      />
      <KpiCard
        accent="green"
        image="/images/answered-calls-icon.png"
        label={t('kpi.answered')}
        value={n(inb.answered)}
        unit={t('kpi.ta')}
        badge={`${inb.answerRate}%`}
        sub={<B>{t('kpi.clients', { n: n(inb.answeredClients) })}</B>}
      />
      <KpiCard
        accent="amber"
        image="/images/queue.png"
        label={t('kpi.abandoned')}
        value={n(inb.abandoned)}
        unit={t('kpi.ta')}
        badge={`${inb.abandonRate}%`}
        sub={<B>{t('kpi.lost', { n: n(inb.lostClients) })}</B>}
      />
      <KpiCard
        accent="red"
        image="/images/missedcall.png"
        label={t('kpi.notReached')}
        value={n(inb.ivr + inb.afterHours)}
        unit={t('kpi.ta')}
        sub={t('kpi.ivrAfter', { ivr: n(inb.ivr), after: n(inb.afterHours) })}
      />
      <KpiCard
        accent="indigo"
        image="/images/stillinqueue.png"
        label={t('kpi.wait')}
        value={formatDuration(inb.avgWaitSec)}
        sub={t('kpi.maxWait', { v: formatDuration(inb.maxWaitSec) })}
      />
      <KpiCard
        accent="teal"
        icon="headphone"
        label={t('kpi.talk')}
        value={formatHoursMinutes(summary.talk.totalSec)}
        unit={t('kpi.hours')}
        sub={t('kpi.avgTalk', { v: formatDuration(summary.talk.avgSec) })}
      />
    </div>
  );
}
