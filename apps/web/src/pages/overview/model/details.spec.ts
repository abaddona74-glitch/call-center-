import { describe, expect, it } from 'vitest';
import { listId, ticketListParams } from './details';

const state = { from: '2026-11-01', to: '2026-11-19', region: 'samarqand' };

describe('ticketListParams', () => {
  it('the page period and region filter', () => {
    expect(ticketListParams({ metric: 'received', value: 3 }, state)).toEqual({
      from: '2026-11-01',
      to: '2026-11-19',
      metric: 'received',
      region: 'samarqand',
    });
  });

  it('a regions-table cell brings its own region ("none" too); null clears it', () => {
    expect(ticketListParams({ metric: 'closed', region: 'andijon', value: 1 }, state).region).toBe('andijon');
    expect(ticketListParams({ metric: 'closed', region: 'none', value: 1 }, state).region).toBe('none');
    expect(ticketListParams({ metric: 'closed', region: null, value: 1 }, state)).not.toHaveProperty('region');
    expect(ticketListParams({ metric: 'closed', value: 1 }, { ...state, region: null })).not.toHaveProperty('region');
  });

  it('a status or a Mas’ul when the metric needs one', () => {
    expect(ticketListParams({ metric: 'nowStatus', status: 'new', value: 2 }, state)).toMatchObject({ status: 'new' });
    expect(ticketListParams({ metric: 'exTaken', executive: 7, executiveName: 'Ali', value: 2 }, state)).toMatchObject({
      executive: 7,
    });
  });

  it('a stable id per number', () => {
    const a = ticketListParams({ metric: 'received', value: 3 }, state);
    expect(listId(a)).toBe(listId({ ...a }));
    expect(listId(a)).not.toBe(listId(ticketListParams({ metric: 'closed', value: 3 }, state)));
  });
});
