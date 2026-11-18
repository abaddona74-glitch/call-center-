import { Link } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type FocusState, GUIDE_TREE, toggleNode } from '@/entities/guide';
import { cn } from '@/shared/lib/cn';
import { FocusTree } from '@/widgets/guide-focus-tree';
import '../i18n';
import { useDocumentTitle } from '../lib/use-document-title';
import { usePanZoom } from '../model/use-pan-zoom';
import { ArrowLeftIcon, FitIcon, HierarchyIcon, ResetIcon } from './icons';
import './guide-tree.css';

/** "Tizimlar va Rollar Daraxti" (legacy `guide.html`): the focus tree on a pan/zoom canvas. */
export function GuideTreePage() {
  const { t } = useTranslation('guide');
  const [state, setState] = useState<FocusState>({});
  const [hints, setHints] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const { percent, dragging, zoomIn, zoomOut, resetZoom, center, fit } = usePanZoom(viewportRef, layerRef);
  const onToggle = useCallback((parentId: string, nodeId: string) => {
    setState((s) => toggleNode(s, parentId, nodeId));
  }, []);
  useDocumentTitle(t('tree.title'));

  return (
    <div className="guide-page">
      <header className="guide-header">
        <div className="guide-header-left">
          <Link to="/" className="guide-back-btn" title={t('tree.backTitle')}>
            <ArrowLeftIcon />
            <span>{t('tree.back')}</span>
          </Link>
          <div className="guide-title-box">
            <div className="guide-icon-badge">
              <HierarchyIcon />
            </div>
            <h1 className="guide-title">
              <span>{t('tree.title')}</span>
              <span className="guide-pill">{t('tree.pill')}</span>
            </h1>
          </div>
        </div>

        <div className="guide-header-actions">
          <button
            type="button"
            className="guide-action-btn"
            aria-pressed={hints}
            title={t('tree.hintsTitle')}
            onClick={() => setHints((v) => !v)}
          >
            <span>💡 {t('tree.hints', { state: hints ? t('tree.hintsOn') : t('tree.hintsOff') })}</span>
          </button>
          <button type="button" className="guide-action-btn" title={t('tree.centerTitle')} onClick={() => center()}>
            <span>🎯 {t('tree.center')}</span>
          </button>
          <button
            type="button"
            className="guide-action-btn"
            title={t('tree.collapseAllTitle')}
            onClick={() => setState({})}
          >
            <ResetIcon />
            <span>{t('tree.collapseAll')}</span>
          </button>
        </div>
      </header>

      <div ref={viewportRef} className={cn('guide-viewport', dragging && 'is-dragging', !hints && 'gft-hide-hints')}>
        <div ref={layerRef} className="guide-layer">
          <FocusTree nodes={GUIDE_TREE} state={state} onToggle={onToggle} variant="canvas" />
        </div>

        <div className="guide-controls" data-no-pan>
          <button
            type="button"
            className="guide-ctrl-btn"
            title={t('tree.zoomIn')}
            aria-label={t('tree.zoomIn')}
            onClick={zoomIn}
          >
            +
          </button>
          <button
            type="button"
            className="guide-ctrl-btn"
            title={t('tree.zoomOut')}
            aria-label={t('tree.zoomOut')}
            onClick={zoomOut}
          >
            −
          </button>
          <button type="button" className="guide-zoom-badge" title={t('tree.zoomReset')} onClick={resetZoom}>
            {percent}%
          </button>
          <button
            type="button"
            className="guide-ctrl-btn"
            title={t('tree.fit')}
            aria-label={t('tree.fit')}
            onClick={() => fit()}
          >
            <FitIcon />
          </button>
        </div>

        <div className="guide-helper-pill" aria-hidden="true">
          <span>
            🖱️ <b>{t('tree.helpWheel')}</b> {t('tree.helpWheelText')}
          </span>
          <span>
            🖐️ <b>{t('tree.helpDrag')}</b> {t('tree.helpDragText')}
          </span>
          <span>
            👆 <b>{t('tree.helpButtons')}</b> {t('tree.helpButtonsText')}
          </span>
        </div>
      </div>
    </div>
  );
}
