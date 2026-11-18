import { type CallbackSettings, CallbackSettingsSchema } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callbackKeys, saveCallbackSettings } from '@/entities/callback';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const field =
  'rounded-lg border border-tint/15 bg-sidebar/80 px-3 py-2 text-[13px] text-ink outline-none focus:border-primary/60';
const label = 'mb-1.5 block text-[12.5px] font-semibold text-mute';

/**
 * The minimum talk time that closes a callback automatically. Saved on the server (audited); applies to
 * the next calls. Working days/hours/holidays: the shared calendar (features/working-calendar).
 */
export function CallbackSettingsForm({ initial }: { initial: CallbackSettings }) {
  const { t } = useTranslation('callbacksSettings');
  const queryClient = useQueryClient();
  const [value, setValue] = useState<CallbackSettings>(initial);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = CallbackSettingsSchema.safeParse(value);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
      return saveCallbackSettings(parsed.data);
    },
    onSuccess: (saved) => {
      setError(null);
      setValue(saved);
      queryClient.setQueryData(callbackKeys.settings, saved);
      toast.success(t('saved'));
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <label>
        <span className={label}>{t('minTalk')}</span>
        <input
          type="number"
          min={1}
          max={600}
          className={cn(field, 'w-[110px]')}
          value={value.minTalkSeconds}
          onChange={(e) => setValue({ ...value, minTalkSeconds: Number(e.target.value) })}
        />
      </label>
      <p className="-mt-3 text-[11.5px] text-dim">{t('minTalkHint')}</p>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 px-3.5 py-2.5 text-[12.5px] text-danger">
          {error}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/45 bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_100%)] px-6 py-[9px] text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(99,102,241,0.35)] disabled:opacity-60"
        >
          <Icon name="tick-circle" className="size-3.5" /> {t('save')}
        </button>
      </div>
    </form>
  );
}
