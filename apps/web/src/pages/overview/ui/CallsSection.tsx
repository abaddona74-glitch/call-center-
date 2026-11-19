import type { CallScope, OverviewCalls } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { formatDuration, formatNumber } from '@/entities/call';
import { isHttpError } from '@/shared/api';
import { Icon } from '@/shared/ui/icon';
import { NativeSelect } from '@/shared/ui/native-select';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Skeleton } from '@/shared/ui/skeleton';
import { CallDynamicsChart, KpiCard } from '@/widgets/call-stats';
import '../i18n';

/**
 * Calls of the period from the PBX CDR — the statistics page's numbers (METRICS.md): totals, answered,
 * unanswered, waiting and talk time, and the dynamics chart. Not filtered by region (calls have none).
 */
export function CallsSection({
  data,
  error,
  scope,
  onScope,
  regionSelected,
  rangeKey,
}: {
  data: OverviewCalls | undefined;
  error: unknown;
  scope: CallScope;
  onScope: (scope: CallScope) => void;
  regionSelected: boolean;
  /** Resets the chart's day/hour view when the period changes. */
  rangeKey: string;
}) {
  const { t, i18n } = useTranslation('overviewPage');
  const n = (v: number) => formatNumber(v, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ');
  const s = data?.summary;
  return (
    <section className="flex flex-col gap-4">
      <Panel className="py-4">
        <PanelHeader className="mb-0">
          <div>
            <PanelTitle>
              <Icon name="call" className="size-[18px] text-shade-chart-6" />
              {t('calls.title')}
            </PanelTitle>
            {regionSelected && <p className="mt-1 text-xs text-mute">{t('calls.wholeCenter')}</p>}
          </div>
          <NativeSelect
            aria-label={t('calls.scope.working')}
            className="h-9 px-3 text-[13px] font-semibold"
            value={scope}
            onChange={(e) => onScope(e.target.value === 'all' ? 'all' : 'working')}
          >
            <option value="working">{t('calls.scope.working')}</option>
            <option value="all">{t('calls.scope.all')}</option>
          </NativeSelect>
        </PanelHeader>
      </Panel>

      {error ? (
        <Panel className="text-center text-sm text-destructive">
          {isHttpError(error, 503) ? t('calls.pbxDown') : t('error')}
        </Panel>
      ) : !s ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[145px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              accent="blue"
              image="/images/totalcalls.png"
              label={t('calls.total')}
              value={n(s.totalCalls)}
              unit={t('calls.ta')}
              sub={t('calls.split', { inbound: n(s.inbound.offered), outbound: n(s.outbound.connected) })}
            />
            <KpiCard
              accent="green"
              image="/images/answered-calls-icon.png"
              label={t('calls.answered')}
              value={n(s.inbound.answered)}
              unit={t('calls.ta')}
              badge={`${s.inbound.answerRate}%`}
              sub={t('calls.ofInbound', { n: n(s.inbound.offered) })}
            />
            <KpiCard
              accent="red"
              image="/images/missedcall.png"
              label={t('calls.unanswered')}
              value={n(s.inbound.offered - s.inbound.answered)}
              unit={t('calls.ta')}
              sub={t('calls.unansweredSplit', {
                abandoned: n(s.inbound.abandoned),
                ivr: n(s.inbound.ivr),
                after: n(s.inbound.afterHours),
              })}
            />
            <KpiCard
              accent="amber"
              image="/images/stillinqueue.png"
              label={t('calls.wait')}
              value={formatDuration(s.inbound.avgWaitSec)}
              sub={t('calls.avgTalk', { v: formatDuration(s.talk.avgSec) })}
            />
          </div>
          {data && <CallDynamicsChart key={rangeKey} hourly={data.hourly} daily={data.daily} />}
        </>
      )}
    </section>
  );
}
