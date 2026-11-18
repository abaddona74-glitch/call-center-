import type { OperatorPresence, OperatorToday } from '@cc/shared';
import { DateTime } from 'luxon';
import {
  type CallAbandonedEvent,
  type CallAnsweredEvent,
  type CallDirection,
  type CallEndedEvent,
  CallEvents,
  type CallOperatorMissedEvent,
  type CallQueueJoinedEvent,
  type HangupParty,
} from '../../../common/events/domain-events.js';
import {
  type ChannelKind,
  type ChannelState,
  callerNameOf,
  channelStateOf,
  extFromDevice,
  extFromMember,
  parseChannel,
  phoneFromDialString,
  phoneOf,
} from './channel.js';
import { type CounterSeed, callIdEpochMs, startedBefore } from './cdr-seed.js';

/**
 * In-memory live telephony state, built only from AMI events (Asterisk 13+ names). Today's counters for calls that
 * started before live counting began (`countFrom`) come from the CDR (`applySeed`, see cdr-seed.ts); the projection
 * adds the two.
 *
 * Pure: no Nest, no I/O, no clock — every input carries `now` (epoch ms). Feed it with
 * `apply(event, now)` and the list-action results (`applyPeers`, `applyQueueStatus`,
 * `resyncChannels`), then drain the produced domain events and changed sections.
 *
 * Model (replaces legacy amiService's 6 overlapping maps):
 *  - a channel is keyed by Uniqueid; a call is keyed by Linkedid and owns its channels;
 *  - operator presence is *derived* from the operator's device channels + registration + pause
 *    with one precedence (talking > ringing > offline > paused > idle);
 *  - every event type has exactly one handler (legacy ran 2 for DialBegin/DialEnd/AgentConnect/
 *    QueueCallerAbandon), and a call produces exactly one `call.ended` (B11/B12/B13).
 */

export interface LiveConfig {
  /** Which SIP peers / queue members are operator phones. */
  operatorExtension: RegExp;
  timezone: string;
}

export type LiveSection = 'operators' | 'calls' | 'queues' | 'counters';

export type LiveDomainEvent =
  | { name: typeof CallEvents.QueueJoined; payload: CallQueueJoinedEvent }
  | { name: typeof CallEvents.Abandoned; payload: CallAbandonedEvent }
  | { name: typeof CallEvents.Answered; payload: CallAnsweredEvent }
  | { name: typeof CallEvents.Ended; payload: CallEndedEvent }
  | { name: typeof CallEvents.OperatorMissed; payload: CallOperatorMissedEvent };

export type AmiEvent = Record<string, string>;

export interface ChannelRec {
  uniqueid: string;
  /** Call this channel belongs to (Linkedid; re-pointed on attended transfer). */
  callId: string;
  name: string;
  kind: ChannelKind;
  ext: string | null;
  state: ChannelState;
  createdAt: number;
  answeredAt: number | null;
  callerNum: string;
  callerName: string;
  exten: string;
  bridgeId: string | null;
  /** Last DialEnd status where this channel was the destination. */
  dialStatus: string | null;
  /** Leaving because of a transfer — not a "who hung up" signal. */
  transferring: boolean;
}

export interface CallRec {
  id: string;
  direction: CallDirection;
  /** Direction is a guess until an external leg / dialed number is seen. */
  directionKnown: boolean;
  phone: string | null;
  callerName: string | null;
  startedAt: number;
  /** Tashkent day the call is counted in; null = not counted (discovered by resync, or on the CDR side). */
  countedDay: string | null;
  /** Started before live counting began (`countFrom`): counted from the CDR once it ends, never live. */
  seedSide: boolean;
  /** Citizen leg (inbound: the trunk channel; outbound: the dialed trunk channel). */
  partyUniqueid: string | null;
  /** Operator who placed an outbound/internal call. */
  originExt: string | null;
  queue: string | null;
  queuedAt: number | null;
  leftQueueAt: number | null;
  inQueue: boolean;
  everQueued: boolean;
  abandonEmitted: boolean;
  /** Citizen hung up while waiting (QueueCallerAbandon). */
  abandoned: boolean;
  answeredAt: number | null;
  talkingExt: string | null;
  handledExts: string[];
  /** ext -> ring start. */
  ringing: Map<string, number>;
  everRang: boolean;
  transferred: boolean;
  /** Authoritative party from AgentComplete.Reason. */
  agentParty: HangupParty | null;
  /** First party leg that left: HangupRequest (remote hangup) or leaving the bridge while talking. */
  partyExit: { uniqueid: string; party: 'client' | 'operator' } | null;
  staffHangup: boolean;
  outboundDialStatus: string | null;
  /** ext -> time a miss was recorded (dedupes DialEnd + AgentRingNoAnswer of one ring). */
  missed: Map<string, number>;
  channels: Set<string>;
  lastState: string;
  stateSince: number;
}

export interface OperatorRec {
  ext: string;
  name: string | null;
  /** null = no registration info yet. */
  registered: boolean | null;
  registeredFromPeer: boolean;
  ip: string | null;
  paused: boolean;
  pauseReason: string | null;
  queue: { callsTaken: number; lastCallAt: number | null } | null;
  presence: OperatorPresence;
  presenceSince: number;
  today: OperatorToday;
}

export interface QueueRec {
  name: string;
  strategy: string | null;
  completed: number;
  abandoned: number;
  members: Set<string>;
  /** uniqueid of the waiting caller channel -> entry */
  waiting: Map<string, { callId: string; position: number; joinedAt: number }>;
}

export interface CountersRec {
  date: string;
  since: number;
  inbound: number;
  answered: number;
  abandoned: number;
  ivrOnly: number;
  unanswered: number;
  outbound: number;
  outboundAnswered: number;
  operatorMissed: number;
  talkSeconds: number;
  clientHangups: number;
  operatorHangups: number;
  unknownHangups: number;
}

const MISS_DEDUPE_MS = 5_000;
const STALE_RING_MS = 120_000;
const ORIGINATE_EXPECT_MS = 60_000;

const emptyToday = (): OperatorToday => ({
  answered: 0,
  outbound: 0,
  outboundAttempts: 0,
  missed: 0,
  transfersIn: 0,
  transfersOut: 0,
  talkSeconds: 0,
  clientHangups: 0,
  operatorHangups: 0,
});

