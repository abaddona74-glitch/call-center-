import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { agentKeys, revokeAgentDevice } from '@/entities/agent';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';

export function RevokeAgentDeviceButton({ id, name }: { id: number; name: string }) {
  const { t } = useTranslation('agentsRevoke');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => revokeAgentDevice(id),
    onSuccess: () => {
      toast.success(t('done'));
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-500/25 bg-red-500/[0.12] px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500 hover:text-white"
      >
        {t('revoke')}
      </button>
      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('revoke')}
        message={t('confirm', { name })}
        okText={t('ok')}
        cancelText={t('cancel')}
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate()}
      />
    </>
  );
}
