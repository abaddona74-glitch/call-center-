import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_MATCH_WINDOW_MS,
  attemptStatusAfterEnd,
  compareCallbackQueue,
  decideAfterEnd,
  decideOutcome,
  eventMatchesAttempt,
  isOpenAttempt,
} from './ticket-callback.js';

const t0 = new Date('2026-11-17T10:00:00Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);
const attempt = { extension: '201', phone: '901234567', startedAt: t0, callId: null, status: 'dialing' as const };
const event = {
  callId: '1763373600.10',
  direction: 'outbound' as const,
  extension: '201',
  phone: '901234567',
  at: plus(4_000),
};

describe('eventMatchesAttempt', () => {
  it('matches the outbound call from my extension to the ticket number shortly after pressing call', () => {
    expect(eventMatchesAttempt(attempt, event)).toBe(true);
    expect(eventMatchesAttempt(attempt, { ...event, at: plus(-3_000) })).toBe(true);
  });
  it('rejects other numbers, extensions, directions and late calls', () => {
    expect(eventMatchesAttempt(attempt, { ...event, phone: '909999999' })).toBe(false);
    expect(eventMatchesAttempt(attempt, { ...event, extension: '202' })).toBe(false);
    expect(eventMatchesAttempt(attempt, { ...event, direction: 'inbound' })).toBe(false);
    expect(eventMatchesAttempt(attempt, { ...event, phone: null })).toBe(false);
    expect(eventMatchesAttempt(attempt, { ...event, at: plus(ATTEMPT_MATCH_WINDOW_MS + 1) })).toBe(false);
    expect(eventMatchesAttempt(attempt, { ...event, at: plus(-60_000) })).toBe(false);
  });
  it('a bound attempt matches only its own call id', () => {
    const bound = { ...attempt, callId: event.callId, status: 'answered' as const };
    expect(eventMatchesAttempt(bound, { ...event, at: plus(10 * 60_000) })).toBe(true);
    expect(eventMatchesAttempt(bound, { ...event, callId: '1763373600.99' })).toBe(false);
  });
});

describe('conversation and outcome', () => {
  it('connected needs an answered call of at least 10 s', () => {
    expect(attemptStatusAfterEnd(true, 10)).toBe('connected');
    expect(attemptStatusAfterEnd(true, 9)).toBe('not_connected');
    expect(attemptStatusAfterEnd(false, 30)).toBe('not_connected');
  });

  it('closes only with a confirmed conversation and a real outcome', () => {
    expect(decideOutcome('connected', 'informed')).toEqual({ kind: 'close' });
    expect(decideOutcome('connected', 'unresolved')).toEqual({ kind: 'close' });
    expect(decideOutcome('answered', 'informed')).toEqual({ kind: 'pending' });
    expect(decideOutcome('dialing', 'other')).toEqual({ kind: 'pending' });
    expect(decideOutcome('not_connected', 'informed')).toMatchObject({ kind: 'error' });
    expect(decideOutcome('failed', 'informed')).toMatchObject({ kind: 'error' });
    for (const s of ['connected', 'not_connected', 'dialing'] as const)
      expect(decideOutcome(s, 'not_reached')).toEqual({ kind: 'attempt' });
  });

  it('an outcome given during the call is applied when it ends', () => {
    expect(decideAfterEnd('connected', 'informed')).toBe('close');
    expect(decideAfterEnd('not_connected', 'informed')).toBe('attempt');
    expect(decideAfterEnd('connected', null)).toBe('wait');
    expect(decideAfterEnd('connected', 'not_reached')).toBe('attempt');
  });

  it('open attempts block a second call until they end or go stale', () => {
    expect(isOpenAttempt({ status: 'dialing', startedAt: t0 }, plus(60_000))).toBe(true);
    expect(isOpenAttempt({ status: 'answered', startedAt: t0 }, plus(3 * 3_600_000))).toBe(false);
    expect(isOpenAttempt({ status: 'connected', startedAt: t0 }, plus(1_000))).toBe(false);
  });
});

describe('callback queue order', () => {
  it('my citizens first, then the oldest resolution', () => {
    const rows = [
      { id: 1, lastContactUserId: 5, resolvedAt: new Date('2026-11-17T08:00:00Z') },
      { id: 2, lastContactUserId: 7, resolvedAt: new Date('2026-11-17T09:00:00Z') },
      { id: 3, lastContactUserId: null, resolvedAt: new Date('2026-11-17T07:00:00Z') },
      { id: 4, lastContactUserId: 7, resolvedAt: new Date('2026-11-17T06:00:00Z') },
    ];
    expect(rows.sort((a, b) => compareCallbackQueue(a, b, 7)).map((r) => r.id)).toEqual([4, 2, 3, 1]);
  });
});
