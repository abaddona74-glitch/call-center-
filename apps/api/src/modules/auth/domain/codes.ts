import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** One-time codes and tokens sent to users. Only salted hashes are stored. */

export const CODE_TTL_SECONDS = 10 * 60;
export const CODE_MAX_ATTEMPTS = 5;
/** A new code for the same purpose is not sent more often than this. */
export const CODE_RESEND_SECONDS = 60;
export const RESET_TOKEN_TTL_SECONDS = 10 * 60;

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** `salt$hmacHex` */
export function hashCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}$${createHmac('sha256', salt).update(code).digest('hex')}`;
}

export function verifyCode(code: string, stored: string): boolean {
  const [salt, hex] = stored.split('$');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = createHmac('sha256', salt).update(code).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** "jo***e@gmail.com" — enough for the owner to recognize, useless for harvesting. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  const tail = local.length > 4 ? local.slice(-1) : '';
  return `${visible}***${tail}@${domain}`;
}
