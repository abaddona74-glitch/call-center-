import type {
  CallAnalysisStats,
  CallScope,
  KpiOperatorCallMetric,
  KpiOperatorQuality,
  KpiOperatorRow,
  KpiOperatorTickets,
} from '@cc/shared';
import type { AssembledCall } from '../../../pbx/calls/call-assembler.js';
import type { SurveyRating } from '../../../pbx/calls/survey-rating.js';
import type { PresenceIntervalFact, PresenceTotals } from '../../operator-presence/domain/presence-summary.js';
import { inScope, operatorStats, type SurveyTotals } from '../../stats/domain/metrics.js';

/**
 * «KPI xodimlar» — operators (docs/rewrite/METRICS.md §11.2). Pure: no Nest, no DB.
 * Calls and ratings come from the statistics page's functions (`operatorStats`, `surveyByOperator`), quality from the
 * «Tahlil» aggregates, online time from the presence log; this file only joins them by extension.
 */

/** A ticket, as far as the operator figures need it (extensions are the snapshots stored on the ticket). */
export interface OperatorTicketFact {
  id: number;
  creatorExtension: string | null;
  createdAt: Date;
  closedByExtension: string | null;
  closedAt: Date | null;
  callbackDueAt: Date | null;
  /** `forced` = closed by the superuser without a confirmed call: not an operator's callback. */
  callbackOutcome: string | null;
}

/** A callback attempt (ticket_calls kind = callback). */
export interface CallbackAttemptFact {
  ticketId: number;
  extension: string | null;
  startedAt: Date;
}

/** The tickets behind one operator's ticket numbers. */
export interface OperatorTicketIds {
  created: Set<number>;
  /** Tickets called back (distinct); `callbackAttempts` counts the calls. */
  callbacks: Set<number>;
  callbackAttempts: number;
  closed: Set<number>;
  closedLate: Set<number>;
}

const emptyIds = (): OperatorTicketIds => ({
  created: new Set(),
  callbacks: new Set(),
  callbackAttempts: 0,
  closed: new Set(),
  closedLate: new Set(),
});

/**
 * Tickets per extension for [from, to): created by the operator, called back by the operator (distinct tickets, and
 * the attempts), closed by the operator after a confirmed callback (force-closes excluded) and, of those, closed after
 * `callback_due_at`.
 */
export function operatorTicketIds(
  tickets: readonly OperatorTicketFact[],
  attempts: readonly CallbackAttemptFact[],
  period: readonly [Date, Date],
): Map<string, OperatorTicketIds> {
  const [from, to] = [period[0].getTime(), period[1].getTime()];
  const inPeriod = (d: Date | null) => d !== null && d.getTime() >= from && d.getTime() < to;
  const out = new Map<string, OperatorTicketIds>();
  const get = (ext: string) => {
    let t = out.get(ext);
    if (!t) {
      t = emptyIds();
      out.set(ext, t);
    }
    return t;
  };
  for (const t of tickets) {
    if (t.creatorExtension && inPeriod(t.createdAt)) get(t.creatorExtension).created.add(t.id);
    if (t.closedByExtension && inPeriod(t.closedAt) && t.callbackOutcome !== 'forced') {
      const row = get(t.closedByExtension);
      row.closed.add(t.id);
      if (t.callbackDueAt && (t.closedAt as Date).getTime() > t.callbackDueAt.getTime()) row.closedLate.add(t.id);
    }
  }
  for (const a of attempts) {
    if (!a.extension || !inPeriod(a.startedAt)) continue;
    const row = get(a.extension);
    row.callbacks.add(a.ticketId);
    row.callbackAttempts++;
  }
  return out;
}

/** The ticket numbers of each operator (operatorTicketIds counted). */
export function ticketsByOperator(
  tickets: readonly OperatorTicketFact[],
  attempts: readonly CallbackAttemptFact[],
  period: readonly [Date, Date],
): Map<string, KpiOperatorTickets> {
  return new Map(
    [...operatorTicketIds(tickets, attempts, period)].map(([ext, ids]) => [
      ext,
      {
        created: ids.created.size,
        callbacks: ids.callbacks.size,
        callbackAttempts: ids.callbackAttempts,
        closed: ids.closed.size,
        closedLate: ids.closedLate.size,
      },
    ]),
  );
}

/**
 * The calls behind one operator's call number — the same conditions `operatorStats` counts with (in scope, internal
 * calls never): `answered` = inbound answered calls the operator finished (transfers in included), `missed*` = their
 * `missedBy` entries, `outbound*` = outbound calls they placed, `talked` = calls they talked on.
 */
export function matchesOperatorCall(
  c: AssembledCall,
  ext: string,
  metric: Exclude<KpiOperatorCallMetric, 'rated' | 'analysed' | 'flagged' | 'handled'>,
  scope: CallScope,
): boolean {
  if (!inScope(c, scope) || c.direction === 'internal') return false;
  switch (metric) {
    case 'answered':
      return c.direction === 'inbound' && c.status === 'answered' && c.finalOperator === ext;
    case 'missed':
    case 'missedNoAnswer':
    case 'missedRejected': {
      if (c.direction !== 'inbound') return false;
      const m = c.missedBy.find((x) => x.ext === ext);
      if (!m) return false;
      if (metric === 'missed') return true;
      return metric === 'missedRejected' ? m.reason === 'rejected' : m.reason !== 'rejected';
    }
    case 'outbound':
      return c.direction === 'outbound' && c.firstOperator === ext && c.status === 'answered';
    case 'outboundAttempts':
      return c.direction === 'outbound' && c.firstOperator === ext;
    case 'talked':
      return (c.operatorTalk[ext] ?? 0) > 0;
  }
}

