import type { TicketAssignee, TicketDetail, TicketTransition } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AttachButton,
  AttachmentGallery,
  DocViewer,
  KdsAction,
  KdsTextarea,
  PreviewStrip,
  TicketStatusBadge,
  UrgentBadge,
  type ViewerSource,
  acceptFiles,
  addTicketComment,
  deleteTicket,
  personName,
  ticketKeys,
  ticketQuery,
  timeAgo,
  transitionTicket,
  usePasteTarget,
} from '@/entities/ticket';
import { EditTicketModal } from '@/features/tickets/edit-ticket';
import { RejectTicketModal } from '@/features/tickets/reject-ticket';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { KdsCloseButton, KdsIdBadge, KdsModal, KdsModalActions, KdsModalBody, KdsModalHeader } from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

/** Legacy detail "box" (`#ticketBoxOverlay`). Opens for `ticketId`, closes with `onClose`. */
export function TicketBox({
  ticketId,
  meId,
  assignees,
  maxFileMb,
  onClose,
}: {
  ticketId: number | null;
  meId: number;
  assignees: TicketAssignee[];
  maxFileMb: number;
  onClose: () => void;
}) {
  const { t } = useTranslation('ticket');
  const query = useQuery({ ...ticketQuery(ticketId ?? 0), enabled: ticketId !== null });
  const ticket = ticketId !== null ? query.data : undefined;

  return (
    <KdsModal open={ticketId !== null} onOpenChange={(o) => !o && onClose()} title={ticket?.code ?? 'Ticket'} closeOnBackdrop>
      {ticket ? (
        <BoxContent key={ticket.id} ticket={ticket} meId={meId} assignees={assignees} maxFileMb={maxFileMb} onClose={onClose} />
      ) : (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-[#94a3b8]">
          {query.isError ? (
            <>
              <span>{t('box.notFound')}</span>
              <KdsAction variant="delete" onClick={onClose}>
                {t('box.close')}
              </KdsAction>
            </>
          ) : (
            <span className="size-10 animate-[tkSpin_0.8s_linear_infinite] rounded-full border-[3px] border-[rgba(56,189,248,0.2)] border-t-[#38bdf8]" />
          )}
        </div>
      )}
    </KdsModal>
  );
}

function BoxContent({
  ticket,
  meId,
  assignees,
  maxFileMb,
  onClose,
}: {
  ticket: TicketDetail;
  meId: number;
  assignees: TicketAssignee[];
  maxFileMb: number;
  onClose: () => void;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const p = ticket.permissions;

  usePasteTarget(!editOpen && !rejectOpen && viewer === null, (pasted) => setFiles((cur) => acceptFiles(cur, pasted, maxFileMb, t)));

  const onDetail = async (detail: TicketDetail) => {
    queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
    await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
  };
  const onError = (err: Error) => toast.error(t('error', { message: err.message }));

  const move = useMutation({
    mutationFn: (tr: Exclude<TicketTransition, 'reject'>) => transitionTicket(ticket.id, tr),
    onSuccess: onDetail,
    onError,
  });
  const comment = useMutation({
    mutationFn: () => addTicketComment(ticket.id, reply.trim(), files),
    onSuccess: async (detail) => {
      setReply('');
      setFiles([]);
      await onDetail(detail);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteTicket(ticket.id),
    onSuccess: async () => {
      onClose();
      queryClient.removeQueries({ queryKey: ticketKeys.detail(ticket.id) });
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError,
  });

  let accepted: { text: string; color: string };
  if (ticket.status === 'completed') {
    accepted = { text: ticket.completedBy ? t('box.doneBy', { name: personName(ticket.completedBy) }) : t('box.done'), color: '#34d399' };
  } else if (ticket.status === 'rejected') {
    accepted = { text: ticket.rejectedBy ? t('box.rejectedByName', { name: personName(ticket.rejectedBy) }) : t('box.rejected'), color: '#ef4444' };
  } else if (ticket.assignee) {
    accepted = { text: t('box.acceptedBy', { name: personName(ticket.assignee), time: timeAgo(ticket.acceptedAt, t) }), color: '#c084fc' };
  } else accepted = { text: t('box.notAccepted'), color: '#94a3b8' };

  const busy = move.isPending || remove.isPending;
  const canAct = p.accept || p.reject || p.complete;
  const locked = !canAct && (ticket.status === 'open' || ticket.status === 'accepted') && ticket.target && ticket.target.userId !== meId;

  return (
    <>
      <KdsModalHeader>
        <div className="flex items-center gap-3">
          <KdsIdBadge>{ticket.code}</KdsIdBadge>
          {ticket.isUrgent && <UrgentBadge label={t('box.urgent')} className="px-2 py-[3px] text-[11px]" />}
          <TicketStatusBadge status={ticket.status} />
        </div>
        <KdsCloseButton label={t('box.close')} />
      </KdsModalHeader>

      <KdsModalBody>
        {ticket.status === 'rejected' && (
          <div className="flex flex-col gap-1.5 rounded-[10px] border-[1.5px] border-l-4 border-[rgba(239,68,68,0.38)] border-l-[#ef4444] bg-[linear-gradient(135deg,rgba(239,68,68,0.14),rgba(15,23,42,0.85))] px-3.5 py-3 shadow-[0_4px_16px_rgba(239,68,68,0.14)]">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#f87171]">
                <Icon name="close-circle" className="size-4" />
                {t('box.rejectedTitle')}
              </span>
              <span className="text-[11px] text-[#94a3b8]">{timeAgo(ticket.rejectedAt ?? ticket.updatedAt, t)}</span>
            </div>
            <div className="mt-[3px] flex gap-1.5 text-xs text-[#cbd5e1]">
              <span className="text-[#94a3b8]">{t('box.rejectedBy')}</span>
              <strong className="text-[#fca5a5]">{personName(ticket.rejectedBy) || 'Operator'}</strong>
            </div>
            <div className="mt-[5px] flex flex-col gap-[3px] rounded-[7px] border border-[rgba(239,68,68,0.25)] bg-black/28 px-3 py-2 text-[12.5px]">
              <span className="text-[11px] font-bold tracking-[0.4px] text-[#fb7185] uppercase">{t('box.rejectReason')}</span>
              <span className="leading-[1.45] font-medium break-words text-[#fee2e2]">{ticket.rejectReason || t('box.noReason')}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 rounded-xl border border-white/7 bg-[rgba(30,41,59,0.5)] px-4 py-3">
          <Meta label={t('box.metaCreator')}>{personName(ticket.creator)}</Meta>
          <Meta label={t('box.metaTime')}>{timeAgo(ticket.createdAt, t)}</Meta>
          <Meta label={t('box.metaAccepted')} color={accepted.color}>
            {accepted.text}
          </Meta>
          <Meta label={t('box.metaPhone')}>{ticket.customerPhone || t('box.noPhone')}</Meta>
          <Meta label={t('box.metaTarget')} color={ticket.target ? '#38bdf8' : '#94a3b8'}>
            {ticket.target ? t('box.targetOne', { name: personName(ticket.target) }) : t('box.targetAll')}
          </Meta>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-bold text-[#94a3b8]">{t('box.description')}</div>
          <div className="rounded-xl border border-white/8 bg-[rgba(15,23,42,0.6)] px-[18px] py-4 text-[13.5px] leading-[1.6] break-words whitespace-pre-wrap text-[#e2e8f0]">
            {ticket.body || t('box.noDescription')}
          </div>
        </div>

        {ticket.attachments.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-[#94a3b8]">
              <LegacyIcon name="gallery" className="size-3.5" />
              {t('box.gallery')}
            </div>
            <AttachmentGallery ticketId={ticket.id} attachments={ticket.attachments} onOpen={setViewer} />
          </div>
        )}

        <div className="mt-2.5 border-t border-white/8 pt-3.5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-[#94a3b8]">
            <LegacyIcon name="message" className="size-3.5" />
            {t('box.chat')}
          </div>
          <div className="flex flex-col gap-2.5">
            {ticket.comments.length === 0 ? (
              <div className="text-xs text-[#64748b] italic">{t('box.noReplies')}</div>
            ) : (
              ticket.comments.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-[10px] border border-white/6 bg-[rgba(30,41,59,0.4)] px-3.5 py-2.5',
                    c.isSystem && 'border-l-[3px] border-l-[#ef4444] bg-[rgba(239,68,68,0.08)]',
                  )}
                >
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className={cn('inline-flex items-center gap-1 font-bold', c.isSystem ? 'text-[#f87171]' : 'text-[#38bdf8]')}>
                      {c.isSystem && <Icon name="close-circle" className="size-3.5" />}
                      {personName(c.author)}
                    </span>
                    <span className="text-[#64748b]">{timeAgo(c.createdAt, t)}</span>
                  </div>
                  {(c.body || c.isSystem) && (
                    <div className={cn('text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap', c.isSystem ? 'font-medium text-[#fecdd3]' : 'text-[#e2e8f0]')}>
                      {c.isSystem ? t('box.systemRejected', { reason: c.body }) : c.body}
                    </div>
                  )}
                  {c.attachments.length > 0 && (
                    <div className="mt-2">
                      <AttachmentGallery ticketId={ticket.id} attachments={c.attachments} compact onOpen={setViewer} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {p.comment && (
            <div className="mt-3 flex flex-col gap-2">
              <KdsTextarea
                value={reply}
                maxLength={4000}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t('box.replyPlaceholder')}
                className="min-h-[70px]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <AttachButton onFiles={(added) => setFiles((cur) => acceptFiles(cur, added, maxFileMb, t))} />
                  <span className="text-[11px] text-[#64748b]">{t('box.orPaste')}</span>
                </div>
                <KdsAction
                  variant="accept"
                  className="px-4 py-[7px] text-xs"
                  disabled={comment.isPending}
                  onClick={() => {
                    if (!reply.trim() && files.length === 0) {
                      toast.warning(t('box.replyEmpty'));
                      return;
                    }
                    comment.mutate();
                  }}
                >
                  {t('box.send')}
                </KdsAction>
              </div>
              <PreviewStrip
                files={files}
                onRemove={(i) => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
                onOpen={(file) => setViewer({ kind: 'local', file })}
              />
            </div>
          )}
        </div>
      </KdsModalBody>

      <KdsModalActions>
        <div className="flex flex-wrap items-center gap-2">
          {ticket.status === 'open' && (
            <>
              {p.accept && (
                <KdsAction variant="accept" disabled={busy} onClick={() => move.mutate('accept')}>
                  <Icon name="timer" className="size-4" />
                  {t('box.accept')}
                </KdsAction>
              )}
              {p.reject && <RejectButton onClick={() => setRejectOpen(true)} disabled={busy} />}
            </>
          )}
          {ticket.status === 'accepted' && (
            <>
              {p.complete && (
                <KdsAction variant="complete" disabled={busy} onClick={() => move.mutate('complete')}>
                  <Icon name="tick-circle" className="size-4" />
                  {t('box.complete')}
                </KdsAction>
              )}
              {p.reject && <RejectButton onClick={() => setRejectOpen(true)} disabled={busy} />}
            </>
          )}
          {ticket.status === 'completed' && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#10b981]">
              <Icon name="tick-circle" className="size-4" />
              {t('box.completedText')}
            </span>
          )}
          {ticket.status === 'rejected' && (
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#ef4444]">
                <Icon name="close-circle" className="size-4" />
                {t('box.rejectedText')}
              </span>
              {p.accept && (
                <KdsAction variant="accept" className="px-3 py-1.5 text-[11.5px]" disabled={busy} onClick={() => move.mutate('accept')}>
                  <Icon name="timer" className="size-3.5" />
                  {t('box.reaccept')}
                </KdsAction>
              )}
            </div>
          )}
          {locked && ticket.target && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.12)] px-3 py-1.5 text-xs font-semibold text-[#f59e0b]">
              <LegacyIcon name="lock" className="size-3.5" />
              {t('box.lock', { name: personName(ticket.target) })}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {p.edit && (
            <KdsAction variant="edit" title={t('box.editTitle')} onClick={() => setEditOpen(true)}>
              <Icon name="edit" className="size-4" />
              {t('box.edit')}
            </KdsAction>
          )}
          {p.delete && (
            <KdsAction
              variant="delete"
              title={t('box.deleteTitle')}
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('box.deleteConfirm', { code: ticket.code }))) remove.mutate();
              }}
            >
              <Icon name="trash" className="size-4" />
              {t('box.delete')}
            </KdsAction>
          )}
        </div>
      </KdsModalActions>

      <EditTicketModal ticket={ticket} assignees={assignees} open={editOpen} onOpenChange={setEditOpen} />
      <RejectTicketModal ticket={ticket} open={rejectOpen} onOpenChange={setRejectOpen} />
      <DocViewer source={viewer} onClose={() => setViewer(null)} />
    </>
  );
}

function RejectButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const { t } = useTranslation('ticket');
  return (
    <KdsAction variant="reject" title={t('box.rejectTitle')} disabled={disabled} onClick={onClick}>
      <Icon name="close-circle" className="size-4" />
      {t('box.reject')}
    </KdsAction>
  );
}

function Meta({ label, color, children }: { label: string; color?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <span className="text-[11px] font-semibold tracking-[0.5px] text-[#64748b] uppercase">{label}</span>
      <span className="text-[13px] font-bold break-words text-[#f1f5f9]" style={color ? { color } : undefined}>
        {children}
      </span>
    </div>
  );
}
