import { isHttpError } from './http';

/**
 * Message to show for a failed request: the server's message for 4xx (they are written for
 * people), the fallback for network/5xx errors.
 */
export function errorText(err: unknown, fallback: string): string {
  if (isHttpError(err) && err.status < 500 && err.body?.message) return err.body.message;
  return fallback;
}

/** Seconds from a lockout message ("Try again in 42 s"), if any. */
export function retryAfterFrom(err: unknown): number | null {
  if (!isHttpError(err, 429)) return null;
  const m = err.body?.message.match(/(\d+)\s*s\b/);
  return m ? Number(m[1]) : null;
}
