import {
  type CallAnalysisStats,
  KPI_CRITERIA,
  type KpiCriterion,
  LEGACY_KPI_CRITERIA,
  SENTIMENTS,
  type Sentiment,
} from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { OutcomeBadge, RedFlagBadge, ScorePill, formatAvg, pickText, scoreTone } from '@/entities/call-analysis';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import '../i18n';

/** Legacy `.data-table` (uppercase header on slate, centered cells) — same classes as the statistics tables. */
const DT = {
  wrap: 'w-full overflow-x-auto rounded-xl border border-tint/8',
  table: 'w-full border-collapse text-center text-[13px]',
  th: 'border-b border-tint/8 bg-secondary/85 px-3 py-3 text-[11px] font-bold tracking-[0.6px] whitespace-nowrap text-muted-foreground uppercase',
  td: 'border-b border-tint/5 px-3 py-[10px] whitespace-nowrap text-foreground',
  tr: 'transition-colors hover:bg-tint/[0.04]',
} as const;

const FILL: Record<ReturnType<typeof scoreTone>, string> = {
  success: 'bg-success',
  info: 'bg-chart-4',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground',
};

export interface BarRow {
  key: string;
  label: React.ReactNode;
  value: number;
  /** Shown right of the bar instead of the bare value. */
  display?: React.ReactNode;
  /** Hover text (the bar's tooltip). */
  title?: string;
  /** Fill class; default the single magnitude hue. */
  fill?: string;
  active?: boolean;
  onClick?: () => void;
}

