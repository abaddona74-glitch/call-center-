import { describe, expect, it } from 'vitest';
import {
  type CallbackState,
  categoryOf,
  causeFromDisposition,
  countOnDay,
  decideConversation,
  decideMissed,
  decideOutboundFailure,
  deriveMissedSource,
  mergeSources,
} from './callback-rules.js';
import type { WorkingCalendar } from './working-calendar.js';

const cal: WorkingCalendar = {
  timezone: 'Asia/Tashkent',
  workDays: [1, 2, 3, 4, 5],
  workStart: '08:00',
  workEnd: '21:00',
  holidays: ['2026-12-08'],
};
const t = (local: string) => new Date(`${local}+05:00`);

const open = (over: Partial<CallbackState> = {}): CallbackState => ({
  id: 7,
  status: 'pending',
  firstMissedAt: t('2026-11-17T10:00:00'),
  lastMissedAt: t('2026-11-17T10:00:00'),
  closedAt: null,
  sources: ['abandoned'],
  ...over,
});

describe('deriveMissedSource', () => {
  it('abandoned during working hours when no operator was rung', () => {
    expect(deriveMissedSource({ startedAt: t('2026-11-17T10:00:00'), operatorRang: false, calendar: cal })).toBe(
      'abandoned',
    );
  });

  it('operator_missed when an operator was rung and did not pick up', () => {
    expect(deriveMissedSource({ startedAt: t('2026-11-17T10:00:00'), operatorRang: true, calendar: cal })).toBe(
      'operator_missed',
    );
  });

  it.each([
    ['2026-11-17T21:00:00', 'closing time'],
    ['2026-11-17T06:30:00', 'early morning'],
    ['2026-11-21T11:00:00', 'Saturday'],
    ['2026-12-08T11:00:00', 'holiday'],
  ])('after_hours at %s (%s), even if an operator was rung', (local) => {
    expect(deriveMissedSource({ startedAt: t(local), operatorRang: true, calendar: cal })).toBe('after_hours');
  });

  it('after_hours when the PBX played its off-hours announcement', () => {
    expect(
      deriveMissedSource({
        startedAt: t('2026-11-17T10:00:00'),
        operatorRang: false,
        ivrAfterHours: true,
        calendar: cal,
      }),
    ).toBe('after_hours');
  });
});

describe('mergeSources', () => {
  it('keeps order and uniqueness', () => {
    expect(mergeSources(['after_hours'], 'abandoned')).toEqual(['after_hours', 'abandoned']);
    expect(mergeSources(['after_hours', 'abandoned'], 'after_hours')).toEqual(['after_hours', 'abandoned']);
  });
});

describe('decideMissed', () => {
  it('creates a callback for a first missed call', () => {
    expect(decideMissed({ at: t('2026-11-17T10:00:00'), source: 'abandoned' }, null, null)).toEqual({
      action: 'create',
    });
  });

  it('appends to the open callback, extends the time window and keeps the opening source', () => {
    const decision = decideMissed(
      { at: t('2026-11-17T11:00:00'), source: 'abandoned' },
      open({
        sources: ['after_hours'],
        firstMissedAt: t('2026-11-16T22:00:00'),
        lastMissedAt: t('2026-11-16T22:00:00'),
      }),
      null,
    );
    expect(decision).toEqual({
      action: 'append',
      callbackId: 7,
      firstMissedAt: t('2026-11-16T22:00:00'),
      lastMissedAt: t('2026-11-17T11:00:00'),
      // after-hours request is not lost or overwritten when the citizen calls again (legacy B7)
      sources: ['after_hours', 'abandoned'],
    });
  });

  it('a late-arriving older call (reconciliation) moves firstMissedAt back but not lastMissedAt', () => {
    const decision = decideMissed({ at: t('2026-11-17T09:00:00'), source: 'abandoned' }, open(), null);
    expect(decision).toMatchObject({
      action: 'append',
      firstMissedAt: t('2026-11-17T09:00:00'),
      lastMissedAt: t('2026-11-17T10:00:00'),
    });
  });

  it('does not resurrect a callback closed after the call', () => {
    const closed = { closedAt: t('2026-11-17T12:00:00') };
    expect(decideMissed({ at: t('2026-11-17T11:59:59'), source: 'abandoned' }, null, closed)).toEqual({
      action: 'skip',
      reason: 'before_last_close',
    });
    expect(decideMissed({ at: t('2026-11-17T12:00:00'), source: 'abandoned' }, null, closed)).toMatchObject({
      action: 'skip',
    });
  });

  it('opens a new callback for a call after the last close', () => {
    expect(
      decideMissed({ at: t('2026-11-17T12:00:01'), source: 'abandoned' }, null, { closedAt: t('2026-11-17T12:00:00') }),
    ).toEqual({ action: 'create' });
  });
});

