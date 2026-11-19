import { type MissReason, digitsOnly, normalizeUzPhone } from '@cc/shared';
import type { CdrRow } from './cdr-row.js';

/**
 * The PBX dialplan conventions needed to interpret CDR rows (docs/rewrite/legacy/data.md §3.2–3.3).
 * Values come from configuration (PBX_* env vars); DEFAULT_DIALPLAN mirrors the production Issabel PBX.
 */
export interface PbxDialplan {
  /** SIP trunk peers: inbound calls arrive on `SIP/<peer>-…`. */
  trunkPeers: string[];
  /** DID / queue numbers that are never a client phone. */
  serviceNumbers: string[];
  /** dcontext values of an external inbound call. */
  inboundContexts: string[];
  /** dcontext values meaning "the caller is in a queue". */
  queueContexts: string[];
  /** Calls dialled by extensions (outbound and internal). */
  internalContext: string;
  /** Legs created by call transfers. */
  transferContext: string;
  /** Queue member dial context: members are `Local/<ext>@<context>/n`. */
  queueMemberContext: string;
  /** `lastdata` fragments of the "outside working hours" announcement. */
  offHoursMarkers: string[];
  /** Operator extension, e.g. /^[0-9]{2,4}$/. */
  extensionPattern: RegExp;
  /** One-digit outside-line prefixes operators may dial before a 9-digit number ("0", "9"). */
  dialPrefixes: string[];
}

export const DEFAULT_DIALPLAN: PbxDialplan = {
  trunkPeers: ['712020159'],
  serviceNumbers: ['2020159', '712020159'],
  inboundContexts: ['ext-queues', 'from-trunk', 'ivr-4'],
  queueContexts: ['ext-queues'],
  internalContext: 'from-internal',
  transferContext: 'from-internal-xfer',
  queueMemberContext: 'from-queue',
  offHoursMarkers: ['working-time', 'music-working-time'],
  extensionPattern: /^[0-9]{2,4}$/,
  dialPrefixes: ['0', '9'],
};

// ---------------------------------------------------------------------------
// Channel parsing
// ---------------------------------------------------------------------------

const SIP_CHANNEL_RE = /^(?:SIP|PJSIP|IAX2)\/([^-/@;]+)-[0-9a-fA-F]+/;
const LOCAL_CHANNEL_RE = /^Local\/([^@/;]+)@([^-/;]+(?:-[a-z][^-/;]*)*)/;

/** `SIP/101-0000abcd` → `101` (also PJSIP/IAX2). Null for anything else. Legacy E_EXT_FROM_SIP_CHANNEL. */
export function extFromSipChannel(channel: string | null | undefined): string | null {
  const m = SIP_CHANNEL_RE.exec(channel ?? '');
  return m ? m[1] : null;
}

/** `Local/101@from-queue-0000abcd;2` → `{ ext: '101', context: 'from-queue' }`. Legacy E_EXT_FROM_LOCAL. */
export function parseLocalChannel(channel: string | null | undefined): { ext: string; context: string } | null {
  const m = LOCAL_CHANNEL_RE.exec(channel ?? '');
  if (!m) return null;
  // the context is followed by "-<hex>;n" on Asterisk 11+, strip a trailing hex id if the regex kept it
  return { ext: m[1], context: m[2].replace(/-[0-9a-f]+$/i, '') };
}

export function extFromLocalChannel(channel: string | null | undefined): string | null {
  return parseLocalChannel(channel)?.ext ?? null;
}

export function isLocalChannel(channel: string | null | undefined): boolean {
  return (channel ?? '').startsWith('Local/');
}

export function isTrunkChannel(channel: string | null | undefined, dp: PbxDialplan): boolean {
  const peer = extFromSipChannel(channel);
  return peer !== null && dp.trunkPeers.includes(peer);
}

export function isExtension(value: string | null | undefined, dp: PbxDialplan): boolean {
  return dp.extensionPattern.test(value ?? '');
}

/** Operator extension of a SIP channel (`SIP/101-…`), excluding trunks. */
export function operatorExtOfSipChannel(channel: string | null | undefined, dp: PbxDialplan): string | null {
  const ext = extFromSipChannel(channel);
  return ext !== null && !dp.trunkPeers.includes(ext) && isExtension(ext, dp) ? ext : null;
}

