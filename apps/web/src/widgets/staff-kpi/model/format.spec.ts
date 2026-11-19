import { describe, expect, it } from 'vitest';
import { hoursMinutes, hoursText, orLast, percentText, shareTone, surveyTone } from './format';

describe('KPI formatting', () => {
  it('hours:minutes', () => {
    expect(hoursMinutes(0)).toBe('0:00');
    expect(hoursMinutes(13 * 3600 + 5 * 60 + 40)).toBe('13:05');
    expect(hoursMinutes(59)).toBe('0:00');
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

  it('missing values sort last', () => {
    expect(orLast(null)).toBeUndefined();
    expect(orLast(0)).toBe(0);
  });
});
