import type { CallDirection, CallMiss, CallStatus } from '@cc/shared';
import { parseWall } from '../../common/time/business-time.js';
import type { WorkingCalendar } from '../../common/time/working-calendar.js';
import type { CdrRow } from './cdr-row.js';
import {
  isAnsweredRow,
  isInboundRow,
  isInternalCallRow,
  isOffHoursAnnouncementRow,
  isOutboundRow,
  isQueueRow,
  isTransferRow,
  missReasonOfRow,
  normalizeClientNumber,
  operatorExtOfChannel,
  operatorExtOfSipChannel,
  operatorLegOf,
  type OperatorLeg,
  type PbxDialplan,
  worseMiss,
} from './dialplan.js';

export interface TransferHop {
  from: string | null;
  to: string;
  /** Tashkent wall time of the transfer leg. */
  at: string;
  answered: boolean;
  talkSec: number;
}

/**
 * One call = every CDR row that shares a linkedid (uniqueid when linkedid is empty).
 * All facts below are decided here, once; metrics and the history only count/filter them.
 * See docs/rewrite/METRICS.md.
 */
export interface AssembledCall {
  id: string;
  /** Tashkent wall time of the first leg. */
  start: string;
  startEpochMs: number;
  date: string;
  time: string;
  hour: number;
  inWorkingHours: boolean;
  direction: CallDirection;
  status: CallStatus;
  /** normalizeUzPhone form; null for hidden/unknown. */
  clientNumber: string | null;
  clientNumberRaw: string | null;
  hiddenNumber: boolean;
  /** Inbound: first operator who answered. Outbound/internal: the extension that dialled. */
  firstOperator: string | null;
  /** Inbound: last operator who talked (end of the transfer chain). Outbound/internal: the dialler. */
  finalOperator: string | null;
  /** Operators who talked, in order (internal calls: caller then callee). */
  operators: string[];
  transfers: TransferHop[];
  /** Talk seconds per operator, from that operator's own legs. */
  operatorTalk: Record<string, number>;
  /**
   * Inbound: operators whose phone actually rang and who never talked on the call, once each, with why
   * (`missReasonOfRow`). Offline phones and phones busy at once are not here.
   */
  missedBy: CallMiss[];
  /** Σ operatorTalk (inbound) / billsec of the connected leg (outbound, internal). */
  talkSec: number;
  waitSec: number | null;
  durationSec: number;
  reachedQueue: boolean;
  recordingFile: string | null;
  legCount: number;
}

interface ParsedRow {
  row: CdrRow;
  startMs: number;
}

function callKey(row: CdrRow): string {
  return row.linkedid?.trim() || row.uniqueid;
}

/** Group CDR rows into calls, sorted by start time. Rows that belong to no recognizable call are skipped. */
export function assembleCalls(rows: readonly CdrRow[], dp: PbxDialplan, calendar: WorkingCalendar): AssembledCall[] {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const key = callKey(row);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push({ row, startMs: parseWall(row.calldate, calendar.timezone).epochMs });
  }
  const calls: AssembledCall[] = [];
  for (const [id, group] of groups) {
    group.sort((a, b) => a.startMs - b.startMs || a.row.uniqueid.localeCompare(b.row.uniqueid));
    const call = assembleCall(id, group, dp, calendar);
    if (call) calls.push(call);
  }
  return calls.sort((a, b) => a.startEpochMs - b.startEpochMs || a.id.localeCompare(b.id));
}

function endMs(p: ParsedRow): number {
  return p.startMs + Math.max(0, p.row.duration) * 1000;
}

/** The moment a leg was answered: start + ring time. */
function answeredAtMs(p: ParsedRow): number {
  return p.startMs + Math.max(0, p.row.duration - p.row.billsec) * 1000;
}