export class LiveStore {
  readonly channels = new Map<string, ChannelRec>();
  readonly calls = new Map<string, CallRec>();
  readonly operators = new Map<string, OperatorRec>();
  readonly queues = new Map<string, QueueRec>();
  counters: CountersRec;
  /**
   * Live counting started here (epoch ms, whole second; null = not started): calls that started earlier are on the
   * CDR side (`seedSide`). Set once, at the first AMI connection (`startCounting`).
   */
  countFrom: number | null = null;

  private seed: CounterSeed | null = null;
  /** CDR-side calls that ended since the last drain: their CDR rows are written now. */
  private seedSideEnded: Array<{ callId: string; startedAt: number }> = [];
  private events: LiveDomainEvent[] = [];
  private changed = new Set<LiveSection>();
  /** ext -> expected click-to-call target (set by the actions module before Originate). */
  private expectedOriginates = new Map<string, { phone: string; at: number }>();
  /** Channel names whose hangup was requested by staff through our API. */
  private staffHangups = new Map<string, number>();

  constructor(
    private readonly config: LiveConfig,
    now: number,
  ) {
    this.counters = this.emptyCounters(now);
  }

  // =============================================================================================
  // Public API

  apply(evt: AmiEvent, now: number): void {
    this.rollover(now);
    const handler = this.handlers[evt.event];
    if (handler) {
      handler.call(this, evt, now);
      this.refresh(now);
    }
  }

  /** Periodic housekeeping: day rollover and presence timestamps. */
  tick(now: number): void {
    this.rollover(now);
    this.refresh(now);
  }

  drainEvents(): LiveDomainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  drainChanged(): Set<LiveSection> {
    const out = this.changed;
    this.changed = new Set();
    return out;
  }

  /**
   * Start counting live at `boundary` (epoch ms, a whole second): today's live counters restart from zero, and calls
   * that started before it — in progress now, or seen later through their events — are left to the CDR seed.
   */
  startCounting(boundary: number, now: number): void {
    this.countFrom = boundary;
    this.seed = null;
    this.counters = { ...this.emptyCounters(now), since: boundary };
    for (const op of this.operators.values()) op.today = emptyToday();
    for (const call of this.calls.values()) {
      if (startedBefore(boundary, call.id, call.startedAt)) {
        call.seedSide = true;
        call.countedDay = null;
      }
    }
    this.changed.add('counters');
    this.changed.add('operators');
  }

  /**
   * No CDR seed after all (PBX database down): from now on every call seen live is counted again, as before
   * `startCounting` — whatever the PBX clock says. Calls already left to the CDR stay uncounted (they began before
   * `counters.since`).
   */
  liveOnly(): void {
    this.countFrom = null;
    this.seed = null;
    this.seedSideEnded = [];
    this.changed.add('counters');
  }

  /** CDR counts of today's calls before `countFrom`; ignored (false) when the seed is for another day. */
  applySeed(seed: CounterSeed): boolean {
    if (seed.date !== this.counters.date) return false;
    this.seed = seed;
    this.changed.add('counters');
    this.changed.add('operators');
    return true;
  }

  /** The CDR seed of the current day, if any. */
  get todaySeed(): CounterSeed | null {
    return this.seed?.date === this.counters.date ? this.seed : null;
  }

  /** CDR-side calls that ended since the last call (id + start, for reading their CDR rows). */
  drainSeedSideEnded(): Array<{ callId: string; startedAt: number }> {
    const out = this.seedSideEnded;
    this.seedSideEnded = [];
    return out;
  }

  /** Operator directory (asterisk.users): creates operators and sets display names. */
  setDirectory(entries: Iterable<{ extension: string; name: string }>, now: number): void {
    for (const { extension, name } of entries) {
      const op = this.ensureOperator(extension, now);
      if (op && name && op.name !== name) {
        op.name = name;
        this.changed.add('operators');
      }
    }
  }

  /** Remember a click-to-call so the operator's ringing phone is shown as an outbound call to `phone`. */
  expectOriginate(ext: string, phone: string, now: number): void {
    this.expectedOriginates.set(ext, { phone, at: now });
  }

  /** Staff ended the call through our API: the hangup side is "operator" (call-center side). */
  markStaffHangup(channelName: string, now: number): void {
    this.staffHangups.set(channelName, now);
  }

  /**
   * Staff transferred the call with AMI Redirect: the citizen leg and the current operator legs
   * leave their bridges because of the transfer, not because somebody hung up.
   */
  markRedirect(channelName: string, now: number): void {
    const ch = [...this.channels.values()].find((c) => c.name === channelName);
    const call = ch ? this.calls.get(ch.callId) : undefined;
    if (!ch || !call) return;
    ch.transferring = true;
    if (call.talkingExt && !call.transferred) this.countTransferOut(call, call.talkingExt);
    call.transferred = true;
    for (const uid of call.channels) {
      const c = this.channels.get(uid);
      if (c?.kind === 'operator' && c.ext === call.talkingExt) c.transferring = true;
    }
    if (call.partyExit) call.partyExit = null;
    this.refresh(now);
  }

  /** Result of SIPpeers (PeerEntry) or PJSIPShowEndpoints (EndpointList). */
  applyPeers(entries: AmiEvent[], now: number): void {
    this.rollover(now);
    for (const e of entries) {
      if (e.event === 'PeerEntry') {
        const op = this.ensureOperator(e.objectname, now);
        if (!op) continue;
        const status = (e.status ?? '').toUpperCase();
        this.setRegistered(op, status.startsWith('OK') || status.startsWith('LAGGED'), true);
        const ip = e.ipaddress && !/^(-none-|\(null\)|)$/i.test(e.ipaddress) ? e.ipaddress : null;
        if (op.ip !== ip) {
          op.ip = ip;
          this.changed.add('operators');
        }
      } else if (e.event === 'EndpointList') {
        const op = this.ensureOperator(e.objectname, now);
        if (op) this.setRegistered(op, !/unavailable|invalid/i.test(e.devicestate ?? ''), true);
      }
    }
    this.refresh(now);
  }

