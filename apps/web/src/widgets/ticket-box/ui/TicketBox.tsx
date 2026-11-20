import type { TicketCall, TicketDetail, TicketEvent } from '@cc/shared';
import { formatUzPhone } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AttachButton,
  AttachmentGallery,
  DocViewer,
  KdsAction,
  KdsTextarea,
  OverdueBadge,
  OverdueFor,
  PreviewStrip,
  TicketStatusBadge,
  type ViewerSource,
  acceptFiles,
  addTicketComment,
  dateTime,
  personName,
  recordingUrl,
  refName,
  ticketActions,
  ticketKeys,
  ticketQuery,
  timeAgo,
  usePasteTarget,
} from '@/entities/ticket';
import { CallbackCallButton, CallbackOutcomeModal, ForceCloseModal } from '@/features/tickets/callback-call';
import { ForwardTicketModal } from '@/features/tickets/forward-ticket';
import { ReleaseTicketModal } from '@/features/tickets/release-ticket';
import { ResolveTicketModal } from '@/features/tickets/resolve-ticket';
import { useApiScope } from '@/shared/lib/api-scope';
import { cn } from '@/shared/lib/cn';
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

/** Ticket card ("box", legacy `#ticketBoxOverlay` look): details, timeline, calls with recordings, chat, actions. */
export function TicketBox({
  ticketId,
  maxFileMb,
  onClose,
}: {
  ticketId: number | null;
  maxFileMb: number;
  onClose: () => void;
}) {
  const { t } = useTranslation('ticket');
  // `overview` scope (the overview dashboard): the read-only card — the server sends no actions.
  const scope = useApiScope();
  const query = useQuery({ ...ticketQuery(ticketId ?? 0, scope), enabled: ticketId !== null });
  const ticket = ticketId !== null ? query.data : undefined;

  return (
    <KdsModal
      open={ticketId !== null}
      onOpenChange={(o) => !o && onClose()}
      title={ticket?.code ?? 'Ticket'}
      width={860}
      closeOnBackdrop
    >
      {ticket ? (
        <BoxContent key={ticket.id} ticket={ticket} maxFileMb={maxFileMb} onClose={onClose} />
      ) : (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-mute">
          {query.isError ? (
            <>
              <span>{t('box.notFound')}</span>
              <KdsAction variant="delete" onClick={onClose}>
                {t('box.close')}
              </KdsAction>
            </>
          ) : (
            <span className="size-10 animate-[tkSpin_0.8s_linear_infinite] rounded-full border-[3px] border-[rgba(56,189,248,0.2)] border-t-info" />
          )}
        </div>
      )}
    </KdsModal>
  );
}

