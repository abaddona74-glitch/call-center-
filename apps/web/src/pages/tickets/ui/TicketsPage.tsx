import { TICKET_STATUSES, type TicketContext, type TicketStatus, type TicketView } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KdsInput,
  KdsSelect,
  TicketMiniCard,
  refName,
  ticketContextQuery,
  ticketDirectoriesQuery,
  ticketListQuery,
  useClipboardRouter,
} from '@/entities/ticket';
import { CallbackCallButton, CallbackOutcomeModal } from '@/features/tickets/callback-call';
import { CreateTicketModal } from '@/features/tickets/create-ticket';
import { SoundToggle, stopTitleFlash, useTicketLive } from '@/features/tickets/notifications';
import { TicketBox } from '@/widgets/ticket-box';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

/** Which list tabs each kind of user gets, in order (the first is the default). */
function viewsFor(ctx: TicketContext | undefined): TicketView[] {
  switch (ctx?.kind) {
    case 'operator':
      return ['mine', 'callback'];
    case 'executive':
      return ['queue', 'mine', 'all'];
    case 'superuser':
      return ['all', 'queue', 'mine', 'callback', 'triage'];
    case 'observer':
      return ['all', 'queue', 'callback'];
    default:
      return [];
  }
}

const VIEW_COLOR: Record<TicketView, string> = {
  all: '#e2e8f0',
  mine: '#38bdf8',
  queue: '#38bdf8',
  callback: '#5eead4',
  triage: '#fbbf24',
};

/**
 * Tickets board (legacy KDS look): role-specific tabs — operator: mine + callback queue; executive: region
 * queue (unread) + my work + all of my regions; superuser: everything + triage. Filters, SLA highlighting.
 */
