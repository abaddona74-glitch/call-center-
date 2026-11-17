import type { Ticket } from '@cc/shared';
import { formatUzPhone } from '@cc/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon } from '@/shared/ui/legacy-icon';
import { STATUS_STRIPE, dateTime, refName, timeAgo } from '../lib/format';
import { OverdueBadge, RegionBadge, TicketStatusBadge, personName } from './badges';

/**
 * `.tk-mini-card` of the KDS grid: code, region, status, citizen, text, SLA and who holds it.
 * `highlight` = newly arrived / unread (pulses until opened); `footer` = extra actions (callback queue).
 */
export function TicketMiniCard({
  ticket,
  highlight,
  onOpen,
  footer,
}: {
  ticket: Ticket;
  highlight: boolean;
  onOpen: () => void;
  footer?: ReactNode;
}) {
  const { t, i18n } = useTranslation('ticket');
  const stripe = ticket.overdue ? 'linear-gradient(180deg,#ef4444,#f97316)' : STATUS_STRIPE[ticket.status];
  const holder = ticket.assignee ? t('card.assignee', { name: ticket.assignee.label }) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-[14px] border border-[rgba(59,130,246,0.22)] bg-[rgba(15,23,42,0.85)] px-5 py-[18px] text-left shadow-[0_8px_24px_rgba(0,0,0,0.45)] outline-none transition-all duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        'hover:-translate-y-[3px] hover:border-[rgba(56,189,248,0.55)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.6),0_0_15px_rgba(56,189,248,0.15)] focus-visible:border-[rgba(56,189,248,0.55)]',
        ticket.lastContactIsMe && ticket.status === 'callback_pending' && 'border-[rgba(56,189,248,0.45)]! bg-[linear-gradient(135deg,rgba(30,41,59,0.88)_0%,rgba(14,165,233,0.1)_100%)]!',
        ticket.overdue && 'border-[rgba(239,68,68,0.45)]',
        highlight && 'animate-[tkNewGlow_2.2s_ease-in-out_infinite]',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', ticket.overdue && 'shadow-[0_0_8px_rgba(239,68,68,0.8)]')} style={{ background: stripe }} />
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded bg-[rgba(56,189,248,0.12)] px-1.5 py-0.5 font-mono text-[11.5px] font-extrabold text-[#38bdf8]">{ticket.code}</span>
          {ticket.region ? (
            <RegionBadge label={refName(ticket.region, i18n.language)} title={ticket.city ? refName(ticket.city, i18n.language) : undefined} />
          ) : (
            <RegionBadge label={t('card.noRegion')} muted />
          )}
          {ticket.unread && (
            <span className="rounded-md border border-[rgba(14,165,233,0.6)] bg-[rgba(14,165,233,0.22)] px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-[0.5px] text-[#38bdf8]">
              {t('card.unread')}
            </span>
          )}
          {ticket.overdue && <OverdueBadge label={t('card.overdue')} />}
        </div>
        <TicketStatusBadge status={ticket.status} />
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[#e2e8f0]">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="call" className="size-3.5 text-[#38bdf8]" />
          {ticket.customerPhone ? formatUzPhone(ticket.customerPhone) : '—'}
        </span>
        {ticket.customerName && (
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
            <Icon name="user" className="size-3.5" />
            {ticket.customerName}
          </span>
        )}
      </div>
      {ticket.category && <div className="text-[11px] font-semibold text-[#94a3b8]">{refName(ticket.category, i18n.language)}</div>}
      <div className="my-2.5 line-clamp-3 text-[13.5px] leading-[1.4] break-words whitespace-pre-line text-[#cbd5e1]">{ticket.description}</div>
      {ticket.status === 'callback_pending' && ticket.resolution && (
        <div
          className={cn(
            'mt-[5px] flex items-center gap-[5px] rounded-md border border-dashed px-2 py-[3.5px] text-[11px] leading-[1.35] font-semibold',
            ticket.resolution === 'done'
              ? 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.12)] text-[#34d399]'
              : 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[#f87171]',
          )}
          title={ticket.resolutionNote ?? undefined}
        >
          <Icon name={ticket.resolution === 'done' ? 'tick-circle' : 'close-circle'} className="size-3.5" />
          <span className="truncate">
            {t(`resolution.${ticket.resolution}`)}
            {ticket.resolutionNote ? `: ${ticket.resolutionNote}` : ''}
          </span>
        </div>
      )}
      {ticket.lastContact && ticket.status === 'callback_pending' && (
        <div className={cn('mt-1.5 text-[11px] font-semibold', ticket.lastContactIsMe ? 'text-[#38bdf8]' : 'text-[#94a3b8]')}>
          {ticket.lastContactIsMe ? `★ ${t('card.yourCitizen')}` : t('card.lastContact', { name: personName(ticket.lastContact) })}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/5 pt-1.5 text-[11px] text-[#64748b]">
        <span className="whitespace-nowrap" title={dateTime(ticket.createdAt)}>
          {timeAgo(ticket.createdAt, t)} · {ticket.creator.label}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {ticket.dueAt && ticket.status !== 'closed' && !ticket.resolvedAt && (
            <span className={cn('whitespace-nowrap', ticket.overdue ? 'font-bold text-[#f87171]' : '')}>{t('card.due', { date: dateTime(ticket.dueAt) })}</span>
          )}
          {ticket.callbackAttempts > 0 && <span className="whitespace-nowrap text-[#fbbf24]">{t('card.attempts', { n: ticket.callbackAttempts })}</span>}
          {ticket.attachmentCount > 0 && (
            <span title={t('card.files', { n: ticket.attachmentCount })} className="inline-flex items-center gap-1 font-semibold text-[#38bdf8]">
              <LegacyIcon name="gallery" className="size-3.5" />
              {ticket.attachmentCount}
            </span>
          )}
          {ticket.commentCount > 0 && (
            <span title={t('card.replies', { n: ticket.commentCount })} className="inline-flex items-center gap-[3px] font-semibold text-[#94a3b8]">
              <Icon name="clipboard-text" className="size-4" />
              {ticket.commentCount}
            </span>
          )}
          {holder && (
            <span title={holder} className="truncate font-semibold text-[#c084fc]">
              {holder}
            </span>
          )}
        </div>
      </div>
      {footer && (
        // Footer actions must not open the card.
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </div>
  );
}
