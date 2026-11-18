import type { TicketDetail } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  KdsAction,
  KdsField,
  KdsSelect,
  KdsTextarea,
  refName,
  ticketActions,
  ticketDirectoriesQuery,
  ticketKeys,
} from '@/entities/ticket';
import { Icon } from '@/shared/ui/icon';
import {
  KdsCloseButton,
  KdsIdBadge,
  KdsModal,
  KdsModalActions,
  KdsModalBody,
  KdsModalHeader,
} from '@/shared/ui/kds-modal';

/** Forward to another region (back to `new` there). For tickets without a region (triage) the note is optional. */
export function ForwardTicketModal({
  ticket,
  open,
  onClose,
}: {
  ticket: TicketDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const dirs = useQuery({ ...ticketDirectoriesQuery, enabled: open });
  const [regionId, setRegionId] = useState('');
  const [note, setNote] = useState('');
  const triage = ticket.region === null;

  useEffect(() => {
    if (open) {
      setRegionId('');
      setNote('');
    }
  }, [open]);

  const save = useMutation({
    mutationFn: () => ticketActions.forward(ticket.id, Number(regionId), note.trim() || undefined),
    onSuccess: async (detail) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
      onClose();
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  const regions = (dirs.data?.regions ?? []).filter((r) => r.isActive && r.id !== ticket.region?.id);
  return (
    <KdsModal open={open} onOpenChange={(o) => !o && onClose()} title={t('forward.title')} width={520} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (!regionId || (!triage && note.trim().length < 2)) return;
          save.mutate();
        }}
      >
        <KdsModalHeader>
          <div className="flex items-center gap-3">
            <KdsIdBadge>{ticket.code}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-ink">{t('forward.title')}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-1 px-5 py-[18px]">
          {triage && <p className="mb-3 text-[13px] text-ink-2">{t('forward.triageHint')}</p>}
          <KdsField
            label={t('forward.region')}
            icon={<Icon name="location" className="size-3.5" />}
            htmlFor="kds-forward-region"
          >
            <KdsSelect id="kds-forward-region" required value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              <option value="">{t('form.regionPick')}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {refName(r, i18n.language)}
                </option>
              ))}
            </KdsSelect>
          </KdsField>
          <KdsField
            label={t('forward.note')}
            icon={<Icon name="edit" className="size-3.5" />}
            htmlFor="kds-forward-note"
          >
            <KdsTextarea
              id="kds-forward-note"
              required={!triage}
              minLength={triage ? undefined : 2}
              maxLength={1000}
              value={note}
              placeholder={t('forward.notePlaceholder')}
              className="min-h-20"
              onChange={(e) => setNote(e.target.value)}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions className="justify-end gap-2.5 px-5 py-3">
          <KdsAction variant="delete" onClick={onClose}>
            {t('forward.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant="primary" disabled={save.isPending || !regionId} className="px-4 py-2">
            <Icon name="arrow-swap-horizontal" className="size-3.5" />
            {t('forward.submit')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}
