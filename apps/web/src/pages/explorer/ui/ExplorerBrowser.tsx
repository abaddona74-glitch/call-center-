import type { RecordingDir, RecordingFile } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  InfoPill,
  RecordingKindBadge,
  audioPlayer,
  crumbLabel,
  folderMeta,
  formatDuration,
  formatExplorerDateTime,
  formatFullDateTime,
  formatSize,
  parentPath,
  recordingStreamUrl,
  recordingTreeQuery,
} from '@/entities/recording';
import { useZipExport } from '@/features/recordings/zip-export';
import { isHttpError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon, type LegacyIconName } from '@/shared/ui/legacy-icon';

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** Windows-Explorer-like navigation history (legacy: in memory, not in the URL). */
function useExplorerHistory() {
  const [nav, setNav] = useState({ history: [''], index: 0 });
  const path = nav.history[nav.index];
  return {
    path,
    canBack: nav.index > 0,
    canForward: nav.index < nav.history.length - 1,
    go: (next: string) =>
      setNav((s) => {
        if (s.history[s.index] === next) return s;
        const history = [...s.history.slice(0, s.index + 1), next];
        return { history, index: history.length - 1 };
      }),
    back: () => setNav((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s)),
    forward: () => setNav((s) => (s.index < s.history.length - 1 ? { ...s, index: s.index + 1 } : s)),
  };
}

