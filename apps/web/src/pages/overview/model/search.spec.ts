import { describe, expect, it } from 'vitest';
import { overviewSearchSchema, overviewStateFrom } from './search';

const today = '2026-11-19';

describe('overview search', () => {
  it('defaults: this month, whole country, received, working time', () => {
    expect(overviewStateFrom({}, today)).toEqual({
      period: 'month',
      from: '2026-11-01',
      to: '2026-11-19',
      region: null,
      metric: 'received',
      scope: 'working',
    });
  });

  it('presets resolve against today (Asia/Tashkent business day)', () => {
    expect(overviewStateFrom({ period: 'today' }, today)).toMatchObject({ from: today, to: today });
    expect(overviewStateFrom({ period: 'week' }, today)).toMatchObject({ from: '2026-11-13', to: today });
  });

  it('a custom range is ordered and never goes past today', () => {
    expect(overviewStateFrom({ period: 'range', from: '2026-11-10', to: '2026-11-03' }, today)).toMatchObject({
      from: '2026-11-03',
      to: '2026-11-10',
    });
    expect(overviewStateFrom({ period: 'range', from: '2026-11-10', to: '2027-01-01' }, today)).toMatchObject({
      from: '2026-11-10',
      to: '2026-11-10',
    });
    expect(overviewStateFrom({ period: 'range' }, today)).toMatchObject({ from: today, to: today });
  });

  it('drops invalid URL values instead of failing', () => {
    expect(
      overviewSearchSchema.parse({ period: 'year', from: 'x', region: 'DROP TABLE', metric: 'colour', scope: 'nope' }),
    ).toEqual({});
    expect(overviewSearchSchema.parse({ region: 'samarqand', metric: 'overdueShare' })).toEqual({
      region: 'samarqand',
      metric: 'overdueShare',
    });
  });
});
