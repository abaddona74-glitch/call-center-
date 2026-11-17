import type { TicketDetail } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KdsAction, KdsField, KdsTextarea, ticketActions, ticketKeys } from '@/entities/ticket';
import { Icon } from '@/shared/ui/icon';
import { KdsCloseButton, KdsIdBadge, KdsModal, KdsModalActions, KdsModalBody, KdsModalHeader } from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

/** Executive finishes the work: done (note desirable) or rejected (note required). Both return to operators. */
export function ResolveTicketModal({
  ticket,
  mode,
  onClose,
}: {
  ticket: TicketDetail;
  /** null = closed */
  mode: 'done' | 'rejected' | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const reject = mode === 'rejected';

  useEffect(() => {
    if (!mode) return;
    setNote('');
    const timer = setTimeout(() => ref.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [mode]);

  const save = useMutation({
    mutationFn: () => (reject ? ticketActions.reject(ticket.id, note.trim()) : ticketActions.resolve(ticket.id, note.trim() || undefined)),
    onSuccess: async (detail) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
      onClose();
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  const title = reject ? t('resolve.titleReject') : t('resolve.titleDone');
  return (
    <KdsModal open={mode !== null} onOpenChange={(o) => !o && onClose()} title={title} width={520} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (reject && note.trim().length < 2) {
            toast.warning(t('resolve.noteRequired'));
            return;
          }
          save.mutate();
        }}
      >
        <KdsModalHeader className={reject ? 'border-b-[rgba(239,68,68,0.25)]' : undefined}>
          <div className="flex items-center gap-3">
            <KdsIdBadge className={reject ? 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.18)] text-[#f87171]' : undefined}>{ticket.code}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-white">{title}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-3.5 px-5 py-[18px]">
          <p className="text-[13px] leading-[1.45] text-[#cbd5e1]">{t('resolve.hint')}</p>
          <KdsField label={reject ? t('resolve.noteReject') : t('resolve.noteDone')} icon={<LegacyIcon name="message" className="size-3.5" />} htmlFor="kds-resolve-note">
            <KdsTextarea
              id="kds-resolve-note"
              ref={ref}
              required={reject}
              value={note}
              maxLength={2000}
              placeholder={reject ? t('resolve.placeholderReject') : t('resolve.placeholderDone')}
              className="min-h-24"
              onChange={(e) => setNote(e.target.value)}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions className="justify-end gap-2.5 px-5 py-3">
          <KdsAction variant="delete" onClick={onClose}>
            {t('resolve.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant={reject ? 'reject' : 'complete'} disabled={save.isPending} className="px-4 py-2">
            <Icon name={reject ? 'close-circle' : 'tick-circle'} className="size-3.5" />
            {reject ? t('resolve.submitReject') : t('resolve.submitDone')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}
