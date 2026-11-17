import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { contactKeys, deleteContact } from '@/entities/contact';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';
import { Icon } from '@/shared/ui/icon';

/** Row "trash" button of the clients table with the legacy confirm dialog. */
export function DeleteContactButton({ phone, className }: { phone: string; className?: string }) {
  const { t } = useTranslation('contactsDelete');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => deleteContact(phone),
    onSuccess: () => {
      toast.success(t('done'));
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  });
  return (
    <>
      <button type="button" title={t('tooltip')} onClick={() => setOpen(true)} className={className}>
        <Icon name="trash" className="size-3.5" />
      </button>
      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('tooltip')}
        message={t('message', { phone })}
        okText={t('ok')}
        cancelText={t('cancel')}
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate()}
      />
    </>
  );
}
