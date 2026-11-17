import type { TicketStatus } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import './ticket.css';

const STATUS_BADGE: Record<TicketStatus, string> = {
  new: 'border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.18)] text-[#38bdf8]',
  assigned: 'border-[rgba(167,139,250,0.35)] bg-[rgba(139,92,246,0.18)] text-[#c4b5fd]',
  in_progress: 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.18)] text-[#fbbf24]',
  done: 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.18)] text-[#34d399]',
  rejected: 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.18)] text-[#f87171]',
  callback_pending: 'border-[rgba(45,212,191,0.35)] bg-[rgba(20,184,166,0.18)] text-[#5eead4]',
  closed: 'border-[rgba(148,163,184,0.3)] bg-[rgba(148,163,184,0.14)] text-[#94a3b8]',
};

/** `.tk-status-badge.{status}` */
export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const { t } = useTranslation('ticket');
  return (
    <span className={cn('inline-flex items-center gap-[5px] rounded-xl border px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap', STATUS_BADGE[status], className)}>
      {t(`status.${status}`)}
    </span>
  );
}

/** Red pulsing badge like the legacy `.tk-urgent-badge`, used for overdue tickets. */
export function OverdueBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex animate-[tkUrgentPulse_1.8s_ease-in-out_infinite] items-center gap-1 rounded-md border border-[rgba(239,68,68,0.6)] bg-[linear-gradient(135deg,rgba(239,68,68,0.25),rgba(249,115,22,0.25))] px-[7px] py-0.5 text-[10px] font-extrabold whitespace-nowrap text-[#fca5a5]',
        className,
      )}
    >
      <Icon name="timer" className="size-[13px]" />
      {label}
    </span>
  );
}

/** Region chip (legacy `.tk-target-badge.specific` look). */
export function RegionBadge({ label, muted, title }: { label: string; muted?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-[200px] items-center gap-1 truncate rounded-md border px-[7px] py-0.5 text-[10.5px] font-bold',
        muted
          ? 'border-[rgba(148,163,184,0.22)] bg-[rgba(148,163,184,0.12)] text-[#94a3b8]'
          : 'border-[rgba(139,92,246,0.3)] bg-[rgba(139,92,246,0.16)] text-[#c084fc]',
      )}
    >
      <Icon name="location" className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** "Name (101)" or just the name when there is no extension. */
export function personName(p: { label: string; extension: string | null } | null): string {
  if (!p) return '';
  return p.extension && !p.label.includes(p.extension) ? `${p.label} (${p.extension})` : p.label;
}
