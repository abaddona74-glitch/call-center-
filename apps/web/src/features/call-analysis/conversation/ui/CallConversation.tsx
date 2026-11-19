import { SKIP_REASONS, type SkipReason } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AnalysisCard,
  JobStatusBadge,
  TranscriptView,
  activeSegmentIndex,
  callAnalysisQuery,
} from '@/entities/call-analysis';
import { Skeleton } from '@/shared/ui/skeleton';
import { useRecordingSeek } from '../model/use-recording-seek';
import '../i18n';

const isSkipReason = (v: string | null): v is SkipReason => SKIP_REASONS.includes(v as SkipReason);

/**
 * AI analysis of one call inside the call details: the rubric card and the dialogue as chat bubbles.
 * Clicking a time (a bubble or a red flag) plays the call's recording from there when `canListen`.
 */
export function CallConversation({
  callId,
  recordingTitle,
  canListen,
}: {
  callId: string;
  /** Player title when the recording is started from here. */
  recordingTitle: string;
  canListen: boolean;
}) {
  const { t } = useTranslation('callConversation');
  const { t: ta } = useTranslation('callAnalysis');
  const query = useQuery(callAnalysisQuery(callId));
  const { seek, position } = useRecordingSeek(callId, recordingTitle);
  const onSeek = canListen ? (s: number) => void seek(s) : null;

  if (query.isPending) return <Skeleton className="h-48 w-full" />;
  if (query.isError) return <div className="py-4 text-sm text-destructive">{t('error')}</div>;

  const { job, transcript, analysis, tickets } = query.data;
  const segments = transcript?.segments ?? [];
  const active = position === null ? -1 : activeSegmentIndex(segments, position);

  if (!analysis && !transcript) {
    const status = job?.status ?? null;
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-tint/8 bg-tint/[0.02] px-4 py-4 text-sm">
        <div className="flex items-center gap-2">
          <JobStatusBadge status={status} />
          {job && job.attempts > 0 && (
            <span className="text-xs text-muted-foreground">{t('attempts', { n: job.attempts })}</span>
          )}
        </div>
        <p className="text-muted-foreground">
          {status === null ? t('notAnalysed') : status === 'queued' || status === 'processing' ? t('pending') : null}
          {status === 'failed' && t('failed')}
          {status === 'skipped' && isSkipReason(job?.lastError ?? null) && ta(`skipReason.${job?.lastError}`)}
        </p>
        {job?.lastError && !(status === 'skipped' && isSkipReason(job.lastError)) && (
          <code className="max-w-full rounded bg-well/30 px-2 py-1 text-[11px] break-all text-muted-foreground">
            {job.lastError}
          </code>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] [&>*]:min-w-0">
      <div>{analysis ? <AnalysisCard analysis={analysis} tickets={tickets} onSeek={onSeek} /> : null}</div>
      <div className="flex min-h-0 flex-col rounded-xl border border-tint/8 bg-tint/[0.015] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-[0.4px] text-muted-foreground uppercase">{t('title')}</span>
          {transcript && (
            <span className="text-[11px] text-muted-foreground">{ta(`language.${transcript.language}`)}</span>
          )}
        </div>
        {transcript ? (
          <TranscriptView segments={segments} activeIndex={active} onSeek={onSeek} className="max-h-[560px]" />
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">{t('noTranscript')}</div>
        )}
      </div>
    </div>
  );
}
