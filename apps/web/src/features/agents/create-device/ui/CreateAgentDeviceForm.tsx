import { CreateAgentDeviceRequestSchema } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { agentKeys, createAgentDevice } from '@/entities/agent';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';

const field =
  'rounded-lg border border-white/10 bg-black/40 px-3 py-[7px] text-xs text-white outline-none focus:border-primary/60';

/** Issues a per-device key. The key is shown once, in a dialog, and never again. */
export function CreateAgentDeviceForm() {
  const { t } = useTranslation('agentsCreate');
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [extension, setExtension] = useState('');
  const [issued, setIssued] = useState<{ key: string; name: string; extension: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const body = CreateAgentDeviceRequestSchema.safeParse({ name, extension });
      if (!body.success) throw new Error(t('invalid'));
      return createAgentDevice(body.data);
    },
    onSuccess: (res) => {
      setIssued({ key: res.apiKey, name: res.device.name, extension: res.device.extension });
      setName('');
      setExtension('');
      void queryClient.invalidateQueries({ queryKey: agentKeys.devices });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <input
          className={`${field} w-[220px]`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('name')}
          maxLength={80}
        />
        <input
          className={`${field} w-[110px] font-mono`}
          value={extension}
          onChange={(e) => setExtension(e.target.value.replace(/\D/g, ''))}
          placeholder={t('extension')}
          maxLength={6}
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-[linear-gradient(135deg,#3b82f6,#6366f1)] px-4 py-[7px] text-xs font-semibold text-white disabled:opacity-60"
        >
          {t('issue')}
        </button>
      </form>
      <Dialog open={issued !== null} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="max-w-[520px] rounded-2xl border-primary/40 bg-sidebar">
          <DialogTitle className="text-base font-bold text-white">
            {t('keyTitle', { name: issued?.name, ext: issued?.extension })}
          </DialogTitle>
          <DialogDescription className="text-xs text-amber-400">{t('keyOnce')}</DialogDescription>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 p-2.5">
            <code className="flex-1 font-mono text-xs break-all text-sky-300 select-all">{issued?.key}</code>
            <button
              type="button"
              title={t('copy')}
              onClick={() => {
                if (!issued) return;
                void navigator.clipboard.writeText(issued.key).then(() => toast.success(t('copied')));
              }}
              className="rounded-md border border-white/15 bg-white/[0.06] p-2 text-slate-300 hover:text-white"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">{t('keyHowTo')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
