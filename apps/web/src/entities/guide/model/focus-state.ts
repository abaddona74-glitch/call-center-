/**
 * Open/closed state of the focus tree: for every parent id (`'root'` for the top row) the id of its one
 * open child. Opening a node collapses its siblings; closing it closes everything opened below it.
 * Same behaviour as legacy `guide.html` (`handleFocusTreeClick` / `resetDescendants`).
 */
export type FocusState = Readonly<Record<string, string>>;

export const ROOT_ID = 'root';

export type NodeFocus = 'normal' | 'open' | 'collapsed';

/** Removes the chain of open nodes below `fromId` (only one child per parent can be open). */
function closeBelow(state: Record<string, string>, fromId: string): void {
  let id: string | undefined = fromId;
  while (id !== undefined) {
    const next: string | undefined = state[id];
    delete state[id];
    id = next;
  }
}

/** Click on a node with children. */
export function toggleNode(state: FocusState, parentId: string, nodeId: string): FocusState {
  const next: Record<string, string> = { ...state };
  const current = next[parentId];
  if (current === nodeId) {
    delete next[parentId];
    closeBelow(next, nodeId);
  } else {
    if (current !== undefined) closeBelow(next, current);
    next[parentId] = nodeId;
  }
  return next;
}

/** How a node shows: its row has nothing open, it is the open one, or a sibling is open. */
export function nodeFocus(state: FocusState, parentId: string, nodeId: string): NodeFocus {
  const open = state[parentId];
  if (open === undefined) return 'normal';
  return open === nodeId ? 'open' : 'collapsed';
}
