import type { LiveCounters, LiveOperator, OperatorToday } from '@cc/shared';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { CALL_CARDS, callListView } from './call-views';

const counters: LiveCounters = {
  date: '2026-11-19',
  since: '2026-11-19T00:00:00+05:00',
  seededThrough: '2026-11-19T12:44:00+05:00',
  inbound: 227,
  answered: 210,
  abandoned: 9,
  ivrOnly: 7,
  unanswered: 17,
  answerRate: 93,
  outbound: 18,
  outboundAnswered: 10,
  operatorMissed: 47,
  operatorMissedNoAnswer: 19,
  operatorMissedRejected: 28,
  talkSeconds: 24_043,
  clientHangups: 1,
  operatorHangups: 0,
  unknownHangups: 209,
  avgWaitSec: 31,
};

const today = (over: Partial<OperatorToday>): OperatorToday => ({
  answered: 0,
  outbound: 0,
  outboundAttempts: 0,
  missed: 0,
  missedNoAnswer: 0,
  missedRejected: 0,
  transfersIn: 0,
  transfersOut: 0,
  talkSeconds: 0,
  clientHangups: 0,
  operatorHangups: 0,
  ...over,
});

const op = (extension: string, name: string, over: Partial<OperatorToday>): LiveOperator => ({
  extension,
  name,
  presence: 'idle',
  presenceSince: '2026-11-19T12:00:00+05:00',
  registered: true,
  ip: null,
  paused: false,
  pauseReason: null,
  call: null,
  queue: null,
  today: today(over),
});

const operators = [
  op('101', 'Aziza', { missed: 3, answered: 40 }),
  op('102', 'Bobur', { missed: 0, answered: 55, outboundAttempts: 4 }),
  op('103', 'Dilnoza', { missed: 7, answered: 40 }),
];
const t = ((key: string) => key) as unknown as TFunction<'liveCounters'>;

describe('callListView', () => {
  it('every call card has a stable id and at least one tab', () => {
    for (const card of CALL_CARDS) {
      const view = callListView(card, counters, operators, t);
      expect(view.id).toBe(card);
      expect(view.tabs.length).toBeGreaterThan(0);
    }
  });

  it('"Jami" lists inbound + outbound (no internal calls) and splits them', () => {
    const view = callListView('total', counters, operators, t);
    expect(view.tabs.map((x) => [x.filter, x.count])).toEqual([
      [{ direction: 'external' }, 245],
      [{ direction: 'inbound' }, 227],
      [{ direction: 'outbound' }, 18],
    ]);
  });

  it('missed calls: by reason, with chips of the operators who missed, most first', () => {
    const view = callListView('missed', counters, operators, t);
    expect(view.tabs.map((x) => x.filter.operatorMiss)).toEqual(['any', 'no_answer', 'rejected']);
    expect(view.tabs.map((x) => x.count)).toEqual([47, 19, 28]);
    expect(view.operators).toEqual([
      { ext: '103', name: 'Dilnoza', count: 7 },
      { ext: '101', name: 'Aziza', count: 3 },
    ]);
    expect(view.showMissedBy).toBe(true);
    expect(view.operatorNames).toMatchObject({ '102': 'Bobur' });
  });

  it('answered: ties keep extension order; outbound chips count attempts', () => {
    expect(callListView('answered', counters, operators, t).operators?.map((o) => o.ext)).toEqual([
      '102',
      '101',
      '103',
    ]);
    expect(callListView('outbound', counters, operators, t).operators).toEqual([
      { ext: '102', name: 'Bobur', count: 4 },
    ]);
    expect(callListView('outbound', counters, operators, t).tabs[2].count).toBe(8);
  });
});
