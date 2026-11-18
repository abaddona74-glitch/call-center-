import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CallEvents } from '../../../common/events/domain-events.js';
import { type AmiEvent, type LiveDomainEvent, LiveStore } from './live-store.js';
import {
  callsFor,
  operatorsFor,
  projectCalls,
  projectCounters,
  projectOperators,
  projectQueues,
  queuesFor,
} from './projection.js';

const config = { operatorExtension: /^[0-9]{2,4}$/, timezone: 'Asia/Tashkent' };
const T0 = Date.UTC(2026, 10, 17, 5, 0, 0); // 10:00 Tashkent

interface Fixture {
  start: number;
  peers: Record<string, string>[];
  queueStatus: Record<string, string>[];
  events: Array<{ t: number; e: Record<string, string> }>;
}

/** AMI keys are case-insensitive; the client lowercases them (see ami.protocol.ts). */
const lower = (e: Record<string, string>): AmiEvent =>
  Object.fromEntries(Object.entries(e).map(([k, v]) => [k.toLowerCase(), v]));

const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', `${name}.json`), 'utf8')) as Fixture;

/** Replays a recorded simulator scenario; `at` callbacks run right after the event at that offset. */
function play(
  name: string,
  opts: { before?: (s: LiveStore) => void; at?: Record<number, (s: LiveStore, now: number) => void> } = {},
) {
  const fx = load(name);
  const store = new LiveStore(config, fx.start);
  store.applyPeers(fx.peers.map(lower), fx.start);
  store.applyQueueStatus(fx.queueStatus.map(lower), fx.start);
  opts.before?.(store);
  const events: LiveDomainEvent[] = [];
  const pending = new Map(Object.entries(opts.at ?? {}).map(([k, v]) => [Number(k), v]));
  for (const { t, e } of fx.events) {
    for (const [at, fn] of pending) {
      if (t > at) {
        fn(store, fx.start + at);
        pending.delete(at);
      }
    }
    store.apply(lower(e), fx.start + t);
    events.push(...store.drainEvents());
  }
  for (const [at, fn] of pending) fn(store, fx.start + at);
  return { store, events, fx };
}

const names = (events: LiveDomainEvent[]) => events.map((e) => e.name);
const ended = (events: LiveDomainEvent[]) => events.filter((e) => e.name === CallEvents.Ended).map((e) => e.payload);
const op = (s: LiveStore, ext: string, now: number) => projectOperators(s, now).find((o) => o.extension === ext)!;

