import { TICKET_ATTACHMENT_ACCEPT, TICKET_MAX_FILES_PER_UPLOAD } from '@cc/shared';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/cn';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

export type LocalKind = 'image' | 'pdf' | 'word';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Client-side mirror of the server allow-list (the server re-checks the bytes). */
export function localKind(file: File): LocalKind | null {
  const name = file.name.toLowerCase();
  if (IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'word';
  return null;
}

/** Keeps allowed files within the size/count limits; tells the user about the rest. */
export function acceptFiles(current: File[], incoming: File[], maxMb: number, t: TFunction<'ticket'>): File[] {
  const next = [...current];
  for (const f of incoming) {
    if (!localKind(f)) {
      toast.error(t('form.fileRejected', { name: f.name }));
      continue;
    }
    if (f.size > maxMb * 1024 * 1024) {
      toast.error(t('form.fileTooBig', { name: f.name, mb: maxMb }));
      continue;
    }
    if (next.length < TICKET_MAX_FILES_PER_UPLOAD) next.push(f);
  }
  return next;
}

/** Image files from a clipboard paste (legacy: only `image/*`, named screenshot_<ms>.png). */
export function clipboardImages(e: ClipboardEvent): File[] {
  const out: File[] = [];
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind === 'file' && item.type.includes('image')) {
      const blob = item.getAsFile();
      if (blob) out.push(new File([blob], `screenshot_${Date.now()}.png`, { type: blob.type || 'image/png' }));
    }
  }
  return out;
}

/** `.tk-dropzone` (create modal). */
export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation('ticket');
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') input.current?.click();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[rgba(56,189,248,0.35)] bg-[rgba(30,41,59,0.35)] px-4 py-[22px] text-center transition-all duration-[220ms] hover:-translate-y-px hover:border-[#38bdf8] hover:bg-[rgba(56,189,248,0.08)]',
        over && '-translate-y-px border-[#38bdf8] bg-[rgba(56,189,248,0.08)]',
      )}
    >
      <LegacyIcon name="document-upload" className="size-9 text-[#38bdf8]" />
      <span className="text-[13px] font-semibold text-[#f1f5f9]">{t('form.drop')}</span>
      <span className="text-[11.5px] text-[#94a3b8]">{t('form.dropHint')}</span>
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-[#f1f5f9]">
        <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd>
      </span>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={TICKET_ATTACHMENT_ACCEPT}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/20 bg-white/12 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#38bdf8]">
      {children}
    </kbd>
  );
}

/** Hidden file input + the legacy reply "attach" button. */
export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation('ticket');
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-[5px] rounded-lg border border-white/12 bg-white/7 px-3 py-1.5 text-[11.5px] font-semibold text-[#cbd5e1] hover:text-white"
      >
        <LegacyIcon name="gallery" className="size-[13px]" />
        {t('box.attach')}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={TICKET_ATTACHMENT_ACCEPT}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** `.tk-preview-strip` of files not yet uploaded. */
export function PreviewStrip({ files, onRemove, onOpen }: { files: File[]; onRemove: (index: number) => void; onOpen: (file: File) => void }) {
  const { t } = useTranslation('ticket');
  const urls = useMemo(() => files.map((f) => (localKind(f) === 'image' ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  if (files.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {files.map((f, i) => {
        const kind = localKind(f);
        return (
          <div key={`${f.name}-${i}`} className="relative size-[72px] overflow-hidden rounded-lg border border-white/15 bg-black">
            <button type="button" title={t('form.preview')} onClick={() => onOpen(f)} className="size-full">
              {kind === 'image' && urls[i] ? (
                <img src={urls[i] as string} alt={f.name} className="size-full object-cover" />
              ) : (
                <span
                  className={cn(
                    'flex size-full flex-col items-center justify-center p-1 text-center',
                    kind === 'pdf'
                      ? 'border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] text-[#f87171]'
                      : 'border border-[rgba(59,130,246,0.35)] bg-[rgba(37,99,235,0.15)] text-[#60a5fa]',
                  )}
                >
                  <LegacyIcon name={kind === 'pdf' ? 'file-pdf' : 'file-word'} className="size-[18px]" />
                  <span className="mt-0.5 text-[10px] font-extrabold uppercase">{kind === 'pdf' ? 'PDF' : 'DOCX'}</span>
                  <span className="mt-px max-w-[60px] truncate text-[9px] text-[#94a3b8]">{f.name}</span>
                </span>
              )}
            </button>
            <button
              type="button"
              title={t('form.remove')}
              onClick={() => onRemove(i)}
              className="absolute top-0.5 right-0.5 flex size-[18px] items-center justify-center rounded-full bg-[rgba(239,68,68,0.85)] text-[11px] leading-none text-white"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ctrl+V routing: the topmost open form (reply box, create modal) receives pasted
// screenshots; with nothing open, the page decides (legacy: opens "new ticket").
// ---------------------------------------------------------------------------
const pasteTargets: Array<{ current: (files: File[]) => void }> = [];

export function usePasteTarget(active: boolean, handler: (files: File[]) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = { current: (files: File[]) => ref.current(files) };
    pasteTargets.push(entry);
    return () => {
      const i = pasteTargets.indexOf(entry);
      if (i >= 0) pasteTargets.splice(i, 1);
    };
  }, [active]);
}

export function useClipboardRouter(fallback: (files: File[]) => void): void {
  const ref = useRef(fallback);
  ref.current = fallback;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = clipboardImages(e);
      if (files.length === 0) return;
      e.preventDefault();
      const target = pasteTargets.at(-1);
      if (target) target.current(files);
      else ref.current(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
}
