import { describe, expect, it } from 'vitest';
import { epochToWall } from '../../../common/time/business-time.js';
import { CallEvents } from '../../../common/events/domain-events.js';
import { assembleCalls } from '../../../pbx/calls/call-assembler.js';
import type { CdrRow } from '../../../pbx/calls/cdr-row.js';
import { missReasonOfRow } from '../../../pbx/calls/dialplan.js';
import { TEST_CALENDAR, TEST_DIALPLAN } from '../../../pbx/calls/testing/cdr-fixtures.js';
import { addCallsToSeed, dayStartMs, emptySeed } from './cdr-seed.js';
import { type AmiEvent, type LiveDomainEvent, LiveStore } from './live-store.js';
import { missReasonOfDial } from './missed-ring.js';
import { projectCounters, projectOperators } from './projection.js';

const TZ = 'Asia/Tashkent';
const T0 = Date.UTC(2026, 10, 17, 5, 0, 0); // Tue 10:00 Tashkent
const config = { operatorExtension: /^[0-9]{2,4}$/, timezone: TZ };

describe('the miss rule, CDR and AMI', () => {
  it.each([
    ['NO ANSWER', 15, 'no_answer'],
    ['NO ANSWER', 0, 'no_answer'], // the citizen hung up as it started ringing: still NO ANSWER in the CDR
    ['BUSY', 3, 'rejected'],
    ['BUSY', 1, 'rejected'],
    ['BUSY', 0, null], // busy at once: already on a call
    ['CONGESTION', 0, null], // phone offline
    ['FAILED', 0, null],
    ['ANSWERED', 60, null],
  ])('CDR %s, duration %i s → %s', (disposition, duration, reason) => {
    expect(missReasonOfRow({ disposition, duration })).toBe(reason);
  });

  it.each([
    ['NOANSWER', 15_000, 'no_answer'],
    ['CANCEL', 3_000, 'no_answer'], // written as NO ANSWER by Asterisk's CDR
    ['BUSY', 3_249, 'rejected'],
    ['BUSY', 1_000, 'rejected'],
    ['BUSY', 999, null],
    ['CHANUNAVAIL', 0, null],
    ['CONGESTION', 0, null],
    ['ANSWER', 5_000, null],
  ])('AMI dial %s after %i ms → %s', (status, ms, reason) => {
    expect(missReasonOfDial(status, ms)).toBe(reason);
  });
});

/**
 * One queue call, as AMI reports it (Asterisk 13, app_queue + Local members) and as the CDR writes it without
 * linkedid: one caller-side member row per ring (dstchannel Local/<ext>@from-queue…;1) whose disposition is that
 * dial's status (CANCEL/NOANSWER → NO ANSWER) and whose duration is the ring in whole seconds, rounded down.
 */