  /** Result of QueueStatus: QueueParams / QueueMember / QueueEntry. Resyncs waiting callers. */
  applyQueueStatus(entries: AmiEvent[], now: number): void {
    this.rollover(now);
    const seenWaiting = new Map<string, Set<string>>();
    const seenMembers = new Map<string, Set<string>>();
    for (const e of entries) {
      if (e.event === 'QueueParams') {
        const q = this.ensureQueue(e.queue);
        q.strategy = e.strategy || q.strategy;
        q.completed = toInt(e.completed);
        q.abandoned = toInt(e.abandoned);
        seenWaiting.set(q.name, seenWaiting.get(q.name) ?? new Set());
        seenMembers.set(q.name, seenMembers.get(q.name) ?? new Set());
      } else if (e.event === 'QueueMember') {
        const ext = extFromMember(e, this.config.operatorExtension);
        if (!ext) continue;
        this.onMemberUpdate(e, ext, now);
        const set = seenMembers.get(e.queue) ?? new Set<string>();
        set.add(ext);
        seenMembers.set(e.queue, set);
      } else if (e.event === 'QueueEntry') {
        const q = this.ensureQueue(e.queue);
        const set = seenWaiting.get(q.name) ?? new Set<string>();
        set.add(e.uniqueid);
        seenWaiting.set(q.name, set);
        const ch =
          this.channels.get(e.uniqueid) ??
          this.addChannel({ ...e, linkedid: e.linkedid || e.uniqueid, channelstate: '6' }, now, {
            createdAt: now - toInt(e.wait) * 1000,
            partial: true,
          });
        const call = this.calls.get(ch.callId);
        if (!call) continue;
        call.queue = q.name;
        call.inQueue = true;
        call.everQueued = true;
        call.queuedAt ??= now - toInt(e.wait) * 1000;
        const existing = q.waiting.get(e.uniqueid);
        q.waiting.set(e.uniqueid, {
          callId: call.id,
          position: toInt(e.position),
          joinedAt: existing?.joinedAt ?? now - toInt(e.wait) * 1000,
        });
      }
    }
    for (const [name, ids] of seenWaiting) {
      const q = this.queues.get(name);
      if (!q) continue;
      for (const uid of q.waiting.keys()) if (!ids.has(uid)) q.waiting.delete(uid);
      q.members = seenMembers.get(name) ?? q.members;
    }
    this.changed.add('queues');
    this.changed.add('calls');
    this.refresh(now);
  }

  /**
   * Result of CoreShowChannels: adds channels we missed (API restart, reconnect) and ends the
   * ones Asterisk no longer has (lost Hangup events). Pairing/bridges are merged, not replaced (B30).
   */
  resyncChannels(entries: AmiEvent[], now: number): void {
    this.rollover(now);
    const seen = new Set<string>();
    const sorted = entries
      .filter((e) => e.event === 'CoreShowChannel' && e.uniqueid)
      .sort((a, b) => Number.parseFloat(a.uniqueid) - Number.parseFloat(b.uniqueid));
    for (const e of sorted) {
      seen.add(e.uniqueid);
      const existing = this.channels.get(e.uniqueid);
      const state = channelStateOf(e.channelstate, e.channelstatedesc);
      if (existing) {
        existing.state = state;
        existing.bridgeId = e.bridgeid || existing.bridgeId;
        if (state === 'up') existing.answeredAt ??= now - durationMs(e.duration);
        continue;
      }
      const createdAt = now - durationMs(e.duration);
      const ch = this.addChannel(e, now, { createdAt, partial: true });
      ch.state = state;
      ch.bridgeId = e.bridgeid || null;
      if (state === 'up') ch.answeredAt = createdAt;
    }
    // Calls discovered mid-way: infer "talking" from an up operator leg bridged with the call.
    for (const call of this.calls.values()) {
      if (call.answeredAt !== null || call.countedDay !== null) continue;
      for (const uid of call.channels) {
        const ch = this.channels.get(uid);
        if (ch?.kind === 'operator' && ch.state === 'up' && ch.bridgeId && ch.ext) {
          const partyUp = [...call.channels].some((u) => {
            const c = this.channels.get(u);
            return c && c.kind === 'external' && c.state === 'up';
          });
          if (partyUp || call.direction === 'internal') {
            call.answeredAt = ch.answeredAt ?? now;
            call.talkingExt = call.direction === 'outbound' ? (call.originExt ?? ch.ext) : ch.ext;
            if (!call.handledExts.includes(ch.ext)) call.handledExts.push(ch.ext);
          }
        }
      }
    }
    for (const uid of this.channels.keys()) {
      if (!seen.has(uid)) this.onHangup({ event: 'Hangup', uniqueid: uid, cause: '0' }, now);
    }
    for (const call of this.calls.values()) if (call.channels.size === 0) this.endCall(call, now);
    this.changed.add('calls');
    this.changed.add('operators');
    this.refresh(now);
  }

  // =============================================================================================
  // Event handlers — one per AMI event type

  private readonly handlers: Record<string, (this: LiveStore, e: AmiEvent, now: number) => void> = {
    Newchannel: this.onNewchannel,
    Newstate: this.onNewstate,
    DialBegin: this.onDialBegin,
    DialEnd: this.onDialEnd,
    BridgeEnter: this.onBridgeEnter,
    BridgeLeave: this.onBridgeLeave,
    HangupRequest: this.onHangupRequest,
    Hangup: this.onHangup,
    QueueCallerJoin: this.onQueueCallerJoin,
    QueueCallerLeave: this.onQueueCallerLeave,
    QueueCallerAbandon: this.onQueueCallerAbandon,
    AgentCalled: this.onAgentCalled,
    AgentRingNoAnswer: this.onAgentRingNoAnswer,
    AgentConnect: this.onAgentConnect,
    AgentComplete: this.onAgentComplete,
    QueueMemberStatus: this.onQueueMemberEvent,
    QueueMemberPause: this.onQueueMemberEvent,
    QueueMemberPaused: this.onQueueMemberEvent,
    QueueMemberAdded: this.onQueueMemberEvent,
    QueueMemberRemoved: this.onQueueMemberRemoved,
    PeerStatus: this.onPeerStatus,
    ContactStatus: this.onContactStatus,
    DeviceStateChange: this.onDeviceStateChange,
    BlindTransfer: this.onBlindTransfer,
    AttendedTransfer: this.onAttendedTransfer,
  };

  private onNewchannel(e: AmiEvent, now: number): void {
    if (!e.uniqueid || this.channels.has(e.uniqueid)) return;
    this.addChannel(e, now, { createdAt: now, partial: false });
  }

  private onNewstate(e: AmiEvent, now: number): void {
    const ch = this.channels.get(e.uniqueid) ?? this.addChannel(e, now, { createdAt: now, partial: false });
    const state = channelStateOf(e.channelstate, e.channelstatedesc);
    if (state === ch.state) return;
    ch.state = state;
    if (state === 'up') ch.answeredAt ??= now;
    this.touch(ch);
  }

