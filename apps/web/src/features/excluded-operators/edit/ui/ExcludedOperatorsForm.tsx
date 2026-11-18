import type { ExcludedOperatorsInfo } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { excludedOperatorsKeys, saveExcludedOperators } from '@/entities/excluded-operator';
import { liveSnapshotQuery } from '@/entities/telephony';
import { errorText } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { SettingsButton, SettingsInput } from '@/shared/ui/settings-panel';
import { matchesSearch, withLiveOperators } from '../model/choices';
import { invalidateExcludedDependents } from '../model/use-excluded-operators-sync';

/**
 * Legacy "Statistikadan chiqarilgan operatorlar": search, a grid of operator checkboxes, "Ro'yxatni saqlash".
 * Checked operators disappear from the operators board, the per-operator statistics and the Excel report.
 */
export function ExcludedOperatorsForm({ initial }: { initial: ExcludedOperatorsInfo }) {
  const { t } = useTranslation('excludedOperatorsForm');
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(initial.extensions));
  const [search, setSearch] = useState('');
  const { data: live } = useQuery({ ...liveSnapshotQuery, select: (s) => s.operators });

  const choices = useMemo(() => withLiveOperators(initial.operators, live), [initial.operators, live]);
  const visible = choices.filter((c) => matchesSearch(c, search));

  const mutation = useMutation({
    mutationFn: () => saveExcludedOperators({ extensions: [...selected] }),
    onSuccess: (saved) => {
      queryClient.setQueryData(excludedOperatorsKeys.all, saved);
      setSelected(new Set(saved.extensions));
      invalidateExcludedDependents(queryClient);
      toast.success(t('saved'));
    },
    onError: (err) => toast.error(errorText(err, t('failed'))),
  });

  const toggle = (ext: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext);
      else next.add(ext);
      return next;
    });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <SettingsInput
        type="search"
        aria-label={t('search')}
        placeholder={t('search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {!initial.directoryAvailable && <p className="text-[11.5px] text-[#fbbf24]">{t('noDirectory')}</p>}

      <div className="rounded-[10px] border border-white/[0.07] bg-[rgba(15,23,42,0.35)] p-1.5">
        {visible.length === 0 ? (
          <div className="p-3 text-center text-[13px] text-[#94a3b8]">{t('empty')}</div>
        ) : (
          <div className="grid max-h-[340px] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 overflow-y-auto p-1">
            {visible.map((op) => {
              const checked = selected.has(op.extension);
              return (
                <label
                  key={op.extension}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 transition-all hover:border-white/15 hover:bg-white/[0.05]"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 cursor-pointer accent-[#ef4444]"
                    checked={checked}
                    onChange={() => toggle(op.extension)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-[#f1f5f9]">
                      {op.name ?? t('operator', { ext: op.extension })} ({op.extension})
                    </div>
                    <div
                      className={cn(
                        'flex items-center gap-1 text-[11px] font-medium',
                        checked ? 'text-[#ef4444]' : 'text-[#94a3b8]',
                      )}
                    >
                      <Icon
                        name={checked ? 'close-circle' : 'tick-circle'}
                        className={cn('size-3 shrink-0', checked ? 'text-[#ef4444]' : 'text-[#22c55e]')}
                      />
                      {checked ? t('excluded') : t('included')}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[#94a3b8]">{t('count', { count: selected.size })}</span>
        <SettingsButton type="submit" disabled={mutation.isPending}>
          <Icon name="tick-circle" className="size-4" /> {t('save')}
        </SettingsButton>
      </div>
    </form>
  );
}