export function ExplorerBrowser({ onPlay }: { onPlay: () => void }) {
  const { t, i18n } = useTranslation('recording');
  const lang = i18n.language;
  const nav = useExplorerHistory();
  const [search, setSearch] = useState('');
  const tree = useQuery(recordingTreeQuery(nav.path));
  const zip = useZipExport();

  const navigate = (next: string) => {
    setSearch('');
    nav.go(next);
  };
  const up = () => nav.path && navigate(parentPath(nav.path));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.altKey && e.key === 'ArrowLeft') nav.back();
      else if (e.altKey && e.key === 'ArrowRight') nav.forward();
      else if (e.altKey && e.key === 'ArrowUp') up();
      else if (e.key === 'Backspace' && !e.altKey && !e.ctrlKey && !e.metaKey) nav.back();
      else return;
      e.preventDefault();
      setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const q = search.trim().toLowerCase();
  const dirs = useMemo(
    () =>
      (tree.data?.directories ?? [])
        .map((d) => ({ ...d, meta: folderMeta(d.name, nav.path, lang) }))
        .filter((d) => !q || [d.name, d.meta.display, d.meta.subtitle].some((v) => v.toLowerCase().includes(q))),
    [tree.data, nav.path, lang, q],
  );
  const allFiles = tree.data?.files ?? [];
  const files = q ? allFiles.filter((f) => f.name.toLowerCase().includes(q)) : allFiles;

  const play = (file: RecordingFile) => {
    if (file.kind === 'empty') {
      toast.warning(t('emptyAlert'));
      return;
    }
    audioPlayer.play({
      key: file.path,
      title: file.name,
      src: recordingStreamUrl(file.path),
      downloadUrl: recordingStreamUrl(file.path, true),
      size: file.size,
    });
    onPlay();
  };

  const parts = nav.path ? nav.path.split('/') : [];
  const playable = allFiles.filter((f) => f.kind !== 'empty');

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tint/8 bg-glass/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-[3px] rounded-lg border border-tint/8 bg-glass-2/70 px-[5px] py-[3px]">
            <NavButton icon="chevron-left" title={t('back')} disabled={!nav.canBack} onClick={() => { setSearch(''); nav.back(); }} />
            <NavButton icon="chevron-right" title={t('forward')} disabled={!nav.canForward} onClick={() => { setSearch(''); nav.forward(); }} />
            <NavButton icon="chevron-up" title={t('up')} disabled={!nav.path} onClick={up} />
            <div className="mx-0.5 h-[18px] w-px bg-tint/10" />
            <NavButton icon="rotate-cw" title={t('refresh')} small onClick={() => void tree.refetch()} />
          </div>
          <nav className="flex items-center gap-2 overflow-x-auto text-[13px] text-mute" aria-label="breadcrumb">
            <Crumb active={parts.length === 0} onClick={() => navigate('')}>
              <Icon name="folder" className="size-[15px]" />
              {t('root')}
            </Crumb>
            {parts.map((_, i) => (
              <span key={parts.slice(0, i + 1).join('/')} className="flex items-center gap-2">
                <span>/</span>
                <Crumb active={i === parts.length - 1} onClick={() => navigate(parts.slice(0, i + 1).join('/'))}>
                  {crumbLabel(parts, i, lang)}
                </Crumb>
              </span>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2.5">
          {playable.length > 0 && (
            <button
              type="button"
              title={t('zipTitle')}
              disabled={zip.isPending}
              onClick={() =>
                zip.mutate({
                  source: 'files',
                  paths: playable.map((f) => f.path),
                  zipName: `recordings_${nav.path.replaceAll('/', '-') || 'monitor'}.zip`,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-tint/8 bg-tint/8 px-3 py-1.5 text-xs text-ink transition hover:border-[#6366f1] hover:bg-[#6366f1] hover:shadow-[0_2px_8px_rgba(99,102,241,0.4)] disabled:cursor-wait disabled:opacity-60"
            >
              <LegacyIcon name="document-download" className="size-3.5" />
              {t('zip')}
            </button>
          )}
          <div className="relative min-w-[240px]">
            <span className="pointer-events-none absolute top-1/2 left-2.5 inline-flex -translate-y-1/2 text-dim">
              <LegacyIcon name="search" strokeWidth={2.5} className="size-[15px]" />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              className="w-full rounded-lg border border-tint/8 bg-well/30 py-2 pr-3.5 pl-[34px] text-[13px] text-ink outline-none transition-colors focus:border-[#6366f1]"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      {tree.isPending ? (
        <div className="flex flex-col items-center justify-center gap-4 px-5 py-[60px]">
          <span className="inline-block size-11 animate-spin rounded-full border-[3.5px] border-[rgba(56,189,248,0.2)] border-t-info shadow-[0_0_18px_rgba(56,189,248,0.3)]" />
          <span className="text-sm font-semibold tracking-[0.3px] text-mute">{t('loading')}</span>
        </div>
      ) : tree.isError ? (
        <div className="rounded-xl border border-tint/8 px-5 py-5 text-center text-sm text-shade-[#ef4444]">
          {isHttpError(tree.error, 503) ? t('unavailable') : t('error', { message: tree.error.message })}
        </div>
      ) : (
        <>
          {dirs.length > 0 && (
            <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3.5">
              {dirs.map((d) => (
                <FolderCard key={d.path} dir={d} meta={d.meta} lang={lang} onOpen={() => navigate(d.path)} />
              ))}
            </div>
          )}
          {allFiles.length > 0 && (
            <div className="w-full overflow-x-auto rounded-xl border border-tint/8">
              <table className="w-full border-collapse text-center text-[13px]">
                <thead>
                  <tr>
                    {(['name', 'type', 'size', 'duration', 'datetime', 'actions'] as const).map((c) => (
                      <th
                        key={c}
                        className={cn(
                          'border-b border-tint/8 bg-glass-2/85 px-3.5 py-3 align-middle text-[11px] font-bold tracking-[0.6px] whitespace-nowrap text-mute uppercase',
                          c === 'name' && 'text-left',
                        )}
                      >
                        {t(`col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {files.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-mute">
                        {t('searchEmpty')}
                      </td>
                    </tr>
                  ) : (
                    files.map((f) => <FileRow key={f.path} file={f} lang={lang} onPlay={() => play(f)} />)
                  )}
                </tbody>
              </table>
            </div>
          )}
          {dirs.length === 0 && allFiles.length === 0 && (
            <div className="py-10 text-center text-[13px] text-dim">{q ? t('searchEmpty') : t('emptyFolder')}</div>
          )}
        </>
      )}
    </div>
  );
}

function NavButton({
  icon,
  title,
  disabled,
  small,
  onClick,
}: {
  icon: LegacyIconName;
  title: string;
  disabled?: boolean;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-[30px] items-center justify-center rounded-md text-ink transition-all duration-200 hover:scale-105 hover:bg-tint/12 hover:text-ink active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-25"
    >
      <LegacyIcon name={icon} strokeWidth={2.5} className={small ? 'size-3.5' : 'size-4'} />
    </button>
  );
}

function Crumb({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-lg px-2 py-1 whitespace-nowrap transition-all duration-200 hover:bg-tint/10 hover:text-ink',
        active && 'font-semibold text-shade-[#6366f1]',
      )}
    >
      {children}
    </button>
  );
}

function FolderCard({
  dir,
  meta,
  lang,
  onOpen,
}: {
  dir: RecordingDir;
  meta: { display: string; subtitle: string };
  lang: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation('recording');
  const tooltip = t('folderTooltip', {
    display: meta.display,
    name: dir.name,
    subtitle: meta.subtitle ? ` — ${meta.subtitle}` : '',
    time: formatFullDateTime(dir.modifiedAt),
  });
  return (
    <button
      type="button"
      title={tooltip}
      onClick={onOpen}
      className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-tint/8 bg-tint/3 px-3 py-4 text-center transition-all duration-[250ms] hover:-translate-y-[3px] hover:border-[#6366f1] hover:bg-[rgba(99,102,241,0.1)]"
    >
      <Icon name="folder" className="size-[41px] text-shade-[#f59e0b]" />
      <div className="text-[13px] font-semibold break-words text-ink">{meta.display}</div>
      {meta.subtitle && <div className="-mt-0.5 text-[11px] font-normal text-mute">{meta.subtitle}</div>}
      {dir.modifiedAt && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
          <span
            title={t('lastRecord', { time: formatFullDateTime(dir.modifiedAt) })}
            className="inline-flex items-center gap-1 rounded-md border border-[rgba(167,139,250,0.28)] bg-[rgba(167,139,250,0.12)] px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.2px] whitespace-nowrap text-lilac transition-all duration-200 group-hover:border-[rgba(167,139,250,0.55)] group-hover:bg-[rgba(167,139,250,0.22)] group-hover:text-violet group-hover:shadow-[0_0_10px_rgba(167,139,250,0.2)]"
          >
            <Icon name="timer" className="size-2.5" />
            {formatExplorerDateTime(dir.modifiedAt, lang)}
          </span>
        </div>
      )}
    </button>
  );
}

function FileRow({ file, lang, onPlay }: { file: RecordingFile; lang: string; onPlay: () => void }) {
  const { t } = useTranslation('recording');
  const empty = file.kind === 'empty';
  const actionBtn =
    'inline-flex items-center gap-1.5 rounded-lg border border-tint/8 bg-tint/8 px-3 py-1.5 text-xs text-ink no-underline transition-[transform,background-color,border-color,box-shadow] duration-[140ms] hover:border-[#6366f1] hover:bg-[#6366f1] hover:shadow-[0_2px_8px_rgba(99,102,241,0.4)]';
  return (
    <tr className="border-l-[3px] border-transparent transition-[background,filter] duration-150 hover:bg-tint/4 hover:brightness-115">
      <td className="border-b border-tint/5 px-3.5 py-[11px] text-left align-middle whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Icon name="headphone" className="size-3.5 text-shade-[#06b6d4]" />
          <span className="font-mono font-medium">{file.name}</span>
        </div>
      </td>
      <td className="border-b border-tint/5 px-3.5 py-[11px] align-middle whitespace-nowrap">
        <RecordingKindBadge kind={file.kind} />
      </td>
      <td className="border-b border-tint/5 px-3.5 py-[11px] align-middle whitespace-nowrap">
        <InfoPill>{formatSize(file.size)}</InfoPill>
      </td>
      <td className="border-b border-tint/5 px-3.5 py-[11px] align-middle whitespace-nowrap">
        <span className={cn('inline-flex items-center gap-[3px] font-mono text-[13px] font-semibold', empty ? 'text-mute' : 'text-info')}>
          <Icon name="timer" className="size-3" />
          {empty ? t('durationEmpty') : formatDuration(file.durationSec)}
        </span>
      </td>
      <td className="border-b border-tint/5 px-3.5 py-[11px] align-middle whitespace-nowrap text-xs" title={formatFullDateTime(file.modifiedAt)}>
        <div className="font-medium text-foreground">{formatExplorerDateTime(file.modifiedAt, lang)}</div>
      </td>
      <td className="border-b border-tint/5 px-3.5 py-[11px] align-middle whitespace-nowrap">
        <div className="flex items-center justify-center gap-1">
          {empty ? (
            <button type="button" title={t('emptyHint')} onClick={onPlay} className={cn(actionBtn, 'cursor-not-allowed opacity-50')}>
              <Icon name="close-circle" className="size-3" />
              {t('emptyBtn')}
            </button>
          ) : (
            <button type="button" onClick={onPlay} className={actionBtn}>
              <Icon name="play" className="size-3" />
              {t('listen')}
            </button>
          )}
          {!empty && (
            <a href={recordingStreamUrl(file.path, true)} className={actionBtn}>
              <Icon name="import" className="size-3" />
              {t('download')}
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}