  private onDialBegin(e: AmiEvent, now: number): void {
    const dest = this.destChannel(e, now);
    if (!dest) return;
    const call = this.calls.get(dest.callId);
    if (!call) return;
    const caller = e.uniqueid ? this.channels.get(e.uniqueid) : undefined;

    if (dest.kind === 'external') {
      // An operator dialing out through a trunk.
      if (caller?.kind === 'operator' || call.originExt) {
        const dialed =
          phoneFromDialString(e.dialstring, this.config.operatorExtension) ??
          phoneOf(e.destexten, this.config.operatorExtension);
        if (dialed && !call.phone) call.phone = dialed;
        call.partyUniqueid ??= dest.uniqueid;
        this.markOutbound(call, now);
      }
      return;
    }

    if (dest.ext && call.direction !== 'outbound' && call.talkingExt !== dest.ext) {
      if (!call.ringing.has(dest.ext)) call.ringing.set(dest.ext, now);
      call.everRang = true;
      if (!call.directionKnown && !caller && call.originExt === null) {
        // Originate rings the operator's own phone first (no caller channel).
        call.originExt = dest.ext;
      }
    }
    this.touch(dest);
  }

  private onDialEnd(e: AmiEvent, now: number): void {
    const dest = this.destChannel(e, now);
    if (!dest) return;
    const call = this.calls.get(dest.callId);
    if (!call) return;
    const status = (e.dialstatus ?? '').toUpperCase();
    dest.dialStatus = status;

    if (dest.kind === 'external') {
      if (call.direction !== 'outbound') return;
      if (status === 'ANSWER') this.markOutboundAnswered(call, now);
      else call.outboundDialStatus = status;
      return;
    }

    if (!dest.ext) return;
    const ext = dest.ext;
    const isOriginateLeg = !e.uniqueid && call.originExt === ext;
    if (isOriginateLeg || (call.direction === 'outbound' && call.originExt === ext)) return;

    if (status === 'ANSWER') {
      if (dest.kind === 'operator') this.markAnswered(call, ext, now);
      return;
    }
    call.ringing.delete(ext);
    if (dest.kind === 'operator' && call.direction === 'inbound') {
      const reason =
        status === 'NOANSWER'
          ? 'no_answer'
          : status === 'BUSY'
            ? 'rejected'
            : status === 'CHANUNAVAIL' || status === 'CONGESTION'
              ? 'unavailable'
              : null;
      // CANCEL = the caller left or the queue stopped ringing this member (AgentRingNoAnswer covers queue timeouts).
      if (reason) this.recordMissed(call, ext, reason, now);
    }
    this.changed.add('calls');
    this.changed.add('operators');
  }

  private onBridgeEnter(e: AmiEvent, now: number): void {
    const ch = this.channels.get(e.uniqueid);
    if (!ch) return;
    ch.bridgeId = e.bridgeuniqueid || null;
    const call = this.calls.get(ch.callId);
    if (call?.partyExit?.uniqueid === ch.uniqueid) call.partyExit = null; // back in a bridge (hold/transfer)
    if (ch.kind === 'external') ch.transferring = false; // the redirected citizen is connected again
    if (!call || !ch.bridgeId) return;
    // Direct (non-Local) bridges: operator leg with the citizen leg means the call is connected.
    const members = [...this.channels.values()].filter((c) => c.bridgeId === ch.bridgeId);
    const op = members.find((c) => c.kind === 'operator' && c.ext);
    const party = members.find((c) => c.kind === 'external');
    if (op?.ext && party) {
      if (call.direction === 'outbound') this.markOutboundAnswered(call, now);
      else if (call.direction === 'inbound') this.markAnswered(call, op.ext, now);
    }
  }

  private onBridgeLeave(e: AmiEvent, now: number): void {
    const ch = this.channels.get(e.uniqueid);
    if (!ch) return;
    const call = this.calls.get(ch.callId);
    ch.bridgeId = null;
    if (call && call.answeredAt !== null) this.notePartyExit(call, ch);
    void now;
  }

  /** Raised when the far end hangs up (SIP BYE/CANCEL) — the strongest "who hung up" signal. */
  private onHangupRequest(e: AmiEvent): void {
    const ch = this.channels.get(e.uniqueid);
    if (!ch) return;
    const call = this.calls.get(ch.callId);
    if (call) this.notePartyExit(call, ch, true);
  }

  private onHangup(e: AmiEvent, now: number): void {
    const ch = this.channels.get(e.uniqueid);
    if (!ch) return;
    const call = this.calls.get(ch.callId);
    this.channels.delete(ch.uniqueid);
    for (const q of this.queues.values()) if (q.waiting.delete(ch.uniqueid)) this.changed.add('queues');

    const staffAt = this.staffHangups.get(ch.name);
    if (staffAt !== undefined) this.staffHangups.delete(ch.name);

    if (call) {
      call.channels.delete(ch.uniqueid);
      if (staffAt !== undefined) call.staffHangup = true;
      if (ch.kind === 'operator' && ch.ext) {
        const ext = ch.ext;
        if (call.handledExts.includes(ext) && ch.answeredAt !== null && call.answeredAt !== null) {
          const from = Math.max(ch.answeredAt, call.answeredAt);
          const op = this.operators.get(ext);
          if (op && call.countedDay === this.counters.date)
            op.today.talkSeconds += Math.max(0, Math.round((now - from) / 1000));
        }
        if (call.talkingExt === ext && call.direction !== 'outbound') call.talkingExt = null;
        const stillHasLeg = [...call.channels].some(
          (u) => this.channels.get(u)?.ext === ext && this.channels.get(u)?.kind === 'operator',
        );
        if (!stillHasLeg) call.ringing.delete(ext);
      }
      if (call.channels.size === 0) this.endCall(call, now);
    }
    this.touch(ch);
  }

  private onQueueCallerJoin(e: AmiEvent, now: number): void {
    const ch = this.channels.get(e.uniqueid) ?? this.addChannel(e, now, { createdAt: now, partial: false });
    const call = this.calls.get(ch.callId);
    if (!call) return;
    const q = this.ensureQueue(e.queue);
    q.waiting.set(ch.uniqueid, { callId: call.id, position: toInt(e.position), joinedAt: now });
    call.queue = q.name;
    call.inQueue = true;
    call.everQueued = true;
    call.queuedAt ??= now;
    call.leftQueueAt = null;
    this.changed.add('queues');
    this.changed.add('calls');
    this.emit(CallEvents.QueueJoined, { ...this.base(call, now), queue: q.name });
  }

  private onQueueCallerLeave(e: AmiEvent, now: number): void {
    const q = this.queues.get(e.queue);
    q?.waiting.delete(e.uniqueid);
    if (q) renumber(q);
    const call = this.callOfChannel(e);
    if (call) {
      call.inQueue = false;
      call.leftQueueAt = now;
    }
    this.changed.add('queues');
    this.changed.add('calls');
  }

