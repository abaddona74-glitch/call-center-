import { CALL_ANALYSIS_PROMPT_VERSION, canAccessCdr } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  businessToday,
  calendarLabels,
  callDetailsQuery,
  type RangePresetId,
  rangePresets,
  shiftDate,
} from '@/entities/call';
import { callAnalysisStatsQuery, formatAvg, pickText } from '@/entities/call-analysis';
import { useSessionUser } from '@/entities/session';
import { DateRangeModal } from '@/shared/ui/date-range-modal';
import { Icon } from '@/shared/ui/icon';
import { ModalButton } from '@/shared/ui/modal';
import { NativeSelect } from '@/shared/ui/native-select';
import { Panel } from '@/shared/ui/panel';
import { toDmy } from '@/shared/ui/range-calendar';
import { Segmented } from '@/shared/ui/segmented';
import { Skeleton } from '@/shared/ui/skeleton';
import { CallDetailsDialog } from '@/widgets/call-history-table';
import { KpiCard } from '@/widgets/call-stats';
import { type AnalysisSearch, DEFAULT_DAYS, analysisQueryFrom } from '../model/search';
import { QueuePanel } from './QueuePanel';
import {
  CriteriaPanel,
  FlaggedPanel,
  FlagsPanel,
  OperatorsTable,
  OutcomesPanel,
  ProblemsPanel,
  SentimentPanel,
  TopicsPanel,
} from './sections';
import '../i18n';

const route = getRouteApi('/_app/analysis');
const PRESETS: RangePresetId[] = ['today', 'week', 'month', 'prevMonth'];
type PeriodChoice = RangePresetId | 'custom';

