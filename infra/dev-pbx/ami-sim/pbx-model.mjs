// Simulated Issabel/Asterisk 13 PBX for development: operators (SIP peers), queues with Local/<ext>@from-queue/n
// members, call scenarios and the AMI actions the API uses. Emits events with Asterisk 13 field names
// (see docs/rewrite/legacy/telephony.md §3). No dependencies; used by ami-sim.mjs (TCP) and record.mjs (fixtures).

export const TRUNK = '712020159';
export const DID = '712020159';

const PRIVILEGE = {
  PeerStatus: 'system,all',
  DeviceStateChange: 'call,all',
  QueueMemberStatus: 'agent,all',
  QueueMemberPause: 'agent,all',
  AgentCalled: 'agent,all',
  AgentConnect: 'agent,all',
  AgentComplete: 'agent,all',
  AgentRingNoAnswer: 'agent,all',
};

const STATE_DESC = { 0: 'Down', 4: 'Ring', 5: 'Ringing', 6: 'Up' };
const MOBILE_CODES = ['90', '91', '93', '94', '95', '97', '98', '99', '33', '88', '50', '77'];

/** Deterministic PRNG (mulberry32) so recordings are reproducible. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Real-time clock (ami-sim) — `speed` > 1 makes everything faster. */
export function realClock(speed = 1) {
  return { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms / speed))) };
}

