import type { Ticket, TicketStatus } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon } from '@/shared/ui/legacy-icon';
import './ticket.css';

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: 'border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.18)] text-[#38bdf8]',
  accepted: 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.18)] text-[#fbbf24]',
  completed: 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.18)] text-[#34d399]',
  rejected: 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.18)] text-[#f87171]',
};

/** `.tk-status-badge.{status}` */
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useTranslation('ticket');
  return (
    <span className={cn('inline-flex items-center gap-[5px] rounded-xl border px-2 py-0.5 text-[10.5px] font-bold', STATUS_BADGE[status])}>
      {t(`status.${status}`)}
    </span>
  );
}

/** `.tk-urgent-badge` */
export function UrgentBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex animate-[tkUrgentPulse_1.8s_ease-in-out_infinite] items-center gap-1 rounded-md border border-[rgba(239,68,68,0.6)] bg-[linear-gradient(135deg,rgba(239,68,68,0.25),rgba(249,115,22,0.25))] px-[7px] py-0.5 text-[10px] font-extrabold text-[#fca5a5]',
        className,
      )}
    >
      <Icon name="flash" className="size-[13px]" />
      {label}
    </span>
  );
}

/** `.tk-target-badge.{for-me|specific|all}` */
export function TicketTargetBadge({ ticket, meId }: { ticket: Ticket; meId: number }) {
  const { t } = useTranslation('ticket');
  const base = 'inline-flex items-center gap-1 rounded-md border px-[7px] py-0.5 text-[10.5px] font-bold';
  if (!ticket.target) {
    return (
      <span title={t('card.allTitle')} className={cn(base, 'border-[rgba(148,163,184,0.22)] bg-[rgba(148,163,184,0.12)] text-[#94a3b8]')}>
        <LegacyIcon name="people" className="size-3" />
        {t('card.all')}
      </span>
    );
  }
  if (ticket.target.userId === meId) {
    return (
      <span
        title={t('card.forMeTitle')}
        className={cn(base, 'border-[rgba(56,189,248,0.45)] bg-[rgba(14,165,233,0.22)] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)]')}
      >
        <LegacyIcon name="target" className="size-3" />
        {t('card.forMe', { name: ticket.target.label })}
      </span>
    );
  }
  return (
    <span
      title={t('card.specificTitle', { name: ticket.target.label })}
      className={cn(base, 'border-[rgba(139,92,246,0.3)] bg-[rgba(139,92,246,0.16)] text-[#c084fc]')}
    >
      <LegacyIcon name="target" className="size-3" />
      {ticket.target.label}
    </span>
  );
}

/** "Name (101)" or just the name when there is no extension. */
export function personName(p: { label: string; extension: string | null } | null): string {
  if (!p) return '';
  return p.extension && !p.label.includes(p.extension) ? `${p.label} (${p.extension})` : p.label;
}
