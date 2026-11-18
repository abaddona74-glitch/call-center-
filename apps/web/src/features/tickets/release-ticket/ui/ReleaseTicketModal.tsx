import type { TicketDetail } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KdsAction, KdsField, KdsTextarea, ticketActions, ticketKeys } from '@/entities/ticket';
import { Icon } from '@/shared/ui/icon';
import {
  KdsCloseButton,
  KdsIdBadge,
  KdsModal,
  KdsModalActions,
  KdsModalBody,
  KdsModalHeader,
} from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

/**
 * The executive who holds the ticket gives it back to the queue of the same region (reason required).
 * Nobody hands a ticket to a specific executive: whoever takes it from the queue gets it.
 */
export function ReleaseTicketModal({
  ticket,
  open,
  onClose,
}: {
  ticket: TicketDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    const timer = setTimeout(() => ref.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open]);

  const save = useMutation({
    mutationFn: () => ticketActions.release(ticket.id, note.trim()),
    onSuccess: async (detail) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
      onClose();
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  return (
    <KdsModal open={open} onOpenChange={(o) => !o && onClose()} title={t('release.title')} width={500} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim().length < 2) {
            toast.warning(t('release.noteRequired'));
            return;
          }
          save.mutate();
        }}
      >
        <KdsModalHeader className="border-b-[rgba(245,158,11,0.25)]">
          <div className="flex items-center gap-3">
            <KdsIdBadge className="border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.16)] text-caution">
              {ticket.code}
            </KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-ink">{t('release.title')}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-3.5 px-5 py-[18px]">
          <p className="text-[13px] leading-[1.45] text-ink-2">{t('release.hint')}</p>
          <KdsField
            label={t('release.note')}
            icon={<LegacyIcon name="message" className="size-3.5" />}
            htmlFor="kds-release-note"
          >
            <KdsTextarea
              id="kds-release-note"
              ref={ref}
              required
              minLength={2}
              maxLength={1000}
              value={note}
              placeholder={t('release.notePlaceholder')}
              className="min-h-20"
              onChange={(e) => setNote(e.target.value)}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions className="justify-end gap-2.5 px-5 py-3">
          <KdsAction variant="delete" onClick={onClose}>
            {t('release.cancel')}
          </KdsAction>
          <KdsAction
            type="submit"
            variant="edit"
            disabled={save.isPending || note.trim().length < 2}
            className="px-4 py-2"
          >
            <Icon name="arrow-left" className="size-3.5" />
            {t('release.submit')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}
