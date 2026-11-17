import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketContextQuery } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { CreateTicketModal } from './CreateTicketModal';

/**
 * "Ticket" button next to a call (my active call, a row in the history). Hidden for users who cannot
 * open tickets. The server takes the number from the call and checks the user took part in it.
 */
export function CreateTicketButton({ callId, className, variant = 'pill' }: { callId: string; className?: string; variant?: 'pill' | 'table' }) {
  const { t } = useTranslation('ticket');
  const ctx = useQuery(ticketContextQuery);
  const [open, setOpen] = useState(false);
  if (!ctx.data?.capabilities.create) return null;
  return (
    <>
      <button
        type="button"
        title={t('createFromCallTitle')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          variant === 'pill'
            ? 'inline-flex items-center gap-1.5 rounded-[10px] border border-[rgba(16,185,129,0.4)] bg-[linear-gradient(135deg,#10b981_0%,#059669_100%)] px-3 py-1.5 text-xs font-bold text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-transform hover:-translate-y-px active:scale-[0.96]'
            : 'inline-flex items-center gap-1 rounded-md border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.12)] px-2 py-1 text-[11px] font-semibold text-[#34d399] hover:bg-[rgba(16,185,129,0.22)]',
          className,
        )}
      >
        <Icon name="clipboard-text" className={variant === 'pill' ? 'size-3.5' : 'size-3'} />
        {t('createFromCall')}
      </button>
      <CreateTicketModal open={open} onOpenChange={setOpen} maxFileMb={ctx.data.maxFileMb} callId={callId} />
    </>
  );
}
