import { describe, expect, it } from 'vitest';
import {
  type CallFacts,
  afterFailure,
  isAnalyzable,
  jobOf,
  retryDelaySec,
  sanitizeError,
  sha256Hex,
  workerTokenMatches,
} from './job-policy.js';

const call: CallFacts = {
  id: '1794544201.2101100',
  start: '2026-11-13 09:30:09',
  date: '2026-11-13',
  direction: 'inbound',
  status: 'answered',
  talkSec: 95,
  recordingFile: 'q-2020159-901234567-20261113-093009-1794544201.2101100.wav',
  finalOperator: '114',
};

describe('isAnalyzable', () => {
  it('takes answered inbound and outbound calls with a recording and enough talk', () => {
    expect(isAnalyzable(call, 20)).toBe(true);
    expect(isAnalyzable({ ...call, direction: 'outbound' }, 20)).toBe(true);
    expect(isAnalyzable({ ...call, talkSec: 20 }, 20)).toBe(true);
  });

  it('skips internal, unanswered, unrecorded and short calls', () => {
    expect(isAnalyzable({ ...call, direction: 'internal' }, 20)).toBe(false);
    for (const status of ['abandoned', 'ivr', 'after_hours', 'no_answer', 'busy', 'failed'] as const) {
      expect(isAnalyzable({ ...call, status }, 20)).toBe(false);
    }
    expect(isAnalyzable({ ...call, recordingFile: null }, 20)).toBe(false);
    expect(isAnalyzable({ ...call, recordingFile: '  ' }, 20)).toBe(false);
    expect(isAnalyzable({ ...call, talkSec: 19 }, 20)).toBe(false);
  });
});

describe('jobOf', () => {
  it('keeps the call id, start, final operator and the recording file', () => {
    expect(jobOf(call, (w) => `${w.replace(' ', 'T')}+05:00`)).toEqual({
      callId: call.id,
      callStartedAt: '2026-11-13T09:30:09+05:00',
      callDate: '2026-11-13',
      direction: 'inbound',
      operatorExt: '114',
      talkSec: 95,
      recordingFile: call.recordingFile,
    });
  });
});

describe('failures', () => {
  it('retryable failures go back to the queue with a growing delay until the attempts run out', () => {
    expect(afterFailure({ attempts: 1, maxAttempts: 3, retryable: true })).toEqual({ status: 'queued', delaySec: 60 });
    expect(afterFailure({ attempts: 2, maxAttempts: 3, retryable: true })).toEqual({ status: 'queued', delaySec: 300 });
    expect(afterFailure({ attempts: 3, maxAttempts: 3, retryable: true })).toEqual({ status: 'failed' });
    expect(afterFailure({ attempts: 1, maxAttempts: 3, retryable: false })).toEqual({ status: 'failed' });
    expect(retryDelaySec(9)).toBe(3600);
  });

  it('error texts lose digit runs and line breaks', () => {
    expect(sanitizeError('STT 503\nfor 998 90 123 45 67')).toBe('STT 503 for ***');
    expect(sanitizeError('x'.repeat(900))).toHaveLength(500);
  });
});

describe('workerTokenMatches', () => {
  const token = 'a-very-long-random-worker-token-1234567890';
  const hash = sha256Hex(token);
  it('accepts the bearer token whose SHA-256 is configured', () => {
    expect(workerTokenMatches(`Bearer ${token}`, hash)).toBe(true);
    expect(workerTokenMatches(`Bearer ${token}`, hash.toUpperCase())).toBe(true);
  });
  it('rejects other tokens, other schemes and an unconfigured API', () => {
    expect(workerTokenMatches(`Bearer ${token}x`, hash)).toBe(false);
    expect(workerTokenMatches(`Basic ${token}`, hash)).toBe(false);
    expect(workerTokenMatches(token, hash)).toBe(false);
    expect(workerTokenMatches(undefined, hash)).toBe(false);
    expect(workerTokenMatches(`Bearer ${token}`, undefined)).toBe(false);
    expect(workerTokenMatches('Bearer short', sha256Hex('short'))).toBe(false);
  });
});