function queueCall() {
  const sec = Math.floor(T0 / 1000);
  const callId = `${sec}.1`;
  const trunk = {
    channel: 'SIP/712020159-000000f0',
    uniqueid: callId,
    linkedid: callId,
    channelstate: '6',
    calleridnum: '901234567',
    calleridname: '<unknown>',
    exten: '712020159',
    context: 'from-trunk',
  };
  const events: Array<[number, AmiEvent]> = [
    [0, { event: 'Newchannel', ...trunk, channelstate: '4' }],
    [5_000, { event: 'QueueCallerJoin', ...trunk, queue: '2020159', position: '1' }],
  ];
  const rows: CdrRow[] = [
    {
      calldate: epochToWall(T0, TZ),
      clid: '',
      src: '901234567',
      dst: 's',
      dcontext: 'ivr-4',
      channel: trunk.channel,
      dstchannel: '',
      lastapp: 'BackGround',
      lastdata: 'custom/welcome-menu',
      duration: 5,
      billsec: 4,
      disposition: 'ANSWERED',
      uniqueid: callId,
      linkedid: callId,
      recordingfile: '',
    },
  ];
  let n = 0;
  const dest = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [`dest${k}`, v]));
  const member = (ext: string) => ({ queue: '2020159', interface: `Local/${ext}@from-queue/n`, membername: ext });

  /** One ring of `ext` from `start` to `end` (ms after T0) that ended with `status`; ANSWER then talks `talk` s. */
  const ring = (ext: string, start: number, end: number, status: string, talk = 0) => {
    n++;
    const hex = (0x100 + n).toString(16).padStart(8, '0');
    const ch = (name: string, k: number) => ({
      channel: name,
      uniqueid: `${sec}.${100 * k + n}`,
      linkedid: callId,
      channelstate: '0',
      calleridnum: '901234567',
      calleridname: '<unknown>',
      exten: ext,
      context: 'from-queue',
    });
    const l1 = ch(`Local/${ext}@from-queue-${hex};1`, 1);
    const l2 = ch(`Local/${ext}@from-queue-${hex};2`, 2);
    const sip = ch(`SIP/${ext}-${hex}`, 3);
    const offline = status === 'CONGESTION';
    events.push(
      [start, { event: 'Newchannel', ...l1 }],
      [start, { event: 'Newchannel', ...l2 }],
      [start, { event: 'AgentCalled', ...trunk, ...dest(l1), ...member(ext) }],
      [start, { event: 'DialBegin', ...trunk, ...dest(l1) }],
    );
    if (!offline) {
      events.push([start, { event: 'Newchannel', ...sip }], [start, { event: 'DialBegin', ...l2, ...dest(sip) }]);
    }
    // app_queue's RingTime is whole seconds of the wall clock: a 50 ms ring across a second boundary says 1 000
    const ringTime = String((Math.floor((T0 + end) / 1000) - Math.floor((T0 + start) / 1000)) * 1000);
    const arna: AmiEvent = { event: 'AgentRingNoAnswer', ...trunk, ...dest(l1), ...member(ext), ringtime: ringTime };
    if (status === 'ANSWER') {
      events.push(
        [end, { event: 'DialEnd', ...l2, ...dest(sip), dialstatus: 'ANSWER' }],
        [end, { event: 'Newstate', ...sip, channelstate: '6' }],
        [end, { event: 'DialEnd', ...trunk, ...dest(l1), dialstatus: 'ANSWER' }],
        [end, { event: 'AgentConnect', ...trunk, ...dest(l1), ...member(ext), holdtime: '30' }],
        [end + talk * 1000, { event: 'Hangup', ...sip, cause: '16' }],
        [end + talk * 1000, { event: 'Hangup', ...l2, cause: '16' }],
        [end + talk * 1000, { event: 'Hangup', ...l1, cause: '16' }],
        [end + talk * 1000, { event: 'Hangup', ...trunk, cause: '16' }],
      );
    } else if (status === 'CANCEL') {
      // ring timeout: the queue gives up on the member
      events.push(
        [end, arna],
        [end, { event: 'DialEnd', ...l2, ...dest(sip), dialstatus: 'CANCEL' }],
        [end, { event: 'Hangup', ...sip, cause: '16' }],
        [end, { event: 'DialEnd', ...trunk, ...dest(l1), dialstatus: 'CANCEL' }],
      );
    } else {
      if (!offline) events.push([end, { event: 'DialEnd', ...l2, ...dest(sip), dialstatus: status }]);
      if (!offline) events.push([end, { event: 'Hangup', ...sip, cause: '17' }]);
      events.push([end, { event: 'DialEnd', ...trunk, ...dest(l1), dialstatus: status }], [end, arna]);
    }
    if (status !== 'ANSWER') {
      events.push([end, { event: 'Hangup', ...l2, cause: '16' }], [end, { event: 'Hangup', ...l1, cause: '16' }]);
    }
    const disposition = { ANSWER: 'ANSWERED', CANCEL: 'NO ANSWER', NOANSWER: 'NO ANSWER' }[status] ?? status;
    rows.push({
      ...rows[0],
      calldate: epochToWall(T0 + start, TZ),
      dst: '2020159',
      dcontext: 'ext-queues',
      dstchannel: l1.channel,
      lastapp: 'Queue',
      lastdata: '',
      duration: Math.floor((end - start) / 1000) + talk,
      billsec: talk,
      disposition,
    });
  };

  // rrmemory over the members, two retry cycles
  ring('101', 6_000, 6_000, 'CONGESTION'); //    offline
  ring('102', 6_990, 7_040, 'BUSY'); //          busy at once (50 ms, across a second: RingTime says 1 000)
  ring('103', 8_000, 23_000, 'CANCEL'); //       rang out
  ring('104', 25_000, 28_249, 'BUSY'); //        declined after 3.2 s
  ring('105', 30_000, 45_000, 'CANCEL'); //      rang out …
  ring('101', 47_000, 47_000, 'CONGESTION'); //  offline again
  ring('103', 48_000, 63_000, 'CANCEL'); //      … rang out again (once per call)
  ring('105', 65_000, 67_500, 'BUSY'); //        … then declined: one miss, rejected
  ring('107', 70_000, 71_000, 'BUSY'); //        declined after exactly 1 s
  ring('108', 73_000, 73_999, 'BUSY'); //        999 ms: busy at once
  ring('106', 75_000, 90_000, 'CANCEL'); //      rang out …
  ring('106', 92_000, 97_000, 'ANSWER', 60); //  … then answered: no miss
  return { events, rows, callId };
}