describe('LiveStore — recorded simulator scenarios', () => {
  it('queue call answered, citizen hangs up', () => {
    const { store, events } = play('queue-answered-client-hangup', {
      at: {
        5_000: (s, now) => {
          expect(op(s, '101', now).presence).toBe('ringing');
          expect(projectCalls(s, now)[0]).toMatchObject({ state: 'ringing', ringing: ['101'], phone: '901234567' });
          expect(projectQueues(s).find((q) => q.name === '2020159')!.waiting).toHaveLength(1);
        },
        60_000: (s, now) => {
          const o = op(s, '101', now);
          expect(o.presence).toBe('talking');
          expect(o.call).toMatchObject({ state: 'talking', direction: 'inbound', phone: '901234567' });
          expect(Date.parse(o.call!.since)).toBe(T0 + 7_799); // talk stopwatch starts at pickup
          expect(projectCalls(s, now)[0]).toMatchObject({ state: 'talking', extension: '101' });
          expect(projectQueues(s).find((q) => q.name === '2020159')!.waiting).toHaveLength(0);
        },
      },
    });

    expect(names(events)).toEqual([CallEvents.QueueJoined, CallEvents.Answered, CallEvents.Ended]);
    expect(events[1].payload).toMatchObject({
      extension: '101',
      phone: '901234567',
      direction: 'inbound',
      callId: '1794891600.1',
    });
    expect(ended(events)).toEqual([
      {
        callId: '1794891600.1',
        direction: 'inbound',
        phone: '901234567',
        at: '2026-11-17T10:01:42.799+05:00',
        extension: '101',
        answered: true,
        talkSeconds: 95,
        hangupParty: 'client',
      },
    ]);
    const now = T0 + 200_000;
    expect(projectCounters(store)).toMatchObject({
      inbound: 1,
      answered: 1,
      answerRate: 100,
      unanswered: 0,
      clientHangups: 1,
      talkSeconds: 95,
    });
    expect(op(store, '101', now)).toMatchObject({
      presence: 'idle',
      call: null,
      today: { answered: 1, talkSeconds: 95, clientHangups: 1 },
    });
    expect(store.calls.size).toBe(0);
    expect(store.channels.size).toBe(0);
  });

  it('queue call answered, operator hangs up (HangupRequest + AgentComplete reason=agent)', () => {
    const { events, store } = play('queue-answered-operator-hangup');
    expect(ended(events)[0]).toMatchObject({
      answered: true,
      hangupParty: 'operator',
      extension: '101',
      phone: '935551122',
    });
    expect(projectCounters(store)).toMatchObject({ operatorHangups: 1, clientHangups: 0 });
  });

  it('abandoned in queue while an operator was ringing: one miss, one abandon, no answer', () => {
    const { events, store } = play('queue-abandoned');
    expect(names(events)).toEqual([
      CallEvents.QueueJoined,
      CallEvents.OperatorMissed,
      CallEvents.Abandoned,
      CallEvents.Ended,
    ]);
    expect(events[1].payload).toMatchObject({ extension: '101', reason: 'no_answer' });
    expect(events[2].payload).toMatchObject({ queue: '2020159', waitSeconds: 20 });
    expect(ended(events)[0]).toMatchObject({ answered: false, extension: null, hangupParty: 'client', talkSeconds: 0 });
    expect(projectCounters(store)).toMatchObject({
      inbound: 1,
      answered: 0,
      abandoned: 1,
      unanswered: 1,
      operatorMissed: 1,
      answerRate: 0,
    });
    expect(op(store, '101', T0 + 60_000).today.missed).toBe(1);
  });

  it('ring-no-answer, then a rejected ring, then answered: each ring is counted once', () => {
    const { events, store } = play('ring-no-answer-then-reject');
    const missed = events.filter((e) => e.name === CallEvents.OperatorMissed).map((e) => e.payload);
    expect(missed.map((m) => [m.extension, m.reason])).toEqual([
      ['101', 'no_answer'],
      ['103', 'rejected'],
    ]);
    const answered = events.filter((e) => e.name === CallEvents.Answered).map((e) => e.payload);
    expect(answered.map((a) => a.extension)).toEqual(['106']);
    expect(ended(events)[0]).toMatchObject({ answered: true, extension: '106', hangupParty: 'client' });
    expect(projectCounters(store)).toMatchObject({ operatorMissed: 2, answered: 1 });
  });

  it('queue timeout without QueueCallerAbandon is unanswered, not credited to the last rung operator (B10)', () => {
    const { events, store } = play('queue-timeout');
    expect(names(events).filter((n) => n === CallEvents.Answered)).toEqual([]);
    expect(events.filter((e) => e.name === CallEvents.Abandoned)).toHaveLength(1);
    expect(ended(events)).toHaveLength(1);
    expect(ended(events)[0]).toMatchObject({ answered: false, extension: null });
    expect(projectCounters(store)).toMatchObject({ answered: 0, abandoned: 1, unanswered: 1 });
    for (const o of projectOperators(store, T0 + 120_000)) expect(o.today.answered).toBe(0);
  });

  it('blind transfer: answered once, transfer out/in per operator, party from the final leg', () => {
    const { events, store } = play('blind-transfer');
    const answered = events.filter((e) => e.name === CallEvents.Answered).map((e) => e.payload.extension);
    expect(answered).toEqual(['101', '106']);
    expect(ended(events)).toEqual([
      expect.objectContaining({ answered: true, extension: '106', hangupParty: 'client' }),
    ]);
    const now = T0 + 300_000;
    expect(op(store, '101', now).today).toMatchObject({ answered: 1, transfersOut: 1, transfersIn: 0 });
    expect(op(store, '106', now).today).toMatchObject({ answered: 0, transfersIn: 1 });
    expect(projectCounters(store)).toMatchObject({ inbound: 1, answered: 1 });
  });

  it('outbound answered from the phone: one call, one answer, operator hung up', () => {
    const { events, store } = play('outbound-answered', {
      at: {
        3_000: (s, now) => {
          expect(op(s, '103', now)).toMatchObject({
            presence: 'ringing',
            call: { state: 'dialing', direction: 'outbound', phone: '991234567' },
          });
        },
        40_000: (s, now) =>
          expect(op(s, '103', now)).toMatchObject({ presence: 'talking', call: { state: 'talking' } }),
      },
    });
    expect(names(events)).toEqual([CallEvents.Answered, CallEvents.Ended]);
    expect(ended(events)[0]).toMatchObject({
      direction: 'outbound',
      phone: '991234567',
      extension: '103',
      answered: true,
      hangupParty: 'operator',
    });
    expect(projectCounters(store)).toMatchObject({ inbound: 0, outbound: 1, outboundAnswered: 1 });
    expect(op(store, '103', T0 + 200_000).today).toMatchObject({ outbound: 1, outboundAttempts: 1 });
  });

  it('outbound busy / cancelled', () => {
    const busy = play('outbound-busy');
    expect(ended(busy.events)[0]).toMatchObject({
      direction: 'outbound',
      answered: false,
      extension: '111',
      hangupParty: 'unknown',
    });
    expect(projectCounters(busy.store)).toMatchObject({ outbound: 1, outboundAnswered: 0 });
    expect(busy.events.some((e) => e.name === CallEvents.OperatorMissed)).toBe(false);

    const cancelled = play('outbound-cancelled');
    expect(ended(cancelled.events)[0]).toMatchObject({ answered: false, hangupParty: 'operator' });
  });

  it('click-to-call: the operator phone rings as an outbound call to the expected number', () => {
    const { events } = play('click-to-call', {
      before: (s) => s.expectOriginate('101', '901234567', T0),
      at: {
        1_000: (s, now) => {
          expect(op(s, '101', now)).toMatchObject({
            presence: 'ringing',
            call: { state: 'dialing', phone: '901234567', direction: 'outbound' },
          });
        },
      },
    });
    expect(names(events)).toEqual([CallEvents.Answered, CallEvents.Ended]);
    expect(ended(events)[0]).toMatchObject({
      direction: 'outbound',
      phone: '901234567',
      extension: '101',
      answered: true,
      hangupParty: 'client',
    });
  });

  it('click-to-call without a prior expectation still resolves to outbound from the Dial string', () => {
    const { events } = play('click-to-call');
    expect(ended(events)[0]).toMatchObject({
      direction: 'outbound',
      phone: '901234567',
      extension: '101',
      answered: true,
    });
  });

  it('hidden caller id has no phone', () => {
    const { events } = play('hidden-caller');
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.payload.phone).toBeNull();
    expect(ended(events)[0]).toMatchObject({ answered: true });
  });

  it('IVR-only and after-hours calls', () => {
    const ivr = play('ivr-only');
    expect(ended(ivr.events)[0]).toMatchObject({ answered: false, hangupParty: 'client', phone: '941112233' });
    expect(projectCounters(ivr.store)).toMatchObject({ inbound: 1, ivrOnly: 1, unanswered: 1, abandoned: 0 });

    const ah = play('after-hours');
    // The PBX ended the call (dialplan Hangup, no HangupRequest): unknown, not "client".
    expect(ended(ah.events)[0]).toMatchObject({ answered: false, hangupParty: 'unknown' });
  });

  it('every scenario leaves no calls or channels behind', () => {
    for (const name of [
      'queue-answered-client-hangup',
      'queue-abandoned',
      'ring-no-answer-then-reject',
      'queue-timeout',
      'blind-transfer',
      'click-to-call',
      'outbound-busy',
    ]) {
      const { store, events } = play(name);
      expect(store.calls.size, name).toBe(0);
      expect(store.channels.size, name).toBe(0);
      expect(ended(events), name).toHaveLength(1);
      for (const o of projectOperators(store, T0 + 3_600_000))
        expect(['idle', 'paused', 'offline'], `${name} ${o.extension}`).toContain(o.presence);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Hand-written sequences for legacy edge cases

const ch = (name: string, uniqueid: string, linkedid: string, extra: Record<string, string> = {}) => ({
  channel: name,
  uniqueid,
  linkedid,
  channelstate: '0',
  calleridnum: '<unknown>',
  calleridname: '<unknown>',
  exten: '',
  context: 'from-internal',
  ...extra,
});
const dest = (fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [`dest${k}`, v]));

function feed(store: LiveStore, seq: Array<[number, AmiEvent]>): LiveDomainEvent[] {
  const out: LiveDomainEvent[] = [];
  for (const [t, e] of seq) {
    store.apply(e, T0 + t);
    out.push(...store.drainEvents());
  }
  return out;
}

describe('LiveStore — legacy edge cases', () => {
  const trunk = ch('SIP/712020159-00000001', '1.1', '1.1', {
    channelstate: '4',
    calleridnum: '998901234567',
    exten: '712020159',
    context: 'from-trunk',
  });
  const sip101 = ch('SIP/101-00000002', '1.2', '1.1', { exten: '101' });

  it('B10: a direct inbound ring that is never answered is not "answered" by the rung operator', () => {
    const store = new LiveStore(config, T0);
    const events = feed(store, [
      [0, { event: 'Newchannel', ...trunk }],
      [100, { event: 'Newchannel', ...sip101 }],
      [100, { event: 'DialBegin', ...trunk, ...dest(sip101), dialstring: '101' }],
      [200, { event: 'Newstate', ...sip101, channelstate: '5' }],
      [9_000, { event: 'HangupRequest', ...trunk }],
      [9_000, { event: 'DialEnd', ...trunk, ...dest(sip101), dialstatus: 'CANCEL' }],
      [9_000, { event: 'Hangup', ...sip101, cause: '16' }],
      [9_000, { event: 'Hangup', ...trunk, cause: '16' }],
    ]);
    expect(names(events)).toEqual([CallEvents.Ended]);
    expect(ended(events)[0]).toMatchObject({
      answered: false,
      extension: null,
      hangupParty: 'client',
      phone: '901234567',
    });
    expect(projectCounters(store)).toMatchObject({
      inbound: 1,
      answered: 0,
      unanswered: 1,
      ivrOnly: 0,
      operatorMissed: 0,
    });
  });

  it('direct dial with NOANSWER is a missed ring; duplicate DialEnd/Hangup are ignored', () => {
    const store = new LiveStore(config, T0);
    const events = feed(store, [
      [0, { event: 'Newchannel', ...trunk }],
      [100, { event: 'Newchannel', ...sip101 }],
      [100, { event: 'DialBegin', ...trunk, ...dest(sip101), dialstring: '101' }],
      [20_000, { event: 'DialEnd', ...trunk, ...dest(sip101), dialstatus: 'NOANSWER' }],
      [20_000, { event: 'DialEnd', ...trunk, ...dest(sip101), dialstatus: 'NOANSWER' }],
      [20_001, { event: 'Hangup', ...sip101, cause: '19' }],
      [20_001, { event: 'Hangup', ...sip101, cause: '19' }],
      [25_000, { event: 'Hangup', ...trunk, cause: '16' }],
      [25_000, { event: 'Hangup', ...trunk, cause: '16' }],
    ]);
    expect(names(events)).toEqual([CallEvents.OperatorMissed, CallEvents.Ended]);
    expect(events[0].payload).toMatchObject({ extension: '101', reason: 'no_answer' });
  });

  it('DialBegin/DialEnd + AgentConnect for one answer produce one Answered and one count (legacy ran two handlers)', () => {
    const store = new LiveStore(config, T0);
    const events = feed(store, [
      [0, { event: 'Newchannel', ...trunk }],
      [100, { event: 'Newchannel', ...sip101 }],
      [100, { event: 'DialBegin', ...trunk, ...dest(sip101) }],
      [2_000, { event: 'Newstate', ...sip101, channelstate: '6' }],
      [2_000, { event: 'DialEnd', ...trunk, ...dest(sip101), dialstatus: 'ANSWER' }],
      [
        2_000,
        { event: 'AgentConnect', ...trunk, queue: '2020159', interface: 'SIP/101', membername: '101', holdtime: '5' },
      ],
      [
        2_000,
        { event: 'AgentConnect', ...trunk, queue: '2020159', interface: 'SIP/101', membername: '101', holdtime: '5' },
      ],
      [2_000, { event: 'BridgeEnter', ...trunk, bridgeuniqueid: 'b1' }],
      [2_000, { event: 'BridgeEnter', ...sip101, bridgeuniqueid: 'b1' }],
    ]);
    expect(names(events)).toEqual([CallEvents.Answered]);
    expect(projectCounters(store).answered).toBe(1);
    expect(op(store, '101', T0 + 3_000).today.answered).toBe(1);
  });

  it('B31: DialState does not reset an outbound call; a >60 s outbound call ends once (B12)', () => {
    const store = new LiveStore(config, T0);
    const opCh = ch('SIP/103-00000010', '2.1', '2.1', { channelstate: '4', calleridnum: '103', exten: '901234567' });
    const out = ch('SIP/712020159-00000011', '2.2', '2.1', { calleridnum: '712020159', exten: '901234567' });
    const events = feed(store, [
      [0, { event: 'Newchannel', ...opCh }],
      [500, { event: 'Newchannel', ...out }],
      [500, { event: 'DialBegin', ...opCh, ...dest(out), dialstring: '712020159/901234567' }],
      [3_000, { event: 'DialState', ...opCh, ...dest(out), dialstatus: 'RINGING' }],
      [6_000, { event: 'DialEnd', ...opCh, ...dest(out), dialstatus: 'ANSWER' }],
      [6_000, { event: 'Newstate', ...opCh, channelstate: '6' }],
      [9_000, { event: 'DialState', ...opCh, ...dest(out), dialstatus: 'PROGRESS' }],
      [126_000, { event: 'HangupRequest', ...out }],
      [126_000, { event: 'Hangup', ...out, cause: '16' }],
      [126_001, { event: 'Hangup', ...opCh, cause: '16' }],
    ]);
    expect(names(events)).toEqual([CallEvents.Answered, CallEvents.Ended]);
    expect(ended(events)[0]).toMatchObject({
      talkSeconds: 120,
      hangupParty: 'client',
      direction: 'outbound',
      extension: '103',
    });
    expect(projectCounters(store)).toMatchObject({ outbound: 1, outboundAnswered: 1 });
  });

  it('presence: one precedence, registration never overrides a call (B28, B29)', () => {
    const store = new LiveStore(config, T0);
    store.applyPeers(
      [
        { event: 'PeerEntry', objectname: '101', status: 'OK (5 ms)', ipaddress: '192.168.0.17' },
        { event: 'PeerEntry', objectname: '103', status: 'UNREACHABLE', ipaddress: '192.168.0.100' },
        { event: 'PeerEntry', objectname: '106', status: 'OK (3 ms)', ipaddress: '192.168.0.106' },
        { event: 'PeerEntry', objectname: '712020159', status: 'OK (9 ms)', ipaddress: '10.0.0.1' },
      ],
      T0,
    );
    feed(store, [
      [
        0,
        {
          event: 'QueueMemberPause',
          queue: '2020159',
          interface: 'Local/106@from-queue/n',
          paused: '1',
          pausedreason: 'Tushlik',
        },
      ],
      [0, { event: 'Newchannel', ...trunk }],
      [10, { event: 'Newchannel', ...sip101 }],
      [10, { event: 'DialBegin', ...trunk, ...dest(sip101) }],
      [20, { event: 'Newstate', ...sip101, channelstate: '5' }],
      [30, { event: 'PeerStatus', peer: 'SIP/101', peerstatus: 'Registered', address: '192.168.0.17:5060' }],
    ]);
    const now = T0 + 100;
    expect(projectOperators(store, now).map((o) => [o.extension, o.presence])).toEqual([
      ['101', 'ringing'],
      ['103', 'offline'],
      ['106', 'paused'],
    ]);
    expect(op(store, '106', now)).toMatchObject({ pauseReason: 'Tushlik', ip: '192.168.0.106' });
    // excluded operators (settings) are left off the board; the store keeps tracking them
    expect(projectOperators(store, now, new Set(['101', '106'])).map((o) => o.extension)).toEqual(['103']);
    expect(store.operators.has('101')).toBe(true);
    feed(store, [[200, { event: 'DeviceStateChange', device: 'SIP/106', state: 'UNAVAILABLE' }]]);
    expect(op(store, '106', T0 + 300).presence).toBe('offline');
  });

  it('QueueStatus resync adds waiting callers we missed; their hangup ends the call', () => {
    const store = new LiveStore(config, T0);
    store.applyQueueStatus(
      [
        { event: 'QueueParams', queue: '2020159', strategy: 'fewestcalls', completed: '12', abandoned: '3' },
        {
          event: 'QueueMember',
          queue: '2020159',
          name: 'Operator 101',
          location: 'Local/101@from-queue/n',
          stateinterface: 'SIP/101',
          callstaken: '7',
          lastcall: '1794891000',
          status: '1',
          paused: '0',
        },
        {
          event: 'QueueEntry',
          queue: '2020159',
          position: '1',
          channel: 'SIP/712020159-0000000a',
          uniqueid: '9.1',
          calleridnum: '998977776655',
          wait: '42',
        },
      ],
      T0,
    );
    const q = projectQueues(store)[0];
    expect(q).toMatchObject({ name: '2020159', strategy: 'fewestcalls', completed: 12, abandoned: 3, members: 1 });
    expect(q.waiting).toEqual([
      { callId: '9.1', phone: '977776655', position: 1, joinedAt: new Date(T0 - 42_000).toISOString() },
    ]);
    expect(op(store, '101', T0).queue).toEqual({ callsTaken: 7, lastCallAt: new Date(1794891000_000).toISOString() });

    const events = feed(store, [
      [
        1_000,
        {
          event: 'QueueCallerAbandon',
          channel: 'SIP/712020159-0000000a',
          uniqueid: '9.1',
          linkedid: '9.1',
          queue: '2020159',
          holdtime: '43',
        },
      ],
      [1_000, { event: 'Hangup', channel: 'SIP/712020159-0000000a', uniqueid: '9.1', linkedid: '9.1', cause: '16' }],
    ]);
    expect(names(events)).toEqual([CallEvents.Abandoned, CallEvents.Ended]);
    // Discovered by resync: not counted in today's counters (they cover calls seen from the start).
    expect(projectCounters(store).abandoned).toBe(0);
    expect(store.calls.size).toBe(0);
    expect(projectQueues(store)[0].waiting).toEqual([]);
  });

  it('CoreShowChannels resync: adopts an ongoing conversation and ends channels Asterisk no longer has', () => {
    const store = new LiveStore(config, T0);
    store.resyncChannels(
      [
        { event: 'CoreShowChannel', ...trunk, channelstate: '6', duration: '00:02:00', bridgeid: 'b1' },
        { event: 'CoreShowChannel', ...sip101, channelstate: '6', duration: '00:01:30', bridgeid: 'b1' },
      ],
      T0,
    );
    expect(op(store, '101', T0)).toMatchObject({
      presence: 'talking',
      call: { phone: '901234567', since: new Date(T0 - 90_000).toISOString() },
    });
    store.drainEvents();
    store.resyncChannels([], T0 + 5_000);
    const events = store.drainEvents();
    expect(names(events)).toEqual([CallEvents.Ended]);
    expect(ended(events)[0]).toMatchObject({ answered: true, extension: '101', hangupParty: 'unknown' });
    expect(op(store, '101', T0 + 5_000).presence).toBe('idle');
  });

  it('staff Redirect is a transfer, staff Hangup is an operator-side hangup', () => {
    const run = (mark: (s: LiveStore) => void, tail: Array<[number, AmiEvent]>) => {
      const store = new LiveStore(config, T0);
      feed(store, [
        [0, { event: 'Newchannel', ...trunk }],
        [100, { event: 'Newchannel', ...sip101 }],
        [100, { event: 'DialBegin', ...trunk, ...dest(sip101) }],
        [2_000, { event: 'Newstate', ...sip101, channelstate: '6' }],
        [2_000, { event: 'DialEnd', ...trunk, ...dest(sip101), dialstatus: 'ANSWER' }],
        [2_000, { event: 'BridgeEnter', ...trunk, bridgeuniqueid: 'b1' }],
        [2_000, { event: 'BridgeEnter', ...sip101, bridgeuniqueid: 'b1' }],
      ]);
      mark(store);
      return feed(store, tail);
    };

    const sip106 = ch('SIP/106-00000003', '1.3', '1.1', { exten: '106' });
    const redirected = run(
      (s) => s.markRedirect(trunk.channel, T0 + 30_000),
      [
        [30_000, { event: 'BridgeLeave', ...trunk, bridgeuniqueid: 'b1' }],
        [30_000, { event: 'SoftHangupRequest', ...sip101 }],
        [30_000, { event: 'BridgeLeave', ...sip101, bridgeuniqueid: 'b1' }],
        [30_000, { event: 'Hangup', ...sip101, cause: '16' }],
        [30_100, { event: 'Newchannel', ...sip106 }],
        [30_100, { event: 'DialBegin', ...trunk, ...dest(sip106) }],
        [33_000, { event: 'DialEnd', ...trunk, ...dest(sip106), dialstatus: 'ANSWER' }],
        [33_000, { event: 'Newstate', ...sip106, channelstate: '6' }],
        [33_000, { event: 'BridgeEnter', ...trunk, bridgeuniqueid: 'b2' }],
        [33_000, { event: 'BridgeEnter', ...sip106, bridgeuniqueid: 'b2' }],
        [60_000, { event: 'HangupRequest', ...sip106 }],
        [60_000, { event: 'BridgeLeave', ...sip106, bridgeuniqueid: 'b2' }],
        [60_000, { event: 'Hangup', ...sip106, cause: '16' }],
        [60_000, { event: 'Hangup', ...trunk, cause: '16' }],
      ],
    );
    expect(redirected.filter((e) => e.name === CallEvents.Answered).map((e) => e.payload.extension)).toEqual(['106']);
    expect(ended(redirected)[0]).toMatchObject({ extension: '106', hangupParty: 'operator', answered: true });

    const hungUp = run(
      (s) => s.markStaffHangup(trunk.channel, T0 + 30_000),
      [
        [30_000, { event: 'SoftHangupRequest', ...trunk }],
        [30_000, { event: 'BridgeLeave', ...trunk, bridgeuniqueid: 'b1' }],
        [30_000, { event: 'Hangup', ...trunk, cause: '16' }],
        [30_000, { event: 'Hangup', ...sip101, cause: '16' }],
      ],
    );
    expect(ended(hungUp)[0]).toMatchObject({ hangupParty: 'operator', extension: '101' });
  });

  it('counters roll over at Tashkent midnight', () => {
    const store = new LiveStore(config, T0);
    feed(store, [[0, { event: 'Newchannel', ...trunk }]]);
    expect(projectCounters(store).inbound).toBe(1);
    const nextDay = Date.UTC(2026, 10, 17, 19, 0, 1); // 00:00:01 Tashkent on the 18th
    store.tick(nextDay);
    expect(projectCounters(store)).toMatchObject({ date: '2026-11-18', inbound: 0 });
  });

  it('ignores unknown events and events for unknown channels', () => {
    const store = new LiveStore(config, T0);
    expect(() =>
      feed(store, [
        [0, { event: 'VarSet', channel: 'SIP/101-1', variable: 'X', value: '1' }],
        [0, { event: 'Hangup', channel: 'SIP/999-1', uniqueid: '5.5', linkedid: '5.5' }],
        [0, { event: 'DialEnd', destuniqueid: '' }],
      ]),
    ).not.toThrow();
    expect(store.calls.size).toBe(0);
  });
});

describe('projection — operators see only their own numbers', () => {
  it('masks other operators’ calls and keeps own', () => {
    const { store } = play('queue-answered-client-hangup', {
      at: {
        60_000: (s, now) => {
          const ops = projectOperators(s, now);
          const calls = projectCalls(s, now);
          const queues = projectQueues(s);
          const own = { role: 'operator' as const, extension: '101' };
          const other = { role: 'operator' as const, extension: '103' };
          const admin = { role: 'executive' as const, extension: null };
          expect(operatorsFor(own, ops).find((o) => o.extension === '101')!.call!.phone).toBe('901234567');
          expect(operatorsFor(other, ops).find((o) => o.extension === '101')!.call!.phone).toBe('90 ••• •• 67');
          expect(callsFor(other, calls)[0].phone).toBe('90 ••• •• 67');
          expect(callsFor(own, calls)[0].phone).toBe('901234567');
          expect(callsFor(admin, calls)[0].phone).toBe('901234567');
          expect(queuesFor(other, queues)).toEqual(queues.map((q) => ({ ...q, waiting: [] })));
        },
      },
    });
    expect(store.calls.size).toBe(0);
  });
});
