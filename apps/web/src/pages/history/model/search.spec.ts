import { describe, expect, it } from 'vitest';
import { pageItems } from '@/shared/ui/pagination';
import { historyParams } from './search';

describe('historyParams', () => {
  it('defaults to today and page 1', () => {
    expect(historyParams({}, '2026-11-17')).toMatchObject({
      from: '2026-11-17',
      to: '2026-11-17',
      page: 1,
      pageSize: 20,
      scope: 'all',
    });
  });

  it('all-days search sends no dates', () => {
    expect(historyParams({ search: '901234567', allDays: true, from: '2026-11-01' }, '2026-11-17')).toMatchObject({
      from: undefined,
      to: undefined,
    });
    // allDays without a search term is ignored
    expect(historyParams({ allDays: true }, '2026-11-17').from).toBe('2026-11-17');
  });
});

describe('pageItems', () => {
  it('shows ellipses around the current page', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(6, 20)).toEqual([1, 'gap', 4, 5, 6, 7, 8, 'gap', 20]);
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 'gap', 20]);
  });
});
