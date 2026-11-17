import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  businessToday,
  calendarLabels,
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
import { DateRangeModal } from '@/shared/ui/date-range-modal';
import { ModalButton } from '@/shared/ui/modal';
import { toDmy } from '@/shared/ui/range-calendar';
import { Icon } from '@/shared/ui/icon';
import { NativeSelect } from '@/shared/ui/native-select';
import { Panel } from '@/shared/ui/panel';
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
const PRESETS: RangePresetId[] = ['today', 'week', 'month', 'prevMonth'];
const inputCls =
  'h-9 rounded-lg border border-white/8 bg-sidebar/75 px-3 text-[13px] font-semibold text-foreground [color-scheme:dark] outline-none focus:border-primary';

/** Historical call-center statistics from the PBX CDR (KPI cards, dynamics, distribution, operators, top clients). */
export function StatisticsPage() {
  const { t, i18n } = useTranslation('statisticsPage');
  const [rangeOpen, setRangeOpen] = useState(false);
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
  const cal = calendarLabels(i18n.language);

  return (
    <div className="flex flex-col gap-6">
      <Panel className="relative z-10">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] border border-chart-4/40 bg-chart-4/12">
            <Icon name="chart" className="size-[18px] text-chart-4" />
          </span>
          <h2 className="text-[22px] font-bold text-white">{t('title')}</h2>
        </div>
        <p className="mb-4 text-sm text-foreground/85">
          {t('description')}{' '}
          <span className="text-muted-foreground">
            · {q.from === q.to ? toDmy(q.from) : `${toDmy(q.from)} — ${toDmy(q.to)}`}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            tone="sky"
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
          {(period === 'month' || period === 'year') && (
            <NativeSelect
              aria-label={t('year')}
              className="h-9 px-3 text-[13px] font-semibold"
              value={q.from.slice(0, 4)}
              onChange={(e) => set({ from: `${e.target.value}-${period === 'month' ? q.from.slice(5, 7) : '01'}-01` })}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {t('yearOption', { y })}
                </option>
              ))}
            </NativeSelect>
          )}
          {period === 'month' && (
            <NativeSelect
              aria-label={t('month')}
              className="h-9 px-3 text-[13px] font-semibold"
              value={q.from.slice(5, 7)}
              onChange={(e) => set({ from: `${q.from.slice(0, 4)}-${e.target.value}-01` })}
            >
              {cal.months.map((m, i) => {
                const mm = String(i + 1).padStart(2, '0');
                return (
                  <option key={mm} value={mm} disabled={`${q.from.slice(0, 4)}-${mm}` > today.slice(0, 7)}>
                    {m}
                  </option>
                );
              })}
            </NativeSelect>
          )}
          {period === 'range' && (
            <button
              type="button"
              onClick={() => setRangeOpen(true)}
              className="inline-flex h-9 items-center gap-[7px] rounded-lg border border-chart-6/40 bg-chart-6/15 px-3.5 text-[13px] font-semibold text-chart-4 hover:bg-chart-6/25"
            >
              <Icon name="calendar" className="size-4" /> {`${toDmy(q.from)} — ${toDmy(q.to)}`}
            </button>
          )}
          <NativeSelect
            aria-label={t('scope.working')}
            className="h-9 px-3 text-[13px] font-semibold"
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
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-chart-4/45 bg-chart-4/10 px-3.5 text-[13px] font-semibold text-chart-4 transition-colors hover:bg-chart-4/20"
          >
            <Icon name="refresh" className={anyFetching ? 'size-4 animate-spin' : 'size-4'} /> {t('refresh')}
          </button>
          <ExportExcelButton from={q.from} to={q.to} scope={q.scope} />
        </div>
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

      <DateRangeModal
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        initial={{ from: q.from, to: q.to }}
        today={today}
        max={today}
        title={t('range')}
        subtitle={t('rangeSubtitle')}
        icon={<Icon name="calendar" className="size-5 text-white" />}
        presets={PRESETS.map((id) => ({ label: t(`presets.${id}`), ...presets[id] }))}
        labels={{
          quick: t('quick'),
          from: t('from'),
          to: t('to'),
          summary: (r, days) => t('rangeSummary', { from: toDmy(r.from), to: toDmy(r.to), days }),
          monthNames: cal.months,
          weekdayNames: cal.weekdays,
        }}
      >
        {(r, valid) => (
          <>
            <ModalButton onClick={() => setRangeOpen(false)}>{t('cancel')}</ModalButton>
            <ModalButton
              tone="blue"
              disabled={!valid}
              onClick={() => {
                set({ from: r.from, to: r.to });
                setRangeOpen(false);
              }}
            >
              <Icon name="chart" className="size-4" /> {t('apply')}
            </ModalButton>
          </>
        )}
      </DateRangeModal>
    </div>
  );
}
