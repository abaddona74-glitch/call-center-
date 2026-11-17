import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DocViewer,
  Dropzone,
  KdsAction,
  KdsField,
  KdsInput,
  KdsTextarea,
  PreviewStrip,
  UrgentToggle,
  type ViewerSource,
  acceptFiles,
  createTicket,
  ticketKeys,
  usePasteTarget,
} from '@/entities/ticket';
import { Icon } from '@/shared/ui/icon';
import { KdsCloseButton, KdsIdBadge, KdsModal, KdsModalActions, KdsModalBody, KdsModalHeader } from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

/**
 * "Yangi Ticket Ochish" (production layout: no creator/target fields — the creator is the
 * session user and new tickets go to every receiver). Ctrl+V adds screenshots while open.
 */
export function CreateTicketModal({
  open,
  onOpenChange,
  maxFileMb,
  initialFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxFileMb: number;
  /** Screenshots pasted on the board that opened the modal. */
  initialFiles: File[];
}) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [phone, setPhone] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setFiles(acceptFiles([], initialFiles, maxFileMb, t));
    const timer = setTimeout(() => commentRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [open, initialFiles, maxFileMb, t]);

  usePasteTarget(open && viewer === null, (pasted) => setFiles((cur) => acceptFiles(cur, pasted, maxFileMb, t)));

  const reset = () => {
    setBody('');
    setPhone('');
    setUrgent(false);
    setFiles([]);
  };

  const create = useMutation({
    mutationFn: () => createTicket({ body: body.trim(), customerPhone: phone.trim(), isUrgent: urgent, files }),
    onSuccess: async () => {
      reset();
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <KdsModal open={open} onOpenChange={close} title={t('form.newTitle')} width={620} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim() && files.length === 0) {
            toast.warning(t('form.required'));
            return;
          }
          create.mutate();
        }}
      >
        <KdsModalHeader>
          <div className="flex items-center gap-3">
            <KdsIdBadge>{t('form.newBadge')}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-white">{t('form.newTitle')}</h3>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-1">
          <KdsField label={t('form.phone')} icon={<Icon name="call" className="size-3.5" />} htmlFor="kds-new-phone">
            <KdsInput
              id="kds-new-phone"
              value={phone}
              maxLength={32}
              inputMode="tel"
              placeholder="+998 90 123 45 67"
              onChange={(e) => setPhone(e.target.value)}
            />
          </KdsField>
          <UrgentToggle
            checked={urgent}
            onChange={setUrgent}
            label={t('form.urgent')}
            description={t('form.urgentDesc')}
            switchTitle={t('form.urgentSwitch')}
          />
          <KdsField label={t('form.comment')} icon={<LegacyIcon name="message" className="size-3.5" />} htmlFor="kds-new-comment">
            <KdsTextarea
              id="kds-new-comment"
              ref={commentRef}
              value={body}
              maxLength={4000}
              placeholder={t('form.commentPlaceholder')}
              onChange={(e) => setBody(e.target.value)}
            />
          </KdsField>
          <KdsField label={t('form.files')} icon={<LegacyIcon name="gallery" className="size-3.5" />}>
            <Dropzone onFiles={(added) => setFiles((cur) => acceptFiles(cur, added, maxFileMb, t))} />
            <PreviewStrip
              files={files}
              onRemove={(i) => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
              onOpen={(file) => setViewer({ kind: 'local', file })}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions>
          <KdsAction variant="delete" onClick={() => close(false)}>
            {t('form.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? t('form.sending') : t('form.submit')}
          </KdsAction>
        </KdsModalActions>
      </form>
      <DocViewer source={viewer} onClose={() => setViewer(null)} />
    </KdsModal>
  );
}