/** Operator extension of a SIP or Local channel. */
export function operatorExtOfChannel(channel: string | null | undefined, dp: PbxDialplan): string | null {
  const sip = operatorExtOfSipChannel(channel, dp);
  if (sip) return sip;
  const local = extFromLocalChannel(channel);
  return local !== null && isExtension(local, dp) ? local : null;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The DID / queue number, the trunk peer, or anything containing them. */
export function isServiceNumber(value: string | null | undefined, dp: PbxDialplan): boolean {
  const d = digitsOnly(value);
  return d.length > 0 && dp.serviceNumbers.some((s) => d.endsWith(s));
}

/** Legacy "internal number": 1–4 digits (operator-to-operator calls are not external inbound). */
export function isInternalNumber(value: string | null | undefined): boolean {
  return /^[0-9]{1,4}$/.test(value ?? '');
}

/**
 * Client phone as one canonical form (normalizeUzPhone), or null for hidden / internal / service numbers.
 * Strips a one-digit outside-line prefix ("0901234567" → "901234567").
 */
export function normalizeClientNumber(raw: string | null | undefined, dp: PbxDialplan): string | null {
  let d = digitsOnly(raw);
  if (d.length === 10 && dp.dialPrefixes.includes(d[0]) && d[0] !== '8') d = d.slice(1);
  if (d.length < 7) return null;
  if (isServiceNumber(d, dp)) return null;
  return normalizeUzPhone(d);
}

/** Every stored form of a normalized number, for an indexed `src IN (…) OR dst IN (…)` lookup. */
export function storedNumberVariants(normalized: string, dp: PbxDialplan): string[] {
  const set = new Set([normalized]);
  if (normalized.length === 9) {
    set.add(`998${normalized}`);
    set.add(`+998${normalized}`);
    set.add(`8${normalized}`);
    for (const p of dp.dialPrefixes) set.add(`${p}${normalized}`);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Row predicates (legacy P_* building blocks, data.md §3.3)
// ---------------------------------------------------------------------------

/** P_ANSWERED: answered with talk time. `disposition` alone is not trusted (the IVR answers inbound legs). */
export function isAnsweredRow(row: CdrRow): boolean {
  return row.disposition === 'ANSWERED' && row.billsec > 0;
}

/** P_INBOUND: a row of an external inbound call. */
export function isInboundRow(row: CdrRow, dp: PbxDialplan): boolean {
  return (
    (dp.inboundContexts.includes(row.dcontext) || isTrunkChannel(row.channel, dp)) &&
    !isLocalChannel(row.channel) &&
    row.dcontext !== dp.internalContext &&
    !isInternalNumber(row.src)
  );
}

/** The caller is in a queue. */
export function isQueueRow(row: CdrRow, dp: PbxDialplan): boolean {
  return dp.queueContexts.includes(row.dcontext) && !isLocalChannel(row.channel);
}

/** P_OUTBOUND: an operator dialled an external number. */
export function isOutboundRow(row: CdrRow, dp: PbxDialplan): boolean {
  return (
    row.dcontext === dp.internalContext &&
    operatorExtOfSipChannel(row.channel, dp) !== null &&
    digitsOnly(row.dst).length >= 7 &&
    !isServiceNumber(row.dst, dp)
  );
}

/** An operator called another extension. */
export function isInternalCallRow(row: CdrRow, dp: PbxDialplan): boolean {
  return (
    row.dcontext === dp.internalContext && operatorExtOfSipChannel(row.channel, dp) !== null && isExtension(row.dst, dp)
  );
}

/** P_XFER (without the answered part): a transfer leg to an extension. */
export function isTransferRow(row: CdrRow, dp: PbxDialplan): boolean {
  return row.dcontext === dp.transferContext && isExtension(row.dst, dp);
}

/**
 * A BUSY ring shorter than this is "busy at once": the phone was already on a call and did not ring, so it is no
 * miss. CDR `duration` is whole seconds rounded down (Asterisk 13: (end − start) ms / 1000), so `duration >= 1` means
 * the ring lasted ≥ 1 000 ms — the live AMI side uses the same 1 000 ms.
 */
export const REJECT_MIN_RING_SEC = 1;

/**
 * How one unanswered ring towards an operator ended (an operator leg: queue member or phone):
 *  - `NO ANSWER` → no_answer (ring timeout, the caller left, the queue moved on; Asterisk writes it for the dial
 *    statuses NOANSWER and CANCEL);
 *  - `BUSY` after ringing ≥ REJECT_MIN_RING_SEC → rejected (the operator declined);
 *  - anything else → null: CONGESTION / FAILED (phone offline), BUSY at once (already on a call), ANSWERED.
 */
export function missReasonOfRow(row: Pick<CdrRow, 'disposition' | 'duration'>): MissReason | null {
  const disposition = row.disposition.toUpperCase();
  if (disposition === 'NO ANSWER') return 'no_answer';
  if (disposition === 'BUSY' && row.duration >= REJECT_MIN_RING_SEC) return 'rejected';
  return null;
}

/** One operator, several rings on one call: counted once, `rejected` over `no_answer`. */
export function worseMiss(a: MissReason | null, b: MissReason | null): MissReason | null {
  return a === 'rejected' || b === 'rejected' ? 'rejected' : (a ?? b);
}

/** The IVR played the "outside working hours" announcement. */
export function isOffHoursAnnouncementRow(row: CdrRow, dp: PbxDialplan): boolean {
  const data = (row.lastdata ?? '').toLowerCase();
  return dp.offHoursMarkers.some((m) => data.includes(m.toLowerCase()));
}

export type OperatorLegKind = 'phone' | 'member';

export interface OperatorLeg {
  ext: string;
  /**
   * `phone`: the operator's own phone is the B-party (`dstchannel SIP/<ext>-…`) — exact talk time of that operator.
   * `member`: the caller's leg towards a queue member (`dstchannel Local/<ext>@from-queue…`) — used only when the
   * PBX did not write the member's own leg.
   */
  kind: OperatorLegKind;
  answered: boolean;
  billsec: number;
  transfer: boolean;
}

/** Which operator (if any) this row connects the call to. Legacy P_OP_ANSWERED without the answered part. */
export function operatorLegOf(row: CdrRow, dp: PbxDialplan): OperatorLeg | null {
  if (row.dcontext === dp.internalContext) return null; // dialled by an operator: outbound/internal, not a leg
  const transfer = isTransferRow(row, dp);
  const answered = isAnsweredRow(row);
  const phoneExt = operatorExtOfSipChannel(row.dstchannel, dp);
  if (phoneExt) return { ext: phoneExt, kind: 'phone', answered, billsec: row.billsec, transfer };
  const local = parseLocalChannel(row.dstchannel);
  if (local && local.context === dp.queueMemberContext && isExtension(local.ext, dp)) {
    return { ext: local.ext, kind: 'member', answered, billsec: row.billsec, transfer };
  }
  return null;
}
