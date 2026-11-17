import { generateCode, generateToken, hashCode, hashToken, maskEmail, verifyCode } from './codes.js';

describe('one-time codes', () => {
  it('generates 6 digit codes', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('verifies only the right code, with a different salt every time', () => {
    const a = hashCode('123456');
    const b = hashCode('123456');
    expect(a).not.toBe(b);
    expect(a).not.toContain('123456');
    expect(verifyCode('123456', a)).toBe(true);
    expect(verifyCode('123457', a)).toBe(false);
    expect(verifyCode('123456', 'garbage')).toBe(false);
  });

  it('hashes tokens deterministically', () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });

  it('masks emails', () => {
    expect(maskEmail('john.doe@gmail.com')).toBe('jo***e@gmail.com');
    expect(maskEmail('ab@mail.uz')).toBe('a***@mail.uz');
    expect(maskEmail('x@y.z')).toBe('x***@y.z');
    expect(maskEmail('bad')).toBe('***');
  });
});
