import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, TOOL_IDS, dropBefore, moveTool, restoreLayout } from './layout';

describe('tools layout', () => {
  it('starts with the legacy layout and places every card once', () => {
    const l = restoreLayout(null);
    expect(l).toEqual(DEFAULT_LAYOUT);
    expect([...l.admin, ...l.primary, ...l.secondary].sort()).toEqual([...TOOL_IDS].sort());
  });

  it('restores a saved layout, drops junk and adds new cards to their default zone', () => {
    const l = restoreLayout({
      admin: ['converter', 'nope', 'converter'],
      primary: ['uzcrypto', 42],
      secondary: 'broken',
    });
    expect(l.admin).toEqual(['converter', 'edo_cabinet', 'ehuquq_cabinet']); // unsaved cards appended
    expect(l.primary[0]).toBe('uzcrypto');
    expect(l.primary).toContain('anydesk'); // not in the saved layout → default zone
    expect(l.secondary).not.toContain('uzcrypto');
    expect([...l.admin, ...l.primary, ...l.secondary]).toHaveLength(TOOL_IDS.length);
  });

  it('moves a card between zones and within a zone', () => {
    let l = moveTool(DEFAULT_LAYOUT, 'converter', 'admin', 'ehuquq_cabinet');
    expect(l.admin).toEqual(['edo_cabinet', 'converter', 'ehuquq_cabinet']);
    expect(l.primary).not.toContain('converter');
    l = moveTool(l, 'converter', 'admin', null);
    expect(l.admin).toEqual(['edo_cabinet', 'ehuquq_cabinet', 'converter']);
    l = moveTool(l, 'uzb2026', 'secondary', 'uzcrypto');
    expect(l.secondary[0]).toBe('uzb2026');
  });

  it('finds the card to drop before (reading order)', () => {
    const cards = [
      { id: 'edo_cabinet' as const, left: 0, top: 0, width: 100, height: 50 },
      { id: 'ehuquq_cabinet' as const, left: 120, top: 0, width: 100, height: 50 },
      { id: 'anydesk' as const, left: 0, top: 70, width: 100, height: 50 },
    ];
    expect(dropBefore(cards, 10, 25)).toBe('edo_cabinet'); // left half of the first card
    expect(dropBefore(cards, 90, 25)).toBe('ehuquq_cabinet'); // right half → before the next one
    expect(dropBefore(cards, 230, 25)).toBe('anydesk'); // after the first row → next row
    expect(dropBefore(cards, 90, 110)).toBeNull(); // after the last card → end
  });
});
