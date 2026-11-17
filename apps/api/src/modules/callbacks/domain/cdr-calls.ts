import { type OutboundFailureCause, normalizeUzPhone } from '@cc/shared';
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
}

const EXT = /^[0-9]{2,6}$/;
const CHANNEL_EXT = /^(?:SIP|PJSIP|IAX2)\/([0-9]{2,6})-/i;
const LOCAL_EXT = /^Local\/([0-9]{2,6})@/i;
/** Contexts where `dst` is the dialed extension (as opposed to a queue or IVR number). */
const EXTENSION_DIAL_CONTEXTS = new Set(['from-internal-xfer', 'ext-local', 'from-did-direct']);

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
        operatorRang: operatorLegs.length > 0,
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
