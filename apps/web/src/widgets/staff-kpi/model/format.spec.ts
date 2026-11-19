import { describe, expect, it } from 'vitest';
import { hoursAndMinutes, hoursText, scoreClass, orLast, percentText, shareTone, surveyTone } from './format';

describe('KPI formatting', () => {
  it('hours and minutes', () => {
    expect(hoursAndMinutes(0)).toEqual({ h: 0, m: 0 });
    expect(hoursAndMinutes(13 * 3600 + 5 * 60 + 40)).toEqual({ h: 13, m: 5 });
    expect(hoursAndMinutes(59)).toEqual({ h: 0, m: 0 });
  });

  it('percent and hours: one decimal at most, null stays null', () => {
    expect(percentText(92.5, 'en-US')).toBe('92.5%');
    expect(percentText(100, 'en-US')).toBe('100%');
    expect(percentText(null, 'en-US')).toBeNull();
    expect(hoursText(1.5, 'ru-RU')).toBe('1,5');
    expect(hoursText(null, 'ru-RU')).toBeNull();
  });

  it('tones never are the only carrier: they only colour a printed value', () => {
    expect(shareTone(95)).toContain('text-positive');
    expect(shareTone(50)).toContain('text-caution');
    expect(shareTone(80)).toBe('text-ink');
    expect(shareTone(null)).toBe('text-mute');
    expect(surveyTone(4.6)).toBe('text-positive');
    expect(surveyTone(2)).toBe('text-danger');
  });

  it('score colours follow the «Tahlil» thresholds', () => {
    expect(scoreClass(9, 10)).toBe('text-positive');
    expect(scoreClass(3.4, 5)).toContain('text-info');
    expect(scoreClass(2, 5)).toBe('text-caution');
    expect(scoreClass(1.5, 5)).toContain('text-danger');
  });

  it('missing values sort last', () => {
    expect(orLast(null)).toBeUndefined();
    expect(orLast(0)).toBe(0);
  });
});
