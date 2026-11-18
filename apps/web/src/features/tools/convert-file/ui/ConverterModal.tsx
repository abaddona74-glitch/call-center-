import { type ConvertTargetFormat, type ServerConvertTarget, fileExtension } from '@cc/shared';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { convertOnServer } from '@/entities/tool';
import { isHttpError } from '@/shared/api';
import { Icon } from '@/shared/ui/icon';
import { Modal } from '@/shared/ui/modal';
import { convertImage, imageToPdf } from '../lib/image-convert';
import { pdfToImages } from '../lib/pdf-images';
import { pdfToDocx, pdfToText } from '../lib/pdf-text';
import { checkFile, conversionMode, fileTone, formatFileSize } from '../model/plan';
import './converter.css';

interface Result {
  url: string;
  fileName: string;
  size: number;
}

type Phase = 'idle' | 'ready' | 'working' | 'done' | 'failed';

const ACCEPT = '.pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp';

/** i18n key for a failed conversion. */
function errorKey(err: unknown): string {
  if (isHttpError(err)) {
    if (err.status === 413) return 'error.tooLarge';
    if (err.status === 415) return 'error.mismatch';
    if (err.status === 422) return 'error.damaged';
    if (err.status === 429) return 'error.tooMany';
    if (err.status === 503) return 'error.busy';
    if (err.status === 403) return 'error.forbidden';
    return 'error.failed';
  }
  const code = err instanceof Error ? err.message : '';
  if (code === 'decode' || code === 'empty') return 'error.decode';
  if (code === 'encode') return 'error.encode';
  return 'error.failed';
}

/**
 * Universal file converter (legacy viewer #converterModal, screenshot viewer-07): drop or pick a file
 * (≤ 35 MB) → target format → progress → download. Images and PDFs are converted in this browser
 * (canvas, pdf.js); Word and text documents on the server (POST /api/tools/convert). Nothing is stored.
 * The state survives closing the modal, like legacy.
 */
