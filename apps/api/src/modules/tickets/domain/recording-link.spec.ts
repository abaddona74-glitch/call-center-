import { describe, expect, it } from 'vitest';
import { RECORDING_RETRY_MS, afterCheck, scheduleForEndedCall, scheduleForRunningCall } from './recording-link.js';

const now = new Date('2026-11-17T10:00:00Z');

describe('recording link schedule', () => {
  it('waits for a running call, looks soon after it ended', () => {
    const running = scheduleForRunningCall(now);
    expect(running.deadline.getTime() - now.getTime()).toBe(4 * 3_600_000);
    const ended = scheduleForEndedCall(now);
    expect(ended.nextAt.getTime() - now.getTime()).toBe(5_000);
    expect(ended.deadline.getTime() - now.getTime()).toBe(10 * 60_000);
  });

  it('retries until the deadline, then gives up', () => {
    const deadline = new Date(now.getTime() + 60_000);
    expect(afterCheck({ kind: 'found', path: '2026/11/17/a.wav' }, deadline, now)).toEqual({
      status: 'found',
      nextAt: null,
      path: '2026/11/17/a.wav',
    });
    expect(afterCheck({ kind: 'missing' }, deadline, now)).toEqual({
      status: 'pending',
      nextAt: new Date(now.getTime() + RECORDING_RETRY_MS),
      path: null,
    });
    expect(afterCheck({ kind: 'missing' }, now, now).status).toBe('none');
    expect(afterCheck({ kind: 'unavailable' }, now, now).status).toBe('unavailable');
    expect(afterCheck({ kind: 'unavailable' }, deadline, now).status).toBe('pending');
  });
});