/** Virtual clock (record.mjs): sleeping just advances time. */
export function virtualClock(start) {
  let t = start;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

const DEFAULT_OPERATORS = [
  ['101', 'Operator 101', '192.168.0.17', true],
  ['103', 'Operator 103', '192.168.0.100', true],
  ['106', 'Operator 106', '192.168.0.106', true],
  ['111', 'Operator 111', '192.168.0.19', true],
  ['114', 'Operator 114', '192.168.0.114', true],
  ['119', 'Operator 119', '192.168.0.15', true],
  ['120', 'Operator 120', '192.168.0.18', false],
  ['200', 'Operator 200', '192.168.1.20', true],
  ['201', 'Operator 201', '192.168.1.21', false],
];

export class SimPbx {
  /**
   * @param {{ clock: {now(): number, sleep(ms: number): Promise<void>}, random?: () => number, onEvent: (e: Record<string,string>) => void,
   *           operators?: Array<[string,string,string,boolean]> }} opts
   */
  constructor(opts) {
    this.clock = opts.clock;
    this.random = opts.random ?? Math.random;
    this.onEvent = opts.onEvent;
    this.seq = 0;
    this.chanSeq = 0x20;
    this.bridgeSeq = 0;
    this.channels = new Map(); // name -> channel
    this.calls = new Set();
    this.astdb = new Map();
    this.peers = new Map();
    for (const [ext, name, ip, registered] of opts.operators ?? DEFAULT_OPERATORS) {
      this.peers.set(ext, { ext, name, ip, registered, busy: false, paused: false, pausedReason: '', callsTaken: 0, lastCall: 0 });
    }
    this.peers.get('119') && Object.assign(this.peers.get('119'), { paused: true, pausedReason: 'Tanaffus' });
    this.queues = new Map([
      ['2020159', { name: '2020159', strategy: 'fewestcalls', members: ['101', '103', '106', '111', '114', '119', '120'], waiting: [], completed: 0, abandoned: 0 }],
      ['2020142', { name: '2020142', strategy: 'ringall', members: ['200', '201'], waiting: [], completed: 0, abandoned: 0 }],
    ]);
  }

  // ------------------------------------------------------------------------------------------
  // helpers

  rand(min, max) {
    return Math.round(min + this.random() * (max - min));
  }
  pick(list) {
    return list[Math.floor(this.random() * list.length)];
  }
  /** Random Uzbek mobile number as a trunk would send it (9 digits or with 998). */
  randomPhone() {
    const n = this.pick(MOBILE_CODES) + String(this.rand(0, 9_999_999)).padStart(7, '0');
    return this.random() < 0.4 ? `998${n}` : n;
  }

  emit(event, fields) {
    this.onEvent({ Event: event, Privilege: PRIVILEGE[event] ?? 'call,all', ...fields });
  }

  newCall() {
    const call = { id: null, channels: [], bridges: new Set(), ended: false, gen: 0, queue: null, member: null, connected: false, agentDone: false, waitStart: 0 };
    this.calls.add(call);
    return call;
  }

  newChannel(call, base, o) {
    const hex = (this.chanSeq++).toString(16).padStart(8, '0');
    return this.addChannel(call, `${base}-${hex}`, o);
  }

  newLocalPair(call, ext, o) {
    const hex = (this.chanSeq++).toString(16).padStart(8, '0');
    const l1 = this.addChannel(call, `Local/${ext}@from-queue-${hex};1`, { ...o, context: 'from-queue', exten: ext });
    const l2 = this.addChannel(call, `Local/${ext}@from-queue-${hex};2`, { ...o, context: 'from-queue', exten: ext });
    l1.pair = l2;
    l2.pair = l1;
    return [l1, l2];
  }

  addChannel(call, name, o) {
    const uniqueid = `${Math.floor(this.clock.now() / 1000)}.${++this.seq}`;
    call.id ??= uniqueid;
    const ch = {
      name,
      uniqueid,
      linkedid: call.id,
      state: o.state ?? 0,
      callerNum: o.callerNum ?? '',
      callerName: o.callerName ?? '',
      connectedNum: o.connectedNum ?? '',
      connectedName: '',
      context: o.context ?? 'from-internal',
      exten: o.exten ?? '',
      app: o.app ?? '',
      bridge: null,
      createdAt: this.clock.now(),
      call,
      ext: o.ext ?? null,
    };
    this.channels.set(name, ch);
    call.channels.push(ch);
    this.emit('Newchannel', this.fields(ch));
    return ch;
  }

  fields(ch, prefix = '') {
    const f = {
      Channel: ch.name,
      ChannelState: String(ch.state),
      ChannelStateDesc: STATE_DESC[ch.state] ?? 'Unknown',
      CallerIDNum: ch.callerNum || '<unknown>',
      CallerIDName: ch.callerName || '<unknown>',
      ConnectedLineNum: ch.connectedNum || '<unknown>',
      ConnectedLineName: ch.connectedName || '<unknown>',
      Language: 'en',
      AccountCode: '',
      Context: ch.context,
      Exten: ch.exten,
      Priority: '1',
      Uniqueid: ch.uniqueid,
      Linkedid: ch.linkedid,
    };
    if (!prefix) return f;
    return Object.fromEntries(Object.entries(f).map(([k, v]) => [`${prefix}${k}`, v]));
  }

  setState(ch, state) {
    if (ch.state === state) return;
    ch.state = state;
    this.emit('Newstate', this.fields(ch));
  }

  deviceState(ext, state) {
    const peer = this.peers.get(ext);
    if (!peer) return;
    this.emit('DeviceStateChange', { Device: `SIP/${ext}`, State: state });
    const status = { NOT_INUSE: '1', INUSE: '2', RINGING: '6', UNAVAILABLE: '5' }[state] ?? '0';
    for (const q of this.queues.values()) {
      if (!q.members.includes(ext)) continue;
      this.emit('QueueMemberStatus', this.memberFields(q, peer, { Status: status }));
    }
  }

  memberFields(q, peer, extra = {}) {
    return {
      Queue: q.name,
      MemberName: peer.name,
      Interface: `Local/${peer.ext}@from-queue/n`,
      StateInterface: `SIP/${peer.ext}`,
      Membership: 'static',
      Penalty: '0',
      CallsTaken: String(peer.callsTaken),
      LastCall: String(peer.lastCall),
      InCall: peer.busy ? '1' : '0',
      Status: !peer.registered ? '5' : peer.busy ? '2' : '1',
      Paused: peer.paused ? '1' : '0',
      PausedReason: peer.pausedReason,
      Ringinuse: '0',
      ...extra,
    };
  }

  bridge(call, members) {
    const id = `${(++this.bridgeSeq).toString(16).padStart(8, '0')}-sim0-4b1d-9c3a-${String(this.bridgeSeq).padStart(12, '0')}`;
    call.bridges.add(id);
    this.emit('BridgeCreate', { BridgeUniqueid: id, BridgeType: 'basic', BridgeTechnology: 'simple_bridge', BridgeCreator: '<unknown>', BridgeName: '<unknown>', BridgeNumChannels: '0' });
    let n = 0;
    for (const ch of members) {
      ch.bridge = id;
      this.emit('BridgeEnter', { BridgeUniqueid: id, BridgeType: 'basic', BridgeTechnology: 'simple_bridge', BridgeNumChannels: String(++n), ...this.fields(ch) });
    }
    return id;
  }

  leaveBridge(ch) {
    if (!ch.bridge) return;
    const id = ch.bridge;
    ch.bridge = null;
    const left = ch.call.channels.filter((c) => c.bridge === id).length;
    this.emit('BridgeLeave', { BridgeUniqueid: id, BridgeType: 'basic', BridgeTechnology: 'simple_bridge', BridgeNumChannels: String(left), ...this.fields(ch) });
    if (left === 0) {
      ch.call.bridges.delete(id);
      this.emit('BridgeDestroy', { BridgeUniqueid: id, BridgeType: 'basic', BridgeTechnology: 'simple_bridge', BridgeNumChannels: '0' });
    }
  }

  hangupChannel(ch, cause = 16, causeTxt = 'Normal Clearing') {
    if (!this.channels.has(ch.name)) return;
    this.leaveBridge(ch);
    this.channels.delete(ch.name);
    ch.call.channels = ch.call.channels.filter((c) => c !== ch);
    this.emit('Hangup', { ...this.fields(ch), Cause: String(cause), 'Cause-txt': causeTxt });
    if (ch.ext && ch.name.startsWith('SIP/')) {
      const peer = this.peers.get(ch.ext);
      if (peer && !ch.call.channels.some((c) => c.ext === ch.ext && c.name.startsWith('SIP/'))) {
        peer.busy = false;
        this.deviceState(ch.ext, peer.registered ? 'NOT_INUSE' : 'UNAVAILABLE');
      }
    }
    if (ch.call.channels.length === 0) {
      ch.call.ended = true;
      this.calls.delete(ch.call);
    }
  }

  /**
   * Tear the call down the way Asterisk does: the first channel leaves its bridge and hangs up,
   * the rest are hung up by the core. `how`: 'remote' (that device sent BYE -> HangupRequest),
   * 'soft' (AMI Hangup -> SoftHangupRequest), 'system' (dialplan Hangup()).
   */
  teardown(call, first, how, cause = 16) {
    if (call.ended) return;
    call.gen++;
    if (how === 'remote') this.emit('HangupRequest', { ...this.fields(first), Cause: String(cause) });
    if (how === 'soft') this.emit('SoftHangupRequest', { ...this.fields(first), Cause: String(cause) });

    const party = call.channels.find((c) => c.party);
    if (call.queue && call.waiting && first === party) this.abandonQueue(call);

    // Phones still ringing for this call stop ringing.
    for (const ch of call.channels) {
      if (ch === first || ch.state === 6 || !ch.ext || !ch.name.startsWith('SIP/')) continue;
      const caller = call.channels.find((c) => c.name.endsWith(';2') && c.ext === ch.ext) ?? party ?? first;
      this.emit('DialEnd', { ...this.fields(caller), ...this.fields(ch, 'Dest'), DialStatus: 'CANCEL' });
    }
    this.leaveBridge(first);
    if (call.connected && !call.agentDone) {
      call.agentDone = true;
      const reason = first.ext && first.name.startsWith('SIP/') ? 'agent' : 'caller';
      this.emit('AgentComplete', this.agentFields(call, call.member, { HoldTime: String(call.holdTime), TalkTime: String(Math.round((this.clock.now() - call.connectedAt) / 1000)), Reason: reason }));
    }
    this.hangupChannel(first, cause);
    for (const ch of [...call.channels].reverse()) {
      if (ch.name.startsWith('SIP/')) this.emit('SoftHangupRequest', { ...this.fields(ch), Cause: '16' });
      this.hangupChannel(ch, 16);
    }
  }

  agentFields(call, member, extra) {
    const party = call.channels.find((c) => c.party) ?? call.partyRef;
    const l1 = call.memberLocal;
    const peer = this.peers.get(member);
    return {
      ...this.fields(party),
      ...(l1 ? this.fields(l1, 'Dest') : {}),
      Queue: call.queue.name,
      Interface: `Local/${member}@from-queue/n`,
      MemberName: peer?.name ?? member,
      ...extra,
    };
  }

  abandonQueue(call) {
    const q = call.queue;
    const party = call.channels.find((c) => c.party);
    const pos = q.waiting.indexOf(call) + 1;
    q.waiting = q.waiting.filter((c) => c !== call);
    q.abandoned++;
    call.waiting = false;
    const hold = Math.round((this.clock.now() - call.waitStart) / 1000);
    this.emit('QueueCallerAbandon', { ...this.fields(party), Queue: q.name, Position: String(pos), OriginalPosition: String(call.origPos), HoldTime: String(hold) });
    this.emit('QueueCallerLeave', { ...this.fields(party), Queue: q.name, Position: String(pos), Count: String(q.waiting.length) });
  }

  leaveQueue(call) {
    const q = call.queue;
    const party = call.channels.find((c) => c.party);
    const pos = q.waiting.indexOf(call) + 1;
    q.waiting = q.waiting.filter((c) => c !== call);
    call.waiting = false;
    this.emit('QueueCallerLeave', { ...this.fields(party), Queue: q.name, Position: String(pos), Count: String(q.waiting.length) });
  }

  /** Sleep inside a call; returns false if the call ended or was taken over (transfer) meanwhile. */
  async wait(call, ms) {
    const gen = call.gen;
    await this.clock.sleep(ms);
    return !call.ended && call.gen === gen;
  }

  freeMember(q, exclude) {
    const free = q.members
      .map((e) => this.peers.get(e))
      .filter((p) => p && p.registered && !p.paused && !p.busy && !exclude.has(p.ext));
    if (!free.length) return null;
    if (q.strategy === 'fewestcalls') return free.sort((a, b) => a.callsTaken - b.callsTaken || a.lastCall - b.lastCall)[0];
    return this.pick(free);
  }

  // ------------------------------------------------------------------------------------------
  // Scenarios

  /**
   * Inbound call from the trunk through the IVR into a queue.
   * o: { phone?, hidden?, queue?, patienceSec?, maxWaitSec?, talkSec?, hangupBy?: 'client'|'operator',
   *      memberOutcomes?: Array<'noanswer'|'reject'|'answer'>, transferTo?, ivrSec? }
   */
  async inboundQueueCall(o = {}) {
    const call = this.newCall();
    const raw = o.hidden ? '' : (o.phone ?? this.randomPhone());
    const trunk = this.newChannel(call, `SIP/${TRUNK}`, { state: 4, callerNum: raw, callerName: o.hidden ? '' : raw, exten: DID, context: 'from-trunk' });
    trunk.party = true;
    call.partyRef = trunk;
    if (!(await this.wait(call, 300))) return;
    this.setState(trunk, 6);
    trunk.context = 'ivr-4';
    if (!(await this.wait(call, o.ivrSec ?? this.rand(2_000, 5_000)))) return;

    const q = this.queues.get(o.queue ?? '2020159');
    call.queue = q;
    call.waiting = true;
    call.waitStart = this.clock.now();
    q.waiting.push(call);
    call.origPos = q.waiting.length;
    trunk.context = 'ext-queues';
    trunk.exten = q.name;
    this.emit('QueueCallerJoin', { ...this.fields(trunk), Queue: q.name, Position: String(q.waiting.length), Count: String(q.waiting.length) });

    const patience = (o.patienceSec ?? 600) * 1000;
    const maxWait = (o.maxWaitSec ?? 300) * 1000;
    const outcomes = [...(o.memberOutcomes ?? [])];
    const tried = new Set();

    for (;;) {
      if (call.ended) return;
      const waited = this.clock.now() - call.waitStart;
      if (waited >= patience) return this.teardown(call, trunk, 'remote');
      if (waited >= maxWait) {
        // Queue timeout -> dialplan continues (voicemail prompt), then the caller hangs up.
        this.leaveQueue(call);
        if (!(await this.wait(call, 4_000))) return;
        return this.teardown(call, trunk, 'remote');
      }
      // Only the head of the queue is offered to members.
      const member = q.waiting[0] === call ? this.freeMember(q, tried) : null;
      if (!member) {
        if (tried.size && tried.size >= q.members.length) tried.clear();
        if (!(await this.wait(call, 1_000))) return;
        continue;
      }
      const outcome = outcomes.shift() ?? 'answer';
      const result = await this.ringMember(call, q, member, outcome, patience - waited);
      if (result === 'gone') return;
      if (result === 'connected') break;
      tried.add(member.ext);
      if (!(await this.wait(call, 2_000))) return;
    }

    // Talking.
    if (!(await this.wait(call, (o.talkSec ?? this.rand(20, 240)) * 1000))) return;
    if (o.transferTo) return this.blindTransfer(call, o.transferTo, o);
    const sip = call.channels.find((c) => c.name.startsWith(`SIP/${call.member}-`));
    if ((o.hangupBy ?? (this.random() < 0.6 ? 'client' : 'operator')) === 'operator' && sip) this.teardown(call, sip, 'remote');
    else this.teardown(call, trunk, 'remote');
  }

  /** Offer the queue call to one member. Returns 'connected' | 'next' | 'gone'. */
  async ringMember(call, q, peer, outcome, patienceLeftMs) {
    const RING_TIMEOUT = 15_000;
    const trunk = call.channels.find((c) => c.party);
    const phone = trunk.callerNum;
    peer.busy = true;
    const [l1, l2] = this.newLocalPair(call, peer.ext, { callerNum: phone, callerName: trunk.callerName, connectedNum: DID, ext: peer.ext });
    call.memberLocal = l1;
    this.emit('AgentCalled', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), Queue: q.name, Interface: `Local/${peer.ext}@from-queue/n`, MemberName: peer.name });
    this.emit('DialBegin', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), DialString: `Local/${peer.ext}@from-queue/n` });
    const sip = this.newChannel(call, `SIP/${peer.ext}`, { state: 0, callerNum: phone, callerName: trunk.callerName, connectedNum: phone, exten: peer.ext, context: 'from-internal', ext: peer.ext });
    this.emit('DialBegin', { ...this.fields(l2), ...this.fields(sip, 'Dest'), DialString: peer.ext });
    this.setState(sip, 5);
    this.setState(l1, 5);
    this.deviceState(peer.ext, 'RINGING');
    const ringStart = this.clock.now();

    const cleanupMember = (status, cause) => {
      this.emit('DialEnd', { ...this.fields(l2), ...this.fields(sip, 'Dest'), DialStatus: status });
      this.hangupChannel(sip, cause, cause === 17 ? 'User busy' : 'Normal Clearing');
      this.emit('DialEnd', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), DialStatus: status === 'BUSY' ? 'BUSY' : 'CANCEL' });
      this.hangupChannel(l2);
      this.hangupChannel(l1);
      peer.busy = false;
    };

    // The caller gives up while the phone is still ringing.
    const giveUp = async () => {
      if (!(await this.wait(call, patienceLeftMs))) return 'gone';
      this.teardown(call, trunk, 'remote');
      return 'gone';
    };

    if (outcome === 'noanswer') {
      if (patienceLeftMs < RING_TIMEOUT) return giveUp();
      const ok = await this.wait(call, RING_TIMEOUT);
      if (!ok) return 'gone';
      this.emit('AgentRingNoAnswer', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), Queue: q.name, Interface: `Local/${peer.ext}@from-queue/n`, MemberName: peer.name, RingTime: String(this.clock.now() - ringStart) });
      cleanupMember('CANCEL', 16);
      return 'next';
    }
    if (outcome === 'reject') {
      const rejectAfter = this.rand(2_000, 4_000);
      if (patienceLeftMs < rejectAfter) return giveUp();
      const ok = await this.wait(call, rejectAfter);
      if (!ok) return 'gone';
      this.emit('DialEnd', { ...this.fields(l2), ...this.fields(sip, 'Dest'), DialStatus: 'BUSY' });
      this.hangupChannel(sip, 17, 'User busy');
      this.emit('AgentRingNoAnswer', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), Queue: q.name, Interface: `Local/${peer.ext}@from-queue/n`, MemberName: peer.name, RingTime: String(this.clock.now() - ringStart) });
      this.emit('DialEnd', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), DialStatus: 'BUSY' });
      this.hangupChannel(l2);
      this.hangupChannel(l1);
      peer.busy = false;
      return 'next';
    }

    const answerAfter = this.rand(2_000, 6_000);
    if (patienceLeftMs < answerAfter) return giveUp();
    const ok = await this.wait(call, answerAfter);
    if (!ok) return 'gone';
    // Operator picks up.
    this.setState(sip, 6);
    this.emit('DialEnd', { ...this.fields(l2), ...this.fields(sip, 'Dest'), DialStatus: 'ANSWER' });
    this.setState(l2, 6);
    this.setState(l1, 6);
    this.emit('DialEnd', { ...this.fields(trunk), ...this.fields(l1, 'Dest'), DialStatus: 'ANSWER' });
    this.deviceState(peer.ext, 'INUSE');
    this.bridge(call, [l2, sip]);
    this.bridge(call, [trunk, l1]);
    const hold = Math.round((this.clock.now() - call.waitStart) / 1000);
    this.leaveQueue(call);
    call.member = peer.ext;
    call.connected = true;
    call.connectedAt = this.clock.now();
    call.holdTime = hold;
    peer.callsTaken++;
    peer.lastCall = Math.floor(this.clock.now() / 1000);
    q.completed++;
    this.emit('AgentConnect', this.agentFields(call, peer.ext, { HoldTime: String(hold), RingTime: String(Math.round((this.clock.now() - ringStart) / 1000)) }));
    return 'connected';
  }

  /** The operator blind-transfers (feature code) to another extension; the Local;2 leg dials it. */
  async blindTransfer(call, target, o = {}) {
    const sip = call.channels.find((c) => c.name.startsWith(`SIP/${call.member}-`));
    const l2 = call.channels.find((c) => c.name.endsWith(';2'));
    if (!sip || !l2) return;
    const bridgeId = sip.bridge;
    this.emit('BlindTransfer', {
      Result: 'Success',
      ...this.fields(sip, 'Transferer'),
      ...this.fields(l2, 'Transferee'),
      IsExternal: 'No',
      Context: 'from-internal-xfer',
      Extension: target,
      BridgeUniqueid: bridgeId ?? '',
      BridgeType: 'basic',
    });
    this.leaveBridge(sip);
    call.agentDone = true;
    this.emit('AgentComplete', this.agentFields(call, call.member, { HoldTime: String(call.holdTime), TalkTime: String(Math.round((this.clock.now() - call.connectedAt) / 1000)), Reason: 'transfer' }));
    this.hangupChannel(sip);
    await this.dialExtension(call, l2, target, o);
  }

  /** `from` (in the call) dials extension `target` directly; on answer they are bridged. */
  async dialExtension(call, from, target, o = {}) {
    const peer = this.peers.get(target);
    const party = call.channels.find((c) => c.party) ?? from;
    if (from.bridge) this.leaveBridge(from);
    const sip = this.newChannel(call, `SIP/${target}`, { state: 0, callerNum: party.callerNum, connectedNum: party.callerNum, exten: target, context: 'from-internal', ext: target });
    this.emit('DialBegin', { ...this.fields(from), ...this.fields(sip, 'Dest'), DialString: target });
    if (!peer || !peer.registered || peer.busy) {
      this.emit('DialEnd', { ...this.fields(from), ...this.fields(sip, 'Dest'), DialStatus: 'CHANUNAVAIL' });
      this.hangupChannel(sip, 20, 'Subscriber absent');
      if (!(await this.wait(call, 1_000))) return;
      return this.teardown(call, party, 'system');
    }
    peer.busy = true;
    this.setState(sip, 5);
    this.deviceState(target, 'RINGING');
    if (!(await this.wait(call, this.rand(2_000, 5_000)))) return;
    this.setState(sip, 6);
    this.emit('DialEnd', { ...this.fields(from), ...this.fields(sip, 'Dest'), DialStatus: 'ANSWER' });
    this.deviceState(target, 'INUSE');
    this.bridge(call, [from, sip]);
    call.member = target;
    if (!(await this.wait(call, (o.afterTransferTalkSec ?? this.rand(20, 120)) * 1000))) return;
    if ((o.hangupBy ?? 'client') === 'operator') this.teardown(call, sip, 'remote');
    else this.teardown(call, party, 'remote');
  }

  /** Inbound call that never reaches a queue: IVR self-service or after-hours announcement. */
  async inboundIvrOnly(o = {}) {
    const call = this.newCall();
    const raw = o.hidden ? '' : (o.phone ?? this.randomPhone());
    const trunk = this.newChannel(call, `SIP/${TRUNK}`, { state: 4, callerNum: raw, callerName: raw, exten: DID, context: 'from-trunk' });
    trunk.party = true;
    if (!(await this.wait(call, 300))) return;
    this.setState(trunk, 6);
    trunk.context = o.afterHours ? 'app-announcement-working-time' : 'ivr-4';
    if (!(await this.wait(call, (o.durationSec ?? this.rand(5, 25)) * 1000))) return;
    if (o.afterHours) this.teardown(call, trunk, 'system');
    else this.teardown(call, trunk, 'remote');
  }

  /**
   * Operator calls out. o: { ext, phone?, originate?, answer?, failStatus?, talkSec?, hangupBy?, actionId? }
   * Returns false if the operator cannot be used (busy/offline).
   */
  async outbound(o) {
    const peer = this.peers.get(o.ext);
    if (!peer || !peer.registered || peer.busy) {
      if (o.originate) this.emit('OriginateResponse', { ActionID: o.actionId ?? '', Response: 'Failure', Channel: `SIP/${o.ext}`, Context: 'from-internal', Exten: o.phone ?? '', Reason: '0', Uniqueid: '<null>', CallerIDNum: '<unknown>', CallerIDName: '<unknown>' });
      return false;
    }
    peer.busy = true;
    const phone = o.phone ?? this.randomPhone().replace(/^998/, '');
    const call = this.newCall();
    let sip;
    if (o.originate) {
      sip = this.newChannel(call, `SIP/${o.ext}`, { state: 0, callerNum: phone, connectedNum: phone, context: 'from-internal', exten: '', ext: o.ext });
      this.emit('DialBegin', { ...this.fields(sip, 'Dest'), DialString: o.ext });
      this.setState(sip, 5);
      this.deviceState(o.ext, 'RINGING');
      if (!(await this.wait(call, this.rand(2_000, 4_000)))) return true;
      if (o.operatorAnswers === false) {
        this.emit('DialEnd', { ...this.fields(sip, 'Dest'), DialStatus: 'NOANSWER' });
        this.hangupChannel(sip, 19, 'No answer');
        this.emit('OriginateResponse', { ActionID: o.actionId ?? '', Response: 'Failure', Channel: `SIP/${o.ext}`, Context: 'from-internal', Exten: phone, Reason: '3', Uniqueid: '<null>', CallerIDNum: '<unknown>', CallerIDName: '<unknown>' });
        return true;
      }
      this.setState(sip, 6);
      this.emit('DialEnd', { ...this.fields(sip, 'Dest'), DialStatus: 'ANSWER' });
      this.emit('OriginateResponse', { ActionID: o.actionId ?? '', Response: 'Success', Channel: sip.name, Context: 'from-internal', Exten: phone, Reason: '4', Uniqueid: sip.uniqueid, CallerIDNum: phone, CallerIDName: '<unknown>' });
      sip.exten = phone;
      this.deviceState(o.ext, 'INUSE');
    } else {
      sip = this.newChannel(call, `SIP/${o.ext}`, { state: 4, callerNum: o.ext, callerName: peer.name, exten: phone, context: 'from-internal', ext: o.ext });
      this.deviceState(o.ext, 'INUSE');
      if (!(await this.wait(call, 800))) return true;
    }
    const trunk = this.newChannel(call, `SIP/${TRUNK}`, { state: 0, callerNum: DID, connectedNum: o.ext, exten: phone, context: 'from-trunk' });
    trunk.party = true;
    this.emit('DialBegin', { ...this.fields(sip), ...this.fields(trunk, 'Dest'), DialString: `${TRUNK}/${phone}` });
    this.setState(trunk, 5);
    if (!(await this.wait(call, this.rand(4_000, 10_000)))) return true;

    if (o.answer === false) {
      const status = o.failStatus ?? this.pick(['BUSY', 'NOANSWER', 'CHANUNAVAIL']);
      const cause = { BUSY: 17, NOANSWER: 19, CHANUNAVAIL: 20, CONGESTION: 34, CANCEL: 16 }[status] ?? 16;
      if (status === 'CANCEL') {
        // The operator gave up before the callee answered.
        this.emit('HangupRequest', { ...this.fields(sip), Cause: '16' });
        this.emit('DialEnd', { ...this.fields(sip), ...this.fields(trunk, 'Dest'), DialStatus: 'CANCEL' });
        this.hangupChannel(trunk, 16);
        this.hangupChannel(sip, 16);
        return true;
      }
      this.emit('DialEnd', { ...this.fields(sip), ...this.fields(trunk, 'Dest'), DialStatus: status });
      this.hangupChannel(trunk, cause, status);
      if (!(await this.wait(call, 1_500))) return true;
      this.teardown(call, sip, 'system');
      return true;
    }

    this.setState(trunk, 6);
    this.setState(sip, 6);
    this.emit('DialEnd', { ...this.fields(sip), ...this.fields(trunk, 'Dest'), DialStatus: 'ANSWER' });
    this.bridge(call, [sip, trunk]);
    if (!(await this.wait(call, (o.talkSec ?? this.rand(15, 180)) * 1000))) return true;
    if ((o.hangupBy ?? (this.random() < 0.5 ? 'client' : 'operator')) === 'operator') this.teardown(call, sip, 'remote');
    else this.teardown(call, trunk, 'remote');
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // AMI actions (return { response: fields, events?: [...] })

  actionHangup(channelName) {
    const ch = this.channels.get(channelName);
    if (!ch) return { error: 'No such channel' };
    this.teardown(ch.call, ch, 'soft');
    return { message: 'Channel Hungup' };
  }

  actionRedirect(channelName, exten, context) {
    const ch = this.channels.get(channelName);
    if (!ch) return { error: 'Channel does not exist: ' + channelName };
    if (!/^[0-9]{2,4}$/.test(exten)) return { error: 'Extension does not exist.' };
    const call = ch.call;
    call.gen++; // the running scenario stops; the redirected leg continues in the dialplan
    if (call.connected && !call.agentDone) {
      call.agentDone = true;
      this.emit('AgentComplete', this.agentFields(call, call.member, { HoldTime: String(call.holdTime), TalkTime: String(Math.round((this.clock.now() - call.connectedAt) / 1000)), Reason: 'transfer' }));
    }
    this.leaveBridge(ch);
    if (call.waiting) this.leaveQueue(call);
    // Everything else of the call (local legs, the operator) is hung up by the core.
    for (const other of [...call.channels].reverse()) {
      if (other === ch) continue;
      if (other.name.startsWith('SIP/')) this.emit('SoftHangupRequest', { ...this.fields(other), Cause: '16' });
      this.hangupChannel(other);
    }
    ch.context = context;
    ch.exten = exten;
    void this.dialExtension(call, ch, exten, {});
    return { message: 'Redirect successful' };
  }

  actionOriginate(fields) {
    const m = /^(?:SIP|PJSIP)\/(\d{2,4})$/.exec(fields.channel ?? '');
    if (!m) return { error: 'Originate failed: invalid channel' };
    void this.outbound({ ext: m[1], phone: fields.exten, originate: true, answer: this.random() < 0.8, actionId: fields.actionid });
    return { message: 'Originate successfully queued' };
  }

  actionQueuePause(fields) {
    const m = /^Local\/(\d{2,4})@from-queue\/n$/.exec(fields.interface ?? '');
    const peer = m ? this.peers.get(m[1]) : null;
    if (!peer) return { error: 'Interface not found' };
    const paused = /^(1|true|yes)$/i.test(fields.paused ?? '');
    peer.paused = paused;
    peer.pausedReason = paused ? (fields.reason ?? '') : '';
    for (const q of this.queues.values()) {
      if (fields.queue && q.name !== fields.queue) continue;
      if (!q.members.includes(peer.ext)) continue;
      this.emit('QueueMemberPause', this.memberFields(q, peer, { Reason: peer.pausedReason }));
    }
    return { message: paused ? 'Interface paused successfully' : 'Interface unpaused successfully' };
  }

  setRegistered(ext, registered) {
    const peer = this.peers.get(ext);
    if (!peer || peer.registered === registered || peer.busy) return;
    peer.registered = registered;
    this.emit('PeerStatus', { ChannelType: 'SIP', Peer: `SIP/${ext}`, PeerStatus: registered ? 'Registered' : 'Unregistered', Address: registered ? `${peer.ip}:5060` : '' });
    this.deviceState(ext, registered ? 'NOT_INUSE' : 'UNAVAILABLE');
  }

  listCoreShowChannels() {
    return [...this.channels.values()].map((ch) => {
      const sec = Math.max(0, Math.round((this.clock.now() - ch.createdAt) / 1000));
      const hms = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
      return {
        Event: 'CoreShowChannel',
        ...this.fields(ch),
        Application: ch.bridge ? 'Dial' : 'AppQueue',
        ApplicationData: '',
        Duration: hms,
        BridgeId: ch.bridge ?? '',
      };
    });
  }

  listQueueStatus(queueName) {
    const out = [];
    for (const q of this.queues.values()) {
      if (queueName && q.name !== queueName) continue;
      out.push({ Event: 'QueueParams', Queue: q.name, Max: '0', Strategy: q.strategy, Calls: String(q.waiting.length), Holdtime: '12', TalkTime: '95', Completed: String(q.completed), Abandoned: String(q.abandoned), ServiceLevel: '60', ServicelevelPerf: '0.0', Weight: '0' });
      for (const ext of q.members) {
        const peer = this.peers.get(ext);
        if (!peer) continue;
        const f = this.memberFields(q, peer);
        out.push({ Event: 'QueueMember', Queue: q.name, Name: f.MemberName, Location: f.Interface, StateInterface: f.StateInterface, Membership: f.Membership, Penalty: f.Penalty, CallsTaken: f.CallsTaken, LastCall: f.LastCall, InCall: f.InCall, Status: f.Status, Paused: f.Paused, PausedReason: f.PausedReason });
      }
      q.waiting.forEach((call, i) => {
        const party = call.channels.find((c) => c.party);
        if (!party) return;
        out.push({ Event: 'QueueEntry', Queue: q.name, Position: String(i + 1), Channel: party.name, Uniqueid: party.uniqueid, CallerIDNum: party.callerNum || '<unknown>', CallerIDName: party.callerName || '<unknown>', ConnectedLineNum: '<unknown>', ConnectedLineName: '<unknown>', Wait: String(Math.round((this.clock.now() - call.waitStart) / 1000)), Priority: '0' });
      });
    }
    return out;
  }

  listPeers() {
    const out = [...this.peers.values()].map((p) => ({
      Event: 'PeerEntry',
      Channeltype: 'SIP',
      ObjectName: p.ext,
      ChanObjectType: 'peer',
      IPaddress: p.registered ? p.ip : '-none-',
      IPport: p.registered ? '5060' : '0',
      Dynamic: 'yes',
      AutoForcerport: 'no',
      Forcerport: 'no',
      AutoComedia: 'no',
      Comedia: 'no',
      VideoSupport: 'no',
      TextSupport: 'no',
      ACL: 'yes',
      Status: p.registered ? `OK (${this.rand(2, 30)} ms)` : 'UNKNOWN',
      RealtimeDevice: 'no',
      Description: '',
      Accountcode: '',
    }));
    out.push({ Event: 'PeerEntry', Channeltype: 'SIP', ObjectName: TRUNK, ChanObjectType: 'peer', IPaddress: '10.0.0.1', IPport: '5060', Dynamic: 'no', Status: 'OK (12 ms)' });
    return out;
  }
}
