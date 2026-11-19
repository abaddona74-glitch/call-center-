import { describe, expect, it } from 'vitest';
import { analysisQueryFrom, analysisSearchSchema } from './search';

const TODAY = '2026-11-19';

describe('analysis page search', () => {
  it('defaults to the last 7 days', () => {
    expect(analysisQueryFrom({}, TODAY)).toEqual({ from: '2026-11-13', to: TODAY });
  });

  it('keeps a valid range and filters', () => {
    expect(
      analysisQueryFrom({ from: '2026-11-01', to: '2026-11-10', operator: '101', topic: 'eri_key' }, TODAY),
    ).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
      operator: '101',
      topic: 'eri_key',
    });
  });

  it('never goes past today and never inverts the range', () => {
    expect(analysisQueryFrom({ to: '2026-12-01' }, TODAY).to).toBe(TODAY);
    expect(analysisQueryFrom({ from: '2026-11-18', to: '2026-11-10' }, TODAY)).toEqual({
      from: '2026-11-04',
      to: '2026-11-10',
    });
  });

  it('drops invalid URL values', () => {
    expect(analysisSearchSchema.parse({ from: 'x', operator: '1a', topic: 'Bad Topic' })).toEqual({
      from: undefined,
      operator: undefined,
      topic: undefined,
    });
  });
});
