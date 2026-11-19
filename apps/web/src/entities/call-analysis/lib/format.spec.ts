import { describe, expect, it } from 'vitest';
import { activeSegmentIndex, formatAvg, formatClock, pickText, scoreTone } from './format';

describe('call analysis formatting', () => {
  it('picks the UI language and falls back to the other one', () => {
    expect(pickText({ uz: 'Salom', ru: 'Привет' }, 'ru')).toBe('Привет');
    expect(pickText({ uz: 'Salom', ru: 'Привет' }, 'uz')).toBe('Salom');
    expect(pickText({ uz: '', ru: 'Привет' }, 'uz')).toBe('Привет');
    expect(pickText(null, 'uz')).toBe('');
  });

  it('formats positions as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('colours scores by share of the scale', () => {
    expect(scoreTone(5, 5)).toBe('success');
    expect(scoreTone(3, 5)).toBe('info');
    expect(scoreTone(2, 5)).toBe('warning');
    expect(scoreTone(1, 5)).toBe('danger');
    expect(scoreTone(8, 10)).toBe('success');
    expect(scoreTone(null, 10)).toBe('muted');
    expect(formatAvg(3.456)).toBe('3.5');
    expect(formatAvg(null)).toBe('—');
  });

  it('finds the segment being heard', () => {
    const segs = [
      { start: 0, end: 2 },
      { start: 2.5, end: 6 },
      { start: 5.5, end: 7 },
    ];
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
    expect(activeSegmentIndex(segs, 1)).toBe(0);
    expect(activeSegmentIndex(segs, 2.2)).toBe(0);
    expect(activeSegmentIndex(segs, 3)).toBe(1);
    expect(activeSegmentIndex(segs, 5.8)).toBe(2);
    expect(activeSegmentIndex(segs, 60)).toBe(2);
    expect(activeSegmentIndex([], 3)).toBe(-1);
  });
});
