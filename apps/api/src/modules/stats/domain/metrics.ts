/**
 * Historical call-center metrics. One definition per number; docs/rewrite/METRICS.md explains each one.
 * Input: calls assembled from CDR (pbx/calls/call-assembler.ts). Pure functions — no Nest, no DB.
 */
import type { CallScope, DailyPoint, HourlyPoint, OperatorStatsRow, StatsSummary, TopClientRow } from '@cc/shared';
import type { AssembledCall } from '../../../pbx/calls/call-assembler.js';
import type { SurveyRating } from '../../../pbx/calls/survey-rating.js';

/** Percent with one decimal; 0 when there is nothing to divide by. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function avg(values: number[]): number {
  return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
}

/** scope "working": only calls that started inside the working calendar. */
export function inScope(call: AssembledCall, scope: CallScope): boolean {
  return scope === 'all' || call.inWorkingHours;
}

export function isConnectedOutbound(c: AssembledCall): boolean {
  return c.direction === 'outbound' && c.status === 'answered';
}

function distinct(values: (string | null)[]): number {
  return new Set(values.filter((v): v is string => Boolean(v))).size;
}

/** Answered transfer hops of a call. */
function answeredHops(c: AssembledCall) {
  return c.transfers.filter((t) => t.answered);
}

/**
 * Distinct numbers that called (inbound, not answered) and were never reached afterwards in `allCalls`
 * (no later answered inbound call and no later connected outbound call to that number).
 */
export function lostClients(scoped: readonly AssembledCall[], allCalls: readonly AssembledCall[]): number {
  const lastMiss = new Map<string, number>();
  for (const c of scoped) {
    if (c.direction !== 'inbound' || c.status === 'answered' || !c.clientNumber) continue;
    lastMiss.set(c.clientNumber, Math.max(lastMiss.get(c.clientNumber) ?? 0, c.startEpochMs));
  }
  const lastReach = new Map<string, number>();
  for (const c of allCalls) {
    if (!c.clientNumber || c.status !== 'answered' || c.direction === 'internal') continue;
    lastReach.set(c.clientNumber, Math.max(lastReach.get(c.clientNumber) ?? 0, c.startEpochMs));
  }
  let lost = 0;
  for (const [number, missAt] of lastMiss) if ((lastReach.get(number) ?? 0) < missAt) lost++;
  return lost;
}

export function summarize(
  allCalls: readonly AssembledCall[],
  range: { from: string; to: string; scope: CallScope },
): StatsSummary {
  const calls = allCalls.filter((c) => inScope(c, range.scope));
  const inbound = calls.filter((c) => c.direction === 'inbound');
  const answered = inbound.filter((c) => c.status === 'answered');
  const abandoned = inbound.filter((c) => c.status === 'abandoned');
  const outbound = calls.filter((c) => c.direction === 'outbound');
  const connected = outbound.filter((c) => c.status === 'answered');
  const talked = [...answered, ...connected];
  const talkTotal = talked.reduce((s, c) => s + c.talkSec, 0);
  const answeredWaits = answered.map((c) => c.waitSec ?? 0);

  return {
    range,
    totalCalls: inbound.length + connected.length,
    inbound: {
      offered: inbound.length,
      answered: answered.length,
      abandoned: abandoned.length,
      ivr: inbound.filter((c) => c.status === 'ivr').length,
      afterHours: inbound.filter((c) => c.status === 'after_hours').length,
      answerRate: percent(answered.length, inbound.length),
      abandonRate: percent(abandoned.length, inbound.length),
      avgWaitSec: avg(answeredWaits),
      maxWaitSec: answeredWaits.length ? Math.max(...answeredWaits) : 0,
      avgAbandonWaitSec: avg(abandoned.map((c) => c.waitSec ?? 0)),
      clients: distinct(inbound.map((c) => c.clientNumber)),
      answeredClients: distinct(answered.map((c) => c.clientNumber)),
      lostClients: lostClients(calls, allCalls),
      hiddenNumbers: inbound.filter((c) => c.hiddenNumber).length,
    },
    outbound: {
      attempts: outbound.length,
      connected: connected.length,
      notConnected: outbound.length - connected.length,
      connectRate: percent(connected.length, outbound.length),
      clients: distinct(connected.map((c) => c.clientNumber)),
    },
    internal: { calls: calls.filter((c) => c.direction === 'internal').length },
    transfers: inbound.reduce((s, c) => s + answeredHops(c).length, 0),
    talk: { totalSec: talkTotal, avgSec: talked.length ? Math.round(talkTotal / talked.length) : 0 },
    clients: distinct([...inbound.map((c) => c.clientNumber), ...connected.map((c) => c.clientNumber)]),
  };
}

