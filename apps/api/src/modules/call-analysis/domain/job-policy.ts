import { createHash, timingSafeEqual } from 'node:crypto';
import type { CallDirection, CallStatus } from '@cc/shared';

/** The call facts the enqueue rule looks at (a subset of AssembledCall). */
export interface CallFacts {
  id: string;
  /** Asia/Tashkent wall time "YYYY-MM-DD HH:mm:ss". */
  start: string;
  date: string;
  direction: CallDirection;
  status: CallStatus;
  talkSec: number;
  recordingFile: string | null;
  finalOperator: string | null;
}

/**
 * Which calls are analysed (owner decision 2026-11-19): answered inbound or outbound calls with a recording and at
 * least `minTalkSec` of talk. Internal (operator ↔ operator) calls are not.
 */
export function isAnalyzable(call: CallFacts, minTalkSec: number): boolean {
  return (
    call.status === 'answered' &&
    (call.direction === 'inbound' || call.direction === 'outbound') &&
    Boolean(call.recordingFile?.trim()) &&
    call.talkSec >= minTalkSec
  );
}

export interface NewJob {
  callId: string;
  callStartedAt: string;
  callDate: string;
  direction: CallDirection;
  operatorExt: string | null;
  talkSec: number;
  recordingFile: string | null;
}

export function jobOf(call: CallFacts, toIso: (wall: string) => string): NewJob {
  return {
    callId: call.id,
    callStartedAt: toIso(call.start),
    callDate: call.date,
    direction: call.direction,
    operatorExt: call.finalOperator,
    talkSec: call.talkSec,
    recordingFile: call.recordingFile?.trim() || null,
  };
}

/** Delay before a retryable failure is leased again: 1, 5, 15, 60 min. */
export function retryDelaySec(attempts: number): number {
  const steps = [60, 300, 900, 3600];
  return steps[Math.min(Math.max(attempts, 1), steps.length) - 1];
}

/** What a reported failure does to the job. `attempts` already counts the failed lease. */
export function afterFailure(opts: {
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
}): { status: 'queued'; delaySec: number } | { status: 'failed' } {
  if (opts.retryable && opts.attempts < opts.maxAttempts) {
    return { status: 'queued', delaySec: retryDelaySec(opts.attempts) };
  }
  return { status: 'failed' };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The worker's bearer token against the configured SHA-256 (hex). The token itself is never stored on the API side.
 * Constant-time on the digests; false when no hash is configured.
 */
export function workerTokenMatches(authorization: string | undefined, expectedSha256: string | undefined): boolean {
  if (!expectedSha256 || !authorization) return false;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/.exec(authorization.trim());
  if (!m) return false;
  const actual = Buffer.from(sha256Hex(m[1]), 'hex');
  const expected = Buffer.from(expectedSha256.toLowerCase(), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Error texts from the worker are shown to the superuser: one line, no long digit runs (phone numbers). */
export function sanitizeError(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/\d[\d\s-]{6,}\d/g, '***')
    .trim()
    .slice(0, 500);
}