/**
 * Ids of the calls whose client rating is credited to `ext` — the attribution of `surveyByOperator` (the operator who
 * talked last; one rating per inbound in-scope call; scores 1–5 only).
 */
export function ratedCallIds(
  ratings: readonly SurveyRating[],
  allCalls: readonly AssembledCall[],
  scope: CallScope,
  ext: string,
): Set<string> {
  const byId = new Map<string, AssembledCall>();
  for (const c of allCalls) if (c.direction === 'inbound' && inScope(c, scope)) byId.set(c.id, c);
  const rated = new Set<string>();
  const out = new Set<string>();
  for (const r of ratings) {
    if (!Number.isInteger(r.score) || r.score < 1 || r.score > 5) continue;
    const call = byId.get(r.linkedid) ?? byId.get(r.uniqueid);
    if (!call || rated.has(call.id)) continue;
    const transferred = call.transfers.some((t) => t.answered);
    const who = transferred ? call.finalOperator : r.operatorExt || call.finalOperator;
    if (!who) continue;
    rated.add(call.id);
    if (who === ext) out.add(call.id);
  }
  return out;
}

/** The «Tahlil» page's per-operator aggregates → the KPI quality block (current prompt version only). */
export function qualityByOperator(operators: CallAnalysisStats['operators']): Map<string, KpiOperatorQuality> {
  return new Map(
    operators.map((o) => [
      o.ext,
      {
        analysed: o.analyzed,
        avgOverall: o.avgOverall,
        avgScores: {
          politeness: o.avgScores.politeness,
          understanding: o.avgScores.understanding,
          solution: o.avgScores.solution,
          closing: o.avgScores.closing,
        },
        redFlagCalls: o.redFlagCalls,
        handledRate: o.analyzed ? o.resolvedRate : null,
      },
    ]),
  );
}

/**
 * Talk seconds per operator for the calls (in scope, not internal) that started while that operator was online or
 * paused in the presence log — the same sum as `operatorStats().talkSec`, limited to the time the log saw the operator,
 * so the talk share compares like with like (no talk from before the log started or from unknown time).
 */
export function talkWhileOnline(
  calls: readonly AssembledCall[],
  scope: CallScope,
  intervals: readonly PresenceIntervalFact[],
  now: number,
): Map<string, number> {
  const online = new Map<string, Array<[number, number]>>();
  for (const it of intervals) {
    if (it.state === 'offline') continue;
    const list = online.get(it.extension) ?? [];
    list.push([it.startedAt.getTime(), it.endedAt?.getTime() ?? now]);
    online.set(it.extension, list);
  }
  const out = new Map<string, number>();
  for (const c of calls) {
    if (!inScope(c, scope) || c.direction === 'internal') continue;
    for (const [ext, sec] of Object.entries(c.operatorTalk)) {
      if (sec <= 0) continue;
      if (!online.get(ext)?.some(([a, b]) => c.startEpochMs >= a && c.startEpochMs < b)) continue;
      out.set(ext, (out.get(ext) ?? 0) + sec);
    }
  }
  return out;
}

const pct1 = (part: number, whole: number) => Math.min(100, Math.round((part / whole) * 1000) / 10);

export interface OperatorKpiInput {
  /** null: the PBX database is unavailable. */
  calls: readonly AssembledCall[] | null;
  scope: CallScope;
  names: ReadonlyMap<string, string>;
  groupOf: (ext: string) => string | null;
  excluded: ReadonlySet<string>;
  /** surveyByOperator(); undefined without the survey table or the PBX. */
  survey?: ReadonlyMap<string, SurveyTotals>;
  tickets: ReadonlyMap<string, KpiOperatorTickets>;
  quality: ReadonlyMap<string, KpiOperatorQuality>;
  presence: ReadonlyMap<string, PresenceTotals>;
  /** Talk seconds while the operator was online in the presence log (talkWhileOnline), for the talk share. */
  talkForShare: ReadonlyMap<string, number>;
}

/**
 * One row per operator: the PBX directory, plus everyone with calls, tickets, analysed calls or online time in the
 * period; excluded operators (settings) get no row, like «Statistika». Sorted by extension.
 */
export function buildOperatorKpi(input: OperatorKpiInput): KpiOperatorRow[] {
  const known = new Set<string>([
    ...input.names.keys(),
    ...input.tickets.keys(),
    ...input.quality.keys(),
    ...input.presence.keys(),
  ]);
  const stats = operatorStats(input.calls ?? [], {
    scope: input.scope,
    names: input.names,
    groupOf: input.groupOf,
    knownExtensions: known,
    excluded: input.excluded,
    survey: input.survey,
  });
  return stats.map(({ ext, name, group, surveyCount, surveyAvg, ...calls }) => {
    const presence = input.presence.get(ext);
    const onlineSec = presence?.onlineSec ?? 0;
    const talk = input.talkForShare.get(ext) ?? 0;
    return {
      ext,
      name,
      group,
      calls: input.calls ? calls : null,
      survey: { count: surveyCount, avg: surveyAvg },
      tickets: input.tickets.get(ext) ?? { created: 0, callbacks: 0, callbackAttempts: 0, closed: 0, closedLate: 0 },
      quality: input.quality.get(ext) ?? null,
      presence: {
        onlineSec,
        pauseSec: presence?.pauseSec ?? 0,
        pauses: presence?.pauses ?? [],
        talkShare: input.calls && onlineSec > 0 ? pct1(talk, onlineSec) : null,
      },
    };
  });
}