  private onQueueCallerAbandon(e: AmiEvent, now: number): void {
    const call = this.callOfChannel(e);
    if (!call || call.abandonEmitted) return;
    call.abandoned = true;
    call.inQueue = false;
    call.leftQueueAt = now;
    this.emitAbandoned(call, e.queue || call.queue || '', toInt(e.holdtime), now);
    this.changed.add('calls');
  }

  private onAgentCalled(e: AmiEvent, now: number): void {
    const ext = extFromMember(e, this.config.operatorExtension);
    const call = this.callOfChannel(e);
    if (!ext || !call || call.talkingExt === ext) return;
    if (!call.ringing.has(ext)) call.ringing.set(ext, now);
    call.everRang = true;
    this.ensureOperator(ext, now);
    this.changed.add('calls');
    this.changed.add('operators');
  }

  private onAgentRingNoAnswer(e: AmiEvent, now: number): void {
    const ext = extFromMember(e, this.config.operatorExtension);
    const call = this.callOfChannel(e);
    if (!ext || !call) return;
    call.ringing.delete(ext);
    // Reason from the member's own dial result if it is already known (rejected phones answer BUSY).
    const status = [...call.channels]
      .map((u) => this.channels.get(u))
      .find((c) => c?.ext === ext && c.kind === 'operator' && c.dialStatus)?.dialStatus;
    const ringMs = toInt(e.ringtime);
    const reason =
      status === 'BUSY'
        ? ringMs < 1000
          ? 'busy'
          : 'rejected'
        : status === 'CHANUNAVAIL' || status === 'CONGESTION'
          ? 'unavailable'
          : 'no_answer';
    this.recordMissed(call, ext, reason, now);
    this.changed.add('calls');
    this.changed.add('operators');
  }

  private onAgentConnect(e: AmiEvent, now: number): void {
    const ext = extFromMember(e, this.config.operatorExtension);
    const call = this.callOfChannel(e);
    if (!ext || !call) return;
    call.inQueue = false;
    call.leftQueueAt ??= now;
    this.markAnswered(call, ext, now);
  }

  private onAgentComplete(e: AmiEvent, now: number): void {
    const ext = extFromMember(e, this.config.operatorExtension);
    const call = this.callOfChannel(e);
    if (!call) return;
    const reason = (e.reason ?? '').toLowerCase();
    if (reason === 'transfer') {
      if (!call.transferred && ext) this.countTransferOut(call, ext);
      call.transferred = true;
      for (const u of call.channels) {
        const c = this.channels.get(u);
        if (c?.ext === ext && c.kind === 'operator') c.transferring = true;
      }
      if (call.partyExit?.party === 'operator') call.partyExit = null;
    } else if (reason === 'agent' || reason === 'caller') {
      // A staff Redirect also ends the queue segment; that is a transfer, not a hangup.
      const transferring = [...call.channels].some((u) => {
        const c = this.channels.get(u);
        return c?.transferring && (c.ext === ext || c.uniqueid === call.partyUniqueid);
      });
      if (!transferring) call.agentParty = reason === 'agent' ? 'operator' : 'client';
    }
    void now;
  }

  private onQueueMemberEvent(e: AmiEvent, now: number): void {
    const ext = extFromMember(e, this.config.operatorExtension);
    if (!ext) return;
    this.onMemberUpdate(e, ext, now);
    if (e.queue) {
      this.ensureQueue(e.queue).members.add(ext);
      this.changed.add('queues');
    }
  }

  private onQueueMemberRemoved(e: AmiEvent): void {
    const ext = extFromMember(e, this.config.operatorExtension);
    if (!ext || !e.queue) return;
    this.queues.get(e.queue)?.members.delete(ext);
    this.changed.add('queues');
  }

  private onPeerStatus(e: AmiEvent, now: number): void {
    const op = this.ensureOperator(extFromDevice(e.peer, this.config.operatorExtension), now);
    if (!op) return;
    const status = (e.peerstatus ?? '').toLowerCase();
    // Registration only toggles online/offline; it never overrides a call state (B29).
    if (['registered', 'reachable', 'lagged'].includes(status)) this.setRegistered(op, true, true);
    else if (['unregistered', 'unreachable', 'rejected'].includes(status)) this.setRegistered(op, false, true);
    if (e.address) {
      const ip = e.address.replace(/:\d+$/, '');
      if (op.ip !== ip) {
        op.ip = ip;
        this.changed.add('operators');
      }
    }
  }

  private onContactStatus(e: AmiEvent, now: number): void {
    const op = this.ensureOperator(e.endpointname || e.aor, now);
    if (!op) return;
    const status = (e.contactstatus ?? '').toLowerCase();
    if (['reachable', 'created', 'updated'].includes(status)) this.setRegistered(op, true, true);
    else if (['unreachable', 'removed'].includes(status)) this.setRegistered(op, false, true);
  }

  private onDeviceStateChange(e: AmiEvent, now: number): void {
    const op = this.ensureOperator(extFromDevice(e.device, this.config.operatorExtension), now);
    if (!op) return;
    const state = (e.state ?? '').toUpperCase();
    if (state === 'UNAVAILABLE' || state === 'INVALID') this.setRegistered(op, false, true);
    else if (state && state !== 'UNKNOWN') this.setRegistered(op, true, true);
  }

  private onBlindTransfer(e: AmiEvent): void {
    if ((e.result ?? '').toLowerCase() !== 'success') return;
    const transferer = this.channels.get(e.transfereruniqueid);
    if (!transferer) return;
    transferer.transferring = true;
    const call = this.calls.get(e.transfereelinkedid) ?? this.calls.get(transferer.callId);
    if (call) {
      if (transferer.ext && !call.transferred) this.countTransferOut(call, transferer.ext);
      call.transferred = true;
      if (call.partyExit?.uniqueid === transferer.uniqueid) call.partyExit = null;
    }
  }

