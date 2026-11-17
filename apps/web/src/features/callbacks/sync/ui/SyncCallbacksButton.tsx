import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callbackKeys, syncCallbacks } from '@/entities/callback';
import { Icon } from '@/shared/ui/icon';

/** Legacy "Qayta tekshirish": re-reads the PBX CDR for calls the live feed missed. */
export function SyncCallbacksButton() {
  const { t } = useTranslation('callbacksSync');
  const queryClient = useQueryClient();
  const [spin, setSpin] = useState(false);
  const mutation = useMutation({
    mutationFn: () => syncCallbacks(48),
    onSuccess: () => {
      toast.info(t('done'));
      void queryClient.invalidateQueries({ queryKey: callbackKeys.all });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <button
      type="button"
      title={t('tooltip')}
      disabled={mutation.isPending}
      onClick={() => {
        setSpin(true);
        setTimeout(() => setSpin(false), 300);
        mutation.mutate();
      }}
      className="inline-flex size-[26px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition-all duration-150 hover:border-white/25 hover:bg-white/10 hover:text-white disabled:opacity-60"
    >
      <Icon
        name="refresh"
        className={spin ? 'size-3 rotate-180 transition-transform' : 'size-3 transition-transform'}
      />
    </button>
  );
}