describe('decideConversation', () => {
  const MIN = 10;

  it('resolves on a real inbound conversation (citizen called again and talked)', () => {
    expect(
      decideConversation({ direction: 'inbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 45 }, open(), MIN),
    ).toEqual({ action: 'resolve', resolutionType: 'client_inbound' });
  });

  it('resolves on an operator call back that was answered long enough', () => {
    expect(
      decideConversation({ direction: 'outbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 10 }, open(), MIN),
    ).toEqual({ action: 'resolve', resolutionType: 'operator_outbound' });
  });

  it('does not resolve on a pickup shorter than the threshold (legacy B55)', () => {
    expect(
      decideConversation({ direction: 'outbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 9 }, open(), MIN),
    ).toEqual({ action: 'short' });
    expect(
      decideConversation({ direction: 'inbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 0 }, open(), MIN),
    ).toEqual({ action: 'short' });
  });

  it('an older conversation cannot resolve a newer missed call (legacy B19)', () => {
    expect(
      decideConversation(
        { direction: 'inbound', endedAt: t('2026-11-17T09:59:00'), talkSeconds: 300 },
        open({ lastMissedAt: t('2026-11-17T10:00:00') }),
        MIN,
      ),
    ).toEqual({ action: 'ignore', reason: 'older_than_last_missed_call' });
  });

  it('ignores conversations of citizens without an open callback', () => {
    expect(
      decideConversation({ direction: 'inbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 60 }, null, MIN),
    ).toEqual({ action: 'ignore', reason: 'no_open_callback' });
    expect(
      decideConversation(
        { direction: 'inbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 60 },
        open({ status: 'dismissed', closedAt: t('2026-11-17T10:01:00') }),
        MIN,
      ),
    ).toMatchObject({ action: 'ignore' });
  });

  it('uses the configured threshold', () => {
    expect(
      decideConversation({ direction: 'inbound', endedAt: t('2026-11-17T10:05:00'), talkSeconds: 25 }, open(), 30),
    ).toEqual({ action: 'short' });
  });
});

describe('decideOutboundFailure', () => {
  it('records attempts made after the first missed call', () => {
    expect(decideOutboundFailure(t('2026-11-17T10:01:00'), open())).toBe('record');
    expect(decideOutboundFailure(t('2026-11-17T10:00:00'), open())).toBe('record');
  });

  it('ignores earlier calls to the number and numbers without an open callback (legacy B20)', () => {
    expect(decideOutboundFailure(t('2026-11-17T09:00:00'), open())).toBe('ignore');
    expect(decideOutboundFailure(t('2026-11-17T11:00:00'), null)).toBe('ignore');
  });
});

describe('causeFromDisposition', () => {
  it.each([
    ['BUSY', 'busy'],
    ['NO ANSWER', 'no_answer'],
    ['FAILED', 'unavailable'],
    ['CONGESTION', 'unavailable'],
    ['ANSWERED', 'no_answer'],
    ['', 'no_answer'],
  ] as const)('%s → %s', (disposition, cause) => {
    expect(causeFromDisposition(disposition)).toBe(cause);
  });
});

describe('categoryOf', () => {
  it('maps status and attempts to the legacy chips', () => {
    expect(categoryOf({ status: 'pending', outboundAttempts: 0 })).toBe('pending');
    expect(categoryOf({ status: 'pending', outboundAttempts: 2 })).toBe('unreachable');
    expect(categoryOf({ status: 'resolved', outboundAttempts: 2 })).toBe('resolved');
    expect(categoryOf({ status: 'dismissed', outboundAttempts: 0 })).toBe('dismissed');
  });
});

describe('countOnDay', () => {
  it('counts events of a kind on a Tashkent day', () => {
    const events = [
      { kind: 'missed', at: t('2026-11-16T23:30:00') },
      { kind: 'missed', at: t('2026-11-17T00:10:00') },
      { kind: 'missed', at: t('2026-11-17T18:00:00') },
      { kind: 'outbound_failed', at: t('2026-11-17T18:05:00') },
    ];
    expect(countOnDay(events, 'missed', '2026-11-17', 'Asia/Tashkent')).toBe(2);
    expect(countOnDay(events, 'missed', '2026-11-16', 'Asia/Tashkent')).toBe(1);
    expect(countOnDay(events, 'outbound_failed', '2026-11-17', 'Asia/Tashkent')).toBe(1);
  });
});