  private onAttendedTransfer(e: AmiEvent, now: number): void {
    if ((e.result ?? '').toLowerCase() !== 'success') return;
    const orig = this.channels.get(e.origtransfereruniqueid);
    const second = this.channels.get(e.secondtransfereruniqueid);
    for (const c of [orig, second]) if (c) c.transferring = true;
    const transferee = this.channels.get(e.transfereeuniqueid);
    const call = transferee ? this.calls.get(transferee.callId) : orig ? this.calls.get(orig.callId) : undefined;
    if (!call) return;
    if (orig?.ext && !call.transferred) this.countTransferOut(call, orig.ext);
    call.transferred = true;
    if (
      call.partyExit &&
      (call.partyExit.uniqueid === orig?.uniqueid || call.partyExit.uniqueid === second?.uniqueid)
    ) {
      call.partyExit = null;
    }
    // The consulted operator's leg lives in the consultation call; it now talks to the citizen.
    const target = this.channels.get(e.transfertargetuniqueid);
    if (target && target.callId !== call.id) {
      this.calls.get(target.callId)?.channels.delete(target.uniqueid);
      target.callId = call.id;
      call.channels.add(target.uniqueid);
    }
    if (target?.kind === 'operator' && target.ext) this.markAnswered(call, target.ext, now);
  }

  // =============================================================================================
  // Call lifecycle

  private addChannel(e: AmiEvent, now: number, opts: { createdAt: number; partial: boolean }): ChannelRec {
    const parsed = parseChannel(e.channel ?? '', this.config.operatorExtension);
    const callId = e.linkedid || e.uniqueid;
    const ch: ChannelRec = {
      uniqueid: e.uniqueid,
      callId,
      name: e.channel ?? '',
      kind: parsed.kind,
      ext: parsed.ext,
      state: channelStateOf(e.channelstate, e.channelstatedesc),
      createdAt: opts.createdAt,
      answeredAt: null,
      callerNum: e.calleridnum ?? '',
      callerName: e.calleridname ?? '',
      exten: e.exten ?? '',
      bridgeId: null,
      dialStatus: null,
      transferring: false,
    };
    this.channels.set(ch.uniqueid, ch);
    if (ch.kind === 'operator' && ch.ext) {
      const op = this.ensureOperator(ch.ext, now);
      if (op && op.registered === null) op.registered = true; // a live channel means the phone is there
    }

    let call = this.calls.get(callId);
    if (!call) {
      // A call that began before live counting did is counted from the CDR, even if this is a live event of it.
      const seedSide = this.countFrom !== null && startedBefore(this.countFrom, callId, opts.createdAt);
      call = this.newCall(callId, opts.createdAt, opts.partial || seedSide ? null : this.counters.date);
      call.seedSide = seedSide;
      this.classifyNewCall(call, ch, e, now);
    } else if (ch.kind === 'external' && !call.partyUniqueid && (call.originExt || !call.directionKnown)) {
      // A trunk leg joined an operator-originated call: it is an outbound call.
      call.partyUniqueid = ch.uniqueid;
      call.phone ??=
        phoneOf(e.exten, this.config.operatorExtension) ?? phoneOf(e.connectedlinenum, this.config.operatorExtension);
      this.markOutbound(call, now);
    }
    call.channels.add(ch.uniqueid);
    this.touch(ch);
    return ch;
  }

  private newCall(id: string, startedAt: number, countedDay: string | null): CallRec {
    const call: CallRec = {
      id,
      direction: 'internal',
      directionKnown: false,
      phone: null,
      callerName: null,
      startedAt,
      countedDay,
      seedSide: false,
      partyUniqueid: null,
      originExt: null,
      queue: null,
      queuedAt: null,
      leftQueueAt: null,
      inQueue: false,
      everQueued: false,
      abandonEmitted: false,
      abandoned: false,
      answeredAt: null,
      talkingExt: null,
      handledExts: [],
      ringing: new Map(),
      everRang: false,
      transferred: false,
      agentParty: null,
      partyExit: null,
      staffHangup: false,
      outboundDialStatus: null,
      missed: new Map(),
      channels: new Set(),
      lastState: '',
      stateSince: startedAt,
    };
    this.calls.set(id, call);
    this.changed.add('calls');
    return call;
  }

  private classifyNewCall(call: CallRec, first: ChannelRec, e: AmiEvent, now: number): void {
    const opExt = this.config.operatorExtension;
    if (first.kind === 'external') {
      call.direction = 'inbound';
      call.directionKnown = true;
      call.partyUniqueid = first.uniqueid;
      call.phone = phoneOf(e.calleridnum, opExt);
      call.callerName = callerNameOf(e.calleridname, e.calleridnum);
      if (call.countedDay) this.counters.inbound++;
      this.changed.add('counters');
      return;
    }
    if (first.kind === 'operator' && first.ext) {
      call.originExt = first.ext;
      const dialed = phoneOf(e.exten, opExt);
      const expected = this.expectedOriginates.get(first.ext);
      if (dialed) {
        call.phone = dialed;
        this.markOutbound(call, now);
      } else if (expected && now - expected.at < ORIGINATE_EXPECT_MS) {
        this.expectedOriginates.delete(first.ext);
        call.phone = expected.phone;
        this.markOutbound(call, now);
      }
    }
  }

  private markOutbound(call: CallRec, now: number): void {
    if (call.direction === 'outbound' && call.directionKnown) return;
    call.direction = 'outbound';
    call.directionKnown = true;
    call.ringing.clear(); // the operator's own phone ringing for a click-to-call is not an inbound ring
    if (call.countedDay === this.counters.date) {
      this.counters.outbound++;
      const op = call.originExt ? this.operators.get(call.originExt) : undefined;
      if (op) op.today.outboundAttempts++;
      this.changed.add('counters');
    }
    this.changed.add('calls');
    void now;
  }

  private markOutboundAnswered(call: CallRec, now: number): void {
    if (call.answeredAt !== null) return;
    call.answeredAt = now;
    call.talkingExt = call.originExt;
    if (call.originExt && !call.handledExts.includes(call.originExt)) call.handledExts.push(call.originExt);
    if (call.countedDay === this.counters.date) {
      this.counters.outboundAnswered++;
      const op = call.originExt ? this.operators.get(call.originExt) : undefined;
      if (op) op.today.outbound++;
      this.changed.add('counters');
    }
    this.changed.add('calls');
    this.changed.add('operators');
    if (call.originExt) this.emit(CallEvents.Answered, { ...this.base(call, now), extension: call.originExt });
  }

  /** An operator picked up an inbound/internal call. Idempotent per (call, operator). */
  private markAnswered(call: CallRec, ext: string, now: number): void {
    call.ringing.delete(ext);
    if (call.direction === 'outbound') return;
    if (call.talkingExt === ext) return;
    const transferIn = call.answeredAt !== null || call.transferred;
    call.talkingExt = ext;
    call.inQueue = false;
    if (call.handledExts.includes(ext)) return;
    call.handledExts.push(ext);
    const counted = call.countedDay === this.counters.date;
    if (call.answeredAt === null) {
      call.answeredAt = now;
      if (call.direction === 'inbound' && counted) this.counters.answered++;
    }
    const op = this.ensureOperator(ext, now);
    if (op && counted && call.direction === 'inbound') {
      if (transferIn) op.today.transfersIn++;
      else op.today.answered++;
    }
    this.changed.add('counters');
    this.changed.add('calls');
    this.changed.add('operators');
    this.emit(CallEvents.Answered, { ...this.base(call, now), extension: ext });
  }

