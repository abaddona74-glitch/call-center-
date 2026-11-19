import { type OutboundFailureCause, normalizeUzPhone } from '@cc/shared';
import { missReasonOfRow } from '../../../pbx/calls/dialplan.js';
import { causeFromDisposition } from './callback-rules.js';
import { parseBusinessDateTime } from './working-calendar.js';

/**
 * Turns raw CDR legs into one fact per call (grouped by Asterisk linkedid, falling back to uniqueid),
 * so the reconciliation can replay calls missed while the API was down through the same rules as
 * the live AMI events. Pure: no database, no Nest.
 *
 * Definitions:
 *  - operator leg: the destination channel is an operator's (`Local/<ext>@…`, `SIP/<ext>-…`, `PJSIP/<ext>-…`),
 *    or `dst` is an extension in an extension-dialing context. In queue/IVR contexts `dst` is the queue
 *    or IVR number, never an operator; a trunk peer named with a phone number is never an operator either;
 *  - inbound call: started by an external number (not from `from-internal`);
 *  - answered inbound: some operator leg is ANSWERED with billsec > 0 (IVR/queue answers do not count, B18);
 *  - an operator rang: some operator leg actually rang the phone — answered, NO ANSWER, or BUSY after ≥ 1 s
 *    (`missReasonOfRow`); offline phones (CONGESTION) and phones busy at once are not a ring;
 *  - outbound call: an operator's own channel dialed an external number from `from-internal`.
 */

export interface CdrLeg {
  calldate: string;
  src: string;
  dst: string;
  dcontext: string;
  channel: string;
  dstchannel: string;
  lastdata: string;
  disposition: string;
  duration: number;
  billsec: number;
  uniqueid: string;
  linkedid: string;
}

export type CallFact =
  | {
      kind: 'missed';
      callId: string;
      phone: string;
      startedAt: Date;
      operatorRang: boolean;
      ivrAfterHours: boolean;
    }
  | {
      kind: 'conversation';
      callId: string;
      phone: string;
      direction: 'inbound' | 'outbound';
      extension: string | null;
      endedAt: Date;
      talkSeconds: number;
    }
  | {
      kind: 'outbound_failed';
      callId: string;
      phone: string;
      extension: string | null;
      at: Date;
      cause: OutboundFailureCause;
    };

export interface CdrCallsOptions {
  timezone: string;
  /** `lastdata` of the PBX "outside working hours" announcement. */
  afterHoursMarker?: RegExp;
  /**
   * Only calls whose first leg is at or after this moment. The caller reads some rows before it, so a call
   * that began earlier and is only partly in the read window is recognised and left out instead of being
   * judged by its tail (e.g. failed attempts after a transfer, without the answered leg → a false "missed").
   */
  startedFrom?: Date;
}

const EXT = /^[0-9]{2,6}$/;
const CHANNEL_EXT = /^(?:SIP|PJSIP|IAX2)\/([0-9]{2,6})-/i;
const LOCAL_EXT = /^Local\/([0-9]{2,6})@/i;
/** Same as the reader's SQL `channel LIKE 'Local/%'` (case-insensitive under MySQL's default collation). */
const LOCAL_CHANNEL = /^Local\//i;
/** Contexts where `dst` is the dialed extension (as opposed to a queue or IVR number). */
const EXTENSION_DIAL_CONTEXTS = new Set(['from-internal-xfer', 'ext-local', 'from-did-direct']);

/**
 * A queue member's own ring attempt that never reached a phone: the `Local/<ext>@from-queue-…` half dialing
 * `SIP/<ext>` from `from-internal` with no peer channel (BUSY/CONGESTION; ~half of all CDR rows in production).
 * When legs are keyed by uniqueid (no `cdr.linkedid`), such a row is its own group whose first leg is from
 * `from-internal` on a non-operator channel, so it never yields a fact, and `CdrLegsReader` filters these rows
 * in SQL. Rows with a peer channel are kept: an answered member leg can be bridged and transferred, and the
 * transfer adds a second row to the same Local channel that this row has to keep heading (see the spec).
 * With linkedid the member legs belong to the caller's call and are never filtered.
 */
export function isQueueMemberRingAttempt(leg: Pick<CdrLeg, 'channel' | 'dcontext' | 'dstchannel'>): boolean {
  return LOCAL_CHANNEL.test(leg.channel) && leg.dcontext === 'from-internal' && leg.dstchannel === '';
}

