import { describe, expect, it } from 'vitest';
import { statisticsSearchSchema, statsQueryFrom } from './search';

describe('statsQueryFrom', () => {
  const today = '2026-11-17';
  it('resolves periods to date ranges that never pass today', () => {
    expect(statsQueryFrom({}, today)).toEqual({ period: 'day', from: today, to: today, scope: 'working' });
    expect(statsQueryFrom({ period: 'month' }, today)).toMatchObject({ from: '2026-11-01', to: today });
    expect(statsQueryFrom({ period: 'month', from: '2026-02-10' }, today)).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(statsQueryFrom({ period: 'year', from: '2025-05-05' }, today)).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(
      statsQueryFrom({ period: 'range', from: '2026-11-10', to: '2026-11-03', scope: 'all' }, today),
    ).toMatchObject({
      from: '2026-11-03',
      to: '2026-11-10',
      scope: 'all',
    });
  });

  it('drops invalid URL values instead of failing', () => {
    expect(statisticsSearchSchema.parse({ period: 'week', from: '17.11.2026', scope: 'x' })).toEqual({});
  });
});
