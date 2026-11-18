import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callbackKeys, callbackPhone, dismissCallback } from '@/entities/callback';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';
import { Icon } from '@/shared/ui/icon';
import { isValidReason } from '../model/reason';

/**
 * Legacy per-card "×" (revealed on row hover). Closing a callback by hand now needs a reason,
 * which is stored and audited on the server (admin only).
 */
export function DismissCallbackButton({ id, phone }: { id: number; phone: string }) {
  const { t } = useTranslation('callbacksDismiss');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => dismissCallback(id, reason.trim()),
    onSuccess: () => {
      toast.success(t('done'));
      setOpen(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: callbackKeys.all });
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  });

  // The dialog is portaled, but React events still bubble to the card (which copies the number on click/Enter).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span className="contents" onClick={stop} onKeyDown={stop}>
      <button
        type="button"
        title={t('tooltip')}
        onClick={() => setOpen(true)}
        className="pointer-events-none ml-0 flex h-[22px] w-0 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground opacity-0 transition-[width,margin-left,opacity,background,color] duration-200 group-hover:pointer-events-auto group-hover:ml-1.5 group-hover:w-[22px] group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive [&_svg]:min-w-3"
      >
        <Icon name="close" className="size-3" />
      </button>
      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        message={t('message', { phone: callbackPhone(phone) })}
        okText={t('ok')}
        cancelText={t('cancel')}
        busy={mutation.isPending}
        okDisabled={!isValidReason(reason)}
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
    </span>
  );
}
