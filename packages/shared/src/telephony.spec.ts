import { describe, expect, it } from 'vitest';
import { PauseOperatorRequestSchema, isMaskedPhone, maskPhone, telephonyAccess } from './telephony.js';

describe('PauseOperatorRequestSchema reason', () => {
  const reason = (r: string) => PauseOperatorRequestSchema.safeParse({ paused: true, reason: r });

  it.each(['Tanaffus', 'Tushlik', "Yig'ilish", 'Yig`ilish', 'Yig‘ilish', 'Yig’ilish', 'Yigʻilish', 'Перерыв (обед)'])(
    'accepts the menu reasons and Uzbek apostrophes: %s',
    (r) => expect(reason(r).success).toBe(true),
  );

  it.each(['a\r\nAction: Hangup', 'a\nb', 'a|b', 'x'.repeat(65)])('rejects %j', (r) =>
    expect(reason(r).success).toBe(false),
  );
});

describe('telephonyAccess', () => {
  it('operators see masked numbers and act on their own extension only', () => {
    expect(telephonyAccess({ role: 'operator' })).toEqual({ seeAll: false, manageAll: false });
  });
  it('executives and superusers see and manage everything; observers (overview dashboard only) nothing', () => {
    expect(telephonyAccess({ role: 'executive' })).toEqual({ seeAll: true, manageAll: true });
    expect(telephonyAccess({ role: 'superuser' })).toEqual({ seeAll: true, manageAll: true });
    expect(telephonyAccess({ role: 'observer' })).toEqual({ seeAll: false, manageAll: false });
    expect(telephonyAccess({ role: 'observer', permissions: ['monitor.view', 'monitor.viewAll'] })).toEqual({
      seeAll: true,
      manageAll: false,
    });
  });
  it('follows the permissions the session carries', () => {
    expect(telephonyAccess({ role: 'operator', permissions: ['monitor.view', 'monitor.viewAll'] })).toEqual({
      seeAll: true,
      manageAll: false,
    });
  });
});

describe('maskPhone', () => {
  it('keeps the operator code and last two digits', () => {
    expect(maskPhone('901234567')).toBe('90 ••• •• 67');
    expect(isMaskedPhone(maskPhone('901234567'))).toBe(true);
    expect(maskPhone(null)).toBeNull();
  });
});