/** «Tahlil»: AI analysis of call recordings across operators (`CDR_ACCESS['analysis.stats']`), queue for superusers. */
export function CallAnalysisPage() {
  const { t, i18n } = useTranslation('analysisPage');
  const user = useSessionUser();
  const canManage = canAccessCdr(user, 'analysis.manage');
  const canListen = canAccessCdr(user, 'calls.recordings');
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = businessToday();
  const q = analysisQueryFrom(search, today);
  const set = (patch: Partial<AnalysisSearch>) => void navigate({ search: (s) => ({ ...s, ...patch }) });
  const [rangeOpen, setRangeOpen] = useState(false);

  const stats = useQuery(callAnalysisStatsQuery(q));
  // Operator options: everyone analysed in the period (same request as the page when no filter is set).
  const unfiltered = useQuery(
    callAnalysisStatsQuery(
      q.promptVersion ? { from: q.from, to: q.to, promptVersion: q.promptVersion } : { from: q.from, to: q.to },
    ),
  );
  // Topic options: the free-text topics of the period, grouped by key (also from the unfiltered request).
  const topicOptions = unfiltered.data?.topics ?? [];

  // A call from a list → its CDR item → the shared call details dialog.
  const [openingCallId, setOpeningCallId] = useState<string | null>(null);
  const opening = useQuery({ ...callDetailsQuery(openingCallId ?? ''), enabled: Boolean(openingCallId) });
  useEffect(() => {
    if (opening.isError && openingCallId) {
      toast.error(t('openFailed'));
      setOpeningCallId(null);
    }
  }, [opening.isError, openingCallId, t]);
  const openCall = opening.data && openingCallId ? opening.data.call : null;

  const presets = rangePresets(today);
  const period: PeriodChoice = PRESETS.find((id) => presets[id].from === q.from && presets[id].to === q.to) ?? 'custom';
  const cal = calendarLabels(i18n.language);
  const operators = [...(unfiltered.data?.operators ?? [])].sort((a, b) => a.ext.localeCompare(b.ext));
  const s = stats.data;
  // Scores of different prompt versions are not comparable: the page shows one version, others are selectable.
  const otherVersions = (s?.versions ?? []).filter((v) => v.version !== CALL_ANALYSIS_PROMPT_VERSION);
  const n = (v: number) => new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ').format(v);

  return (
    <div className="flex flex-col gap-6">
      <Panel className="relative z-10">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] border border-chart-3/40 bg-chart-3/12">
            <Icon name="magic-star" className="size-[18px] text-outbound" />
          </span>
          <h2 className="text-[22px] font-bold text-ink">{t('title')}</h2>
        </div>
        <p className="mb-4 text-sm text-foreground/85">
          {t('description')}{' '}
          <span className="text-muted-foreground">
            · {q.from === q.to ? toDmy(q.from) : `${toDmy(q.from)} — ${toDmy(q.to)}`}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented<PeriodChoice>
            tone="sky"
            value={period}
            onChange={(p) => {
              if (p === 'custom') setRangeOpen(true);
              else set(p === 'week' ? { from: undefined, to: undefined } : presets[p]);
            }}
            options={[...PRESETS, 'custom' as const].map((p) => ({
              value: p,
              label: p === 'custom' && period === 'custom' ? `${toDmy(q.from)} — ${toDmy(q.to)}` : t(`presets.${p}`),
            }))}
          />
          <NativeSelect
            aria-label={t('operatorAll')}
            className="h-9 px-3 text-[13px] font-semibold"
            value={q.operator ?? ''}
            onChange={(e) => set({ operator: e.target.value || undefined })}
          >
            <option value="">{t('operatorAll')}</option>
            {q.operator && !operators.some((o) => o.ext === q.operator) && (
              <option value={q.operator}>{q.operator}</option>
            )}
            {operators.map((o) => (
              <option key={o.ext} value={o.ext}>
                {o.name ? `${o.name} (${o.ext})` : o.ext}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('topicAll')}
            className="h-9 px-3 text-[13px] font-semibold"
            value={q.topic ?? ''}
            onChange={(e) => set({ topic: e.target.value || undefined })}
          >
            <option value="">{t('topicAll')}</option>
            {q.topic && !topicOptions.some((x) => x.key === q.topic) && <option value={q.topic}>{q.topic}</option>}
            {topicOptions.map((x) => (
              <option key={x.key} value={x.key}>
                {pickText(x, i18n.language)} ({x.count})
              </option>
            ))}
          </NativeSelect>
          {otherVersions.length > 0 && (
            <NativeSelect
              aria-label={t('version')}
              title={t('versionHint')}
              className="h-9 px-3 text-[13px] font-semibold"
              value={q.promptVersion ?? ''}
              onChange={(e) => set({ version: e.target.value || undefined })}
            >
              <option value="">{t('versionCurrent', { v: CALL_ANALYSIS_PROMPT_VERSION })}</option>
              {otherVersions.map((v) => (
                <option key={v.version} value={v.version}>
                  {t('versionOption', { v: v.version, n: v.count })}
                </option>
              ))}
            </NativeSelect>
          )}
          <button
            type="button"
            onClick={() => void stats.refetch()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-chart-4/45 bg-chart-4/10 px-3.5 text-[13px] font-semibold text-shade-chart-4 transition-colors hover:bg-chart-4/20"
          >
            <Icon name="refresh" className={stats.isFetching ? 'size-4 animate-spin' : 'size-4'} /> {t('refresh')}
          </button>
        </div>
        {s && otherVersions.some((v) => v.version !== s.promptVersion) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('versionsNote', {
              v: s.promptVersion,
              n: otherVersions.filter((v) => v.version !== s.promptVersion).reduce((sum, v) => sum + v.count, 0),
            })}
          </p>
        )}
      </Panel>

      {canManage && (
        <QueuePanel
          today={today}
          defaultFrom={shiftDate(today, -(DEFAULT_DAYS - 1))}
          onOpenCall={(id) => setOpeningCallId(id)}
        />
      )}

      {stats.isError ? (
        <Panel className="text-center text-destructive">{t('error')}</Panel>
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
              icon="magic-star"
              label={t('kpi.analysed')}
              value={n(s.totals.analyzed)}
              unit={t('kpi.ta')}
              sub={t('kpi.perOperator', { n: s.operators.length })}
            />
            <KpiCard
              accent="green"
              icon="chart"
              label={t('kpi.avgOverall')}
              value={formatAvg(s.totals.avgOverall)}
              unit="/ 10"
            />
            <KpiCard
              accent="red"
              icon="shield-security"
              label={t('kpi.flagged')}
              value={n(s.totals.redFlagCalls)}
              unit={t('kpi.ta')}
              badge={
                s.totals.analyzed > 0
                  ? `${Math.round((s.totals.redFlagCalls / s.totals.analyzed) * 1000) / 10}%`
                  : undefined
              }
            />
            <KpiCard
              accent="purple"
              icon="clipboard-text"
              label={t('kpi.tickets')}
              value={`${n(s.totals.ticketClaimed)} / ${n(s.totals.ticketClaimedConfirmed)}`}
              sub={t('kpi.ticketsSub', {
                wrong: s.totals.ticketClaimed - s.totals.ticketClaimedConfirmed,
                missed: s.totals.ticketMissed,
              })}
            />
          </div>

          {s.totals.analyzed === 0 ? (
            <Panel className="text-center text-muted-foreground">{t('empty')}</Panel>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 [&>*]:min-w-0">
                <CriteriaPanel stats={s} />
                <SentimentPanel stats={s} />
                <FlagsPanel stats={s} />
              </div>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
                <TopicsPanel stats={s} activeTopic={q.topic} onTopic={(topic) => set({ topic })} />
                <OutcomesPanel stats={s} />
              </div>
              <OperatorsTable stats={s} activeOperator={q.operator} onOperator={(operator) => set({ operator })} />
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
                <ProblemsPanel
                  stats={s}
                  activeTopic={q.topic}
                  onClearTopic={() => set({ topic: undefined })}
                  onOpenCall={setOpeningCallId}
                  openingCallId={openCall ? null : openingCallId}
                />
                <FlaggedPanel stats={s} onOpenCall={setOpeningCallId} openingCallId={openCall ? null : openingCallId} />
              </div>
            </>
          )}
        </>
      )}

      <CallDetailsDialog call={openCall} onClose={() => setOpeningCallId(null)} canListen={canListen} />

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
