import type { TicketDetail } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KdsAction, KdsField, KdsTextarea, ticketKeys, transitionTicket } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { KdsCloseButton, KdsIdBadge, KdsModal, KdsModalActions, KdsModalBody, KdsModalHeader } from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

const PRESETS: Array<{ id: 'p1' | 'p2' | 'p3' | 'p4' | 'p5'; icon: ReactNode }> = [
  { id: 'p1', icon: <Icon name="call" className="size-[13px]" /> },
  { id: 'p2', icon: <Icon name="clipboard-text" className="size-[13px]" /> },
  { id: 'p3', icon: <Icon name="user" className="size-[13px]" /> },
  { id: 'p4', icon: <LegacyIcon name="alert-circle" className="size-[13px]" /> },
  { id: 'p5', icon: <Icon name="close-circle" className="size-[13px]" /> },
];

/** "Ticketni Rad Etish": reason presets + required text (shown on the card and in the chat). */
export function RejectTicketModal({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setPreset(null);
    const timer = setTimeout(() => textRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open]);

  const reject = useMutation({
    mutationFn: () => transitionTicket(ticket.id, 'reject', reason.trim()),
    onSuccess: async (detail) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  return (
    <KdsModal open={open} onOpenChange={onOpenChange} title={t('reject.title')} width={520} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 2) {
            toast.warning(t('reject.required'));
            return;
          }
          reject.mutate();
        }}
      >
        <KdsModalHeader className="border-b-[rgba(239,68,68,0.25)]">
          <div className="flex items-center gap-3">
            <KdsIdBadge className="border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.18)] text-[#f87171]">{ticket.code}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-white">{t('reject.title')}</h3>
          </div>
          <KdsCloseButton label={t('reject.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-3.5 px-5 py-[18px]">
          <p className="text-[13px] leading-[1.45] text-[#cbd5e1]">{t('reject.intro')}</p>
          <div>
            <div className="mb-2 text-[11px] font-bold tracking-[0.5px] text-[#94a3b8] uppercase">{t('reject.presets')}</div>
            <div className="flex flex-wrap gap-[7px]">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setReason(t(`reject.${p.id}Text`));
                    setPreset(p.id);
                    textRef.current?.focus();
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-[20px] border border-white/12 bg-white/5 px-[13px] py-1.5 text-[11.5px] font-medium text-[#cbd5e1] select-none transition-all duration-200 hover:-translate-y-px hover:border-[rgba(239,68,68,0.45)] hover:bg-[rgba(239,68,68,0.16)] hover:text-[#fca5a5] hover:shadow-[0_4px_12px_rgba(239,68,68,0.15)] active:scale-[0.96]',
                    preset === p.id && 'border-[#ef4444] bg-[rgba(239,68,68,0.25)] font-semibold text-white',
                  )}
                >
                  {p.icon}
                  {t(`reject.${p.id}`)}
                </button>
              ))}
            </div>
          </div>
          <KdsField label={t('reject.label')} icon={<LegacyIcon name="message" className="size-3.5" />} htmlFor="kds-reject-reason">
            <KdsTextarea
              id="kds-reject-reason"
              ref={textRef}
              required
              value={reason}
              maxLength={500}
              placeholder={t('reject.placeholder')}
              className="min-h-20"
              onChange={(e) => {
                setReason(e.target.value);
                setPreset(null);
              }}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions className="justify-end gap-2.5 px-5 py-3">
          <KdsAction variant="delete" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant="reject" disabled={reject.isPending} className="px-4 py-2">
            <Icon name="close-circle" className="size-3.5" />
            {reject.isPending ? t('reject.sending') : t('reject.submit')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}
