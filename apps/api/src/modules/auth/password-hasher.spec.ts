import { randomBytes, scryptSync } from 'node:crypto';
import { DUMMY_HASH, fromLegacy, hashPassword, verifyPassword } from './password-hasher.js';

describe('password-hasher', () => {
  it('verifies a freshly hashed password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('accepts passwords hashed by the legacy system (salt hex string used as text)', async () => {
    // exactly what legacy/services/authService.js did
    const salt = randomBytes(16).toString('hex');
    const legacyHash = scryptSync('Legacy-Pa55', salt, 64).toString('hex');

    const migrated = fromLegacy(salt, legacyHash);
    expect(await verifyPassword('Legacy-Pa55', migrated)).toBe(true);
    expect(await verifyPassword('legacy-pa55', migrated)).toBe(false);
  });

  it('rejects malformed hashes and the dummy hash', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$16384$8$1$salt$abcd')).toBe(false);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });
});
