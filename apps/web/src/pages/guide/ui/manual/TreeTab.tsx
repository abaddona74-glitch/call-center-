import { type TransitionEvent, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type FocusState, GUIDE_TREE } from '@/entities/guide';
import { FocusTree } from '@/widgets/guide-focus-tree';
import { ResetIcon } from '../icons';

interface TreeTabProps {
  state: FocusState;
  onToggle: (parentId: string, nodeId: string) => void;
  onReset: () => void;
}

/** "🌲 Tizimlar va Rollar Daraxti" tab: the compact focus tree. */
export function TreeTab({ state, onToggle, onReset }: TreeTabProps) {
  const { t } = useTranslation('guide');
  const scrollRef = useRef<HTMLDivElement>(null);

  const settleTimer = useRef<number | undefined>(undefined);

  // A deep level can be wider than the page: once the open/close animation is over, scroll so the deepest open
  // node (its children hang centered under it) is in the middle.
  const centerOpenBranch = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const open = el.querySelectorAll<HTMLElement>('.gft-card.is-open');
    const target = open[open.length - 1];
    let left = (el.scrollWidth - el.clientWidth) / 2;
    if (target) {
      const card = target.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      left = el.scrollLeft + card.left + card.width / 2 - (box.left + el.clientWidth / 2);
    }
    el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, []);

  const scheduleCenter = useCallback(
    (delay: number) => {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(centerOpenBranch, delay);
    },
    [centerOpenBranch],
  );

  // After a click: when the layout transitions end (see onTransitionEnd), or after 0.52 s without transitions
  // (reduced motion).
  useEffect(() => {
    scheduleCenter(520);
  }, [state, scheduleCenter]);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  return (
    <>
      <div className="manual-tree-head">
        <div>
          <h4 className="manual-tree-title">
            <span>🌲 {t('manual.treeTitle')}</span>
            <span className="manual-tree-pill">{t('manual.treePill')}</span>
          </h4>
          <p className="manual-tree-text">{t('manual.treeText')}</p>
        </div>
        <button type="button" className="manual-tree-reset" onClick={onReset}>
          <ResetIcon />
          <span>{t('manual.collapseAll')}</span>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="manual-tree"
        onTransitionEnd={(e: TransitionEvent) => {
          if (e.propertyName === 'max-width' || e.propertyName === 'max-height') scheduleCenter(60);
        }}
      >
        <div className="manual-tree-inner">
          <FocusTree nodes={GUIDE_TREE} state={state} onToggle={onToggle} variant="compact" />
        </div>
      </div>
    </>
  );
}
