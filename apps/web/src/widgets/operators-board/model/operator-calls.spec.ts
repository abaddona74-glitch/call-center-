import type { LiveOperator } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { operatorCallsView } from './operator-calls';

const t = ((key: string) => key) as unknown as Parameters<typeof operatorCallsView>[1];
const op = { extension: '103', name: 'Feruza' } as LiveOperator;

describe('operatorCallsView', () => {
  it("lists only that operator's calls on every tab", () => {
    const view = operatorCallsView(op, t);
    expect(view.id).toBe('operator:103');
    expect(view.title).toBe('Feruza (103)');
    expect(view.tabs.every((tab) => tab.filter.operator === '103')).toBe(true);
  });

  it('splits the calls like the card numbers', () => {
    const filters = Object.fromEntries(operatorCallsView(op, t).tabs.map((tab) => [tab.id, tab.filter]));
    expect(filters).toEqual({
      all: { direction: 'external', operator: '103' },
      inbound: { direction: 'inbound', operator: '103' },
      outbound: { direction: 'outbound', operator: '103' },
      // the calls that rang on this operator and were not taken, not the ones they took
      missed: { operatorMiss: 'any', operator: '103' },
    });
  });
});
