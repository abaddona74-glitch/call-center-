import { CreateAgentReleaseRequestSchema } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { agentKeys, publishAgentRelease } from '@/entities/agent';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';

/** Legacy "Yangi Versiya E'lon Qilish" card body: version input + publish with confirmation. */
export function PublishReleaseForm() {
  const { t } = useTranslation('agentsRelease');
  const queryClient = useQueryClient();
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const mutation = useMutation({
    mutationFn: () => publishAgentRelease({ version: version.trim(), releaseNotes: notes }),
    onSuccess: (r) => {
      toast.success(t('done', { v: r.version }));
      setConfirm(false);
      setVersion('');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = () => {
    if (!CreateAgentReleaseRequestSchema.safeParse({ version: version.trim() }).success) {
      toast.warning(t('required'));
      return;
    }
    setConfirm(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder={t('placeholder')}
          className="flex-1 rounded-lg border border-border bg-black/40 px-3 py-[7px] text-xs text-white outline-none"
        />
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-[linear-gradient(135deg,#3b82f6,#6366f1)] px-4 py-[7px] text-xs font-semibold text-white"
        >
          {t('publish')}
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder={t('notes')}
        className="resize-y rounded-lg border border-border bg-black/40 px-3 py-[7px] text-xs text-white outline-none"
      />
      <p className="text-[11px] text-slate-500">{t('hint')}</p>
      <DangerConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('publish')}
        message={t('confirm', { v: version.trim() })}
        okText={t('ok')}
        cancelText={t('cancel')}
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate()}
      />
    </div>
  );
}
