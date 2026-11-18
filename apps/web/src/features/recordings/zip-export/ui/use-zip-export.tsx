import type { CreateZipJobRequest, ZipJob } from '@cc/shared';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cancelZipJob, createZipJob, formatBytes, zipJobDownloadUrl } from '@/entities/recording';
import { useRealtimeEvent } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

const downloaded = new Set<string>();

function statusText(job: ZipJob, t: TFunction<'recording'>): string {
  switch (job.status) {
    case 'queued':
      return t('zipJob.queued', { position: job.queuePosition });
    case 'processing':
      return t('zipJob.processing', { processed: job.processed, total: job.total, size: formatBytes(job.bytesWritten) });
    case 'ready':
      return t('zipJob.ready', { added: job.added, size: formatBytes(job.bytesWritten) });
    case 'failed':
      return t('zipJob.failed', { error: job.error ?? '' });
    default:
      return t('zipJob.cancelled');
  }
}

function startDownload(job: ZipJob): void {
  if (downloaded.has(job.id)) return;
  downloaded.add(job.id);
  const a = document.createElement('a');
  a.href = zipJobDownloadUrl(job.id);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Floating ZIP progress toast (legacy: files + MB, cancel; downloads when ready). */
function showZipToast(job: ZipJob, t: TFunction<'recording'>): void {
  const active = job.status === 'queued' || job.status === 'processing';
  if (job.status === 'ready') startDownload(job);
  toast.custom(
    (id) => (
      <div className="w-[360px] rounded-[14px] border border-[rgba(56,189,248,0.35)] bg-glass/94 p-3.5 text-ink shadow-[0_16px_36px_color-mix(in_srgb,var(--shadow-color)_60%,transparent)] backdrop-blur-[16px]">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <LegacyIcon name="document-download" className="size-4 text-info" />
          <span className="truncate">{job.zipName}</span>
        </div>
        <div className={cn('mt-1 text-xs', job.status === 'failed' ? 'text-danger' : 'text-mute')}>{statusText(job, t)}</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tint/10">
          <div
            className={cn('h-full rounded-full transition-[width] duration-300', job.status === 'failed' ? 'bg-[#ef4444]' : 'bg-info')}
            style={{ width: `${job.progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          {job.status === 'ready' && (
            <a
              href={zipJobDownloadUrl(job.id)}
              className="rounded-md bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-115"
            >
              {t('zipJob.download')}
            </a>
          )}
          {active ? (
            <button
              type="button"
              className="rounded-md border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] px-2.5 py-1 text-[11px] font-semibold text-danger"
              onClick={() => void cancelZipJob(job.id).catch(() => undefined)}
            >
              {t('zipJob.cancel')}
            </button>
          ) : (
            <button type="button" className="px-1 text-mute hover:text-ink" onClick={() => toast.dismiss(id)}>
              ×
            </button>
          )}
        </div>
      </div>
    ),
    { id: job.id, duration: active ? Number.POSITIVE_INFINITY : 15_000 },
  );
}

/** Starts a background ZIP export; progress arrives over WS `recordings.zipJob` (owner only). */
export function useZipExport() {
  const { t } = useTranslation('recording');
  useRealtimeEvent('recordings.zipJob', (job) => showZipToast(job, t));
  return useMutation({
    mutationFn: (req: CreateZipJobRequest) => createZipJob(req),
    onSuccess: (job) => showZipToast(job, t),
    onError: (err) => toast.error(err.message),
  });
}
