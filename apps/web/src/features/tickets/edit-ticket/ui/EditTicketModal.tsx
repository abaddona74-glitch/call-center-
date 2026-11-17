import type { TicketAssignee, TicketDetail, UpdateTicketRequest } from '@cc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KdsAction, KdsField, KdsInput, KdsSelect, KdsTextarea, UrgentToggle, ticketKeys, updateTicket } from '@/entities/ticket';
import { Icon } from '@/shared/ui/icon';
import { KdsCloseButton, KdsIdBadge, KdsModal, KdsModalActions, KdsModalBody, KdsModalHeader } from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

/** "Ticketni Tahrirlash": target (only while nobody accepted it), phone, urgency, text. */
export function EditTicketModal({
  ticket,
  assignees,
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  assignees: TicketAssignee[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [target, setTarget] = useState('all');
  const [phone, setPhone] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!open) return;
    setTarget(ticket.target?.userId ? String(ticket.target.userId) : 'all');
    setPhone(ticket.customerPhone ?? '');
    setUrgent(ticket.isUrgent);
    setBody(ticket.body);
  }, [open, ticket]);

  const canRetarget = ticket.status === 'open';
  const save = useMutation({
    mutationFn: () => {
      const req: UpdateTicketRequest = {};
      if (body.trim() !== ticket.body) req.body = body.trim();
      if (phone.trim() !== (ticket.customerPhone ?? '')) req.customerPhone = phone.trim() || null;
      if (urgent !== ticket.isUrgent) req.isUrgent = urgent;
      const targetId = target === 'all' ? null : Number(target);
      if (canRetarget && targetId !== (ticket.target?.userId ?? null)) req.targetUserId = targetId;
      return Object.keys(req).length ? updateTicket(ticket.id, req) : Promise.resolve(ticket);
    },
    onSuccess: async (detail) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  // Keep the current target selectable even if that operator is no longer a receiver.
  const options = [...assignees];
  if (ticket.target?.userId && !options.some((a) => a.userId === ticket.target?.userId)) {
    options.push({ userId: ticket.target.userId, username: ticket.target.label, extension: ticket.target.extension ?? '', name: null });
  }

  return (
    <KdsModal open={open} onOpenChange={onOpenChange} title={t('form.editTitle')} width={620} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) {
            toast.warning(t('form.commentRequired'));
            return;
          }
          save.mutate();
        }}
      >
        <KdsModalHeader>
          <div className="flex items-center gap-3">
            <KdsIdBadge>{t('form.editBadge', { code: ticket.code })}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-white">{t('form.editTitle')}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-3.5">
          <KdsField label={t('form.target')} icon={<LegacyIcon name="target" className="size-3.5" />} htmlFor="kds-edit-target">
            <KdsSelect
              id="kds-edit-target"
              value={target}
              disabled={!canRetarget}
              title={canRetarget ? undefined : t('form.targetLocked')}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="all">{t('form.targetAll')}</option>
              {options.map((a) => (
                <option key={a.userId} value={String(a.userId)}>
                  {a.extension} - {a.name ?? a.username}
                </option>
              ))}
            </KdsSelect>
          </KdsField>
          <KdsField label={t('form.phoneEdit')} icon={<Icon name="call" className="size-3.5" />} htmlFor="kds-edit-phone">
            <KdsInput id="kds-edit-phone" value={phone} maxLength={32} placeholder="+998 90 123 45 67" onChange={(e) => setPhone(e.target.value)} />
          </KdsField>
          <UrgentToggle
            checked={urgent}
            onChange={setUrgent}
            label={t('form.urgent')}
            description={t('form.urgentDesc')}
            switchTitle={t('form.urgentSwitch')}
          />
          <KdsField label={t('form.comment')} icon={<LegacyIcon name="message" className="size-3.5" />} htmlFor="kds-edit-comment">
            <KdsTextarea
              id="kds-edit-comment"
              value={body}
              maxLength={4000}
              placeholder={t('form.commentPlaceholder')}
              onChange={(e) => setBody(e.target.value)}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions>
          <KdsAction variant="delete" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant="complete" disabled={save.isPending}>
            {save.isPending ? t('form.saving') : t('form.save')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}
