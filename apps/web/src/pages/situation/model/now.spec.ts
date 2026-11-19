import type { LiveCall, LiveOperator, LiveQueue, SituationWorkday } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { LONG_WAIT_SEC, percent, shiftState, telephonyNow, waitLevel } from './now';

const op = (extension: string, presence: LiveOperator['presence']) => ({ extension, presence }) as LiveOperator;
const call = (id: string, state: LiveCall['state'], direction: LiveCall['direction']) =>
  ({ id, state, direction }) as LiveCall;
const queue = (name: string, joined: string[]) =>
  ({
    name,
    waiting: joined.map((joinedAt, i) => ({ callId: `${i}.1`, phone: null, position: i + 1, joinedAt })),
  }) as LiveQueue;

describe('telephonyNow', () => {
  it('operators by state: everyone not offline is on the line', () => {
    const r = telephonyNow({
      operators: [
        op('101', 'talking'),
        op('102', 'idle'),
        op('103', 'paused'),
        op('104', 'offline'),
        op('105', 'ringing'),
      ],
      calls: [],
      queues: [],
    });
    expect(r.operators).toEqual({ online: 4, talking: 1, ringing: 1, idle: 1, paused: 1, offline: 1 });
  });

  it('waiting callers across queues and the longest wait', () => {
    const r = telephonyNow({
      operators: [],
      calls: [],
      queues: [
        queue('2020159', ['2026-11-19T10:00:30.000Z']),
        queue('2020142', ['2026-11-19T10:00:05.000Z', '2026-11-19T10:01:00.000Z']),
      ],
    });
    expect(r.waiting).toBe(3);
    expect(r.longestSince).toBe('2026-11-19T10:00:05.000Z');
    expect(telephonyNow({ operators: [], calls: [], queues: [] }).longestSince).toBeNull();
  });

  it('conversations with citizens only; ringing and dialing apart', () => {
    const r = telephonyNow({
      operators: [],
      calls: [
        call('1.1', 'talking', 'inbound'),
        call('2.1', 'talking', 'outbound'),
        call('3.1', 'talking', 'internal'),
        call('4.1', 'ringing', 'inbound'),
        call('5.1', 'dialing', 'outbound'),
        call('6.1', 'queued', 'inbound'),
        call('7.1', 'ivr', 'inbound'),
      ],
      queues: [],
    });
    expect(r.conversations).toEqual({ total: 2, inbound: 1, outbound: 1 });
    expect(r.ringing).toBe(2);
  });
});

describe('shiftState', () => {
  const day: SituationWorkday = { date: '2026-11-19', working: true, start: '08:00', end: '21:00' };
  it('working hours are [start, end)', () => {
    expect(shiftState(day, '07:59')).toBe('afterHours');
    expect(shiftState(day, '08:00')).toBe('working');
    expect(shiftState(day, '20:59')).toBe('working');
    expect(shiftState(day, '21:00')).toBe('afterHours');
  });
  it('a day off stays a day off all day', () => {
    expect(shiftState({ ...day, working: false }, '10:00')).toBe('dayOff');
  });
});

describe('waitLevel', () => {
  it('calm without callers, louder with them, loudest after 3 minutes', () => {
    expect(waitLevel(0, 0)).toBe('calm');
    expect(waitLevel(2, 30)).toBe('waiting');
    expect(waitLevel(1, LONG_WAIT_SEC - 1)).toBe('waiting');
    expect(waitLevel(1, LONG_WAIT_SEC)).toBe('long');
  });
});

describe('percent', () => {
  it('whole percent, 0 without a base', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });
});