  private notePartyExit(call: CallRec, ch: ChannelRec, remoteHangup = false): void {
    if (call.partyExit || ch.transferring) return;
    // Leaving a bridge counts only while connected; a remote hangup counts at any stage.
    if (!remoteHangup && call.answeredAt === null) return;
    if (ch.uniqueid === call.partyUniqueid) {
      call.partyExit = { uniqueid: ch.uniqueid, party: 'client' };
    } else if (ch.kind === 'operator' && ch.ext && (ch.ext === call.talkingExt || ch.ext === call.originExt)) {
      call.partyExit = { uniqueid: ch.uniqueid, party: 'operator' };
    }
  }

  private recordMissed(call: CallRec, ext: string, reason: CallOperatorMissedEvent['reason'], now: number): void {
    const last = call.missed.get(ext);
    if (last !== undefined && now - last < MISS_DEDUPE_MS) return;
    call.missed.set(ext, now);
    const op = this.ensureOperator(ext, now);
    if (call.countedDay === this.counters.date) {
      this.counters.operatorMissed++;
      if (op) op.today.missed++;
      this.changed.add('counters');
    }
    this.emit(CallEvents.OperatorMissed, { ...this.base(call, now), extension: ext, reason });
  }

  private emitAbandoned(call: CallRec, queue: string, waitSeconds: number, now: number): void {
    if (call.abandonEmitted) return;
    call.abandonEmitted = true;
    this.emit(CallEvents.Abandoned, { ...this.base(call, now), queue, waitSeconds: Math.max(0, waitSeconds) });
  }

  private countTransferOut(call: CallRec, ext: string): void {
    if (call.countedDay !== this.counters.date) return; // not counted live (resync / CDR side)
    const op = this.operators.get(ext);
    if (op) op.today.transfersOut++;
    this.changed.add('operators');
  }

  private endCall(call: CallRec, now: number): void {
    this.calls.delete(call.id);
    if (call.seedSide)
      this.seedSideEnded.push({ callId: call.id, startedAt: callIdEpochMs(call.id) ?? call.startedAt });
    for (const q of this.queues.values()) {
      for (const [uid, w] of q.waiting) if (w.callId === call.id) q.waiting.delete(uid);
    }
    const answered = call.answeredAt !== null;
    const extension =
      call.direction === 'outbound'
        ? call.originExt
        : (call.talkingExt ?? call.handledExts.at(-1) ?? (call.direction === 'internal' ? call.originExt : null));
    const talkSeconds = answered ? Math.max(0, Math.round((now - (call.answeredAt ?? now)) / 1000)) : 0;

    let hangupParty: HangupParty = 'unknown';
    if (call.staffHangup) hangupParty = 'operator';
    else if (call.agentParty) hangupParty = call.agentParty;
    else if (call.partyExit) hangupParty = call.partyExit.party;
    else if (!answered && call.abandoned) hangupParty = 'client';
    else if (!answered && call.direction === 'outbound' && call.outboundDialStatus === 'CANCEL')
      hangupParty = 'operator';

    if (call.everQueued && !answered && !call.abandonEmitted) {
      const left = call.leftQueueAt ?? now;
      this.emitAbandoned(call, call.queue ?? '', Math.round((left - (call.queuedAt ?? left)) / 1000), now);
    }

    if (call.countedDay === this.counters.date) {
      const c = this.counters;
      if (call.direction === 'inbound' && !answered) {
        c.unanswered++;
        if (call.everQueued) c.abandoned++;
        else if (!call.everRang) c.ivrOnly++;
      }
      if (answered && call.direction !== 'internal') {
        c.talkSeconds += talkSeconds;
        if (hangupParty === 'client') c.clientHangups++;
        else if (hangupParty === 'operator') c.operatorHangups++;
        else c.unknownHangups++;
        const op = extension ? this.operators.get(extension) : undefined;
        if (op && hangupParty === 'client') op.today.clientHangups++;
        if (op && hangupParty === 'operator') op.today.operatorHangups++;
      }
      this.changed.add('counters');
    }

    this.changed.add('calls');
    this.changed.add('queues');
    this.changed.add('operators');
    this.emit(CallEvents.Ended, {
      ...this.base(call, now),
      extension: extension ?? null,
      answered,
      talkSeconds,
      hangupParty,
    });
  }

  // =============================================================================================
  // Operators & queues

  private ensureOperator(ext: string | null | undefined, now: number): OperatorRec | null {
    if (!ext || !this.config.operatorExtension.test(ext)) return null;
    let op = this.operators.get(ext);
    if (!op) {
      op = {
        ext,
        name: null,
        registered: null,
        registeredFromPeer: false,
        ip: null,
        paused: false,
        pauseReason: null,
        queue: null,
        presence: 'offline',
        presenceSince: now,
        today: emptyToday(),
      };
      this.operators.set(ext, op);
      this.changed.add('operators');
    }
    return op;
  }

  private setRegistered(op: OperatorRec, value: boolean, fromPeer: boolean): void {
    if (!fromPeer && op.registeredFromPeer) return;
    if (fromPeer) op.registeredFromPeer = true;
    if (op.registered !== value) {
      op.registered = value;
      this.changed.add('operators');
    }
  }

  private onMemberUpdate(e: AmiEvent, ext: string, now: number): void {
    const op = this.ensureOperator(ext, now);
    if (!op) return;
    if (e.paused !== undefined) {
      const paused = e.paused === '1' || e.paused.toLowerCase() === 'true';
      const reason = paused ? e.pausedreason || e.reason || null : null;
      if (op.paused !== paused || op.pauseReason !== reason) {
        op.paused = paused;
        op.pauseReason = reason;
        this.changed.add('operators');
      }
    }
    if (e.callstaken !== undefined) {
      const lastCall = toInt(e.lastcall);
      op.queue = { callsTaken: toInt(e.callstaken), lastCallAt: lastCall > 0 ? lastCall * 1000 : null };
      this.changed.add('operators');
    }
    // Device state of the member (AST_DEVICE_*): 4 INVALID, 5 UNAVAILABLE. Fallback only.
    if (e.status !== undefined) this.setRegistered(op, !['4', '5'].includes(e.status), false);
  }

