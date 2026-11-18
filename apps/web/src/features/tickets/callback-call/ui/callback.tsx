import { CALLBACK_OUTCOMES, type CallbackOutcome, type TicketDetail } from '@cc/shared';
import { formatUzPhone } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KdsAction, KdsField, KdsTextarea, ticketActions, ticketKeys, ticketQuery } from '@/entities/ticket';
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

/**
 * "Call" for the callback queue: AMI Originate from my own extension to the ticket's number (the server
 * picks the number; the client never sends it). `onCalled` opens the outcome dialog.
 */
export function CallbackCallButton({
  ticketId,
  onCalled,
  compact,
}: {
  ticketId: number;
  onCalled: (detail: TicketDetail) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const call = useMutation({
    mutationFn: () => ticketActions.call(ticketId),
    onSuccess: async (detail) => {
      queryClient.setQueryData(ticketKeys.detail(ticketId), detail);
      toast.success(t('callback.calling'));
      onCalled(detail);
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });
  return (
    <KdsAction
      variant="complete"
      disabled={call.isPending}
      onClick={() => call.mutate()}
      className={compact ? 'px-3 py-1.5 text-[11.5px]' : undefined}
    >
      <Icon name="call" className={compact ? 'size-3.5' : 'size-4'} />
      {compact ? t('callback.call') : t('box.call')}
    </KdsAction>
  );
}

const OUTCOME_TONE: Record<CallbackOutcome, string> = {
  informed: 'border-[rgba(16,185,129,0.5)] bg-[rgba(16,185,129,0.18)] text-positive',
  unresolved: 'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)] text-caution',
  other: 'border-[rgba(56,189,248,0.5)] bg-[rgba(56,189,248,0.16)] text-info',
  not_reached: 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.16)] text-danger',
};

/**
 * Outcome of my callback: the attempt state comes live from the ticket (WS → refetch). The ticket closes
 * only when AMI confirmed a conversation ≥ 10 s AND an outcome is recorded (the server decides).
 */
export function CallbackOutcomeModal({
  ticketId,
  open,
  onClose,
}: {
  ticketId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const detail = useQuery({
    ...ticketQuery(ticketId ?? 0),
    enabled: open && ticketId !== null,
    refetchInterval: open ? 5_000 : false,
  });
  const [outcome, setOutcome] = useState<CallbackOutcome | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNote('');
    }
  }, [open, ticketId]);

  const ticket = detail.data;
  const attempt = ticket?.calls.filter((c) => c.kind === 'callback').at(-1) ?? null;

  const save = useMutation({
    mutationFn: () => ticketActions.outcome(ticketId as number, outcome as CallbackOutcome, note.trim() || undefined),
    onSuccess: async (d) => {
      queryClient.setQueryData(ticketKeys.detail(d.id), d);
      if (d.status === 'closed') toast.success(t('callback.closed', { code: d.code }));
      else if (outcome === 'not_reached' || d.calls.at(-1)?.attemptStatus === 'not_connected')
        toast.info(t('callback.attemptSaved'));
      else toast.info(t('callback.pendingSaved'));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  return (
    <KdsModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('callback.outcomeTitle')}
      width={540}
      closeOnBackdrop
    >
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (outcome) save.mutate();
        }}
      >
        <KdsModalHeader>
          <div className="flex items-center gap-3">
            <KdsIdBadge>{ticket?.code ?? '…'}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-ink">{t('callback.outcomeTitle')}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-3.5 px-5 py-[18px]">
          {ticket && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tint/7 bg-glass-2/50 px-4 py-3">
              <span className="inline-flex items-center gap-2 text-[14px] font-bold text-ink">
                <Icon name="call" className="size-4 text-info" />
                {ticket.customerPhone ? formatUzPhone(ticket.customerPhone) : '—'}
              </span>
              {attempt?.attemptStatus && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold',
                    attempt.attemptStatus === 'connected'
                      ? 'border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.15)] text-positive'
                      : attempt.attemptStatus === 'not_connected' || attempt.attemptStatus === 'failed'
                        ? 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)] text-danger'
                        : 'animate-pulse border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.15)] text-caution',
                  )}
                >
                  {t(`attempt.${attempt.attemptStatus}`)}
                  {attempt.talkSeconds !== null && ` · ${t('box.talk', { n: attempt.talkSeconds })}`}
                </span>
              )}
            </div>
          )}
          <p className="text-[12.5px] leading-[1.45] text-mute">{t('callback.outcomeHint')}</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('callback.outcomeTitle')}>
            {CALLBACK_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className={cn(
                  'rounded-[10px] border border-tint/12 bg-tint/5 px-3 py-2.5 text-left text-[12.5px] font-semibold text-ink-2 transition-all duration-150 hover:bg-tint/10',
                  outcome === o && OUTCOME_TONE[o],
                  outcome === o && 'shadow-[0_0_0_2px_color-mix(in_srgb,var(--tint)_8%,transparent)]',
                )}
              >
                {t(`outcome.${o}`)}
              </button>
            ))}
          </div>
          <KdsField
            label={t('callback.note')}
            icon={<Icon name="edit" className="size-3.5" />}
            htmlFor="kds-outcome-note"
          >
            <KdsTextarea
              id="kds-outcome-note"
              value={note}
              maxLength={1000}
              placeholder={t('callback.notePlaceholder')}
              className="min-h-16"
              onChange={(e) => setNote(e.target.value)}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions className="justify-end gap-2.5 px-5 py-3">
          <KdsAction variant="delete" onClick={onClose}>
            {t('callback.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant="primary" disabled={!outcome || save.isPending} className="px-4 py-2">
            <Icon name="tick-circle" className="size-3.5" />
            {t('callback.submit')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}

/** Superuser: close a queued ticket without a confirmed call (reason required, audited). */
export function ForceCloseModal({
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
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  const save = useMutation({
    mutationFn: () => ticketActions.forceClose(ticket.id, note.trim()),
    onSuccess: async (d) => {
      queryClient.setQueryData(ticketKeys.detail(d.id), d);
      onClose();
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });
  return (
    <KdsModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('callback.forceTitle')}
      width={480}
      closeOnBackdrop
    >
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim().length >= 2) save.mutate();
        }}
      >
        <KdsModalHeader>
          <div className="flex items-center gap-3">
            <KdsIdBadge>{ticket.code}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-ink">{t('callback.forceTitle')}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="px-5 py-[18px]">
          <KdsField label={t('callback.forceNote')} htmlFor="kds-force-note">
            <KdsTextarea
              id="kds-force-note"
              required
              minLength={2}
              maxLength={1000}
              value={note}
              className="min-h-20"
              onChange={(e) => setNote(e.target.value)}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions className="justify-end gap-2.5 px-5 py-3">
          <KdsAction variant="delete" onClick={onClose}>
            {t('callback.cancel')}
          </KdsAction>
          <KdsAction
            type="submit"
            variant="reject"
            disabled={save.isPending || note.trim().length < 2}
            className="px-4 py-2"
          >
            {t('callback.forceSubmit')}
          </KdsAction>
        </KdsModalActions>
      </form>
    </KdsModal>
  );
}
