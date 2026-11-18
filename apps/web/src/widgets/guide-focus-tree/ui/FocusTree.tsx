import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { type FocusState, type GuideNode, ROOT_ID, hasChildren, nodeFocus, safeUrl } from '@/entities/guide';
import { cn } from '@/shared/lib/cn';
import '../i18n';
import './focus-tree.css';

/**
 * `canvas` — the full-page tree of legacy `guide.html` (hint boxes under the nodes, lives in a pan/zoom layer);
 * `compact` — the tree tab of the legacy "Operator manual" modal (hint text under the node + hover popover).
 */
export type FocusTreeVariant = 'canvas' | 'compact';

interface FocusTreeProps {
  nodes: readonly GuideNode[];
  state: FocusState;
  onToggle: (parentId: string, nodeId: string) => void;
  variant: FocusTreeVariant;
}

/** "Systems and roles" focus tree: a click on a node opens its roles and collapses its siblings. */
export const FocusTree = memo(function FocusTree({ nodes, state, onToggle, variant }: FocusTreeProps) {
  return (
    <div className={cn('gft', `gft--${variant}`)}>
      <Branch nodes={nodes} parentId={ROOT_ID} depth={0} state={state} onToggle={onToggle} variant={variant} />
    </div>
  );
});

interface BranchProps extends Omit<FocusTreeProps, 'nodes'> {
  nodes: readonly GuideNode[];
  parentId: string;
  depth: number;
}

function connectorClass(index: number, count: number): string {
  if (count === 1) return 'gft-single';
  if (index === 0) return 'gft-first';
  if (index === count - 1) return 'gft-last';
  return 'gft-mid';
}

function Branch({ nodes, parentId, depth, ...rest }: BranchProps) {
  // Once a node is open its siblings collapse, so it hangs on a straight line (legacy kept a dangling corner).
  const anyOpen = rest.state[parentId] !== undefined;
  return (
    <div className="gft-branch">
      <div className="gft-row">
        {nodes.map((node, i) => (
          <Column
            key={node.id}
            node={node}
            parentId={parentId}
            depth={depth}
            connector={depth > 0 ? connectorClass(i, anyOpen ? 1 : nodes.length) : null}
            {...rest}
          />
        ))}
      </div>
    </div>
  );
}

interface ColumnProps extends Omit<BranchProps, 'nodes'> {
  node: GuideNode;
  connector: string | null;
}

function Column({ node, parentId, depth, connector, state, onToggle, variant }: ColumnProps) {
  const { t } = useTranslation('guideTree');
  const focus = nodeFocus(state, parentId, node.id);
  const open = focus === 'open';
  const depthClass = `gft-depth-${Math.min(depth, 2)}`;
  const url = safeUrl(node);

  const title = <span className="gft-title">{node.title}</span>;
  let card;
  if (hasChildren(node)) {
    card = (
      <button
        type="button"
        className={cn('gft-card', depthClass, open && 'is-open')}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(parentId, node.id);
        }}
      >
        {title}
        <span className="gft-badge">{open ? '−' : '+'}</span>
      </button>
    );
  } else if (url) {
    card = (
      <a
        className={cn('gft-card gft-link', depthClass)}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={t('openInNewTab')}
      >
        {title}
        <ExternalIcon />
      </a>
    );
  } else {
    card = <div className={cn('gft-card gft-leaf', depthClass)}>{title}</div>;
  }

  return (
    <div
      className={cn('gft-col', focus === 'collapsed' && 'is-collapsed', open && 'is-open')}
      inert={focus === 'collapsed'}
    >
      {connector && <div className={cn('gft-connector', connector)} />}
      <div className="gft-anchor">
        {card}
        {node.hint && variant === 'canvas' && (
          <div className="gft-hint-card">
            <div className="gft-hint-badge">💡 {t('hint')}</div>
            <div className="gft-hint-text">{node.hint}</div>
          </div>
        )}
        {node.hint && variant === 'compact' && (
          <>
            <div className="gft-hint-popover" aria-hidden="true">
              <div className="gft-hint-popover-badge">💡 {t('hint')}</div>
              <div>{node.hint}</div>
            </div>
            <div className="gft-hint-sub">{node.hint}</div>
          </>
        )}
      </div>
      {hasChildren(node) && (
        <div className={cn('gft-subtree', open && 'is-open')} inert={!open}>
          <div className="gft-stem" />
          <Branch
            nodes={node.children}
            parentId={node.id}
            depth={depth + 1}
            state={state}
            onToggle={onToggle}
            variant={variant}
          />
        </div>
      )}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      className="gft-external"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
