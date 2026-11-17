import { TICKET_FILTERS, type TicketFilter } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSessionUser } from '@/entities/session';
import {
  Kbd,
  TicketMiniCard,
  cleanupTickets,
  ticketContextQuery,
  ticketKeys,
  ticketListQuery,
  useClipboardRouter,
} from '@/entities/ticket';
import { CreateTicketModal } from '@/features/tickets/create-ticket';
import { SoundToggle, stopTitleFlash, useTicketLive } from '@/features/tickets/notifications';
import { TicketBox } from '@/widgets/ticket-box';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

const TAB_LABEL_COLOR: Partial<Record<TicketFilter, string>> = {
  mine: '#38bdf8',
  open: '#38bdf8',
  accepted: '#fbbf24',
  completed: '#34d399',
  rejected: '#f87171',
};

/** Tickets "KDS board" (legacy viewer /tickets) for operators and admins. */
export function TicketsPage() {
  const { t } = useTranslation('ticket');
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const ctx = useQuery(ticketContextQuery);
  const party = ctx.data?.party ?? 'none';
  const [filter, setFilter] = useState<TicketFilter>('all');
  const list = useQuery({ ...ticketListQuery(filter), enabled: ctx.isSuccess && party !== 'none' });
  const [openId, setOpenId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pasted, setPasted] = useState<File[]>([]);
  const [, tick] = useState(0);

  const live = useTicketLive({
    meId: user.id,
    party,
    openTicketId: openId,
    onOpen: (id) => openTicket(id),
    onDeleted: (id) => setOpenId((cur) => (cur === id ? null : cur)),
  });
  const { clearArrived } = live;

  const openTicket = useCallback(
    (id: number) => {
      setOpenId(id);
      clearArrived(id);
      stopTitleFlash();
    },
    [clearArrived],
  );

  useClipboardRouter((files) => {
    if (!ctx.data?.canCreate) return;
    setPasted(files);
    setCreateOpen(true);
  });

  // Relative times ("5 daqiqa oldin") refresh every minute.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const cleanup = useMutation({
    mutationFn: cleanupTickets,
    onSuccess: async (r) => {
      toast.success(t('cleanupDone', { n: r.removed }));
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  const stats = list.data?.stats;
  const days = ctx.data?.purgeCompletedAfterDays ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1750px]">
      {/* Header (legacy .kds-header, inside the app shell) */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[rgba(15,23,42,0.9)] px-7 py-3.5 backdrop-blur-[14px]">
        <h1 className="m-0 text-lg font-bold text-white">{t('title')}</h1>
        <div className="flex items-center gap-3">
          <SoundToggle />
          {ctx.data?.canCreate && (
            <button
              type="button"
              onClick={() => {
                setPasted([]);
                setCreateOpen(true);
              }}
              className="inline-flex min-w-64 items-center justify-center gap-2 rounded-[10px] border border-[rgba(16,185,129,0.4)] bg-[linear-gradient(135deg,#10b981_0%,#059669_100%)] px-[18px] py-[9px] text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] transition-[transform,background-color,box-shadow] duration-[140ms] hover:-translate-y-px hover:bg-[linear-gradient(135deg,#059669_0%,#047857_100%)] hover:shadow-[0_6px_18px_rgba(16,185,129,0.5)] active:scale-[0.96]"
            >
              <LegacyIcon name="add" strokeWidth={2} />
              {t('create')}
            </button>
          )}
          <LiveClock />
        </div>
      </header>

      {party === 'none' && ctx.isSuccess ? (
        <div className="rounded-xl border border-white/8 bg-[rgba(15,23,42,0.7)] px-6 py-10 text-center text-sm text-[#94a3b8]">{t('noAccess')}</div>
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between gap-3 rounded-[10px] border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.12)] px-[18px] py-2.5 text-[12.5px] font-semibold text-[#34d399]">
            <div className="flex items-center gap-2">
              <LegacyIcon name="info-circle" className="size-[18px]" />
              <span>{days > 0 ? t('banner', { days }) : t('bannerKeep')}</span>
            </div>
            {ctx.data?.canCleanup && (
              <button
                type="button"
                disabled={cleanup.isPending}
                onClick={() => {
                  if (window.confirm(t('cleanupConfirm'))) cleanup.mutate();
                }}
                className="rounded-md border border-[rgba(16,185,129,0.4)] bg-transparent px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap text-[#34d399] disabled:opacity-60"
              >
                {t('cleanup')}
              </button>
            )}
          </div>

          <div className="mb-[22px] flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[rgba(15,23,42,0.7)] px-6 py-[18px] shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-[12px]">
            <div className="flex flex-wrap items-center gap-2" role="tablist">
              {TICKET_FILTERS.map((f) => {
                const active = filter === f;
                const mine = f === 'mine';
                const label =
                  f === 'mine' ? (party === 'creator' ? t('tab.mineCreator') : t('tab.mineReceiver')) : t(`tab.${f}`);
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={mine ? (party === 'creator' ? t('tab.mineCreatorTitle') : t('tab.mineReceiverTitle')) : undefined}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'inline-flex items-center gap-[7px] rounded-[10px] border border-white/8 bg-[rgba(30,41,59,0.6)] px-4 py-2 text-[13px] font-semibold text-[#94a3b8] transition-all duration-200 hover:bg-white/10 hover:text-white',
                      active && !mine && 'border-[rgba(56,189,248,0.55)] bg-[rgba(56,189,248,0.18)] text-white shadow-[0_2px_10px_rgba(56,189,248,0.2)]',
                      active && mine && 'border-[#38bdf8] bg-[linear-gradient(135deg,#0284c7_0%,#0369a1_100%)] text-white',
                    )}
                  >
                    <span style={!active || !mine ? { color: TAB_LABEL_COLOR[f] } : undefined}>{label}</span>
                    <span
                      className={cn(
                        'rounded-[10px] px-[7px] py-px text-[11px] font-extrabold',
                        mine
                          ? active
                            ? 'bg-white text-[#0369a1]'
                            : 'bg-[rgba(14,165,233,0.25)] text-[#38bdf8]'
                          : active
                            ? 'bg-[#38bdf8] text-[#0f172a]'
                            : 'bg-white/12',
                      )}
                    >
                      {stats ? stats[f] : 0}
                    </span>
                  </button>
                );
              })}
            </div>
            {ctx.data?.canCreate && (
              <div className="flex items-center gap-2 text-[12.5px] text-[#94a3b8]">
                <span>{t('hintPaste')}</span>
                <Kbd>Ctrl + V</Kbd>
                {t('hintPaste2') && <span>{t('hintPaste2')}</span>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-[18px]">
            {list.isPending ? (
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-[170px] animate-pulse rounded-[14px] border border-[rgba(59,130,246,0.22)] bg-[rgba(15,23,42,0.85)]" />
              ))
            ) : list.isError ? (
              <div className="col-span-full py-10 text-center text-[13px] text-[#f87171]">{t('error', { message: list.error.message })}</div>
            ) : list.data.items.length === 0 ? (
              <div className="col-span-full px-5 py-10 text-center text-[13px] text-[#64748b]">
                <Icon name="clipboard-text" className="mx-auto size-4" />
                <div className="mt-2 font-semibold">{t('empty')}</div>
                <div className="mt-1 text-[11.5px] text-[#475569]">{ctx.data?.canCreate ? t('emptyCreator') : t('emptyReceiver')}</div>
              </div>
            ) : (
              list.data.items.map((ticket) => (
                <TicketMiniCard
                  key={ticket.id}
                  ticket={ticket}
                  meId={user.id}
                  highlight={live.arrived.has(ticket.id)}
                  onOpen={() => openTicket(ticket.id)}
                />
              ))
            )}
          </div>
        </>
      )}

      {ctx.data && (
        <>
          <CreateTicketModal open={createOpen} onOpenChange={setCreateOpen} maxFileMb={ctx.data.maxFileMb} initialFiles={pasted} />
          <TicketBox
            ticketId={openId}
            meId={user.id}
            assignees={ctx.data.assignees}
            maxFileMb={ctx.data.maxFileMb}
            onClose={() => setOpenId(null)}
          />
        </>
      )}
    </div>
  );
}

/** Header clock (legacy tickets page: plain text — the badge styles live only on the main page). */
function LiveClock() {
  const { t } = useTranslation('ticket');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    <div title={t('clock')} className="text-[17px] font-semibold text-white tabular-nums">
      {p(now.getHours())}:{p(now.getMinutes())}:{p(now.getSeconds())}
    </div>
  );
}
