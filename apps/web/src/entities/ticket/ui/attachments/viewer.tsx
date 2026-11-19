import type { TicketAttachment } from '@cc/shared';
import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { attachmentUrl, fetchDocPreview } from '../../api/ticket.api';
import { fileSize } from '../../lib/format';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { KdsModal } from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';
import { type LocalKind, localKind } from './picker';
import './viewer.css';
import { useApiScope } from '@/shared/lib/api-scope';

export type ViewerSource =
  { kind: 'remote'; ticketId: number; attachment: TicketAttachment } | { kind: 'local'; file: File };

type ViewKind = 'image' | 'pdf' | 'word';

function sourceKind(s: ViewerSource): ViewKind | null {
  if (s.kind === 'remote') return s.attachment.kind === 'docx' ? 'word' : s.attachment.kind;
  return localKind(s.file) as LocalKind | null;
}

const ICON_STYLE: Record<ViewKind, string> = {
  image: 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.15)] text-positive',
  pdf: 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] text-danger',
  word: 'border-[rgba(59,130,246,0.35)] bg-[rgba(37,99,235,0.15)] text-link',
};

/**
 * Legacy in-place document viewer (`#tkDocViewerModal`): images, PDF (from a Blob URL, so the
 * attachment-only download endpoint can still be shown inline) and DOCX (server-converted HTML,
 * sanitized again here with DOMPurify).
 */
