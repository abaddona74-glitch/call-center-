import { describe, expect, it } from 'vitest';
import { type FocusState, ROOT_ID, nodeFocus, toggleNode } from './focus-state';

describe('focus tree state', () => {
  it('opens a node and collapses its siblings', () => {
    const s = toggleNode({}, ROOT_ID, 'edo');
    expect(s).toEqual({ root: 'edo' });
    expect(nodeFocus(s, ROOT_ID, 'edo')).toBe('open');
    expect(nodeFocus(s, ROOT_ID, 'mahalla')).toBe('collapsed');
    expect(nodeFocus(s, 'edo', 'edo-rollar')).toBe('normal');
  });

  it('closing a node closes everything opened below it', () => {
    let s: FocusState = {};
    s = toggleNode(s, ROOT_ID, 'edo');
    s = toggleNode(s, 'edo', 'edo-rollar');
    s = toggleNode(s, 'edo-rollar', 'edo-tizim-rollari');
    expect(s).toEqual({ root: 'edo', edo: 'edo-rollar', 'edo-rollar': 'edo-tizim-rollari' });

    s = toggleNode(s, ROOT_ID, 'edo');
    expect(s).toEqual({});
  });

  it('switching to a sibling forgets what was open under the previous one', () => {
    let s: FocusState = {};
    s = toggleNode(s, ROOT_ID, 'edo');
    s = toggleNode(s, 'edo', 'edo-rollar');
    s = toggleNode(s, 'edo-rollar', 'edo-mf-ijro-rollari');

    s = toggleNode(s, 'edo', 'edo-kirish');
    expect(s).toEqual({ root: 'edo', edo: 'edo-kirish' });
  });

  it('does not mutate the previous state', () => {
    const before: FocusState = { root: 'edo' };
    toggleNode(before, ROOT_ID, 'edo');
    expect(before).toEqual({ root: 'edo' });
  });
});