function BoxContent({ ticket, maxFileMb, onClose }: { ticket: TicketDetail; maxFileMb: number; onClose: () => void }) {
  const { t, i18n } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const [resolveMode, setResolveMode] = useState<'done' | 'rejected' | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const a = ticket.actions;
  // The overview dashboard's card: no actions; say so instead of an empty footer.
  const readOnly = useApiScope() === 'overview';
  const dialogs = resolveMode !== null || forwardOpen || releaseOpen || outcomeOpen || forceOpen || viewer !== null;

  usePasteTarget(!dialogs && a.comment, (pasted) => setFiles((cur) => acceptFiles(cur, pasted, maxFileMb, t)));

  const onDetail = async (detail: TicketDetail) => {
    queryClient.setQueryData(ticketKeys.detail(ticket.id), detail);
    await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
  };
  const onError = (err: Error) => toast.error(t('error', { message: err.message }));

  const move = useMutation({
    mutationFn: (step: 'assign' | 'start') =>
      step === 'assign' ? ticketActions.assign(ticket.id) : ticketActions.start(ticket.id),
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
    mutationFn: () => ticketActions.remove(ticket.id),
    onSuccess: async () => {
      onClose();
      queryClient.removeQueries({ queryKey: ticketKeys.detail(ticket.id) });
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError,
  });

  const lang = i18n.language;
  const busy = move.isPending || remove.isPending;
  const workingByOther =
    !a.start && !a.resolve && ticket.assignee && (ticket.status === 'assigned' || ticket.status === 'in_progress');

  return (
    <>
      <KdsModalHeader>
        <div className="flex flex-wrap items-center gap-3">
          <KdsIdBadge>{ticket.code}</KdsIdBadge>
          <TicketStatusBadge status={ticket.status} className="px-2.5 py-1 text-[11px]" />
          {ticket.overdue && <OverdueBadge label={t('card.overdue')} className="px-2 py-[3px] text-[11px]" />}
          {ticket.callbackOverdue && (
            <OverdueBadge label={t('card.callbackOverdue')} className="px-2 py-[3px] text-[11px]" />
          )}
        </div>
        <KdsCloseButton label={t('box.close')} />
      </KdsModalHeader>

      <KdsModalBody>
        {ticket.resolution && <ResolutionBanner ticket={ticket} />}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 rounded-xl border border-tint/7 bg-glass-2/50 px-4 py-3">
          <Meta label={t('box.metaPhone')} color="var(--info)">
            {ticket.customerPhone ? formatUzPhone(ticket.customerPhone) : t('box.noValue')}
          </Meta>
          <Meta label={t('box.metaName')}>{ticket.customerName || t('box.noValue')}</Meta>
          <Meta label={t('box.metaOrganization')}>
            {ticket.organization ? (
              <>
                {ticket.organization.name}
                {ticket.organization.tin && (
                  <span className="block text-[11.5px] font-semibold text-mute">
                    {t('form.organizationTin', { tin: ticket.organization.tin })}
                  </span>
                )}
              </>
            ) : (
              t('box.noValue')
            )}
          </Meta>
          <Meta label={t('box.metaRegion')} color={ticket.region ? 'var(--violet)' : 'var(--mute)'}>
            {ticket.region ? refName(ticket.region, lang) : t('card.noRegion')}
          </Meta>
          <Meta label={t('box.metaCity')}>{ticket.city ? refName(ticket.city, lang) : t('box.noValue')}</Meta>
          <Meta label={t('box.metaCategory')}>
            {ticket.category ? refName(ticket.category, lang) : t('box.noValue')}
          </Meta>
          <Meta label={t('box.metaCreator')}>{personName(ticket.creator)}</Meta>
          <Meta label={t('box.metaCreated')}>
            <span title={dateTime(ticket.createdAt)}>{timeAgo(ticket.createdAt, t)}</span>
          </Meta>
          <Meta label={t('box.metaAssignee')} color={ticket.assignee ? 'var(--violet)' : 'var(--mute)'}>
            {ticket.assignee ? personName(ticket.assignee) : t('box.noAssignee')}
          </Meta>
          <Meta label={t('box.metaDue')} color={ticket.overdue ? 'var(--danger)' : undefined}>
            {ticket.dueAt ? dateTime(ticket.dueAt) : t('box.noValue')}
            {/* How long past it: live while still with the region, fixed at the resolution when resolved late. */}
            {ticket.overdue && (
              <OverdueFor dueAt={ticket.dueAt} resolvedAt={ticket.resolvedAt} className="block text-[11.5px]" />
            )}
          </Meta>
          {ticket.callbackDueAt && (
            <Meta label={t('box.metaCallbackDue')} color={ticket.callbackOverdue ? 'var(--danger)' : undefined}>
              {dateTime(ticket.callbackDueAt)}
            </Meta>
          )}
          {ticket.lastContact && (
            <Meta label={t('box.metaLastContact')} color={ticket.lastContactIsMe ? 'var(--info)' : undefined}>
              {personName(ticket.lastContact)} · {timeAgo(ticket.lastContact.at, t)}
            </Meta>
          )}
        </div>

        <Section title={t('box.description')}>
          <div className="rounded-xl border border-tint/8 bg-glass/60 px-[18px] py-4 text-[13.5px] leading-[1.6] break-words whitespace-pre-wrap text-foreground">
            {ticket.description || t('box.noDescription')}
          </div>
        </Section>

        {ticket.attachments.length > 0 && (
          <Section title={t('box.gallery')} icon={<LegacyIcon name="gallery" className="size-3.5" />}>
            <AttachmentGallery ticketId={ticket.id} attachments={ticket.attachments} onOpen={setViewer} />
          </Section>
        )}

        {ticket.calls.length > 0 && (
          <Section title={t('box.calls')} icon={<Icon name="call" className="size-3.5" />}>
            <div className="flex flex-col gap-2">
              {ticket.calls.map((c) => (
                <CallRow key={c.id} ticketId={ticket.id} call={c} />
              ))}
            </div>
          </Section>
        )}

        <Section title={t('box.timeline')} icon={<Icon name="clock" className="size-3.5" />}>
          <ol className="relative ml-1.5 flex flex-col gap-2.5 border-l border-tint/10 pl-4">
            {ticket.events.map((e) => (
              <TimelineItem key={e.id} event={e} />
            ))}
          </ol>
        </Section>

        <div className="mt-2.5 border-t border-tint/8 pt-3.5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-mute">
            <LegacyIcon name="message" className="size-3.5" />
            {t('box.chat')}
          </div>
          <div className="flex flex-col gap-2.5">
            {ticket.comments.length === 0 ? (
              <div className="text-xs text-dim italic">{t('box.noReplies')}</div>
            ) : (
              ticket.comments.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-[10px] border border-tint/6 bg-glass-2/40 px-3.5 py-2.5',
                    c.isSystem && 'border-l-[3px] border-l-[#ef4444] bg-[rgba(239,68,68,0.08)]',
                  )}
                >
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className={cn('font-bold', c.isSystem ? 'text-danger' : 'text-info')}>
                      {personName(c.author)}
                    </span>
                    <span className="text-dim" title={dateTime(c.createdAt)}>
                      {timeAgo(c.createdAt, t)}
                    </span>
                  </div>
                  {c.body && (
                    <div className="text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap text-foreground">
                      {c.body}
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

          {a.comment && (
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
                  <span className="text-[11px] text-dim">{t('box.orPaste')}</span>
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
          {a.assign && (
            <KdsAction variant="accept" disabled={busy} onClick={() => move.mutate('assign')}>
              <Icon name="user" className="size-4" />
              {t('box.assign')}
            </KdsAction>
          )}
          {a.start && (
            <KdsAction variant="primary" disabled={busy} onClick={() => move.mutate('start')}>
              <Icon name="play" className="size-4" />
              {t('box.start')}
            </KdsAction>
          )}
          {a.resolve && (
            <KdsAction variant="complete" disabled={busy} onClick={() => setResolveMode('done')}>
              <Icon name="tick-circle" className="size-4" />
              {t('box.resolve')}
            </KdsAction>
          )}
          {a.reject && (
            <KdsAction variant="reject" disabled={busy} onClick={() => setResolveMode('rejected')}>
              <Icon name="close-circle" className="size-4" />
              {t('box.reject')}
            </KdsAction>
          )}
          {a.forward && (
            <KdsAction variant="edit" disabled={busy} onClick={() => setForwardOpen(true)}>
              <Icon name="arrow-swap-horizontal" className="size-4" />
              {t('box.forward')}
            </KdsAction>
          )}
          {a.release && (
            <KdsAction variant="edit" disabled={busy} onClick={() => setReleaseOpen(true)}>
              <Icon name="arrow-left" className="size-4" />
              {t('box.release')}
            </KdsAction>
          )}
          {a.call && <CallbackCallButton ticketId={ticket.id} onCalled={() => setOutcomeOpen(true)} />}
          {a.recordOutcome && (
            <KdsAction variant="primary" onClick={() => setOutcomeOpen(true)}>
              <Icon name="tick-circle" className="size-4" />
              {t('box.outcome')}
            </KdsAction>
          )}
          {readOnly && ticket.status !== 'closed' && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-mute">
              <Icon name="eye" className="size-4" />
              {t('box.readOnly')}
            </span>
          )}
          {!readOnly && workingByOther && ticket.assignee && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.12)] px-3 py-1.5 text-xs font-semibold text-shade-[#f59e0b]">
              <LegacyIcon name="lock" className="size-3.5" />
              {t('box.lockedBy', { name: personName(ticket.assignee) })}
            </span>
          )}
          {ticket.status === 'closed' && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-mute">
              <Icon name="tick-circle" className="size-4" />
              {t('status.closed')}
              {ticket.callbackOutcome && ` · ${t(`outcome.${ticket.callbackOutcome}`)}`}
              {ticket.closedBy && ` · ${personName(ticket.closedBy)}`}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {a.forceClose && (
            <KdsAction variant="edit" onClick={() => setForceOpen(true)}>
              {t('box.forceClose')}
            </KdsAction>
          )}
          {a.delete && (
            <KdsAction
              variant="delete"
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

      <ResolveTicketModal ticket={ticket} mode={resolveMode} onClose={() => setResolveMode(null)} />
      <ForwardTicketModal ticket={ticket} open={forwardOpen} onClose={() => setForwardOpen(false)} />
      <ReleaseTicketModal ticket={ticket} open={releaseOpen} onClose={() => setReleaseOpen(false)} />
      <CallbackOutcomeModal ticketId={ticket.id} open={outcomeOpen} onClose={() => setOutcomeOpen(false)} />
      <ForceCloseModal ticket={ticket} open={forceOpen} onClose={() => setForceOpen(false)} />
      <DocViewer source={viewer} onClose={() => setViewer(null)} />
    </>
  );
}

function ResolutionBanner({ ticket }: { ticket: TicketDetail }) {
  const { t } = useTranslation('ticket');
  const done = ticket.resolution === 'done';
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[10px] border-[1.5px] border-l-4 px-3.5 py-3',
        done
          ? 'border-[rgba(16,185,129,0.38)] border-l-[#10b981] bg-[linear-gradient(135deg,rgba(16,185,129,0.14),color-mix(in_srgb,var(--glass)_85%,transparent))]'
          : 'border-[rgba(239,68,68,0.38)] border-l-[#ef4444] bg-[linear-gradient(135deg,rgba(239,68,68,0.14),color-mix(in_srgb,var(--glass)_85%,transparent))]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[13px] font-bold',
            done ? 'text-positive' : 'text-danger',
          )}
        >
          <Icon name={done ? 'tick-circle' : 'close-circle'} className="size-4" />
          {t('box.metaResolution')}: {t(`resolution.${ticket.resolution as 'done' | 'rejected'}`)}
        </span>
        <span className="text-[11px] text-mute">
          {personName(ticket.resolvedBy)} · {timeAgo(ticket.resolvedAt, t)}
        </span>
      </div>
      {ticket.resolutionNote && (
        <div className="rounded-[7px] border border-tint/8 bg-well/28 px-3 py-2 text-[12.5px] leading-[1.45] font-medium break-words whitespace-pre-wrap text-foreground">
          {ticket.resolutionNote}
        </div>
      )}
    </div>
  );
}

function CallRow({ ticketId, call }: { ticketId: number; call: TicketCall }) {
  const scope = useApiScope();
  const { t } = useTranslation('ticket');
  const tone =
    call.attemptStatus === 'connected'
      ? 'text-positive'
      : call.attemptStatus === 'not_connected' || call.attemptStatus === 'failed'
        ? 'text-danger'
        : 'text-caution';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-tint/6 bg-glass-2/40 px-3.5 py-2.5 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
        <Icon name={call.kind === 'origin' ? 'call-incoming' : 'call'} className="size-3.5 text-info" />
        {call.kind === 'origin' ? t('box.callOrigin') : t('box.callBack')}
      </span>
      <span className="text-mute">{dateTime(call.startedAt)}</span>
      {call.operator && <span className="text-ink-2">{personName(call.operator)}</span>}
      {call.talkSeconds !== null && call.talkSeconds > 0 && (
        <span className="text-mute">{t('box.talk', { n: call.talkSeconds })}</span>
      )}
      {call.attemptStatus && <span className={cn('font-semibold', tone)}>{t(`attempt.${call.attemptStatus}`)}</span>}
      {call.outcome && <span className="font-semibold text-violet">{t(`outcome.${call.outcome}`)}</span>}
      <span className="ml-auto">
        {call.recording.status === 'found' ? (
          // oxlint-disable-next-line jsx-a11y/media-has-caption -- phone recordings have no captions
          <audio
            controls
            preload="none"
            src={recordingUrl(ticketId, call.id, false, scope)}
            className="h-8 w-[260px]"
          />
        ) : (
          <span className="text-[11.5px] text-dim">{t(`box.recording.${call.recording.status}`)}</span>
        )}
      </span>
    </div>
  );
}

function TimelineItem({ event }: { event: TicketEvent }) {
  const { t, i18n } = useTranslation('ticket');
  const label =
    event.kind === 'forwarded'
      ? t('event.forwarded', {
          from: refName(event.fromRegion, i18n.language) || '—',
          to: refName(event.toRegion, i18n.language),
        })
      : t(`event.${event.kind}`);
  return (
    <li className="relative">
      <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-sidebar bg-info" />
      <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
        <span className="font-bold text-foreground">{label}</span>
        <span className="text-mute">{event.actor ? personName(event.actor) : t('box.system')}</span>
        <span className="text-[11px] text-dim">{dateTime(event.createdAt)}</span>
      </div>
      {event.note && <div className="mt-0.5 text-[12px] break-words whitespace-pre-wrap text-ink-2">{event.note}</div>}
    </li>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-mute">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Meta({ label, color, children }: { label: string; color?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <span className="text-[11px] font-semibold tracking-[0.5px] text-dim uppercase">{label}</span>
      <span className="text-[13px] font-bold break-words text-ink" style={color ? { color } : undefined}>
        {children}
      </span>
    </div>
  );
}