export interface SurveyTotals {
  count: number;
  sum: number;
}

/**
 * Post-call survey ratings per operator. A rating counts only for a call in `allCalls` that is in scope
 * (matched by linkedid, else uniqueid), at most once per call; ratings of calls outside the range/scope and
 * scores other than 1–5 are ignored. The operator is the one the PBX recorded, else the call's final operator.
 */
export function surveyByOperator(
  ratings: readonly SurveyRating[],
  allCalls: readonly AssembledCall[],
  scope: CallScope,
): Map<string, SurveyTotals> {
  const byId = new Map<string, AssembledCall>();
  for (const c of allCalls) if (inScope(c, scope)) byId.set(c.id, c);
  const rated = new Set<string>();
  const out = new Map<string, SurveyTotals>();
  for (const r of ratings) {
    if (!Number.isInteger(r.score) || r.score < 1 || r.score > 5) continue;
    const call = byId.get(r.linkedid) ?? byId.get(r.uniqueid);
    if (!call || rated.has(call.id)) continue;
    const ext = r.operatorExt || call.finalOperator;
    if (!ext) continue;
    rated.add(call.id);
    const t = out.get(ext) ?? { count: 0, sum: 0 };
    t.count++;
    t.sum += r.score;
    out.set(ext, t);
  }
  return out;
}

interface OperatorAcc {
  answered: number;
  transferredIn: number;
  transferredOut: number;
  outbound: number;
  outboundAttempts: number;
  missed: number;
  talkSec: number;
  talkedCalls: number;
}

/**
 * Per-operator table. Each answered inbound call is credited to exactly one operator — the one who finished it —
 * as `answered` (no transfer) or `transferredIn` (end of a transfer chain), so Σ(answered + transferredIn)
 * equals the summary's inbound.answered. Internal calls are not counted.
 */
export function operatorStats(
  allCalls: readonly AssembledCall[],
  opts: {
    scope: CallScope;
    names: ReadonlyMap<string, string>;
    groupOf: (ext: string) => string | null;
    /** Extensions to list even without calls (the operator directory). */
    knownExtensions?: Iterable<string>;
    group?: string;
    /** surveyByOperator() result; absent when the PBX has no survey. */
    survey?: ReadonlyMap<string, SurveyTotals>;
  },
): OperatorStatsRow[] {
  const acc = new Map<string, OperatorAcc>();
  const get = (ext: string) => {
    let a = acc.get(ext);
    if (!a) {
      a = {
        answered: 0,
        transferredIn: 0,
        transferredOut: 0,
        outbound: 0,
        outboundAttempts: 0,
        missed: 0,
        talkSec: 0,
        talkedCalls: 0,
      };
      acc.set(ext, a);
    }
    return a;
  };
  for (const ext of opts.knownExtensions ?? []) get(ext);
  for (const ext of opts.survey?.keys() ?? []) get(ext);

  for (const c of allCalls) {
    if (!inScope(c, opts.scope) || c.direction === 'internal') continue;
    if (c.direction === 'inbound') {
      if (c.status === 'answered' && c.finalOperator) {
        const hops = answeredHops(c);
        if (hops.length > 0) get(c.finalOperator).transferredIn++;
        else get(c.finalOperator).answered++;
        for (const hop of hops) if (hop.from) get(hop.from).transferredOut++;
      }
      for (const ext of c.missedBy) get(ext).missed++;
    } else if (c.firstOperator) {
      const a = get(c.firstOperator);
      a.outboundAttempts++;
      if (c.status === 'answered') a.outbound++;
    }
    for (const [ext, sec] of Object.entries(c.operatorTalk)) {
      if (sec <= 0) continue;
      const a = get(ext);
      a.talkSec += sec;
      a.talkedCalls++;
    }
  }

  return [...acc.entries()]
    .map(([ext, a]) => {
      const total = a.answered + a.transferredIn + a.outbound;
      const s = opts.survey?.get(ext);
      return {
        ext,
        name: opts.names.get(ext) ?? null,
        group: opts.groupOf(ext),
        answered: a.answered,
        transferredIn: a.transferredIn,
        transferredOut: a.transferredOut,
        outbound: a.outbound,
        outboundAttempts: a.outboundAttempts,
        missed: a.missed,
        total,
        talkSec: a.talkSec,
        avgTalkSec: a.talkedCalls ? Math.round(a.talkSec / a.talkedCalls) : 0,
        surveyCount: s?.count ?? 0,
        surveyAvg: s?.count ? Math.round((s.sum / s.count) * 100) / 100 : null,
      };
    })
    .filter((r) => !opts.group || opts.group === 'all' || r.group === opts.group)
    .sort((x, y) => Number(x.ext) - Number(y.ext) || x.ext.localeCompare(y.ext));
}