/** Horizontal bars, one hue (magnitude); labels left, values right, tooltip on hover. */
export function BarList({ rows, max, empty }: { rows: BarRow[]; max?: number; empty: string }) {
  if (rows.length === 0) return <div className="py-4 text-center text-sm text-muted-foreground">{empty}</div>;
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => {
        const body = (
          <>
            <span className="w-[42%] min-w-0 truncate text-left text-[13px] text-foreground/90">{r.label}</span>
            <span className="relative h-3 flex-1 overflow-hidden rounded bg-tint/[0.06]">
              <span
                className={cn('absolute inset-y-0 left-0 rounded', r.fill ?? 'bg-chart-6')}
                style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%` }}
              />
            </span>
            <span className="w-[72px] shrink-0 text-right font-mono text-xs text-foreground">
              {r.display ?? r.value}
            </span>
          </>
        );
        return (
          <li key={r.key} title={r.title}>
            {r.onClick ? (
              <button
                type="button"
                onClick={r.onClick}
                aria-pressed={r.active}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-tint/[0.05]',
                  r.active && 'bg-primary/10 ring-1 ring-primary/40',
                )}
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-2.5 px-1.5 py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

/** Criteria shown for these figures: the greeting only for prompt versions that scored it (v1–v3). */
const criteriaOf = (stats: CallAnalysisStats): KpiCriterion[] =>
  stats.totals.avgScores.greeting === null ? [...KPI_CRITERIA] : [...LEGACY_KPI_CRITERIA, ...KPI_CRITERIA];

export function CriteriaPanel({ stats }: { stats: CallAnalysisStats }) {
  const { t } = useTranslation('analysisPage');
  const { t: ta } = useTranslation('callAnalysis');
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('criteria')}</PanelTitle>
      </PanelHeader>
      <BarList
        empty={t('noRows')}
        max={5}
        rows={criteriaOf(stats).map((c) => {
          const v = stats.totals.avgScores[c];
          return {
            key: c,
            label: ta(`criterion.${c}`),
            value: v ?? 0,
            display: formatAvg(v),
            fill: FILL[scoreTone(v, 5)],
            title: `${ta(`criterion.${c}`)}: ${formatAvg(v, 2)} / 5`,
          };
        })}
      />
    </Panel>
  );
}

const SENTIMENT_FILL: Record<Sentiment, string> = {
  positive: 'bg-success',
  neutral: 'bg-muted-foreground/60',
  negative: 'bg-destructive',
};

/** Polarity: positive / neutral / negative, as one 100 % strip per moment, with a legend that carries the numbers. */
export function SentimentPanel({ stats }: { stats: CallAnalysisStats }) {
  const { t } = useTranslation('analysisPage');
  const { t: ta } = useTranslation('callAnalysis');
  const strip = (label: string, counts: CallAnalysisStats['sentiment']['start']) => {
    const total = counts.positive + counts.neutral + counts.negative;
    return (
      <div>
        <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
        <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded bg-tint/[0.06]">
          {SENTIMENTS.map((s) =>
            counts[s] > 0 ? (
              <span
                key={s}
                title={`${ta(`sentiment.${s}`)}: ${counts[s]} (${pct(counts[s], total)}%)`}
                className={cn('h-full first:rounded-l last:rounded-r', SENTIMENT_FILL[s])}
                style={{ width: `${pct(counts[s], total)}%` }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/85">
          {SENTIMENTS.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', SENTIMENT_FILL[s])} aria-hidden="true" />
              {ta(`sentiment.${s}`)} <b className="font-mono font-semibold">{counts[s]}</b>
              <span className="text-muted-foreground">({pct(counts[s], total)}%)</span>
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('sentiment')}</PanelTitle>
      </PanelHeader>
      <div className="flex flex-col gap-4">
        {strip(t('sentimentStart'), stats.sentiment.start)}
        {strip(t('sentimentEnd'), stats.sentiment.end)}
      </div>
    </Panel>
  );
}

export function FlagsPanel({ stats }: { stats: CallAnalysisStats }) {
  const { t } = useTranslation('analysisPage');
  const { t: ta } = useTranslation('callAnalysis');
  const rows = stats.redFlags.filter((f) => f.count > 0).sort((a, b) => b.count - a.count);
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('flags')}</PanelTitle>
      </PanelHeader>
      <BarList
        empty={t('noFlags')}
        rows={rows.map((f) => ({
          key: f.code,
          label: ta(`flag.${f.code}`),
          value: f.count,
          fill: 'bg-destructive/80',
          title: `${ta(`flag.${f.code}`)}: ${f.count}`,
        }))}
      />
    </Panel>
  );
}

export function TopicsPanel({
  stats,
  activeTopic,
  onTopic,
}: {
  stats: CallAnalysisStats;
  activeTopic: string | undefined;
  onTopic: (key: string | undefined) => void;
}) {
  const { t, i18n } = useTranslation('analysisPage');
  const total = stats.topics.reduce((s, x) => s + x.count, 0);
  const rows = [...stats.topics].filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('topics')}</PanelTitle>
        <span className="text-[11px] text-muted-foreground">{t('topicsHint')}</span>
      </PanelHeader>
      <BarList
        empty={t('noRows')}
        rows={rows.map((x) => {
          const name = pickText(x, i18n.language);
          return {
            key: x.key,
            label: name,
            value: x.count,
            display: t('share', { n: x.count, p: pct(x.count, total) }),
            title: `${name}: ${x.count} · ${formatAvg(x.avgOverall)} / 10`,
            active: activeTopic === x.key,
            onClick: () => onTopic(activeTopic === x.key ? undefined : x.key),
          };
        })}
      />
    </Panel>
  );
}

export function OutcomesPanel({ stats }: { stats: CallAnalysisStats }) {
  const { t } = useTranslation('analysisPage');
  const { t: ta } = useTranslation('callAnalysis');
  const total = stats.outcomes.reduce((s, x) => s + x.count, 0);
  const rows = [...stats.outcomes].filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('outcomes')}</PanelTitle>
      </PanelHeader>
      <BarList
        empty={t('noRows')}
        rows={rows.map((x) => ({
          key: x.outcome,
          label: ta(`outcome.${x.outcome}`),
          value: x.count,
          display: t('share', { n: x.count, p: pct(x.count, total) }),
          title: `${ta(`outcome.${x.outcome}`)}: ${x.count}`,
        }))}
      />
    </Panel>
  );
}

export function OperatorsTable({
  stats,
  activeOperator,
  onOperator,
}: {
  stats: CallAnalysisStats;
  activeOperator: string | undefined;
  onOperator: (ext: string | undefined) => void;
}) {
  const { t } = useTranslation('analysisPage');
  const { t: ta } = useTranslation('callAnalysis');
  const rows = [...stats.operators].sort((a, b) => b.analyzed - a.analyzed);
  const criteria = criteriaOf(stats);
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('operators')}</PanelTitle>
        <span className="text-[11px] text-muted-foreground">{t('operatorsHint')}</span>
      </PanelHeader>
      <div className={DT.wrap}>
        <table className={DT.table}>
          <thead>
            <tr>
              <th className={cn(DT.th, 'text-left')}>{t('col.operator')}</th>
              <th className={DT.th}>{t('col.analysed')}</th>
              <th className={DT.th}>{t('col.overall')}</th>
              {criteria.map((c) => (
                <th key={c} className={DT.th}>
                  {ta(`criterion.${c}`)}
                </th>
              ))}
              <th className={DT.th}>{t('col.flagged')}</th>
              <th className={DT.th}>{t('col.resolved')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={criteria.length + 5} className={cn(DT.td, 'py-6 text-muted-foreground')}>
                  {t('noRows')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.ext}
                  onClick={() => onOperator(activeOperator === r.ext ? undefined : r.ext)}
                  className={cn(DT.tr, 'cursor-pointer', activeOperator === r.ext && 'bg-primary/10')}
                >
                  <td className={cn(DT.td, 'text-left font-semibold')}>
                    <span className="mr-2 inline-flex size-7 items-center justify-center rounded-lg bg-primary/15 text-[11px] font-bold text-primary">
                      {r.ext}
                    </span>
                    {r.name ?? `Operator ${r.ext}`}
                  </td>
                  <td className={cn(DT.td, 'font-semibold')}>{r.analyzed}</td>
                  <td className={DT.td}>
                    <ScorePill value={r.avgOverall} max={10} average />
                  </td>
                  {criteria.map((c) => (
                    <td key={c} className={DT.td}>
                      <ScorePill value={r.avgScores[c]} max={5} average />
                    </td>
                  ))}
                  <td
                    className={cn(
                      DT.td,
                      r.redFlagCalls > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {r.redFlagCalls}
                  </td>
                  <td className={cn(DT.td, 'font-mono')}>{r.resolvedRate === null ? '—' : `${r.resolvedRate}%`}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CallRowButton({
  onClick,
  pending,
  children,
}: {
  onClick: () => void;
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border border-tint/8 bg-tint/[0.02] px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.05]',
        pending && 'animate-pulse',
      )}
    >
      {children}
    </button>
  );
}

export function ProblemsPanel({
  stats,
  activeTopic,
  onClearTopic,
  onOpenCall,
  openingCallId,
}: {
  stats: CallAnalysisStats;
  activeTopic: string | undefined;
  onClearTopic: () => void;
  onOpenCall: (callId: string) => void;
  openingCallId: string | null;
}) {
  const { t, i18n } = useTranslation('analysisPage');
  const topicName = (key: string) => {
    const x = stats.topics.find((tp) => tp.key === key);
    return x ? pickText(x, i18n.language) : key;
  };
  return (
    <Panel className="flex flex-col">
      <PanelHeader>
        <PanelTitle>{t('problems')}</PanelTitle>
        {activeTopic && (
          <button
            type="button"
            onClick={onClearTopic}
            className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25"
            title={t('clearTopic')}
          >
            {t('problemsTopic', { topic: topicName(activeTopic) })} ✕
          </button>
        )}
      </PanelHeader>
      {stats.problems.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">{t('noRows')}</div>
      ) : (
        <div className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto pr-1">
          {stats.problems.map((p) => (
            <CallRowButton key={p.callId} onClick={() => onOpenCall(p.callId)} pending={openingCallId === p.callId}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono">{formatDateTime(p.startedAt)}</span>
                {p.operatorExt && <span>· {p.operatorExt}</span>}
                <span className="font-semibold text-shade-chart-4">· {pickText(p.topic, i18n.language)}</span>
                {pickText(p.subtopic, i18n.language) && <span>· {pickText(p.subtopic, i18n.language)}</span>}
                <OutcomeBadge outcome={p.outcome} className="ml-auto px-2 py-0.5" />
              </div>
              <div className="text-[13px] leading-snug text-foreground">{pickText(p.problem, i18n.language)}</div>
            </CallRowButton>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function FlaggedPanel({
  stats,
  onOpenCall,
  openingCallId,
}: {
  stats: CallAnalysisStats;
  onOpenCall: (callId: string) => void;
  openingCallId: string | null;
}) {
  const { t, i18n } = useTranslation('analysisPage');
  return (
    <Panel className="flex flex-col">
      <PanelHeader>
        <PanelTitle>{t('flagged')}</PanelTitle>
      </PanelHeader>
      {stats.flaggedCalls.length === 0 ? (
        <div className="py-4 text-center text-sm text-success">{t('noFlags')}</div>
      ) : (
        <div className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto pr-1">
          {stats.flaggedCalls.map((c) => (
            <CallRowButton key={c.callId} onClick={() => onOpenCall(c.callId)} pending={openingCallId === c.callId}>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{formatDateTime(c.startedAt)}</span>
                {c.operatorExt && <span>· {c.operatorExt}</span>}
                <ScorePill value={c.overall} max={10} className="ml-auto px-2 py-0.5" />
              </div>
              <div className="flex flex-wrap gap-1">
                {c.flags.map((f) => (
                  <RedFlagBadge key={f} code={f} />
                ))}
              </div>
              <div className="line-clamp-2 text-[13px] leading-snug text-foreground/90">
                {pickText(c.summary, i18n.language)}
              </div>
            </CallRowButton>
          ))}
        </div>
      )}
    </Panel>
  );
}