export function ConverterModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('toolsConvert');
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [targets, setTargets] = useState<readonly ConvertTargetFormat[]>([]);
  const [target, setTarget] = useState<ConvertTargetFormat | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ pct: number; status: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [over, setOver] = useState(false);

  // The object URL of the last result lives until it is replaced, cleared or the page is left.
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const reset = () => {
    setFile(null);
    setTargets([]);
    setTarget(null);
    setPhase('idle');
    setProgress(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    const check = checkFile(picked);
    if (!check.ok) {
      toast.error(t(`error.${check.error}`));
      return;
    }
    setFile(picked);
    setTargets(check.targets);
    setTarget(check.targets[0]);
    setPhase('ready');
    setProgress(null);
    setResult(null);
  };

  const run = async () => {
    if (!file || !target) return;
    const source = fileExtension(file.name);
    const mode = conversionMode(source, target);
    if (!mode) return;
    setPhase('working');
    setResult(null);
    setProgress({ pct: 20, status: t('step.prepare') });
    try {
      let out: { blob: Blob; fileName: string };
      if (mode === 'server') {
        setProgress({ pct: 40, status: t('step.upload') });
        const call = convertOnServer(file, target as ServerConvertTarget);
        setProgress({ pct: 75, status: t('step.server') });
        out = await call;
      } else if (mode === 'pdf-images' || mode === 'pdf-text') {
        setProgress({ pct: 30, status: t('step.browser') });
        const onPage = (done: number, total: number) =>
          setProgress({ pct: 30 + Math.round((65 * done) / total), status: t('step.page', { done, total }) });
        out =
          mode === 'pdf-images'
            ? await pdfToImages(file, target as 'png' | 'jpg', onPage)
            : await (target === 'docx' ? pdfToDocx : pdfToText)(file, onPage);
      } else {
        setProgress({ pct: 60, status: t('step.browser') });
        out =
          mode === 'image-pdf' ? await imageToPdf(file) : await convertImage(file, target as 'png' | 'jpg' | 'webp');
      }
      setProgress({ pct: 100, status: t('step.done') });
      // Legacy shows "Tayyor!" for a moment before the result box.
      await new Promise((r) => setTimeout(r, 350));
      setResult({ url: URL.createObjectURL(out.blob), fileName: out.fileName, size: out.blob.size });
      setProgress(null);
      setPhase('done');
    } catch (err) {
      setProgress(null);
      setPhase('failed');
      toast.error(t(errorKey(err)));
    }
  };

  const ext = file ? fileExtension(file.name) : '';
  const working = phase === 'working';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      className="flex max-h-[90vh] w-[95vw] max-w-[820px] flex-col overflow-hidden rounded-2xl border-chart-4/35 bg-sidebar p-0"
    >
      <div className="cv-head">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="cv-head-icon">
            <Icon name="refresh" className="size-5" />
          </span>
          <div className="min-w-0">
            <DialogPrimitive.Title className="cv-title">{t('title')}</DialogPrimitive.Title>
            <p className="cv-subtitle">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="cv-safe max-sm:hidden">
            <Icon name="tick-circle" className="size-[13px]" />
            {t('safe')}
          </span>
          <DialogPrimitive.Close className="cv-close" aria-label={t('close')}>
            <Icon name="close" className="size-4" />
          </DialogPrimitive.Close>
        </div>
      </div>

      <div className="cv-body">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          data-testid="converter-input"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {!file && (
          <div
            role="button"
            tabIndex={0}
            className={`cv-dropzone${over ? ' is-over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
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
              pick(e.dataTransfer.files?.[0]);
            }}
          >
            <div className="cv-drop-icon">
              <Icon name="folder" className="size-[26px]" />
            </div>
            <h4 className="cv-drop-title">{t('drop')}</h4>
            <p className="cv-drop-hint">{t('supported')}</p>
            <span className="cv-choose">
              <Icon name="import" className="size-3.5" />
              {t('choose')}
            </span>
          </div>
        )}

        {file && (
          <div className="cv-details">
            <div className="cv-file-row">
              <div className="flex min-w-0 items-center gap-3">
                <div className="cv-file-badge" data-tone={fileTone(ext)}>
                  {ext.slice(0, 4)}
                </div>
                <div className="min-w-0">
                  <div className="cv-file-name">{file.name}</div>
                  <div className="cv-file-size">{formatFileSize(file.size)}</div>
                </div>
              </div>
              <button type="button" className="cv-replace" title={t('replaceTitle')} onClick={reset} disabled={working}>
                <Icon name="close" className="size-[13px]" />
                {t('replace')}
              </button>
            </div>

            <span className="cv-label">{t('targetLabel')}</span>
            <div className="cv-pills" role="group" aria-label={t('targetLabel')}>
              {targets.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className="cv-pill"
                  aria-pressed={fmt === target}
                  disabled={working}
                  onClick={() => setTarget(fmt)}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>

            <button type="button" className="cv-run" onClick={() => void run()} disabled={working}>
              <Icon name="refresh" className={`size-4${working ? ' animate-spin' : ''}`} />
              {working ? t('working') : phase === 'failed' ? t('retry') : t('convert')}
            </button>
          </div>
        )}

        {progress && (
          <div className="cv-progress" aria-live="polite">
            <div className="cv-progress-row">
              <span>{progress.status}</span>
              <span>{progress.pct}%</span>
            </div>
            <div className="cv-progress-track">
              <div className="cv-progress-bar" style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}

        {result && (
          <div className="cv-result">
            <div className="flex min-w-0 items-center gap-3">
              <div className="cv-result-icon">
                <Icon name="tick-circle" className="size-[22px]" />
              </div>
              <div className="min-w-0">
                <div className="cv-result-label">{t('ready')}</div>
                <div className="cv-result-name">{result.fileName}</div>
                <div className="cv-file-size">{t('size', { size: formatFileSize(result.size) })}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a className="cv-download" href={result.url} download={result.fileName}>
                <Icon name="export" className="size-[15px]" />
                {t('download')}
              </a>
              <button type="button" className="cv-clear" onClick={reset}>
                <Icon name="trash" className="size-3.5" />
                {t('clear')}
              </button>
            </div>
          </div>
        )}

        <div className="cv-note">
          <Icon name="flash" className="size-4 shrink-0 text-chart-4" />
          <span>
            <strong>{t('zeroTitle')}</strong> {t('zeroText')}
          </span>
        </div>
      </div>
    </Modal>
  );
}
