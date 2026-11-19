import { describe, expect, it } from 'vitest';
import { kpiSearchSchema, kpiStateFrom } from './search';

const TODAY = '2026-11-19';

describe('kpiStateFrom', () => {
  it('defaults: operators, today, working time, all column groups', () => {
    expect(kpiStateFrom({}, TODAY)).toEqual({
      view: 'operators',
      period: 'today',
      from: TODAY,
      to: TODAY,
      scope: 'working',
      group: 'all',
    });
  });

  it('presets resolve to dates', () => {
    expect(kpiStateFrom({ period: 'yesterday' }, TODAY)).toMatchObject({ from: '2026-11-18', to: '2026-11-18' });
    expect(kpiStateFrom({ period: 'week' }, TODAY)).toMatchObject({ from: '2026-11-13', to: TODAY });
    expect(kpiStateFrom({ period: 'month' }, TODAY)).toMatchObject({ from: '2026-11-01', to: TODAY });
  });

  it('a custom range is ordered and never past today', () => {
    expect(kpiStateFrom({ period: 'range', from: '2026-11-10', to: '2026-11-03' }, TODAY)).toMatchObject({
      from: '2026-11-03',
      to: '2026-11-10',
    });
    expect(kpiStateFrom({ period: 'range', from: '2026-11-15', to: '2027-01-01' }, TODAY)).toMatchObject({
      from: '2026-11-15',
      to: '2026-11-15',
    });
  });

  it('drops invalid URL values', () => {
    expect(
      kpiSearchSchema.parse({ view: 'admins', period: 'decade', scope: 'night', group: 'x', from: '19.11' }),
    ).toEqual({});
    expect(kpiSearchSchema.parse({ view: 'executives', group: 'presence' })).toEqual({
      view: 'executives',
      group: 'presence',
    });
  });
});
