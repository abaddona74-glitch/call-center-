import { type BlockedNumber, formatUzPhone } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { blacklistKeys, blacklistQuery, syncBlacklist } from '@/entities/blocked-number';
import { AddBlockedNumberForm } from '@/features/blacklist/add-number';
import { RemoveBlockedNumberButton } from '@/features/blacklist/remove-number';
import { useRealtimeEvent } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { tashkentDate, tashkentDateTime } from '@/shared/lib/tashkent-time';
import { Icon } from '@/shared/ui/icon';

/** Today → { today: "HH:mm" }, else "DD.MM.YYYY HH:mm", in Tashkent (legacy showed UTC as local — fixed). */
function addedAt(iso: string): { today: string } | { date: string } {
  const full = tashkentDateTime(iso);
  const hm = full.slice(11, 16);
  if (full.startsWith(tashkentDate())) return { today: hm };
  const [y, m, d] = full.slice(0, 10).split('-');
  return { date: `${d}.${m}.${y} ${hm}` };
}

const STATE_STYLE: Record<BlockedNumber['syncState'], string> = {
  synced: 'border-red-500/30 bg-red-500/15 text-danger before:bg-red-500',
  pending: 'border-amber-500/30 bg-amber-500/15 text-caution before:bg-amber-500',
  error: 'border-orange-500/40 bg-orange-500/15 text-orange-400 before:bg-orange-500',
  removing: 'border-mute/30 bg-mute/10 text-mute before:bg-mute',
};

