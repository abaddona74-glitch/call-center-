import { AddBlockedNumberRequestSchema, type BlacklistScope } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { addBlockedNumber, blacklistKeys } from '@/entities/blocked-number';
import { Icon } from '@/shared/ui/icon';

const QUICK_NOTES = ['bully', 'spam', 'dropper', 'wrong'] as const;

const field =
  'w-full rounded-[10px] border border-white/[0.12] bg-sidebar/80 px-3.5 py-3 text-sm text-white outline-none transition-[border-color,box-shadow] duration-200 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.2)]';

/** Legacy "bl-add-panel": phone, reason, scope (operator list or everyone), quick notes. */
export function AddBlockedNumberForm({ operatorExtensions }: { operatorExtensions: string[] }) {
  const { t } = useTranslation('blacklistAdd');
  const queryClient = useQueryClient();
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<string>(operatorExtensions[0] ?? 'global');

  const mutation = useMutation({
    mutationFn: () => {
      const scope: BlacklistScope = target === 'global' ? 'global' : 'operator';
      const parsed = AddBlockedNumberRequestSchema.safeParse({
        number,
        note,
        scope,
        extension: scope === 'operator' ? target : null,
      });
      if (!parsed.success) throw new Error(t('invalid'));
      return addBlockedNumber({ number, note, scope, extension: scope === 'operator' ? target : null });
    },
    onSuccess: (row) => {
      if (row.syncState === 'synced') toast.success(t('done'));
      else toast.warning(t('pending'));
      setNumber('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: blacklistKeys.all });
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  });

  return (
    <form
      className="border-b border-white/[0.06] bg-sidebar/70 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-300">➕ {t('title')}</div>
      <div className="grid grid-cols-1 items-center gap-2.5 md:grid-cols-[1.5fr_2fr_auto_auto]">
        <input
          className={field}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder={t('phone')}
          autoComplete="off"
          autoFocus
        />
        <input
          className={field}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('note')}
          maxLength={200}
          autoComplete="off"
        />
        <select
          className={`${field} cursor-pointer bg-sidebar pr-3`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          title={t('scope')}
        >
          {operatorExtensions.map((ext) => (
            <option key={ext} value={ext}>
              {t('onlyFor', { ext })}
            </option>
          ))}
          <option value="global">{t('global')}</option>
        </select>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-red-400 bg-[linear-gradient(135deg,#ef4444_0%,#dc2626_100%)] px-[18px] py-2.5 text-[13px] font-bold whitespace-nowrap text-white shadow-[0_4px_14px_rgba(239,68,68,0.3)] transition-all hover:-translate-y-px hover:bg-[linear-gradient(135deg,#dc2626_0%,#b91c1c_100%)] disabled:opacity-60"
        >
          <Icon name="close-circle" className="size-4" />
          {mutation.isPending ? t('adding') : t('block')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500">{t('quick')}</span>
        {QUICK_NOTES.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setNote(t(`chips.${k}.note`))}
            className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 transition-all hover:border-red-500/30 hover:bg-red-500/15 hover:text-red-300"
          >
            {t(`chips.${k}.label`)}
          </button>
        ))}
      </div>
    </form>
  );
}
