import type { CallAnalysisJobStatus, CallOutcome, RedFlagCode, Sentiment } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { type ScoreTone, formatAvg, scoreTone } from '../lib/format';
import '../i18n';

export type AnalysisTone = ScoreTone | 'purple';

const TONES: Record<AnalysisTone, string> = {
  success: 'bg-success/15 text-success',
  info: 'bg-chart-7/15 text-shade-chart-4',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/15 text-destructive',
  muted: 'bg-muted-foreground/15 text-muted-foreground',
  purple: 'border border-chart-3/40 bg-chart-3/15 text-outbound',
};

/** Legacy `.badge` pill in the analysis tones. */
export function AnalysisPill({
  tone,
  className,
  title,
  children,
}: {
  tone: AnalysisTone;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "8/10" (or an average "3.4") coloured by its share of the scale. */
export function ScorePill({
  value,
  max,
  average,
  className,
}: {
  value: number | null | undefined;
  max: number;
  /** Show one decimal without "/max". */
  average?: boolean;
  className?: string;
}) {
  return (
    <AnalysisPill tone={scoreTone(value, max)} className={cn('font-mono', className)}>
      {average ? formatAvg(value) : value === null || value === undefined ? '—' : `${value}/${max}`}
    </AnalysisPill>
  );
}

const OUTCOME_TONE: Record<CallOutcome, AnalysisTone> = {
  resolved: 'success',
  info_only: 'info',
  ticket_opened: 'purple',
  callback_promised: 'warning',
  transferred: 'muted',
  unresolved: 'danger',
};

export function OutcomeBadge({ outcome, className }: { outcome: CallOutcome; className?: string }) {
  const { t } = useTranslation('callAnalysis');
  return (
    <AnalysisPill tone={OUTCOME_TONE[outcome]} className={className}>
      {t(`outcome.${outcome}`)}
    </AnalysisPill>
  );
}

const SENTIMENT_TONE: Record<Sentiment, AnalysisTone> = { positive: 'success', neutral: 'muted', negative: 'danger' };
const SENTIMENT_MARK: Record<Sentiment, string> = { positive: '▲', neutral: '●', negative: '▼' };

export function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const { t } = useTranslation('callAnalysis');
  return (
    <AnalysisPill tone={SENTIMENT_TONE[sentiment]}>
      <span aria-hidden="true" className="text-[9px]">
        {SENTIMENT_MARK[sentiment]}
      </span>
      {t(`sentiment.${sentiment}`)}
    </AnalysisPill>
  );
}

export function RedFlagBadge({ code }: { code: RedFlagCode }) {
  const { t } = useTranslation('callAnalysis');
  return (
    <AnalysisPill tone="danger">
      <span aria-hidden="true">⚑</span>
      {t(`flag.${code}`)}
    </AnalysisPill>
  );
}

const JOB_TONE: Record<CallAnalysisJobStatus | 'none', AnalysisTone> = {
  none: 'muted',
  queued: 'muted',
  processing: 'info',
  done: 'success',
  failed: 'danger',
  skipped: 'warning',
};

/** Job status; `null` = the call was never queued. */
export function JobStatusBadge({ status }: { status: CallAnalysisJobStatus | null }) {
  const { t } = useTranslation('callAnalysis');
  const s = status ?? 'none';
  return <AnalysisPill tone={JOB_TONE[s]}>{t(`jobStatus.${s}`)}</AnalysisPill>;
}
