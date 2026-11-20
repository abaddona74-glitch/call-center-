import { KPI_NO_REGION, type KpiOperatorsResponse } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type CallListView,
  asCallListQuery,
  businessToday,
  calendarLabels,
  type RangePresetId,
  rangePresets,
} from '@/entities/call';
import {
  kpiExecutiveTicketListQuery,
  kpiExecutivesQuery,
  kpiOperatorCallListQuery,
  kpiOperatorTicketListQuery,
  kpiOperatorsQuery,
} from '@/entities/staff-kpi';
import { ApiScopeProvider } from '@/shared/lib/api-scope';
import { cn } from '@/shared/lib/cn';
import { useStableCallback } from '@/shared/lib/use-stable-callback';
import { DateRangeModal } from '@/shared/ui/date-range-modal';
import { Icon } from '@/shared/ui/icon';
import { ModalButton } from '@/shared/ui/modal';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { toDmy } from '@/shared/ui/range-calendar';
import { Segmented } from '@/shared/ui/segmented';
import { CallListDialog } from '@/widgets/call-history-table';
import { TicketBox } from '@/widgets/ticket-box';
import { TicketListDialog, type TicketListDialogView, asTicketListQuery } from '@/widgets/ticket-overview';
import { ExecutivesKpiTable, KPI_GROUPS, type KpiDetailRequest, OperatorsKpiTable } from '@/widgets/staff-kpi';
import { callTabsOf, detailId } from '../model/details';
import { KPI_PERIODS, KPI_VIEWS, type KpiSearch, kpiStateFrom, periodSearchOf } from '../model/search';
import '../i18n';

const route = getRouteApi('/_app/kpi');
/** Pill switches with many options scroll sideways on a phone instead of breaking their labels. */
const SCROLLING_PILLS = 'max-w-full overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap';
/**
 * The selected pill in a deeper shade of the same hue with light text, so its label keeps 4.5:1 in both themes
 * (the shared Segmented's sky / blue / indigo pills measure 2.7–4.3:1 at 12 px).
 */
const ACTIVE_PILL = {
  indigo:
    '[&>[aria-checked=true]]:bg-none [&>[aria-checked=true]]:bg-[color-mix(in_oklab,var(--primary)_78%,black)] [&>[aria-checked=true]]:text-primary-foreground',
  sky: '[&>[aria-checked=true]]:bg-none [&>[aria-checked=true]]:bg-[color-mix(in_oklab,var(--chart-4)_52%,black)] [&>[aria-checked=true]]:text-primary-foreground',
  blue: '[&>[aria-checked=true]]:bg-none [&>[aria-checked=true]]:bg-[color-mix(in_oklab,var(--chart-6)_72%,black)] [&>[aria-checked=true]]:text-primary-foreground',
} as const;
const PRESETS: RangePresetId[] = ['today', 'yesterday', 'week', 'month', 'prevMonth'];
/** More days than this are summarised as "… and N more days". */
const MAX_DAYS_LISTED = 5;

/**
 * «KPI xodimlar» (observers and the superuser; owner, 19.11.2026): per-person figures for a period, operators or
 * "Mas'ul shaxslar". No composite score yet: every figure is its own sortable column.
 */
