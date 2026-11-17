import { useQueries, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  businessToday,
  operatorStatsQuery,
  type RangePresetId,
  rangePresets,
  statsSeriesQuery,
  statsSummaryQuery,
  topClientsQuery,
  workingCalendarQuery,
} from '@/entities/call';
import { ExportExcelButton } from '@/features/export-excel';
import { isHttpError } from '@/shared/api';
import { DateRangePicker } from '@/shared/ui/date-range-picker';
import { Icon } from '@/shared/ui/icon';
import { NativeSelect } from '@/shared/ui/native-select';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Segmented } from '@/shared/ui/segmented';
import {
  CallDynamicsChart,
  DistributionDonut,
  KpiCards,
  OperatorsSection,
  TopClientsTable,
} from '@/widgets/call-stats';
import { STATS_PERIODS, type StatisticsSearch, statsQueryFrom } from '../model/search';
import '../i18n';

const route = getRouteApi('/_app/statistics');
const PRESETS: RangePresetId[] = ['today', 'yesterday', 'week', 'month', 'prevMonth'];
const inputCls =
  'h-8 rounded-lg border border-white/8 bg-sidebar/75 px-2.5 text-xs text-foreground [color-scheme:dark] outline-none focus:border-primary';

/** Historical call-center statistics from the PBX CDR (KPI cards, dynamics, distribution, operators, top clients). */
export function StatisticsPage() {
  const { t } = useTranslation('statisticsPage');
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = businessToday();
  const { period, ...q } = statsQueryFrom(search, today);
  const set = (patch: Partial<StatisticsSearch>) => void navigate({ search: (s) => ({ ...s, ...patch }) });

  const [summary, series, operators, top] = useQueries({
    queries: [statsSummaryQuery(q), statsSeriesQuery(q), operatorStatsQuery(q), topClientsQuery({ ...q, limit: 10 })],
  });
  const calendar = useQuery(workingCalendarQuery);
  const error = [summary, series, operators, top].find((r) => r.isError)?.error;
  const anyFetching = [summary, series, operators, top].some((r) => r.isFetching);
  const refresh = () => [summary, series, operators, top].forEach((r) => void r.refetch());
  const presets = rangePresets(today);
  const weekdays = t('weekdays').split(',');
  const years = Array.from({ length: 5 }, (_, i) => String(Number(today.slice(0, 4)) - i));

  return (
    <div className="flex flex-col gap-6">
      <Panel className="relative z-10">
        <PanelHeader className="mb-0">
          <PanelTitle>
            <Icon name="chart" className="size-[18px] text-primary" />
            {t('title')}
            <span className="text-xs font-medium text-muted-foreground">
              {q.from === q.to ? q.from : `${q.from} — ${q.to}`}
            </span>
          </PanelTitle>
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented
              value={period}
              onChange={(p) => set({ period: p === 'day' ? undefined : p, to: undefined })}
              options={STATS_PERIODS.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
            />
            {period === 'day' && (
              <input
                type="date"
                aria-label={t('periods.day')}
                className={inputCls}
                value={q.from}
                max={today}
                onChange={(e) => e.target.value && set({ from: e.target.value })}
              />
            )}
            {period === 'month' && (
              <input
                type="month"
                aria-label={t('periods.month')}
                className={inputCls}
                value={q.from.slice(0, 7)}
                max={today.slice(0, 7)}
                onChange={(e) => e.target.value && set({ from: `${e.target.value}-01` })}
              />
            )}
            {period === 'year' && (
              <NativeSelect
                aria-label={t('periods.year')}
                value={q.from.slice(0, 4)}
                onChange={(e) => set({ from: `${e.target.value}-01-01` })}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </NativeSelect>
            )}
            {period === 'range' && (
              <DateRangePicker
                value={{ from: q.from, to: q.to }}
                max={today}
                onChange={(r) => set({ from: r.from, to: r.to })}
                presets={PRESETS.map((id) => ({ label: t(`presets.${id}`), ...presets[id] }))}
                labels={{ button: `${q.from} — ${q.to}`, from: t('from'), to: t('to'), apply: t('apply') }}
              />
            )}
            <NativeSelect
              aria-label={t('scope.working')}
              value={q.scope}
              title={
                calendar.data
                  ? t('scopeHint', {
                      days: calendar.data.days.map((d) => weekdays[d - 1]).join(', '),
                      start: calendar.data.start,
                      end: calendar.data.end,
                    })
                  : undefined
              }
              onChange={(e) => set({ scope: e.target.value === 'all' ? 'all' : undefined })}
            >
              <option value="working">{t('scope.working')}</option>
              <option value="all">{t('scope.all')}</option>
            </NativeSelect>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/8 bg-sidebar/75 px-3 text-xs font-semibold text-foreground hover:border-chart-4/40"
            >
              <Icon name="refresh" className={anyFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> {t('refresh')}
            </button>
            <ExportExcelButton from={q.from} to={q.to} scope={q.scope} />
          </div>
        </PanelHeader>
      </Panel>

      {error ? (
        <Panel className="text-center text-destructive">{isHttpError(error, 503) ? t('pbxDown') : t('error')}</Panel>
      ) : (
        <>
          <KpiCards summary={summary.data} />
          <div className="grid w-full grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.15fr)]">
            <CallDynamicsChart
              key={`${q.from}_${q.to}`}
              hourly={series.data?.hourly ?? []}
              daily={series.data?.daily ?? []}
            />
            <DistributionDonut summary={summary.data} />
          </div>
          <OperatorsSection data={operators.data} />
          <TopClientsTable
            clients={top.data?.clients}
            onOpenNumber={(number) =>
              void navigate({ to: '/history', search: { search: number, from: q.from, to: q.to } })
            }
          />
        </>
      )}
    </div>
  );
}
