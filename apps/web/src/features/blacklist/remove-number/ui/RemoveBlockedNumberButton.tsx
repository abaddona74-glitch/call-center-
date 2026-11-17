import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { blacklistKeys, removeBlockedNumber } from '@/entities/blocked-number';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';
import { Icon } from '@/shared/ui/icon';

export function RemoveBlockedNumberButton({ id, label }: { id: number; label: string }) {
  const { t } = useTranslation('blacklistRemove');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => removeBlockedNumber(id),
    onSuccess: () => {
      toast.info(t('done', { number: label }));
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: blacklistKeys.all });
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  });
  return (
    <>
      <button
        type="button"
        title={t('tooltip')}
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-red-500/25 bg-red-500/[0.12] px-2.5 py-[5px] text-xs text-red-300 transition-all hover:border-red-500 hover:bg-red-500 hover:text-white hover:shadow-[0_2px_8px_rgba(239,68,68,0.4)]"
      >
        <Icon name="trash" className="size-[13px]" /> {t('delete')}
      </button>
      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('tooltip')}
        message={t('confirm', { number: label })}
        okText={t('ok')}
        cancelText={t('cancel')}
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate()}
      />
    </>
  );
}