export function StaffKpiPage() {
  const { t, i18n } = useTranslation('staffKpiPage');
  const ru = i18n.language === 'ru';
  const [rangeOpen, setRangeOpen] = useState(false);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = businessToday();
  const state = kpiStateFrom(search, today);
  const set = (patch: Partial<KpiSearch>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true, resetScroll: false });

  const operators = useQuery({
    ...kpiOperatorsQuery({ from: state.from, to: state.to, scope: state.scope }),
    enabled: state.view === 'operators',
  });
  const executives = useQuery({
    ...kpiExecutivesQuery({ from: state.from, to: state.to }),
    enabled: state.view === 'executives',
  });
  const active = state.view === 'operators' ? operators : executives;

  // The records behind a number: the overview dashboard's dialogs and read-only cards (its `/api/overview/*` card
  // endpoints, `overview.view`), fed with this page's lists so each list adds up to the number clicked.
  const [callView, setCallView] = useState<CallListView | null>(null);
  const [ticketView, setTicketView] = useState<TicketListDialogView | null>(null);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const range = state.from === state.to ? toDmy(state.from) : `${toDmy(state.from)} — ${toDmy(state.to)}`;
  const sla = executives.data?.slaWorkingDays ?? 3;
  // Stable: the tables keep their cells (and the focused number) while dialogs open and close.
  const openDetail = useStableCallback((r: KpiDetailRequest) => {
    if (r.kind === 'calls') {
      const quality = r.metric === 'analysed' || r.metric === 'flagged' || r.metric === 'handled';
      const tabs = callTabsOf(r.metric);
      setCallView({
        id: detailId({ ...r, from: state.from, to: state.to, scope: state.scope }),
        title: t('details.personTitle', { name: `${r.name} (${r.ext})`, title: t(`details.calls.${r.metric}.title`) }),
        value: r.value,
        icon: quality ? 'magic-star' : 'call',
        subtitle: t(quality ? 'details.qualitySubtitle' : 'details.callSubtitle', { range }),
        note: quality
          ? t(`details.calls.${r.metric}.def`)
          : `${t(`details.calls.${r.metric}.def`)} ${t(state.scope === 'working' ? 'details.scopeWorking' : 'details.scopeAll')}`,
        showDate: state.from !== state.to,
        tabs: tabs.map((m) => ({
          id: m,
          label: t(`details.calls.${m}.title`),
          count: m === r.metric ? r.value : undefined,
          filter: {},
        })),
        list: (tab, p) =>
          asCallListQuery(
            kpiOperatorCallListQuery({
              from: state.from,
              to: state.to,
              scope: state.scope,
              ext: r.ext,
              metric: tab as (typeof tabs)[number],
              ...p,
            }),
          ),
      });
      return;
    }
    if (r.kind === 'operatorTickets') {
      setTicketView({
        id: detailId({ ...r, from: state.from, to: state.to }),
        title: t('details.personTitle', {
          name: `${r.name} (${r.ext})`,
          title: t(`details.tickets.${r.metric}.title`),
        }),
        definition: `${t(`details.tickets.${r.metric}.def`)} ${range}`,
        value: r.value,
        list: (p) =>
          asTicketListQuery(
            kpiOperatorTicketListQuery({ from: state.from, to: state.to, ext: r.ext, metric: r.metric, ...p }),
          ),
      });
      return;
    }
    const title = t(`details.executive.${r.metric}.title`);
    setTicketView({
      id: detailId({ ...r, from: state.from, to: state.to }),
      title: r.region
        ? t('details.regionTitle', { name: r.name, region: r.region.name, title })
        : t('details.personTitle', { name: r.name, title }),
      definition:
        `${t(`details.executive.${r.metric}.def`, { sla })} ${r.metric === 'holding' || r.metric === 'overdueNow' ? '' : range}`.trim(),
      value: r.value,
      list: (p) =>
        asTicketListQuery(
          kpiExecutiveTicketListQuery({
            from: state.from,
            to: state.to,
            user: r.userId,
            metric: r.metric,
            ...(r.region ? { region: r.region.code ?? KPI_NO_REGION } : {}),
            ...p,
          }),
        ),
    });
  });
  const updated = active.data ? new Date(active.data.generatedAt) : null;
  const cal = calendarLabels(i18n.language);
  const presets = rangePresets(today);

  return (
    <div className="flex flex-col gap-6">
      <Panel className="relative z-10">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] border border-chart-2/40 bg-chart-2/12">
            <Icon name="user" className="size-[18px] text-shade-chart-2" />
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
          <Labeled label={t('viewLabel')} value={state.view}>
            <Segmented
              className={cn(SCROLLING_PILLS, ACTIVE_PILL.indigo)}
              tone="indigo"
              value={state.view}
              onChange={(v) => set({ view: v === 'operators' ? undefined : v })}
              options={KPI_VIEWS.map((v) => ({ value: v, label: t(`views.${v}`) }))}
            />
          </Labeled>
          <Labeled label={t('periodLabel')} value={state.period}>
            <Segmented
              className={cn(SCROLLING_PILLS, ACTIVE_PILL.sky)}
              tone="sky"
              value={state.period}
              onChange={(p) =>
                p === 'range'
                  ? setRangeOpen(true)
                  : set({ period: p === 'today' ? undefined : p, from: undefined, to: undefined })
              }
              options={KPI_PERIODS.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
            />
          </Labeled>
          {state.period === 'range' && (
            <button
              type="button"
              onClick={() => setRangeOpen(true)}
              className="inline-flex h-9 items-center gap-[7px] rounded-lg border border-chart-6/40 bg-chart-6/15 px-3.5 text-[13px] font-semibold text-shade-chart-4 hover:bg-chart-6/25"
            >
              <Icon name="calendar" className="size-4" /> {`${toDmy(state.from)} — ${toDmy(state.to)}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => void active.refetch()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-chart-4/45 bg-chart-4/10 px-3.5 text-[13px] font-semibold text-shade-chart-4 transition-colors hover:bg-chart-4/20"
          >
            <Icon name="refresh" className={active.isFetching ? 'size-4 animate-spin' : 'size-4'} /> {t('refresh')}
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

      {state.view === 'operators' ? (
        <Panel>
          <PanelHeader className="mb-3.5">
            <div>
              <PanelTitle>
                <Icon name="headphone" className="size-[18px] text-primary" />
                {t('operators.title')}
                {operators.data && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    {operators.data.operators.length}
                  </span>
                )}
              </PanelTitle>
              <p className="mt-1 text-xs text-mute">{t('operators.subtitle')}</p>
            </div>
            <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
              <Labeled label={t('operators.scopeLabel')} value={state.scope}>
                <Segmented
                  className={cn(SCROLLING_PILLS, ACTIVE_PILL.blue)}
                  size="xs"
                  value={state.scope}
                  onChange={(s) => set({ scope: s === 'working' ? undefined : s })}
                  options={(['working', 'all'] as const).map((s) => ({ value: s, label: t(`operators.scope.${s}`) }))}
                />
              </Labeled>
              <GroupFilter value={state.group} onChange={(g) => set({ group: g === 'all' ? undefined : g })} />
            </div>
          </PanelHeader>
          {operators.isError && !operators.data ? (
            <p className="py-6 text-center text-sm text-destructive">{t('error')}</p>
          ) : (
            <>
              {operators.data && <OperatorNotices data={operators.data} />}
              <OperatorsKpiTable
                onOpen={openDetail}
                key={state.group}
                rows={operators.data?.operators}
                group={state.group}
                surveyAvailable={operators.data?.surveyAvailable ?? false}
                loading={operators.isFetching}
              />
            </>
          )}
        </Panel>
      ) : (
        <Panel>
          <PanelHeader className="mb-3.5">
            <div>
              <PanelTitle>
                <Icon name="clipboard-text" className="size-[18px] text-primary" />
                {t('executives.title')}
                {executives.data && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    {executives.data.executives.length}
                  </span>
                )}
              </PanelTitle>
              <p className="mt-1 max-w-[880px] text-xs text-mute">
                {t('executives.subtitle', { n: executives.data?.slaWorkingDays ?? 3 })}
              </p>
            </div>
          </PanelHeader>
          {executives.isError && !executives.data ? (
            <p className="py-6 text-center text-sm text-destructive">{t('error')}</p>
          ) : (
            <ExecutivesKpiTable
              rows={executives.data?.executives}
              loading={executives.isFetching}
              onOpen={openDetail}
            />
          )}
        </Panel>
      )}

      <TicketListDialog view={ticketView} onClose={() => setTicketView(null)} onOpenTicket={setTicketId} />
      <ApiScopeProvider scope="overview">
        <CallListDialog view={callView} onClose={() => setCallView(null)} />
        <TicketBox ticketId={ticketId} maxFileMb={10} onClose={() => setTicketId(null)} />
      </ApiScopeProvider>

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
                set(periodSearchOf(r, today));
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

function GroupFilter({
  value,
  onChange,
}: {
  value: (typeof KPI_GROUPS)[number] | 'all';
  onChange: (v: (typeof KPI_GROUPS)[number] | 'all') => void;
}) {
  const { t } = useTranslation('staffKpi');
  const { t: tp } = useTranslation('staffKpiPage');
  return (
    <Labeled label={tp('operators.groupLabel')} value={value}>
      <Segmented
        className={cn(SCROLLING_PILLS, ACTIVE_PILL.indigo)}
        size="xs"
        tone="indigo"
        value={value}
        onChange={onChange}
        options={(['all', ...KPI_GROUPS] as const).map((g) => ({ value: g, label: t(`filter.${g}`) }))}
      />
    </Labeled>
  );
}

/** What the operator figures do not cover: the PBX, the AI analysis (only some days) and the presence history. */
function OperatorNotices({ data }: { data: KpiOperatorsResponse }) {
  const { t, i18n } = useTranslation('staffKpiPage');
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ';
  const q = data.quality;
  const days = q.days.map(toDmy);
  const daysText =
    days.length > MAX_DAYS_LISTED
      ? t('operators.daysMore', { list: days.slice(0, MAX_DAYS_LISTED).join(', '), n: days.length - MAX_DAYS_LISTED })
      : days.join(', ');
  const share =
    q.answeredCalls && q.answeredCalls > 0
      ? `${((q.analysed / q.answeredCalls) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
      : null;
  const since = data.presence.since ? new Date(data.presence.since) : null;
  const sinceText = since
    ? since.toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tashkent',
      })
    : '';

  return (
    <div className="mb-3.5 flex flex-col gap-2">
      {!data.callsAvailable && <Notice tone="danger" icon="call-remove" text={t('operators.pbxDown')} />}
      <Notice
        tone="violet"
        icon="magic-star"
        text={
          q.analysed === 0
            ? t('operators.qualityNone')
            : share
              ? t('operators.quality', { n: q.analysed, share, days: daysText })
              : t('operators.qualityNoShare', { n: q.analysed, days: daysText })
        }
        aside={
          <span className="rounded-md border border-tint/10 bg-tint/5 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
            {t('operators.version', { v: q.promptVersion })}
          </span>
        }
      />
      {data.presence.partial && (
        <Notice
          tone="caution"
          icon="clock"
          text={since ? t('operators.presencePartial', { since: sinceText }) : t('operators.presenceNone')}
        />
      )}
    </div>
  );
}

/**
 * A named group around a pill switch (screen readers announce what it switches). On a phone the switch scrolls
 * sideways; the selected pill is kept in view.
 */
function Labeled({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = ref.current?.querySelector<HTMLElement>('[role="radiogroup"]');
    if (!group) return;
    const reveal = () => {
      const active = group.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!active || group.scrollWidth <= group.clientWidth) return;
      const left = active.offsetLeft - group.offsetLeft;
      if (left < group.scrollLeft || left + active.offsetWidth > group.scrollLeft + group.clientWidth)
        group.scrollLeft = Math.max(0, left - 8);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(group);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div ref={ref} role="group" aria-label={label} className="inline-flex max-w-full min-w-0">
      {children}
    </div>
  );
}

const NOTICE_TONE = {
  danger: 'border-danger/30 bg-danger/8 [&_svg]:text-danger',
  violet: 'border-violet/30 bg-violet/8 [&_svg]:text-violet',
  caution: 'border-caution/30 bg-caution/8 [&_svg]:text-caution',
} as const;

function Notice({
  tone,
  icon,
  text,
  aside,
}: {
  tone: keyof typeof NOTICE_TONE;
  icon: string;
  text: string;
  aside?: ReactNode;
}) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5', NOTICE_TONE[tone])}>
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2.5 gap-y-1.5">
        <p className="min-w-[min(100%,260px)] flex-1 text-[13px] leading-snug text-ink-2">{text}</p>
        {aside}
      </div>
    </div>
  );
}