/** Operator extension a leg was sent to, or null. */
export function operatorOfLeg(leg: Pick<CdrLeg, 'dst' | 'dstchannel' | 'dcontext'>): string | null {
  const local = LOCAL_EXT.exec(leg.dstchannel);
  if (local) return local[1];
  const peer = CHANNEL_EXT.exec(leg.dstchannel);
  if (peer) return peer[1];
  return EXTENSION_DIAL_CONTEXTS.has(leg.dcontext) && EXT.test(leg.dst) ? leg.dst : null;
}

/** Operator extension whose own phone originated a leg, or null. */
export function originatorOfLeg(leg: Pick<CdrLeg, 'channel'>): string | null {
  return CHANNEL_EXT.exec(leg.channel)?.[1] ?? null;
}

/** The operator's phone actually rang on this leg (see `missReasonOfRow`). */
function rang(leg: CdrLeg): boolean {
  return leg.disposition.toUpperCase() === 'ANSWERED' || missReasonOfRow(leg) !== null;
}

function isAnswered(leg: CdrLeg): boolean {
  return leg.disposition.toUpperCase() === 'ANSWERED' && leg.billsec > 0;
}

function legEnd(leg: CdrLeg, timezone: string): Date | null {
  const start = parseBusinessDateTime(leg.calldate, timezone);
  return start ? new Date(start.getTime() + Math.max(0, leg.duration) * 1000) : null;
}

export function callFactsFromCdr(legs: readonly CdrLeg[], opts: CdrCallsOptions): CallFact[] {
  const marker = opts.afterHoursMarker ?? /working-time/i;
  const calls = new Map<string, CdrLeg[]>();
  for (const leg of legs) {
    const key = leg.linkedid || leg.uniqueid;
    if (!key) continue;
    const list = calls.get(key);
    if (list) list.push(leg);
    else calls.set(key, [leg]);
  }

  const facts: CallFact[] = [];
  for (const [callId, callLegs] of calls) {
    callLegs.sort((a, b) => a.calldate.localeCompare(b.calldate));
    const first = callLegs[0];
    const startedAt = parseBusinessDateTime(first.calldate, opts.timezone);
    if (!startedAt) continue;
    if (opts.startedFrom && startedAt < opts.startedFrom) continue; // only partly in the window
    const endedAt = callLegs.reduce<Date>((max, l) => {
      const end = legEnd(l, opts.timezone);
      return end && end > max ? end : max;
    }, startedAt);

    const originator = originatorOfLeg(first);
    const outbound = first.dcontext === 'from-internal' && originator !== null;

    if (outbound) {
      const phone = normalizeUzPhone(first.dst);
      if (!phone || EXT.test(first.dst)) continue; // internal call between operators
      const answered = callLegs.filter((l) => isAnswered(l) && normalizeUzPhone(l.dst) === phone);
      if (answered.length > 0) {
        const talkSeconds = Math.max(...answered.map((l) => l.billsec));
        facts.push({
          kind: 'conversation',
          callId,
          phone,
          direction: 'outbound',
          extension: originator,
          endedAt,
          talkSeconds,
        });
      } else {
        facts.push({
          kind: 'outbound_failed',
          callId,
          phone,
          extension: originator,
          at: startedAt,
          cause: causeFromDisposition(first.disposition),
        });
      }
      continue;
    }

    // Inbound: the caller must be an external number, not an operator calling from inside.
    if (first.dcontext === 'from-internal' || EXT.test(first.src)) continue;
    const phone = normalizeUzPhone(first.src);
    if (!phone) continue; // hidden / garbage caller id

    const operatorLegs = callLegs.filter((l) => operatorOfLeg(l) !== null);
    const answeredLegs = operatorLegs.filter(isAnswered);
    if (answeredLegs.length > 0) {
      const best = answeredLegs.reduce((a, b) => (b.billsec > a.billsec ? b : a));
      facts.push({
        kind: 'conversation',
        callId,
        phone,
        direction: 'inbound',
        extension: operatorOfLeg(best),
        endedAt,
        talkSeconds: best.billsec,
      });
    } else {
      facts.push({
        kind: 'missed',
        callId,
        phone,
        startedAt,
        operatorRang: operatorLegs.some(rang),
        ivrAfterHours: callLegs.some((l) => marker.test(l.lastdata)),
      });
    }
  }

  return facts.sort((a, b) => factTime(a).getTime() - factTime(b).getTime());
}

/** The moment a fact takes effect: start of a missed call / attempt, end of a conversation. */
export function factTime(f: CallFact): Date {
  switch (f.kind) {
    case 'missed':
      return f.startedAt;
    case 'conversation':
      return f.endedAt;
    case 'outbound_failed':
      return f.at;
  }
}
