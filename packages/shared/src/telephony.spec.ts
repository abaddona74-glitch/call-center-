import { describe, expect, it } from 'vitest';
import { isMaskedPhone, maskPhone, telephonyAccess } from './telephony.js';

describe('telephonyAccess', () => {
  it('operators see masked numbers and act on their own extension only', () => {
    expect(telephonyAccess('operator')).toEqual({ seeAll: false, manageAll: false });
  });
  it('admins and superusers see and manage everything', () => {
    expect(telephonyAccess('admin')).toEqual({ seeAll: true, manageAll: true });
    expect(telephonyAccess('superuser')).toEqual({ seeAll: true, manageAll: true });
  });
});

describe('maskPhone', () => {
  it('keeps the operator code and last two digits', () => {
    expect(maskPhone('901234567')).toBe('90 ••• •• 67');
    expect(isMaskedPhone(maskPhone('901234567'))).toBe(true);
    expect(maskPhone(null)).toBeNull();
  });
});