/** Blocked numbers (legacy hidden ext-114 blacklist manager, now a normal admin screen). */
export function BlacklistPage() {
  const { t } = useTranslation('blacklistPage');
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery(blacklistQuery);
  const [search, setSearch] = useState('');
  useRealtimeEvent('blacklist.changed', () => void queryClient.invalidateQueries({ queryKey: blacklistKeys.all }));

  const sync = useMutation({
    mutationFn: syncBlacklist,
    onSuccess: (r) => {
      if (!r.amiConnected) toast.warning(t('amiDown'));
      else toast.success(t('synced', { n: r.applied }));
      void queryClient.invalidateQueries({ queryKey: blacklistKeys.all });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? items.filter(
            (i) =>
              i.number.includes(q.replace(/\D/g, '') || '\u0000') ||
              formatUzPhone(i.number).toLowerCase().includes(q) ||
              i.note.toLowerCase().includes(q),
          )
        : items,
    [items, q],
  );
  const unsynced = items.some((i) => i.syncState !== 'synced');
  const exts = data?.operatorExtensions ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-red-500/30 bg-sidebar shadow-[0_30px_80px_color-mix(in_srgb,var(--shadow-color)_50%,transparent),0_0_50px_rgba(239,68,68,0.1)]">
      <div className="flex items-center justify-between gap-3 border-b border-tint/[0.08] bg-[linear-gradient(90deg,rgba(239,68,68,0.15)_0%,color-mix(in_srgb,var(--glass)_80%,transparent)_100%)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#ef4444_0%,#b91c1c_100%)] shadow-[0_4px_12px_rgba(239,68,68,0.3)]">
            <Icon name="close-circle" className="size-6 text-white" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-[17px] font-bold text-ink">
              {t('title')}
              <span className="rounded-[20px] border border-red-500/40 bg-red-500/20 px-2 py-0.5 text-[11px] font-bold text-danger-soft">
                {t('count', { n: items.length })}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-mute">{t('subtitle', { exts: exts.join(', ') || '—' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
              data?.amiConnected
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-warning/40 bg-warning/10 text-warning',
            )}
          >
            <span className={cn('size-1.5 rounded-full', data?.amiConnected ? 'bg-success' : 'bg-warning')} />
            AMI {data?.amiConnected ? t('online') : t('offline')}
          </span>
          {unsynced && (
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="inline-flex items-center gap-1 rounded-[10px] border border-tint/15 bg-tint/[0.08] px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-ink-2 hover:bg-tint/15 hover:text-ink"
            >
              <Icon name="flash" className="size-3.5" /> {t('apply')}
            </button>
          )}
          <button
            type="button"
            title={t('refreshTitle')}
            onClick={() => void queryClient.invalidateQueries({ queryKey: blacklistKeys.all })}
            className="inline-flex items-center gap-1 rounded-[10px] border border-tint/15 bg-tint/[0.08] px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-tint/15 hover:text-ink"
          >
            <Icon name="refresh" className="size-3.5" /> {t('refresh')}
          </button>
        </div>
      </div>

      {data && <AddBlockedNumberForm operatorExtensions={exts} />}

      <div className="flex items-center justify-between gap-3 border-b border-tint/[0.06] bg-sidebar/60 px-5 py-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`🔍 ${t('search')}`}
          className="max-w-[320px] flex-1 rounded-lg border border-tint/10 bg-sidebar/80 px-3 py-[7px] text-xs text-ink outline-none focus:border-red-500"
        />
        <span className="text-xs text-mute">{q ? t('found', { n: filtered.length }) : ''}</span>
      </div>

      <div className="scrollbar-visible max-h-[60vh] flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-5 py-10 text-center text-dim">
            <Icon name="timer" className="mx-auto mb-2.5 size-8" />
            {t('loading')}
          </div>
        ) : isError ? (
          <div className="px-5 py-10 text-center text-danger">⚠️ {t('loadError', { msg: error.message })}</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-dim">
            <div className="mb-2.5 text-[38px] opacity-70">✨</div>
            <div className="mb-1 text-[15px] font-semibold text-ink-2">{t('emptyTitle')}</div>
            {t('emptyText')}
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-[2] [&>th]:border-b [&>th]:border-tint/[0.08] [&>th]:bg-sidebar/95 [&>th]:px-4 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-bold [&>th]:tracking-[0.5px] [&>th]:text-mute [&>th]:uppercase">
                <th className="w-[50px]">#</th>
                <th>{t('col.phone')}</th>
                <th>{t('col.state')}</th>
                <th>{t('col.scope')}</th>
                <th>{t('col.note')}</th>
                <th>{t('col.added')}</th>
                <th className="w-[100px] text-right">{t('col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const formatted = formatUzPhone(row.number);
                return (
                  <tr
                    key={row.id}
                    className="hover:[&>td]:bg-red-500/[0.04] [&>td]:border-b [&>td]:border-tint/[0.04] [&>td]:px-4 [&>td]:py-3 [&>td]:align-middle [&>td]:text-foreground"
                  >
                    <td className="font-semibold text-dim">{i + 1}</td>
                    <td>
                      <span
                        title={t('variants', { v: row.variants.join(', ') })}
                        className="inline-flex items-center gap-1.5 font-mono text-[13px] font-bold text-danger-soft"
                      >
                        <Icon name="call" className="size-3.5" /> {formatted}
                      </span>
                    </td>
                    <td>
                      <span
                        title={row.syncError ?? undefined}
                        className={cn(
                          "inline-flex items-center gap-1 rounded border px-[7px] py-0.5 text-[11px] font-semibold before:inline-block before:size-1.5 before:rounded-full before:content-['']",
                          STATE_STYLE[row.syncState],
                        )}
                      >
                        {t(`state.${row.syncState}`)}
                      </span>
                    </td>
                    <td className="text-xs text-mute">
                      {row.scope === 'global' ? t('scopeGlobal') : t('scopeOperator', { ext: row.extension })}
                    </td>
                    <td>
                      {row.note ? (
                        <span className="max-w-[260px] text-xs break-words text-ink-2">{row.note}</span>
                      ) : (
                        <span className="text-xs text-dim italic">{t('noNote')}</span>
                      )}
                    </td>
                    <td>
                      <span
                        title={tashkentDateTime(row.createdAt)}
                        className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-mute"
                      >
                        <Icon name="timer" className="size-3" />
                        {(() => {
                          const a = addedAt(row.createdAt);
                          return 'today' in a ? t('today', { time: a.today }) : a.date;
                        })()}
                      </span>
                    </td>
                    <td className="text-right">
                      {row.syncState !== 'removing' && <RemoveBlockedNumberButton id={row.id} label={formatted} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
