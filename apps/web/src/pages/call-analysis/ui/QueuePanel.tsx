import { CALL_ANALYSIS_JOB_STATUSES, type CallAnalysisJobStatus } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callAnalysisQueueQuery } from '@/entities/call-analysis';
import { BackfillForm, RetryFailedButton } from '@/features/call-analysis/manage-queue';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Skeleton } from '@/shared/ui/skeleton';
import '../i18n';

const STATUS_TEXT: Record<CallAnalysisJobStatus, string> = {
  queued: 'text-muted-foreground',
  processing: 'text-shade-chart-4',
  done: 'text-success',
  failed: 'text-destructive',
  skipped: 'text-warning',
};

const STATUS_FILL: Record<CallAnalysisJobStatus, string> = {
  queued: 'bg-muted-foreground/40',
  processing: 'bg-chart-4',
  done: 'bg-success',
  failed: 'bg-destructive',
  skipped: 'bg-warning',
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-tint/8 bg-tint/[0.02] px-3 py-2">
      <div className="text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{children}</div>
    </div>
  );
}

/** Superuser: progress of the AI analysis queue, workers, recent failures, retry and backfill. */
export function QueuePanel({
  today,
  defaultFrom,
  onOpenCall,
}: {
  today: string;
  defaultFrom: string;
  onOpenCall: (callId: string) => void;
}) {
  const { t } = useTranslation('analysisPage');
  const queue = useQuery(callAnalysisQueueQuery);
  const q = queue.data;
  const total = q ? CALL_ANALYSIS_JOB_STATUSES.reduce((s, k) => s + q.counts[k], 0) : 0;
  const finished = q ? q.counts.done + q.counts.skipped + q.counts.failed : 0;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('queue.title')}</PanelTitle>
        {q && (
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span
              className={cn(
                'rounded-full px-2.5 py-1',
                q.autoEnqueue ? 'bg-success/15 text-success' : 'bg-muted-foreground/15 text-muted-foreground',
              )}
            >
              {t('queue.auto', { state: t(q.autoEnqueue ? 'queue.on' : 'queue.off') })}
            </span>
            <span
              className={cn(
                'rounded-full px-2.5 py-1',
                q.workerConfigured ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
              )}
            >
              {t('queue.worker', { state: t(q.workerConfigured ? 'queue.yes' : 'queue.no') })}
            </span>
          </div>
        )}
      </PanelHeader>

      {queue.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : queue.isError || !q ? (
        <div className="text-sm text-destructive">{t('error')}</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {CALL_ANALYSIS_JOB_STATUSES.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 text-[13px]">
                    <span className={cn('size-2 rounded-full', STATUS_FILL[s])} aria-hidden="true" />
                    <span className="text-foreground/85">{t(`queue.status.${s}`)}</span>
                    <b className={cn('font-mono', STATUS_TEXT[s])}>{q.counts[s]}</b>
                  </span>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{t('queue.progress', { done: finished, total })}</span>
            </div>
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded bg-tint/[0.06]">
              {CALL_ANALYSIS_JOB_STATUSES.map((s) =>
                q.counts[s] > 0 ? (
                  <span
                    key={s}
                    title={`${t(`queue.status.${s}`)}: ${q.counts[s]}`}
                    className={cn('h-full', STATUS_FILL[s])}
                    style={{ width: `${(q.counts[s] / Math.max(1, total)) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 [&>*]:min-w-0">
            <Fact label={t('queue.oldest')}>{formatDateTime(q.oldestQueuedCallAt)}</Fact>
            <Fact label={t('queue.lastDone')}>{formatDateTime(q.lastDoneAt)}</Fact>
            <Fact label={t('queue.doneLastHour')}>{q.doneLastHour}</Fact>
            <Fact label={t('queue.avgSec')}>
              {q.avgProcessingSec === null ? '—' : t('queue.sec', { n: Math.round(q.avgProcessingSec) })}
            </Fact>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <div>
              <div className="mb-1.5 text-xs font-bold tracking-[0.4px] text-muted-foreground uppercase">
                {t('queue.workers')}
              </div>
              {q.workers.length === 0 ? (
                <div className="text-[13px] text-muted-foreground">{t('queue.noWorkers')}</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {q.workers.map((w) => (
                    <li key={w.workerId} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-mono font-semibold text-foreground">{w.workerId}</span>
                      <span className="text-muted-foreground">
                        {t('queue.workerRow', { processing: w.processing, seen: formatDateTime(w.lastSeenAt) })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-bold tracking-[0.4px] text-muted-foreground uppercase">
                {t('queue.failures')}
              </div>
              {q.recentFailures.length === 0 ? (
                <div className="text-[13px] text-muted-foreground">{t('queue.noFailures')}</div>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
                  {q.recentFailures.map((f) => (
                    <li key={f.callId} className="text-[12px]">
                      <button
                        type="button"
                        onClick={() => onOpenCall(f.callId)}
                        className="font-mono font-semibold text-link hover:underline"
                      >
                        {f.callId}
                      </button>
                      <span className="ml-2 text-muted-foreground">
                        {t('queue.attempts', { n: f.attempts })} · {formatDateTime(f.updatedAt)}
                      </span>
                      {f.lastError && (
                        <div className="truncate text-muted-foreground" title={f.lastError}>
                          {f.lastError}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-tint/8 pt-4 xl:flex-row xl:items-end xl:justify-between">
            <BackfillForm today={today} defaultFrom={defaultFrom} />
            <RetryFailedButton failed={q.counts.failed} />
          </div>
        </div>
      )}
    </Panel>
  );
}
