import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { backfillCallAnalysis, callAnalysisKeys, retryFailedCallAnalysis } from '@/entities/call-analysis';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Icon } from '@/shared/ui/icon';
import { toDmy } from '@/shared/ui/range-calendar';
import '../i18n';

const BUTTON =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50';
const INPUT =
  'h-9 rounded-lg border border-tint/8 bg-sidebar/75 px-3 text-[13px] font-semibold text-foreground outline-none focus:border-primary';

/** Superuser: put every failed analysis job back into the queue. */
export function RetryFailedButton({ failed }: { failed: number }) {
  const { t } = useTranslation('analysisQueueActions');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const retry = useMutation({
    mutationFn: retryFailedCallAnalysis,
    onSuccess: async (r) => {
      setOpen(false);
      toast.success(t('retried', { n: r.requeued }));
      await queryClient.invalidateQueries({ queryKey: callAnalysisKeys.all });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  return (
    <>
      <button
        type="button"
        disabled={failed === 0 || retry.isPending}
        onClick={() => setOpen(true)}
        className={`${BUTTON} border-warning/45 bg-warning/10 text-warning hover:bg-warning/20`}
      >
        <Icon name="refresh" className={retry.isPending ? 'size-4 animate-spin' : 'size-4'} /> {t('retry')} ({failed})
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="primary"
        title={t('retry')}
        description={t('retryConfirm')}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        pending={retry.isPending}
        onConfirm={() => retry.mutate()}
      />
    </>
  );
}

/** Superuser: queue the answered, recorded calls of a date range (the API applies the selection rules). */
export function BackfillForm({ today, defaultFrom }: { today: string; defaultFrom: string }) {
  const { t } = useTranslation('analysisQueueActions');
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState(false);
  const valid = Boolean(from && to && from <= to && to <= today);
  const backfill = useMutation({
    mutationFn: () => backfillCallAnalysis({ from, to }),
    onSuccess: async (r) => {
      setOpen(false);
      toast.success(t('backfilled', r));
      await queryClient.invalidateQueries({ queryKey: callAnalysisKeys.all });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold text-ink">{t('backfillTitle')}</div>
      <p className="text-xs text-muted-foreground">{t('backfillHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label={t('from')}
          className={INPUT}
          value={from}
          max={today}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-muted-foreground">—</span>
        <input
          type="date"
          aria-label={t('to')}
          className={INPUT}
          value={to}
          max={today}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          type="button"
          disabled={!valid || backfill.isPending}
          onClick={() => setOpen(true)}
          className={`${BUTTON} border-primary/45 bg-primary/10 text-primary hover:bg-primary/20`}
        >
          <Icon name="import" className="size-4" /> {t('backfill')}
        </button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="primary"
        title={t('backfillTitle')}
        description={t('backfillConfirm', { from: toDmy(from), to: toDmy(to) })}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        pending={backfill.isPending}
        onConfirm={() => backfill.mutate()}
      />
    </div>
  );
}