/** Calls per hour of day (by start time). `hours` = the buckets to show (working hours for scope "working"). */
export function hourlySeries(
  allCalls: readonly AssembledCall[],
  scope: CallScope,
  hours: readonly number[],
): HourlyPoint[] {
  const points = new Map<number, HourlyPoint>(
    hours.map((h) => [h, { hour: h, inbound: 0, answered: 0, abandoned: 0, outbound: 0 }]),
  );
  for (const c of allCalls) {
    if (!inScope(c, scope)) continue;
    const p = points.get(c.hour);
    if (!p) continue;
    if (c.direction === 'inbound') {
      p.inbound++;
      if (c.status === 'answered') p.answered++;
      if (c.status === 'abandoned') p.abandoned++;
    } else if (isConnectedOutbound(c)) p.outbound++;
  }
  return [...points.values()];
}

/** One point per calendar date of the range. */
export function dailySeries(
  allCalls: readonly AssembledCall[],
  scope: CallScope,
  dates: readonly string[],
  isWorkingDay: (date: string) => boolean,
): DailyPoint[] {
  const points = new Map<string, DailyPoint>(
    dates.map((d) => [
      d,
      { date: d, inbound: 0, answered: 0, abandoned: 0, outbound: 0, talkSec: 0, workingDay: isWorkingDay(d) },
    ]),
  );
  for (const c of allCalls) {
    if (!inScope(c, scope)) continue;
    const p = points.get(c.date);
    if (!p) continue;
    if (c.direction === 'inbound') {
      p.inbound++;
      if (c.status === 'answered') {
        p.answered++;
        p.talkSec += c.talkSec;
      }
      if (c.status === 'abandoned') p.abandoned++;
    } else if (isConnectedOutbound(c)) {
      p.outbound++;
      p.talkSec += c.talkSec;
    }
  }
  return [...points.values()];
}

/** Most active client numbers: by inbound calls, then by all contacts, then by talk time. */
export function topClients(
  allCalls: readonly AssembledCall[],
  scope: CallScope,
  limit: number,
  toIso: (wall: string) => string,
): TopClientRow[] {
  const acc = new Map<string, TopClientRow & { lastMs: number }>();
  for (const c of allCalls) {
    if (!inScope(c, scope) || c.direction === 'internal' || !c.clientNumber) continue;
    let r = acc.get(c.clientNumber);
    if (!r) {
      r = {
        number: c.clientNumber,
        inbound: 0,
        answered: 0,
        missed: 0,
        outbound: 0,
        talkSec: 0,
        lastCallAt: '',
        lastMs: 0,
      };
      acc.set(c.clientNumber, r);
    }
    if (c.direction === 'inbound') {
      r.inbound++;
      if (c.status === 'answered') r.answered++;
      else r.missed++;
    } else r.outbound++;
    r.talkSec += c.talkSec;
    if (c.startEpochMs >= r.lastMs) {
      r.lastMs = c.startEpochMs;
      r.lastCallAt = toIso(c.start);
    }
  }
  return [...acc.values()]
    .sort((a, b) => b.inbound - a.inbound || b.inbound + b.outbound - (a.inbound + a.outbound) || b.talkSec - a.talkSec)
    .slice(0, limit)
    .map(({ lastMs: _lastMs, ...row }) => row);
}
