import { OVERVIEW_NO_REGION } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { businessToday, calendarLabels, type RangePresetId, rangePresets } from '@/entities/call';
import { overviewCallsQuery, overviewTicketsQuery } from '@/entities/overview';
import { cn } from '@/shared/lib/cn';
import { DateRangeModal } from '@/shared/ui/date-range-modal';
import { Icon } from '@/shared/ui/icon';
import { ModalButton } from '@/shared/ui/modal';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { toDmy } from '@/shared/ui/range-calendar';
import { Segmented } from '@/shared/ui/segmented';
import { MAP_METRICS, RegionMap } from '@/widgets/region-map';
import { DeadlinesPanel, ExecutivesTable, RegionsTable } from '@/widgets/ticket-overview';
import { OVERVIEW_PERIODS, type OverviewSearch, overviewStateFrom } from '../model/search';
import { CallsSection } from './CallsSection';
import { TicketTotals } from './TicketTotals';
import '../i18n';

const route = getRouteApi('/_app/overview');
const PRESETS: RangePresetId[] = ['today', 'week', 'month', 'prevMonth'];

/**
 * The overview dashboard (observers — their only page — and the superuser; owner, 19.11.2026): ticket totals,
 * the regions map, "Mas'ul shaxslar", deadlines and calls for a period. Clicking a region (map or table) filters
 * the ticket blocks by it; calls are for the whole center.
 */
export function OverviewPage() {
  const { t, i18n } = useTranslation('overviewPage');
  const ru = i18n.language === 'ru';
  const [rangeOpen, setRangeOpen] = useState(false);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = businessToday();
  const state = overviewStateFrom(search, today);
  const set = (patch: Partial<OverviewSearch>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true, resetScroll: false });

  const tickets = useQuery(
    overviewTicketsQuery({ from: state.from, to: state.to, ...(state.region ? { region: state.region } : {}) }),
  );
  const calls = useQuery(overviewCallsQuery({ from: state.from, to: state.to, scope: state.scope }));
  const data = tickets.data;
  const fetching = tickets.isFetching || calls.isFetching;
  const refresh = () => {
    void tickets.refetch();
    void calls.refetch();
  };

  const regionRow = data?.regions.find((r) => (r.code ?? OVERVIEW_NO_REGION) === state.region);
  const regionName = (code: string) => {
    const r = data?.regions.find((x) => x.code === code);
    return r ? (ru ? r.nameRu : r.nameUz) : code;
  };
  const selectedName =
    state.region === OVERVIEW_NO_REGION
      ? t('noRegion')
      : regionRow
        ? ru
          ? regionRow.nameRu
          : regionRow.nameUz
        : state.region;
  const selectRegion = (key: string | null) => set({ region: key ?? undefined });
  const cal = calendarLabels(i18n.language);
  const presets = rangePresets(today);
  const updated = data ? new Date(data.generatedAt) : null;

  return (
    <div className="flex flex-col gap-6">
      <Panel className="relative z-10">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] border border-chart-6/40 bg-chart-6/12">
            <Icon name="global" className="size-[18px] text-shade-chart-6" />
          </span>
          <h2 className="text-[22px] font-bold text-ink">{t('title')}</h2>
        </div>
        <p className="mb-4 text-sm text-foreground/85">
          {t('description')}{' '}
          <span className="whitespace-nowrap text-muted-foreground">
            · {state.from === state.to ? toDmy(state.from) : `${toDmy(state.from)} — ${toDmy(state.to)}`}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            tone="sky"
            value={state.period}
            onChange={(p) => (p === 'range' ? setRangeOpen(true) : set({ period: p, from: undefined, to: undefined }))}
            options={OVERVIEW_PERIODS.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
          />
          {state.period === 'range' && (
            <button
              type="button"
              onClick={() => setRangeOpen(true)}
              className="inline-flex h-9 items-center gap-[7px] rounded-lg border border-chart-6/40 bg-chart-6/15 px-3.5 text-[13px] font-semibold text-shade-chart-4 hover:bg-chart-6/25"
            >
              <Icon name="calendar" className="size-4" /> {`${toDmy(state.from)} — ${toDmy(state.to)}`}
            </button>
          )}
          {state.region && (
            <button
              type="button"
              onClick={() => selectRegion(null)}
              title={t('clearRegion')}
              aria-label={t('clearRegion')}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/45 bg-primary/14 px-3.5 text-[13px] font-semibold text-ink hover:bg-primary/22"
            >
              <Icon name="location" className="size-4 text-primary" />
              {t('regionFilter', { name: selectedName })}
              <Icon name="close" className="size-3.5 text-mute" />
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-chart-4/45 bg-chart-4/10 px-3.5 text-[13px] font-semibold text-shade-chart-4 transition-colors hover:bg-chart-4/20"
          >
            <Icon name="refresh" className={fetching ? 'size-4 animate-spin' : 'size-4'} /> {t('refresh')}
          </button>
          {updated && (
            <span className="text-xs text-mute">
              {t('updated', {
                time: updated.toLocaleTimeString(ru ? 'ru-RU' : 'uz-UZ', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Tashkent',
                }),
              })}
            </span>
          )}
        </div>
      </Panel>

      {tickets.isError && !data ? (
        <Panel className="text-center text-sm text-destructive">{t('error')}</Panel>
      ) : (
        <>
          <TicketTotals data={data} />

          <Panel>
            <PanelHeader>
              <div>
                <PanelTitle>
                  <Icon name="location" className="size-[18px] text-primary" />
                  {t('map.title')}
                </PanelTitle>
                <p className="mt-1 text-xs text-mute">{t('map.hint')}</p>
              </div>
              <Segmented
                tone="indigo"
                value={state.metric}
                onChange={(m) => set({ metric: m === 'received' ? undefined : m })}
                options={MAP_METRICS.map((m) => ({ value: m, label: <MetricLabel metric={m} /> }))}
              />
            </PanelHeader>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className={cn('min-w-0', !data && 'min-h-[300px] animate-pulse rounded-xl bg-tint/5')}>
                {data && (
                  <RegionMap
                    rows={data.regions}
                    metric={state.metric}
                    selected={state.region}
                    onSelect={selectRegion}
                  />
                )}
              </div>
              {data && <RegionsTable rows={data.regions} selected={state.region} onSelect={selectRegion} />}
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <ExecutivesTable rows={data?.executives} regionName={regionName} loading={tickets.isFetching} />
            <DeadlinesPanel data={data} />
          </div>
        </>
      )}

      <CallsSection
        data={calls.data}
        error={calls.isError ? calls.error : null}
        scope={state.scope}
        onScope={(scope) => set({ scope: scope === 'working' ? undefined : scope })}
        regionSelected={state.region !== null}
        rangeKey={`${state.from}_${state.to}`}
      />

      <DateRangeModal
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        initial={{ from: state.from, to: state.to }}
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
                set({ period: 'range', from: r.from, to: r.to });
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

function MetricLabel({ metric }: { metric: (typeof MAP_METRICS)[number] }) {
  const { t } = useTranslation('regionMap');
  return <>{t(`metric.${metric}`)}</>;
}
