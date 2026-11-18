import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callbackKeys, dismissAllCallbacks } from '@/entities/callback';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';
import { Icon } from '@/shared/ui/icon';

/** Legacy red trash "clear all": now closes only open callbacks of the selected day/all, with a reason. */
export function DismissAllCallbacksButton({ count, date }: { count: number; date: 'today' | 'all' }) {
  const { t } = useTranslation('callbacksDismissAll');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => dismissAllCallbacks(reason.trim(), date),
    onSuccess: () => {
      toast.success(t('done'));
      setOpen(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: callbackKeys.all });
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  });
  if (count <= 0) return null;

  return (
    <>
      <button
        type="button"
        title={t('tooltip')}
        onClick={() => setOpen(true)}
        className="inline-flex size-[26px] items-center justify-center rounded-lg border border-tint/10 bg-tint/[0.04] text-destructive transition-all duration-150 hover:border-tint/25 hover:bg-tint/10"
      >
        <Icon name="trash" className="size-3" />
      </button>
      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('tooltip')}
        message={t('message', { count })}
        okText={t('ok')}
        cancelText={t('cancel')}
        busy={mutation.isPending}
        okDisabled={reason.trim().length < 3}
        onConfirm={() => mutation.mutate()}
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          autoFocus
          placeholder={t('reasonPlaceholder')}
          className="mb-4 w-full resize-none rounded-lg border border-tint/15 bg-sidebar/80 px-3 py-2 text-left text-[13px] text-ink outline-none placeholder:text-muted-foreground focus:border-destructive"
        />
      </DangerConfirmDialog>
    </>
  );
}