export function DocViewer({ source, onClose }: { source: ViewerSource | null; onClose: () => void }) {
  const { t } = useTranslation('ticket');
  const scope = useApiScope();
  const kind = source ? sourceKind(source) : null;
  const name = source ? (source.kind === 'remote' ? source.attachment.fileName : source.file.name) : '';
  const download = source?.kind === 'remote' ? attachmentUrl(source.ticketId, source.attachment.id, scope) : null;
  const [url, setUrl] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setHtml(null);
    setFailed(false);
    if (!source || !kind) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    if (source.kind === 'local') {
      if (kind === 'word') setFailed(true);
      else {
        objectUrl = URL.createObjectURL(source.file);
        setUrl(objectUrl);
      }
    } else if (kind === 'image') {
      setUrl(attachmentUrl(source.ticketId, source.attachment.id, scope));
    } else if (kind === 'pdf') {
      fetch(attachmentUrl(source.ticketId, source.attachment.id, scope), { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((buf) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
          setUrl(objectUrl);
        })
        .catch(() => !cancelled && setFailed(true));
    } else {
      fetchDocPreview(source.ticketId, source.attachment.id, scope)
        .then((r) => !cancelled && setHtml(DOMPurify.sanitize(r.html, { USE_PROFILES: { html: true } })))
        .catch(() => !cancelled && setFailed(true));
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, kind]);

  const subtitle = kind === 'image' ? t('doc.image') : kind === 'pdf' ? t('doc.pdf') : t('doc.word');
  const actionBtn =
    'inline-flex items-center gap-1.5 rounded-lg border border-tint/12 bg-tint/6 px-3.5 py-[7px] text-xs font-semibold text-ink transition-all duration-150 hover:border-[rgba(56,189,248,0.45)] hover:bg-[rgba(56,189,248,0.2)] hover:text-info';

  return (
    <KdsModal
      open={source !== null}
      onOpenChange={(o) => !o && onClose()}
      title={name}
      width={null}
      closeOnBackdrop
      overlayClassName="bg-[rgba(2,6,23,0.88)] backdrop-blur-[8px]"
      className="h-[92vh] max-h-[92vh] w-[95vw] max-w-[1200px] rounded-[14px] border-tint/12 shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_80%,transparent),0_0_30px_rgba(14,165,233,0.15)]"
    >
      <div className="flex h-[58px] shrink-0 items-center justify-between gap-4 border-b border-tint/8 bg-glass/95 px-[18px]">
        <div className="flex min-w-0 items-center gap-3">
          {kind && (
            <span className={cn('flex size-9 items-center justify-center rounded-lg border', ICON_STYLE[kind])}>
              {kind === 'image' ? (
                <LegacyIcon name="gallery" />
              ) : (
                <LegacyIcon name={kind === 'pdf' ? 'file-pdf' : 'file-word'} />
              )}
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-bold text-ink">{name}</div>
            <div className="text-[11.5px] text-mute">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {download && (
            <a href={download} className={actionBtn} title={t('doc.downloadTitle')}>
              <LegacyIcon name="document-download" className="size-[15px]" />
              {t('doc.download')}
            </a>
          )}
          {url && kind !== 'word' && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(actionBtn, 'bg-mute/10 text-ink-2')}
              title={t('doc.newTabTitle')}
            >
              <LegacyIcon name="export-3" className="size-3.5" />
              {t('doc.newTab')}
            </a>
          )}
          <button
            type="button"
            title={t('doc.close')}
            aria-label={t('doc.close')}
            onClick={onClose}
            className="inline-flex items-center rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.12)] px-2.5 py-[7px] text-danger transition-all hover:border-[#dc2626] hover:bg-[#dc2626] hover:text-white"
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
      </div>
      <div className="relative flex flex-1 items-stretch justify-center overflow-auto bg-[#090d16] light:bg-muted">
        {failed ? (
          <div className="mx-auto my-[60px] h-fit max-w-[600px] rounded-xl border border-[rgba(245,158,11,0.4)] bg-glass-2/80 px-7 py-8 text-center text-ink">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-xl bg-[rgba(245,158,11,0.15)] text-caution">
              <Icon name="document-text" className="size-10" />
            </div>
            <h3 className="mb-2.5 text-lg text-ink">{t('doc.failTitle')}</h3>
            <p className="mb-5 text-[13.5px] leading-[1.6] text-mute">{t('doc.failText')}</p>
            {download && (
              <a href={download} className={cn(actionBtn, 'mx-auto')}>
                <LegacyIcon name="document-download" className="size-[15px]" />
                {t('doc.failDownload', { name })}
              </a>
            )}
          </div>
        ) : kind === 'image' && url ? (
          <div className="flex size-full items-center justify-center overflow-auto p-5">
            <img
              src={url}
              alt={name}
              className="max-h-full max-w-full rounded-lg object-contain shadow-[0_10px_40px_color-mix(in_srgb,var(--shadow-color)_70%,transparent)]"
            />
          </div>
        ) : kind === 'pdf' && url ? (
          <iframe title={name} src={`${url}#toolbar=1&navpanes=1`} className="size-full border-none bg-white" />
        ) : kind === 'word' && html !== null ? (
          <div className="size-full overflow-x-hidden overflow-y-auto bg-[#0b1120] px-4 py-6 light:bg-muted">
            <div className="kds-docx-paper">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#e2e8f0] pb-3">
                <h2 className="m-0! border-0! p-0! text-xl! text-[#1e293b]!">{name}</h2>
                <span className="text-xs text-[#64748b]">{t('doc.wordConverted')}</span>
                {download && (
                  <a
                    href={download}
                    className="inline-flex h-[30px] items-center gap-[5px] rounded-md bg-[rgba(14,165,233,0.15)] px-2.5 text-[11.5px] font-semibold text-[#0284c7] no-underline"
                  >
                    <LegacyIcon name="document-download" className="size-3.5" />
                    {t('doc.original')}
                  </a>
                )}
              </div>
              {html ? (
                // Sanitized twice: server-side allow-list + DOMPurify above.
                // oxlint-disable-next-line react/no-danger
                <div className="kds-docx-body" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <p className="text-[#64748b] italic">{t('doc.noText')}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3.5 text-[13.5px] text-mute">
            <span className="size-10 animate-[tkSpin_0.8s_linear_infinite] rounded-full border-[3px] border-[rgba(56,189,248,0.2)] border-t-[#38bdf8]" />
            {kind === 'word' ? t('doc.loading') : null}
          </div>
        )}
      </div>
    </KdsModal>
  );
}

/** Gallery of a ticket's / comment's attachments: image thumbs + document cards. */
export function AttachmentGallery({
  ticketId,
  attachments,
  compact,
  onOpen,
}: {
  ticketId: number;
  attachments: TicketAttachment[];
  compact?: boolean;
  onOpen: (source: ViewerSource) => void;
}) {
  const { t } = useTranslation('ticket');
  const scope = useApiScope();
  const images = attachments.filter((a) => a.kind === 'image');
  const docs = attachments.filter((a) => a.kind !== 'image');
  if (attachments.length === 0) return null;
  return (
    <div>
      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen({ kind: 'remote', ticketId, attachment: a })}
              className={cn(
                'group relative overflow-hidden rounded-[10px] border border-tint/12 bg-black transition-[transform,border-color] duration-200 hover:scale-[1.03] hover:border-[#38bdf8] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--shadow-color)_40%,transparent)]',
                compact ? 'aspect-video max-w-[140px]' : 'aspect-[4/3]',
              )}
            >
              <img
                src={attachmentUrl(ticketId, a.id, scope)}
                alt={a.fileName}
                loading="lazy"
                className="size-full object-cover"
              />
              {!compact && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <LegacyIcon name="export-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div
          className={cn(
            'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5',
            images.length > 0 ? 'mt-3' : compact ? 'mt-1.5' : 'mt-2',
          )}
        >
          {docs.map((a) => {
            const isPdf = a.kind === 'pdf';
            const ext = isPdf ? 'PDF' : 'DOCX';
            return (
              <div
                key={a.id}
                className={cn(
                  'flex items-center gap-3 overflow-hidden rounded-[10px] border border-tint/8 bg-glass-2/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(56,189,248,0.35)] hover:bg-glass-2/95 hover:shadow-[0_8px_20px_color-mix(in_srgb,var(--shadow-color)_35%,transparent)]',
                  compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
                )}
              >
                <span
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg border font-extrabold tracking-[0.5px] uppercase',
                    compact ? 'size-[34px] min-w-[34px] text-[8px]' : 'size-[42px] min-w-[42px] text-[9px]',
                    isPdf
                      ? 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] text-danger'
                      : 'border-[rgba(59,130,246,0.35)] bg-[rgba(37,99,235,0.18)] text-link',
                  )}
                >
                  <LegacyIcon
                    name={isPdf ? 'file-pdf' : 'file-word'}
                    className={compact ? 'size-3.5' : 'size-[18px]'}
                  />
                  {ext}
                </span>
                <button
                  type="button"
                  title={t('doc.clickToView')}
                  onClick={() => onOpen({ kind: 'remote', ticketId, attachment: a })}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                >
                  <div
                    className={cn(
                      'truncate leading-[1.3] font-semibold text-ink',
                      compact ? 'text-xs' : 'text-[12.5px]',
                    )}
                  >
                    {a.fileName}
                  </div>
                  <div className={cn('mt-0.5 flex gap-2 text-mute', compact ? 'text-[10px]' : 'text-[11px]')}>
                    <span>{t('doc.docMeta', { ext })}</span>
                    <span>• {fileSize(a.size)}</span>
                  </div>
                </button>
                <div className="flex gap-[5px]">
                  <button
                    type="button"
                    title={t('doc.viewTitle')}
                    onClick={() => onOpen({ kind: 'remote', ticketId, attachment: a })}
                    className={cn(
                      'inline-flex items-center gap-[5px] rounded-md border border-[rgba(14,165,233,0.3)] bg-[rgba(14,165,233,0.15)] font-semibold text-info transition-all duration-150 hover:border-[#0284c7] hover:bg-[#0284c7] hover:text-white',
                      compact ? 'h-[26px] px-2 text-[11px]' : 'h-[30px] px-2.5 text-[11.5px]',
                    )}
                  >
                    <Icon name="eye" className="size-3.5" />
                    {t('doc.view')}
                  </button>
                  <a
                    href={attachmentUrl(ticketId, a.id, scope)}
                    title={t('doc.download')}
                    className={cn(
                      'inline-flex items-center justify-center rounded-md border border-tint/10 bg-tint/5 text-ink-2 transition-all duration-150 hover:border-[rgba(56,189,248,0.4)] hover:bg-[rgba(56,189,248,0.2)] hover:text-info',
                      compact ? 'size-[26px]' : 'size-[30px]',
                    )}
                  >
                    <LegacyIcon name="document-download" className="size-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
