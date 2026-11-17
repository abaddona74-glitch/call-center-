import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * scrypt password hashing, stored as `scrypt$N$r$p$<salt>$<hashHex>`.
 *
 * Compatible with the legacy system: it used `scryptSync(password, saltHexString, 64)`
 * with Node defaults (N=16384, r=8, p=1) and stored salt/hash in separate hex columns.
 * `fromLegacy(salt, hash)` turns those into this format, so users keep their passwords.
 * The salt is used as the UTF-8 string it is stored as (exactly like the legacy code).
 */
const KEYLEN = 64;
const DEFAULTS = { N: 16384, r: 8, p: 1 } as const;

function derive(password: string, salt: string, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const { N, r, p } = DEFAULTS;
  const key = await derive(password, salt, N, r, p);
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  const actual = await derive(password, salt, Number(n), Number(r), Number(p));
  return timingSafeEqual(actual, expected);
}

export function fromLegacy(saltHex: string, hashHex: string): string {
  const { N, r, p } = DEFAULTS;
  return `scrypt$${N}$${r}$${p}$${saltHex}$${hashHex}`;
}

/** A valid hash of a random password, used to keep login timing equal for unknown users. */
export const DUMMY_HASH = fromLegacy('0'.repeat(32), '0'.repeat(KEYLEN * 2));