describe('misses of one queue call, live (AMI) and from the CDR', () => {
  const { events, rows, callId } = queueCall();
  const store = new LiveStore(config, T0);
  const emitted: LiveDomainEvent[] = [];
  for (const [t, e] of [...events].sort((a, b) => a[0] - b[0])) {
    store.apply(e, T0 + t);
    emitted.push(...store.drainEvents());
  }
  const calls = assembleCalls(rows, TEST_DIALPLAN, TEST_CALENDAR);
  const { seed } = addCallsToSeed(emptySeed('2026-11-17', dayStartMs('2026-11-17', TZ), T0 + 86_400_000), calls);

  const expected = {
    '101': { missed: 0, missedNoAnswer: 0, missedRejected: 0 },
    '102': { missed: 0, missedNoAnswer: 0, missedRejected: 0 },
    '103': { missed: 1, missedNoAnswer: 1, missedRejected: 0 },
    '104': { missed: 1, missedNoAnswer: 0, missedRejected: 1 },
    '105': { missed: 1, missedNoAnswer: 0, missedRejected: 1 },
    '106': { missed: 0, missedNoAnswer: 0, missedRejected: 0, answered: 1 },
    '107': { missed: 1, missedNoAnswer: 0, missedRejected: 1 },
    '108': { missed: 0, missedNoAnswer: 0, missedRejected: 0 },
  };

  it('CDR: once per call and operator, only phones that rang, rejected over no answer', () => {
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: callId, status: 'answered', finalOperator: '106' });
    expect(calls[0].missedBy).toEqual([
      { ext: '103', reason: 'no_answer' },
      { ext: '104', reason: 'rejected' },
      { ext: '105', reason: 'rejected' },
      { ext: '107', reason: 'rejected' },
    ]);
  });

  it('live: the same misses, counted once per call and operator', () => {
    expect(projectCounters(store)).toMatchObject({
      inbound: 1,
      answered: 1,
      operatorMissed: 4,
      operatorMissedNoAnswer: 1,
      operatorMissedRejected: 3,
    });
    const ops = projectOperators(store, T0 + 200_000);
    for (const [ext, today] of Object.entries(expected)) {
      expect(ops.find((o) => o.extension === ext)?.today, ext).toMatchObject(today);
    }
    // one event per missed pair (the first outcome); 106's ring before the answer raised one too
    const missed = emitted.filter((e) => e.name === CallEvents.OperatorMissed).map((e) => e.payload);
    expect(missed.map((m) => [m.extension, m.reason])).toEqual([
      ['103', 'no_answer'],
      ['104', 'rejected'],
      ['105', 'no_answer'],
      ['107', 'rejected'],
      ['106', 'no_answer'],
    ]);
  });

  it('the CDR seed gives the dashboard the same numbers as live counting', () => {
    const live = projectCounters(store);
    expect(seed.counters).toMatchObject({
      operatorMissed: live.operatorMissed,
      operatorMissedNoAnswer: live.operatorMissedNoAnswer,
      operatorMissedRejected: live.operatorMissedRejected,
    });
    const ops = projectOperators(store, T0 + 200_000);
    for (const ext of Object.keys(expected)) {
      const l = ops.find((o) => o.extension === ext)!.today;
      const s = seed.operators.get(ext);
      expect(
        { missed: s?.missed ?? 0, missedNoAnswer: s?.missedNoAnswer ?? 0, missedRejected: s?.missedRejected ?? 0 },
        ext,
      ).toEqual({ missed: l.missed, missedNoAnswer: l.missedNoAnswer, missedRejected: l.missedRejected });
    }
  });
});
