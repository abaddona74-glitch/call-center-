import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { managersQuery } from '@/entities/tool';
import { Icon } from '@/shared/ui/icon';
import { copyText } from '../lib/clipboard';
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  MANAGERS_TABS,
  type ManagersTab,
  filterDirectory,
  isManagersTab,
  nextFontScale,
  normalizeQuery,
  tabCount,
} from '../model/search';
import { CloseIcon, EnvelopeIcon, SearchIcon } from './parts';
import { ExatTable, MinistryTable, RegionsTable, TashkentTable } from './tables';
import '../i18n';
import './managers.css';

const TAB_EMOJI: Record<ManagersTab, string> = {
  tashkent: '🏙️',
  ministry: '🏛️',
  regions: '🗺️',
  exat: '✉️',
};

export interface ManagersDirectoryProps {
  /** Tab to open first (legacy `?tab=`). */
  initialTab?: ManagersTab;
  /** Search to start with (legacy `?q=`). */
  initialQuery?: string;
}

/**
 * Responsible staff directory (legacy tools/managers.html): Tashkent districts, ministries, regions and
 * E-XAT support, with search, font scaling and print. Fills its container (a page or a modal body).
 */
export function ManagersDirectory({ initialTab, initialQuery }: ManagersDirectoryProps) {
  const { t } = useTranslation('managersDirectory');
  const directory = useQuery(managersQuery);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [tab, setTab] = useState<ManagersTab>(isManagersTab(initialTab) ? initialTab : 'tashkent');
  const [search, setSearch] = useState(initialQuery ?? '');
  const [scale, setScale] = useState(1);
  const query = normalizeQuery(search);

  // Legacy hotkey: Ctrl + mouse wheel scales the text (here only over the directory, not the whole app).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale((s) => nextFontScale(s, e.deltaY < 0 ? FONT_SCALE_STEP : -FONT_SCALE_STEP));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const data = directory.data;
  const filtered = useMemo(() => (data ? filterDirectory(data, query) : null), [data, query]);
  const contracts = useMemo(() => data?.tashkent.find((e) => e.isSpecial), [data]);

  const copyPhone = async (display: string) => {
    if (await copyText(display, rootRef.current)) toast.success(t('copied'), { description: display });
    else toast.error(t('copyFailed'), { description: display });
  };
  const onCopy = (display: string) => void copyPhone(display);

  const clearSearch = () => {
    setSearch('');
    inputRef.current?.focus();
  };

  const totals: Record<ManagersTab, number | undefined> = {
    tashkent: data?.tashkent.length,
    ministry: data?.ministries.length,
    regions: data?.regions.length,
    exat: undefined, // legacy shows the "Unicon.uz" badge instead of a count
  };

  let body: ReactNode;
  if (directory.isPending) {
    body = (
      <div className="md-skeleton" role="status" aria-label={t('loading')}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="md-skeleton-row" />
        ))}
      </div>
    );
  } else if (!filtered) {
    body = (
      <div className="md-error" role="alert">
        <span>{t('loadError')}</span>
        <button type="button" className="md-retry" onClick={() => void directory.refetch()}>
          {t('retry')}
        </button>
      </div>
    );
  } else if (tab === 'tashkent') {
    body = <TashkentTable items={filtered.tashkent} query={query} onCopy={onCopy} contracts={contracts} />;
  } else if (tab === 'ministry') {
    body = <MinistryTable items={filtered.ministries} query={query} onCopy={onCopy} />;
  } else if (tab === 'regions') {
    body = <RegionsTable items={filtered.regions} query={query} onCopy={onCopy} />;
  } else {
    body = <ExatTable items={filtered.exat} query={query} onCopy={onCopy} />;
  }

  return (
    <div ref={rootRef} className="md-root" style={{ '--md-scale': scale } as CSSProperties}>
      <header className="md-header">
        <div className="md-header-title">
          <div className="md-header-icon">
            <Icon name="clipboard-text" className="size-[26px]" />
          </div>
          <div>
            <h2>{t('title')}</h2>
            <p>{t('subtitle')}</p>
          </div>
        </div>

        <div className="md-header-controls">
          <div className="md-zoom" role="group" title={t('zoom.group')} aria-label={t('zoom.group')}>
            <button
              type="button"
              className="md-zoom-btn"
              title={t('zoom.out')}
              aria-label={t('zoom.out')}
              disabled={scale <= FONT_SCALE_MIN}
              onClick={() => setScale((s) => nextFontScale(s, -FONT_SCALE_STEP))}
            >
              A-
            </button>
            <span className="md-zoom-badge" aria-live="polite">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="md-zoom-btn"
              title={t('zoom.in')}
              aria-label={t('zoom.in')}
              disabled={scale >= FONT_SCALE_MAX}
              onClick={() => setScale((s) => nextFontScale(s, FONT_SCALE_STEP))}
            >
              A+
            </button>
            <button type="button" className="md-zoom-btn" title={t('zoom.reset')} onClick={() => setScale(1)}>
              ↺ 100%
            </button>
          </div>

          <button
            type="button"
            className="md-zoom-btn md-print-btn"
            title={t('printTitle')}
            onClick={() => window.print()}
          >
            🖨️ {t('print')}
          </button>
        </div>
      </header>

      <nav className="md-tabs" aria-label={t('tabsLabel')}>
        {MANAGERS_TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'md-tab active' : 'md-tab'}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {key === 'exat' ? (
              <EnvelopeIcon size={18} strokeWidth={1.6} />
            ) : (
              <span aria-hidden="true">{TAB_EMOJI[key]}</span>
            )}
            <span>{t(`tab.${key}`)}</span>
            {key === 'exat' ? (
              <span className="md-tab-badge exat">Unicon.uz</span>
            ) : (
              totals[key] !== undefined && <span className="md-tab-badge">{totals[key]}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="md-search">
        <span className="md-search-icon">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="md-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="md-search-clear"
            title={t('clear')}
            aria-label={t('clear')}
            onClick={clearSearch}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <section className="md-card" aria-labelledby={titleId}>
        <div className="md-card-head">
          <h3 className="md-card-title" id={titleId}>
            <span>
              {TAB_EMOJI[tab]} {t(`heading.${tab}`)}
            </span>
          </h3>
          {filtered && <div className="md-count">{t(`count.${tab}`, { n: tabCount(filtered, tab) })}</div>}
        </div>
        <div className="md-table-wrap">{body}</div>
      </section>
    </div>
  );
}