export function TicketsPage({
  view: viewParam,
  openId,
  onSearch,
}: {
  view?: TicketView;
  openId?: number;
  onSearch: (s: { view?: TicketView; open?: number }) => void;
}) {
  const { t, i18n } = useTranslation('ticket');
  const ctx = useQuery(ticketContextQuery);
  const dirs = useQuery(ticketDirectoriesQuery);
  const views = viewsFor(ctx.data);
  const view: TicketView = viewParam && views.includes(viewParam) ? viewParam : (views[0] ?? 'all');
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [regionId, setRegionId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [pasted, setPasted] = useState<File[]>([]);
  const [outcomeFor, setOutcomeFor] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const list = useQuery({
    ...ticketListQuery({
      view,
      status: status || undefined,
      regionId: regionId ? Number(regionId) : undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      overdue: overdue || undefined,
      q: q || undefined,
    }),
    enabled: ctx.isSuccess && ctx.data.kind !== 'none',
  });

  const openTicket = useCallback(
    (id: number | null) => {
      onSearch({ view, open: id ?? undefined });
      stopTitleFlash();
    },
    [onSearch, view],
  );
  const live = useTicketLive({ openTicketId: openId ?? null, onRevoked: (id) => id === openId && openTicket(null) });
  const { clearArrived } = live;
  useEffect(() => {
    if (openId) clearArrived(openId);
  }, [openId, clearArrived]);

  useClipboardRouter((files) => {
    if (!ctx.data?.capabilities.create) return;
    setPasted(files);
    setCreateOpen(true);
  });

  // Relative times ("5 daqiqa oldin") and SLA highlighting refresh every minute.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const c = ctx.data;
  const counts = list.data?.counts;
  const regionOptions = (dirs.data?.regions ?? []).filter(
    (r) => c?.capabilities.viewAll || c?.regionIds.includes(r.id),
  );
  const viewLabel = (v: TicketView) =>
    v === 'mine'
      ? c?.kind === 'operator'
        ? t('view.mineOperator')
        : c?.kind === 'executive'
          ? t('view.mineExecutive')
          : t('view.mineSuperuser')
      : t(`view.${v}`);

  return (
    <div className="mx-auto w-full max-w-[1750px]">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[rgba(15,23,42,0.9)] px-7 py-3.5 backdrop-blur-[14px]">
        <div>
          <h1 className="m-0 text-lg font-bold text-white">{t('title')}</h1>
          {c && <p className="m-0 text-xs text-[#94a3b8]">{t(`subtitle.${c.kind}`)}</p>}
        </div>
        <div className="flex items-center gap-3">
          <SoundToggle />
          {c?.capabilities.reports && (
            <Link
              to="/tickets/reports"
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.15)] px-3.5 py-[9px] text-[13px] font-bold text-[#38bdf8] hover:bg-[rgba(56,189,248,0.28)] hover:text-white"
            >
              <Icon name="chart" className="size-4" />
              {t('reports')}
            </Link>
          )}
          {c?.capabilities.create && (
            <button
              type="button"
              onClick={() => {
                setPasted([]);
                setCreateOpen(true);
              }}
              className="inline-flex min-w-56 items-center justify-center gap-2 rounded-[10px] border border-[rgba(16,185,129,0.4)] bg-[linear-gradient(135deg,#10b981_0%,#059669_100%)] px-[18px] py-[9px] text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] transition-[transform,background-color,box-shadow] duration-[140ms] hover:-translate-y-px hover:bg-[linear-gradient(135deg,#059669_0%,#047857_100%)] hover:shadow-[0_6px_18px_rgba(16,185,129,0.5)] active:scale-[0.96]"
            >
              <LegacyIcon name="add" strokeWidth={2} />
              {t('create')}
            </button>
          )}
          <LiveClock />
        </div>
      </header>

      {c?.kind === 'none' ? (
        <Notice>{t('noAccess')}</Notice>
      ) : (
        <>
          {c?.kind === 'executive' && c.regionIds.length === 0 && <Notice tone="warn">{t('noRegions')}</Notice>}

          <div className="mb-[22px] flex flex-col gap-4 rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[rgba(15,23,42,0.7)] px-6 py-[18px] shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-[12px]">
            <div className="flex flex-wrap items-center gap-2" role="tablist">
              {views.map((v) => {
                const active = view === v;
                const n = counts ? counts[v] : 0;
                return (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onSearch({ view: v })}
                    className={cn(
                      'inline-flex items-center gap-[7px] rounded-[10px] border border-white/8 bg-[rgba(30,41,59,0.6)] px-4 py-2 text-[13px] font-semibold text-[#94a3b8] transition-all duration-200 hover:bg-white/10 hover:text-white',
                      active && 'border-[#38bdf8] bg-[linear-gradient(135deg,#0284c7_0%,#0369a1_100%)] text-white',
                    )}
                  >
                    <span style={!active ? { color: VIEW_COLOR[v] } : undefined}>{viewLabel(v)}</span>
                    <span
                      className={cn(
                        'rounded-[10px] px-[7px] py-px text-[11px] font-extrabold',
                        active ? 'bg-white text-[#0369a1]' : 'bg-white/12',
                      )}
                    >
                      {n}
                    </span>
                    {v === 'callback' && (counts?.callbackOverdue ?? 0) > 0 && (
                      <span
                        title={t('card.callbackOverdue')}
                        className="rounded-[10px] bg-[#ef4444] px-[6px] py-px text-[10px] font-extrabold text-white"
                      >
                        {t('callback.overdueCount', { n: counts?.callbackOverdue })}
                      </span>
                    )}
                    {v === 'queue' && c?.capabilities.regionAlerts && c.unread > 0 && (
                      <span className="rounded-[10px] bg-[#ef4444] px-[6px] py-px text-[10px] font-extrabold text-white">
                        {t('unread', { n: c.unread })}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={overdue}
                onClick={() => setOverdue((o) => !o)}
                className={cn(
                  'ml-auto inline-flex items-center gap-[7px] rounded-[10px] border px-4 py-2 text-[13px] font-semibold transition-all duration-200',
                  overdue
                    ? 'border-[rgba(239,68,68,0.6)] bg-[rgba(239,68,68,0.2)] text-[#fca5a5]'
                    : 'border-white/8 bg-[rgba(30,41,59,0.6)] text-[#f87171] hover:bg-white/10',
                )}
              >
                <Icon name="timer" className="size-4" />
                {t('filter.overdue')}
                <span className="rounded-[10px] bg-white/12 px-[7px] py-px text-[11px] font-extrabold">
                  {counts?.overdue ?? 0}
                </span>
              </button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <KdsInput
                value={search}
                placeholder={t('filter.search')}
                maxLength={60}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('filter.search')}
              />
              <KdsSelect
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus | '')}
                aria-label={t('filter.allStatuses')}
              >
                <option value="">{t('filter.allStatuses')}</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </KdsSelect>
              <KdsSelect
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                aria-label={t('filter.allRegions')}
                disabled={regionOptions.length < 2 && !c?.capabilities.viewAll}
              >
                <option value="">{t('filter.allRegions')}</option>
                {regionOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {refName(r, i18n.language)}
                  </option>
                ))}
              </KdsSelect>
              <KdsSelect
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label={t('filter.allCategories')}
              >
                <option value="">{t('filter.allCategories')}</option>
                {(dirs.data?.categories ?? []).map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {refName(cat, i18n.language)}
                  </option>
                ))}
              </KdsSelect>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-[18px]">
            {list.isPending ? (
              Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="h-[170px] animate-pulse rounded-[14px] border border-[rgba(59,130,246,0.22)] bg-[rgba(15,23,42,0.85)]"
                />
              ))
            ) : list.isError ? (
              <div className="col-span-full py-10 text-center text-[13px] text-[#f87171]">
                {t('error', { message: list.error.message })}
              </div>
            ) : list.data.items.length === 0 ? (
              <div className="col-span-full px-5 py-10 text-center text-[13px] text-[#64748b]">
                <Icon name="clipboard-text" className="mx-auto size-4" />
                <div className="mt-2 font-semibold">{t('empty')}</div>
                {c && <div className="mt-1 text-[11.5px] text-[#475569]">{t(`emptyHint.${c.kind}`)}</div>}
              </div>
            ) : (
              list.data.items.map((ticket) => (
                <TicketMiniCard
                  key={ticket.id}
                  ticket={ticket}
                  highlight={ticket.unread || live.arrived.has(ticket.id)}
                  onOpen={() => openTicket(ticket.id)}
                  footer={
                    view === 'callback' && (ticket.actions.call || ticket.actions.recordOutcome) ? (
                      <>
                        {ticket.actions.call && (
                          <CallbackCallButton ticketId={ticket.id} compact onCalled={() => setOutcomeFor(ticket.id)} />
                        )}
                        {ticket.actions.recordOutcome && (
                          <button
                            type="button"
                            onClick={() => setOutcomeFor(ticket.id)}
                            className="text-xs font-semibold text-[#c084fc] hover:underline"
                          >
                            {t('box.outcome')}
                          </button>
                        )}
                      </>
                    ) : undefined
                  }
                />
              ))
            )}
          </div>
        </>
      )}

      {c && (
        <>
          <CreateTicketModal
            open={createOpen}
            onOpenChange={setCreateOpen}
            maxFileMb={c.maxFileMb}
            initialFiles={pasted}
            onCreated={(id) => openTicket(id)}
          />
          <TicketBox ticketId={openId ?? null} maxFileMb={c.maxFileMb} onClose={() => openTicket(null)} />
          <CallbackOutcomeModal ticketId={outcomeFor} open={outcomeFor !== null} onClose={() => setOutcomeFor(null)} />
        </>
      )}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div
      className={cn(
        'mb-5 rounded-xl border px-6 py-4 text-center text-sm',
        tone === 'warn'
          ? 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.1)] text-[#fbbf24]'
          : 'border-white/8 bg-[rgba(15,23,42,0.7)] py-10 text-[#94a3b8]',
      )}
    >
      {children}
    </div>
  );
}

/** Header clock (legacy tickets page). */
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
