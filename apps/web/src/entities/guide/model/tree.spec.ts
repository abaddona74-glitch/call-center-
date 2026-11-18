import { describe, expect, it } from 'vitest';
import { GUIDE_TREE, type GuideNode, hasChildren, safeUrl } from './tree';

function flatten(nodes: readonly GuideNode[]): GuideNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

describe('guide tree content', () => {
  const all = flatten(GUIDE_TREE);

  it('has the legacy top-level systems', () => {
    expect(GUIDE_TREE.map((n) => n.title)).toEqual(['EDO', 'E-huquqshunos', 'Mahalla']);
  });

  it('ids are unique (they key the open/closed state)', () => {
    const ids = all.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('root');
  });

  it('every node has a title and every link is https', () => {
    for (const n of all) {
      expect(n.title.trim()).not.toBe('');
      if (n.url) expect(safeUrl(n), n.id).toBe(n.url);
    }
  });
});

describe('safeUrl', () => {
  it('drops non-https links and links on nodes with children', () => {
    expect(safeUrl({ id: 'a', title: 'A', url: 'javascript:alert(1)' })).toBeNull();
    expect(safeUrl({ id: 'a', title: 'A', url: 'http://example.uz' })).toBeNull();
    expect(safeUrl({ id: 'a', title: 'A', url: 'not a url' })).toBeNull();
    expect(safeUrl({ id: 'a', title: 'A', url: 'https://example.uz', children: [{ id: 'b', title: 'B' }] })).toBeNull();
    expect(hasChildren({ id: 'a', title: 'A', children: [] })).toBe(false);
  });
});