  private ensureQueue(name: string): QueueRec {
    let q = this.queues.get(name);
    if (!q) {
      q = { name, strategy: null, completed: 0, abandoned: 0, members: new Set(), waiting: new Map() };
      this.queues.set(name, q);
      this.changed.add('queues');
    }
    return q;
  }

  // =============================================================================================
  // Derived state

  /** Recompute operator presence / call states and their "since" timestamps. */
  private refresh(now: number): void {
    for (const op of this.operators.values()) {
      const presence = this.presenceOf(op, now).presence;
      if (presence !== op.presence) {
        op.presence = presence;
        op.presenceSince = now;
        this.changed.add('operators');
      }
    }
    for (const call of this.calls.values()) {
      const state = this.callStateOf(call, now);
      if (state !== call.lastState) {
        call.lastState = state;
        call.stateSince = now;
        this.changed.add('calls');
      }
    }
  }

  /** Presence precedence: talking > ringing > offline > paused > idle (one model, B54). */
  presenceOf(
    op: OperatorRec,
    now: number,
  ): { presence: OperatorPresence; channel: ChannelRec | null; call: CallRec | null } {
    let talking: { ch: ChannelRec; call: CallRec } | null = null;
    let ringing: { ch: ChannelRec | null; call: CallRec } | null = null;
    for (const ch of this.channels.values()) {
      if (ch.kind !== 'operator' || ch.ext !== op.ext) continue;
      const call = this.calls.get(ch.callId);
      if (!call) continue;
      const connected =
        ch.state === 'up' &&
        call.answeredAt !== null &&
        (call.talkingExt === op.ext ||
          call.direction === 'internal' ||
          (call.direction === 'outbound' && call.originExt === op.ext));
      if (connected) talking = { ch, call };
      else if (!ringing) ringing = { ch, call };
    }
    if (!talking && !ringing) {
      for (const call of this.calls.values()) {
        const since = call.ringing.get(op.ext);
        if (since !== undefined && now - since < STALE_RING_MS) {
          ringing = { ch: null, call };
          break;
        }
      }
    }
    if (talking) return { presence: 'talking', channel: talking.ch, call: talking.call };
    if (ringing) return { presence: 'ringing', channel: ringing.ch, call: ringing.call };
    if (op.registered !== true) return { presence: 'offline', channel: null, call: null };
    if (op.paused) return { presence: 'paused', channel: null, call: null };
    return { presence: 'idle', channel: null, call: null };
  }

  callStateOf(call: CallRec, now: number): 'ivr' | 'queued' | 'ringing' | 'dialing' | 'talking' {
    if (call.answeredAt !== null && call.talkingExt) return 'talking';
    if (call.direction === 'outbound') return 'dialing';
    const ringingNow = [...call.ringing.values()].some((t) => now - t < STALE_RING_MS);
    if (ringingNow) return 'ringing';
    if (call.inQueue) return 'queued';
    if (call.direction === 'internal') return call.answeredAt !== null ? 'talking' : 'ringing';
    return 'ivr';
  }

  // =============================================================================================
  // Helpers

  private destChannel(e: AmiEvent, now: number): ChannelRec | null {
    if (!e.destuniqueid) return null;
    const existing = this.channels.get(e.destuniqueid);
    if (existing) return existing;
    return this.addChannel(
      {
        channel: e.destchannel,
        uniqueid: e.destuniqueid,
        linkedid: e.destlinkedid || e.linkedid,
        channelstate: e.destchannelstate,
        channelstatedesc: e.destchannelstatedesc,
        calleridnum: e.destcalleridnum,
        calleridname: e.destcalleridname,
        exten: e.destexten,
      },
      now,
      { createdAt: now, partial: false },
    );
  }

  /** The call of an Agent or Queue event (caller channel fields: Uniqueid/Linkedid). */
  private callOfChannel(e: AmiEvent): CallRec | undefined {
    const ch = e.uniqueid ? this.channels.get(e.uniqueid) : undefined;
    return (ch && this.calls.get(ch.callId)) ?? (e.linkedid ? this.calls.get(e.linkedid) : undefined);
  }

  private touch(ch: ChannelRec): void {
    this.changed.add('calls');
    if (ch.kind === 'operator') this.changed.add('operators');
  }

  private base(call: CallRec, now: number) {
    return {
      callId: call.id,
      direction: call.direction,
      phone: call.phone,
      at: DateTime.fromMillis(now, { zone: this.config.timezone }).toISO() ?? new Date(now).toISOString(),
    };
  }

  private emit<E extends LiveDomainEvent>(name: E['name'], payload: E['payload']): void {
    this.events.push({ name, payload } as LiveDomainEvent);
  }

  private dayOf(now: number): string {
    return DateTime.fromMillis(now, { zone: this.config.timezone }).toISODate() ?? '';
  }

  private emptyCounters(now: number): CountersRec {
    return {
      date: this.dayOf(now),
      since: now,
      inbound: 0,
      answered: 0,
      abandoned: 0,
      ivrOnly: 0,
      unanswered: 0,
      outbound: 0,
      outboundAnswered: 0,
      operatorMissed: 0,
      talkSeconds: 0,
      clientHangups: 0,
      operatorHangups: 0,
      unknownHangups: 0,
    };
  }

  /** Tashkent midnight: reset our counters (Asterisk's own queue stats are left alone, B50). */
  private rollover(now: number): void {
    const day = this.dayOf(now);
    if (day === this.counters.date) return;
    // Live counting already runs, so the new day is counted live from its start; the old day's CDR seed goes.
    this.counters = this.emptyCounters(now);
    this.seed = null;
    for (const op of this.operators.values()) op.today = emptyToday();
    for (const [ext, exp] of this.expectedOriginates)
      if (now - exp.at > ORIGINATE_EXPECT_MS) this.expectedOriginates.delete(ext);
    for (const [name, at] of this.staffHangups) if (now - at > ORIGINATE_EXPECT_MS) this.staffHangups.delete(name);
    this.changed.add('counters');
    this.changed.add('operators');
  }
}

function toInt(v: string | undefined): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

function durationMs(v: string | undefined): number {
  if (!v) return 0;
  const parts = v.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

function renumber(q: QueueRec): void {
  const sorted = [...q.waiting.entries()].sort(
    (a, b) => a[1].position - b[1].position || a[1].joinedAt - b[1].joinedAt,
  );
  sorted.forEach(([, w], i) => (w.position = i + 1));
}
