import type { IncomingMessage } from 'node:http';

export const SESSION_COOKIE = 'cc_session';

/** Minimal cookie header parser (used for WebSocket upgrades where express middleware doesn't run). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** Session token from the cookie, or `Authorization: Bearer <token>` (for scripts/tests). */
export function extractSessionToken(req: IncomingMessage & { cookies?: Record<string, string> }): string | null {
  const fromCookie = req.cookies?.[SESSION_COOKIE] ?? parseCookieHeader(req.headers.cookie)[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  return null;
}