function assembleCall(
  id: string,
  group: ParsedRow[],
  dp: PbxDialplan,
  calendar: WorkingCalendar,
): AssembledCall | null {
  const first = group[0];
  const w = parseWall(first.row.calldate, calendar.timezone);
  const callEnd = Math.max(...group.map(endMs));
  const recordingFile =
    group.find((p) => isAnsweredRow(p.row) && p.row.recordingfile)?.row.recordingfile ??
    group.find((p) => p.row.recordingfile)?.row.recordingfile ??
    null;

  const base = {
    id,
    start: first.row.calldate,
    startEpochMs: first.startMs,
    date: w.date,
    time: w.time,
    hour: w.hour,
    inWorkingHours: calendar.isWorkingAt(w.date, w.secondOfDay),
    durationSec: Math.round((callEnd - first.startMs) / 1000),
    recordingFile: recordingFile || null,
    legCount: group.length,
  };

  const inboundRows = group.filter((p) => isInboundRow(p.row, dp));
  if (inboundRows.length > 0) return assembleInbound(base, group, inboundRows, dp);

  const outboundRows = group.filter((p) => isOutboundRow(p.row, dp));
  if (outboundRows.length > 0) return assembleDialled(base, outboundRows, 'outbound', dp);

  const internalRows = group.filter((p) => isInternalCallRow(p.row, dp));
  if (internalRows.length > 0) return assembleDialled(base, internalRows, 'internal', dp);

  return null; // feature codes, voicemail, system legs
}

type CallBase = Pick<
  AssembledCall,
  | 'id'
  | 'start'
  | 'startEpochMs'
  | 'date'
  | 'time'
  | 'hour'
  | 'inWorkingHours'
  | 'durationSec'
  | 'recordingFile'
  | 'legCount'
>;

function assembleInbound(base: CallBase, group: ParsedRow[], inboundRows: ParsedRow[], dp: PbxDialplan): AssembledCall {
  const callerRaw = inboundRows[0].row.src?.trim() || null;
  const clientNumber = normalizeClientNumber(callerRaw, dp);

  // --- operator legs (queue members, direct, transfers) ---
  const legs: { p: ParsedRow; leg: OperatorLeg }[] = [];
  for (const p of group) {
    const leg = operatorLegOf(p.row, dp);
    if (leg) legs.push({ p, leg });
  }

  // Talk per operator: the operator's own phone legs when the PBX wrote them, otherwise the caller-side member leg.
  const operatorTalk: Record<string, number> = {};
  const answeredAt = new Map<string, number>(); // first non-transfer answer per operator
  const byExt = new Map<string, { p: ParsedRow; leg: OperatorLeg }[]>();
  for (const l of legs) {
    let list = byExt.get(l.leg.ext);
    if (!list) byExt.set(l.leg.ext, (list = []));
    list.push(l);
  }
  for (const [ext, list] of byExt) {
    const phone = list.filter((l) => l.leg.kind === 'phone' && l.leg.answered);
    const member = list.filter((l) => l.leg.kind === 'member' && l.leg.answered);
    const answeredLegs = phone.length > 0 ? phone : member;
    if (answeredLegs.length === 0) continue;
    operatorTalk[ext] =
      phone.length > 0 ? phone.reduce((s, l) => s + l.leg.billsec, 0) : Math.max(...member.map((l) => l.leg.billsec));
    const direct = answeredLegs.filter((l) => !l.leg.transfer);
    if (direct.length > 0) answeredAt.set(ext, Math.min(...direct.map((l) => answeredAtMs(l.p))));
  }

  // First answerer: earliest non-transfer answer.
  const firstAnswer = [...answeredAt.entries()].sort((a, b) => a[1] - b[1])[0];
  const firstOperator = firstAnswer?.[0] ?? null;

  // Transfer chain, in time order. Hop i>0 starts at the operator who took the previous hop
  // (legacy credited every hop to the first transferor — B42).
  const transfers: TransferHop[] = [];
  for (const p of group) {
    if (!isTransferRow(p.row, dp)) continue;
    const prev = transfers.at(-1);
    const from = prev
      ? prev.answered
        ? prev.to
        : prev.from
      : (operatorExtOfChannel(p.row.channel, dp) ?? firstOperator);
    transfers.push({
      from,
      to: p.row.dst,
      at: p.row.calldate,
      answered: isAnsweredRow(p.row),
      talkSec: isAnsweredRow(p.row) ? p.row.billsec : 0,
    });
  }

  const operators: string[] = [];
  if (firstOperator) operators.push(firstOperator);
  for (const hop of transfers) if (hop.answered && operators.at(-1) !== hop.to) operators.push(hop.to);
  // Operators who talked but appear in neither (e.g. answered only through a transfer with no direct answer)
  for (const ext of Object.keys(operatorTalk)) if (!operators.includes(ext)) operators.push(ext);

  const answered = operators.length > 0;
  const finalOperator = operators.at(-1) ?? null;
  // Rang (queue member or transfer target) and never talked on this call.
  const missedBy: CallMiss[] = [];
  for (const [ext, list] of byExt) {
    if (ext in operatorTalk) continue;
    const reason = list.reduce<CallMiss['reason'] | null>((r, l) => worseMiss(r, missReasonOfRow(l.p.row)), null);
    if (reason) missedBy.push({ ext, reason });
  }

  const reachedQueue = group.some((p) => isQueueRow(p.row, dp));
  const offHoursAnnouncement = group.some((p) => isOffHoursAnnouncementRow(p.row, dp));

  let status: CallStatus;
  if (answered) status = 'answered';
  else if (offHoursAnnouncement || !base.inWorkingHours) status = 'after_hours';
  else if (reachedQueue) status = 'abandoned';
  else status = 'ivr';

  // Wait = queue entry → answer, or queue entry → hang-up for abandoned calls.
  const queueEntry = group.find((p) => isQueueRow(p.row, dp))?.startMs ?? base.startEpochMs;
  let waitSec: number | null = null;
  if (answered && firstAnswer) waitSec = Math.max(0, Math.round((firstAnswer[1] - queueEntry) / 1000));
  else if (status === 'abandoned') {
    waitSec = Math.max(0, Math.round((Math.max(...group.map(endMs)) - queueEntry) / 1000));
  }

  return {
    ...base,
    direction: 'inbound',
    status,
    clientNumber,
    clientNumberRaw: callerRaw,
    hiddenNumber: clientNumber === null,
    firstOperator,
    finalOperator,
    operators,
    transfers,
    operatorTalk,
    missedBy,
    talkSec: Object.values(operatorTalk).reduce((s, v) => s + v, 0),
    waitSec,
    reachedQueue,
  };
}

