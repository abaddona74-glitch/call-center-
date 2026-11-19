import { describe, expect, it } from 'vitest';
import { binFill, binLabels, binOf, metricValue, thresholdsFor } from './scale';

describe('region map scale', () => {
  it('metric values: counts as they are, overdue share in percent of received', () => {
    const row = { received: 8, closed: 5, overdue: 3 };
    expect(metricValue(row, 'received')).toBe(8);
    expect(metricValue(row, 'closed')).toBe(5);
    expect(metricValue(row, 'overdueShare')).toBe(37.5);
    expect(metricValue({ received: 0, closed: 0, overdue: 0 }, 'overdueShare')).toBeNull();
  });

  it('count thresholds: quintile breaks of the regions with tickets', () => {
    const received = [46, 19, 16, 16, 14, 14, 11, 9, 8, 8, 8, 7, 6, 1, 0, null];
    expect(thresholdsFor('received', received)).toEqual([7, 8, 14, 16]);
    expect(thresholdsFor('closed', [3, 3, 3, 1])).toEqual([1]); // repeated values: fewer bins
    expect(thresholdsFor('closed', [5])).toEqual([]); // one value: one bin
    expect(thresholdsFor('closed', [0, 0])).toEqual([1, 2, 3, 4]);
    expect(thresholdsFor('overdueShare', [90, 1])).toEqual([0, 10, 20, 35]);
  });

  it('bins: nothing coloured without tickets, 0 % overdue is the lightest step', () => {
    const t = [10, 20, 30, 40];
    expect([0, 1, 10, 11, 40, 46].map((v) => binOf(v, 'received', t))).toEqual([null, 0, 0, 1, 3, 4]);
    expect(binOf(null, 'received', t)).toBeNull();
    const s = thresholdsFor('overdueShare', []);
    expect([0, 0.1, 10, 20.5, 35, 80].map((v) => binOf(v, 'overdueShare', s))).toEqual([0, 1, 1, 3, 3, 4]);
    expect(binOf(null, 'overdueShare', s)).toBeNull();
  });

  it('legend labels', () => {
    expect(binLabels('received', [10, 20, 30, 40])).toEqual(['1–10', '11–20', '21–30', '31–40', '41+']);
    expect(binLabels('received', [1, 2, 3, 4])).toEqual(['1', '2', '3', '4', '5+']);
    expect(binLabels('overdueShare', [0, 10, 20, 35])).toEqual(['0%', '0–10%', '10–20%', '20–35%', '35%+']);
  });

  it('fills: one hue mixed into the surface, fewer bins spread over the range, neutral without data', () => {
    expect(binFill('overdueShare', 4)).toBe('color-mix(in oklab, var(--chart-8) 96%, var(--muted))');
    expect(binFill('received', 0)).toContain('var(--chart-6) 24%');
    expect(binFill('received', 1, 2)).toContain('var(--chart-6) 96%');
    expect(binFill('received', 1, 3)).toContain('var(--chart-6) 60%');
    expect(binFill('received', 0, 1)).toContain('var(--chart-6) 96%');
    expect(binFill('closed', null)).toBe('var(--panel-2)');
  });
});
