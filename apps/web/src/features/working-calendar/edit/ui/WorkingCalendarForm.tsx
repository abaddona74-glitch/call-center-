import { type WorkingCalendarInfo, type WorkingCalendarInput, WorkingCalendarInputSchema } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { saveWorkingCalendar, workingCalendarKeys } from '@/entities/working-calendar';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const field =
  'rounded-lg border border-white/15 bg-sidebar/80 px-3 py-2 text-[13px] text-white outline-none focus:border-primary/60 [color-scheme:dark]';
const label = 'mb-1.5 block text-[12.5px] font-semibold text-slate-400';

/** "MM-DD" (yearly) sorts before "YYYY-MM-DD"; inside each kind by date. */
const sortHolidays = (list: string[]) =>
  [...list].sort((a, b) => (a.length === b.length ? a.localeCompare(b) : a.length - b.length));

/** "03-21" → "21.03", "2026-03-20" → "20.03.2026". */
const showHoliday = (h: string) => h.split('-').reverse().join('.');

const toInput = ({ days, start, end, holidays }: WorkingCalendarInfo): WorkingCalendarInput => ({
  days,
  start,
  end,
  holidays,
});

/**
 * The one working calendar: weekdays, hours and public holidays. Applies at once to statistics
 * ("working hours"), callbacks ("after hours") and ticket deadlines. Saved on the server (audited).
 */
export function WorkingCalendarForm({ initial }: { initial: WorkingCalendarInfo }) {
  const { t } = useTranslation('workingCalendarForm');
  const queryClient = useQueryClient();
  const [value, setValue] = useState<WorkingCalendarInput>(() => toInput(initial));
  const [newHoliday, setNewHoliday] = useState('');
  const [yearly, setYearly] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = WorkingCalendarInputSchema.safeParse(value);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
      return saveWorkingCalendar(parsed.data);
    },
    onSuccess: (saved) => {
      setError(null);
      setValue(toInput(saved));
      queryClient.setQueryData(workingCalendarKeys.all, saved);
      // statistics computed with the old calendar
      void queryClient.invalidateQueries({ queryKey: ['calls'] });
      toast.success(t('saved'));
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleDay = (d: number) =>
    setValue((v) => ({
      ...v,
      days: v.days.includes(d) ? v.days.filter((x) => x !== d) : [...v.days, d].sort((a, b) => a - b),
    }));

  const holidayToAdd = newHoliday ? (yearly ? newHoliday.slice(5) : newHoliday) : '';
  const addHoliday = () => {
    if (!holidayToAdd || value.holidays.includes(holidayToAdd)) return;
    setValue((v) => ({ ...v, holidays: sortHolidays([...v.holidays, holidayToAdd]) }));
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
              aria-pressed={value.days.includes(d)}
              onClick={() => toggleDay(d)}
              className={cn(
                'min-w-[52px] rounded-[20px] border border-white/[0.12] bg-white/5 px-3 py-[5px] text-xs font-medium text-slate-500 transition-all hover:text-white',
                value.days.includes(d) &&
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
            value={value.start}
            onChange={(e) => setValue({ ...value, start: e.target.value })}
          />
        </label>
        <label>
          <span className={label}>{t('end')}</span>
          <input
            type="time"
            className={field}
            value={value.end}
            onChange={(e) => setValue({ ...value, end: e.target.value })}
          />
        </label>
      </div>
      <p className="-mt-3 text-[11.5px] text-slate-500">{t('hoursHint')}</p>

      <div>
        <span className={label}>{t('holidays')}</span>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label={t('holidayDate')}
            className={field}
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
            {t('yearly')}
          </label>
          <button
            type="button"
            onClick={addHoliday}
            disabled={!holidayToAdd}
            className="rounded-lg border border-white/15 bg-white/[0.08] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/15 disabled:opacity-50"
          >
            {t('add')}
          </button>
        </div>
        <p className="mb-2.5 text-[11.5px] text-slate-500">{t('holidaysHint')}</p>
        {value.holidays.length === 0 ? (
          <p className="text-xs text-slate-500">{t('noHolidays')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.holidays.map((h) => (
              <span
                key={h}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/15 py-1 pr-1 pl-2.5 text-xs font-semibold text-amber-400"
              >
                {showHoliday(h)}
                {h.length === 5 && <span className="font-normal text-amber-400/70">· {t('everyYear')}</span>}
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