function dialledStatus(rows: ParsedRow[]): CallStatus {
  if (rows.some((p) => isAnsweredRow(p.row))) return 'answered';
  const last = rows.at(-1)!.row.disposition;
  if (last === 'BUSY') return 'busy';
  if (last === 'FAILED' || last === 'CONGESTION') return 'failed';
  return 'no_answer';
}

function assembleDialled(
  base: CallBase,
  rows: ParsedRow[],
  direction: 'outbound' | 'internal',
  dp: PbxDialplan,
): AssembledCall {
  const caller = operatorExtOfSipChannel(rows[0].row.channel, dp);
  const status = dialledStatus(rows);
  const talkSec = rows.filter((p) => isAnsweredRow(p.row)).reduce((s, p) => s + p.row.billsec, 0);
  const dstRaw = rows[0].row.dst?.trim() || null;
  const clientNumber = direction === 'outbound' ? normalizeClientNumber(dstRaw, dp) : null;
  const callee = direction === 'internal' ? dstRaw : null;
  const operators = [caller, status === 'answered' ? callee : null].filter((x): x is string => Boolean(x));
  const operatorTalk: Record<string, number> = {};
  if (caller && talkSec > 0) operatorTalk[caller] = talkSec;
  if (callee && talkSec > 0) operatorTalk[callee] = talkSec;

  return {
    ...base,
    direction,
    status,
    clientNumber,
    clientNumberRaw: direction === 'outbound' ? dstRaw : null,
    hiddenNumber: false,
    firstOperator: caller,
    finalOperator: caller,
    operators,
    transfers: [],
    operatorTalk,
    missedBy: [],
    talkSec,
    waitSec: null,
    reachedQueue: false,
  };
}
