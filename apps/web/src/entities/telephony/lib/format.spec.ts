import { describe, expect, it } from 'vitest';
import { carrierOf, displayPhone, formatSeconds } from './format';

describe('telephony format', () => {
  it('formats seconds like the legacy dashboard', () => {
    expect(formatSeconds(0)).toBe('00:00');
    expect(formatSeconds(65)).toBe('01:05');
    expect(formatSeconds(3725)).toBe('1:02:05');
  });

  it('displays phones', () => {
    expect(displayPhone('901234567', 'Yashirin')).toBe('901234567');
    expect(displayPhone(null, 'Yashirin')).toBe('Yashirin');
    expect(displayPhone('90 ••• •• 67', 'Yashirin')).toBe('90 ••• •• 67');
  });

  it('detects the mobile carrier', () => {
    expect(carrierOf('901234567')?.name).toBe('Beeline');
    expect(carrierOf('93 ••• •• 67')?.name).toBe('Ucell');
    expect(carrierOf('712000000')?.name).toBe('Uzmobile');
    expect(carrierOf(null)).toBeNull();
  });
});
