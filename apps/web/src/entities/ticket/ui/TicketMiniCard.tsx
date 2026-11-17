import type { Ticket } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon } from '@/shared/ui/legacy-icon';
import { STATUS_STRIPE, timeAgo } from '../lib/format';
import { TicketStatusBadge, TicketTargetBadge, UrgentBadge, personName } from './badges';

/** `.tk-mini-card` of the KDS grid. `highlight` = newly arrived (pulses until opened). */
export function TicketMiniCard({
  ticket,
  meId,
  highlight,
  onOpen,
}: {
  ticket: Ticket;
  meId: number;
  highlight: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation('ticket');
  const assignedToMe = ticket.target?.userId === meId;
  const stripe = assignedToMe ? '#0ea5e9' : ticket.isUrgent ? 'linear-gradient(180deg,#ef4444,#f97316)' : STATUS_STRIPE[ticket.status];
  const assigned = ticket.assignee
    ? t('card.accepted', { name: ticket.assignee.label })
    : ticket.completedBy
      ? t('card.completed', { name: ticket.completedBy.label })
      : ticket.rejectedBy
        ? t('card.rejected', { name: ticket.rejectedBy.label })
        : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-[14px] border border-[rgba(59,130,246,0.22)] bg-[rgba(15,23,42,0.85)] px-5 py-[18px] text-left shadow-[0_8px_24px_rgba(0,0,0,0.45)] outline-none transition-all duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        'hover:-translate-y-[3px] hover:border-[rgba(56,189,248,0.55)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.6),0_0_15px_rgba(56,189,248,0.15)] focus-visible:border-[rgba(56,189,248,0.55)]',
        assignedToMe && 'border-[rgba(56,189,248,0.45)]! bg-[linear-gradient(135deg,rgba(30,41,59,0.88)_0%,rgba(14,165,233,0.1)_100%)]!',
        highlight && (ticket.isUrgent ? 'animate-[tkUrgentGlow_1.8s_ease-in-out_infinite]' : 'animate-[tkNewGlow_2.2s_ease-in-out_infinite]'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1', ticket.isUrgent && 'shadow-[0_0_8px_rgba(239,68,68,0.8)]')}
        style={{ background: stripe }}
      />
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-[rgba(56,189,248,0.12)] px-1.5 py-0.5 font-mono text-[11.5px] font-extrabold text-[#38bdf8]">
            {ticket.code}
          </span>
          <TicketTargetBadge ticket={ticket} meId={meId} />
          {ticket.isUrgent && <UrgentBadge label={t('card.urgent')} />}
        </div>
        <TicketStatusBadge status={ticket.status} />
      </div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#e2e8f0]">
        <Icon name="user" className="size-3.5" />
        {personName(ticket.creator)}
      </div>
      <div className="my-2.5 line-clamp-3 text-[13.5px] leading-[1.4] break-words whitespace-pre-line text-[#cbd5e1]">{ticket.body}</div>
      {ticket.status === 'rejected' && ticket.rejectReason && (
        <div
          title={t('card.reasonTitle', { reason: ticket.rejectReason })}
          className="mt-[5px] flex items-center gap-[5px] rounded-md border border-dashed border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] px-2 py-[3.5px] text-[11px] leading-[1.35] font-semibold text-[#f87171]"
        >
          <Icon name="close-circle" className="size-3.5" />
          <span className="truncate">{t('card.reason', { reason: ticket.rejectReason })}</span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/5 pt-1.5 text-[11px] text-[#64748b]">
        <span className="whitespace-nowrap">{timeAgo(ticket.createdAt, t)}</span>
        <div className="flex min-w-0 items-center gap-2">
          {ticket.attachments.length > 0 && (
            <span title={t('card.files', { n: ticket.attachments.length })} className="inline-flex items-center gap-1 font-semibold text-[#38bdf8]">
              <LegacyIcon name="gallery" className="size-3.5" />
              {ticket.attachments.length}
            </span>
          )}
          {ticket.commentCount > 0 && (
            <span title={t('card.replies', { n: ticket.commentCount })} className="inline-flex items-center gap-[3px] font-semibold text-[#94a3b8]">
              <Icon name="clipboard-text" className="size-4" />
              {ticket.commentCount}
            </span>
          )}
          {assigned && (
            <span title={assigned} className="truncate font-semibold text-[#c084fc]">
              {assigned}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
