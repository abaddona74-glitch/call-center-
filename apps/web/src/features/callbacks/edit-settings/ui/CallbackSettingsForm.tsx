import { type CallbackSettings, CallbackSettingsSchema } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callbackKeys, saveCallbackSettings } from '@/entities/callback';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const field =
  'rounded-lg border border-white/15 bg-sidebar/80 px-3 py-2 text-[13px] text-white outline-none focus:border-primary/60 [color-scheme:dark]';
const label = 'mb-1.5 block text-[12.5px] font-semibold text-slate-400';

/**
 * Working days/hours and public holidays used to mark callbacks "after hours", plus the minimum talk
 * time that closes a callback. Saved on the server (audited); applies to the next calls.
 */
export function CallbackSettingsForm({ initial }: { initial: CallbackSettings }) {
  const { t } = useTranslation('callbacksSettings');
  const queryClient = useQueryClient();
  const [value, setValue] = useState<CallbackSettings>(initial);
  const [newHoliday, setNewHoliday] = useState('');
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

  const toggleDay = (d: number) =>
    setValue((v) => ({
      ...v,
      workDays: v.workDays.includes(d) ? v.workDays.filter((x) => x !== d) : [...v.workDays, d].sort((a, b) => a - b),
    }));

  const addHoliday = () => {
    if (!newHoliday || value.holidays.includes(newHoliday)) return;
    setValue((v) => ({ ...v, holidays: [...v.holidays, newHoliday].sort() }));
    setNewHoliday('');
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div>
        <span className={label}>{t('workDays')}</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={value.workDays.includes(d)}
              onClick={() => toggleDay(d)}
              className={cn(
                'min-w-[52px] rounded-[20px] border border-white/[0.12] bg-white/5 px-3 py-[5px] text-xs font-medium text-slate-500 transition-all hover:text-white',
                value.workDays.includes(d) &&
                  'border-primary/55 bg-[linear-gradient(135deg,rgba(99,102,241,0.3),rgba(79,70,229,0.2))] font-semibold text-indigo-300',
              )}
            >
              {t(`day.${d}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label>
          <span className={label}>{t('start')}</span>
          <input
            type="time"
            className={field}
            value={value.workStart}
            onChange={(e) => setValue({ ...value, workStart: e.target.value })}
          />
        </label>
        <label>
          <span className={label}>{t('end')}</span>
          <input
            type="time"
            className={field}
            value={value.workEnd}
            onChange={(e) => setValue({ ...value, workEnd: e.target.value })}
          />
        </label>
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
      </div>
      <p className="-mt-3 text-[11.5px] text-slate-500">{t('hoursHint')}</p>

      <div>
        <span className={label}>{t('holidays')}</span>
        <div className="mb-2.5 flex gap-2">
          <input type="date" className={field} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} />
          <button
            type="button"
            onClick={addHoliday}
            disabled={!newHoliday}
            className="rounded-lg border border-white/15 bg-white/[0.08] px-3.5 text-xs font-semibold text-slate-300 hover:bg-white/15 disabled:opacity-50"
          >
            {t('add')}
          </button>
        </div>
        {value.holidays.length === 0 ? (
          <p className="text-xs text-slate-500">{t('noHolidays')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.holidays.map((h) => (
              <span
                key={h}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/15 py-1 pr-1 pl-2.5 text-xs font-semibold text-amber-400"
              >
                {h.split('-').reverse().join('.')}
                <button
                  type="button"
                  aria-label={t('remove')}
                  onClick={() => setValue((v) => ({ ...v, holidays: v.holidays.filter((x) => x !== h) }))}
                  className="rounded p-0.5 hover:bg-amber-500/25"
                >
                  <Icon name="close" className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 px-3.5 py-2.5 text-[12.5px] text-red-400">
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
