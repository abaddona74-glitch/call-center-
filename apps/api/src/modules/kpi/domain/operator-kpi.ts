import type { CallAnalysisStats, CallScope, KpiOperatorQuality, KpiOperatorRow, KpiOperatorTickets } from '@cc/shared';
import type { AssembledCall } from '../../../pbx/calls/call-assembler.js';
import type { PresenceTotals } from '../../operator-presence/domain/presence-summary.js';
import { inScope, operatorStats, type SurveyTotals } from '../../stats/domain/metrics.js';

/**
 * «KPI xodimlar» — operators (docs/rewrite/METRICS.md §10.2). Pure: no Nest, no DB.
 * Calls and ratings come from the statistics page's functions (`operatorStats`, `surveyByOperator`), quality from the
 * «Tahlil» aggregates, online time from the presence log; this file only joins them by extension.
 */

/** A ticket, as far as the operator figures need it (extensions are the snapshots stored on the ticket). */
export interface OperatorTicketFact {
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
  extension: string | null;
  startedAt: Date;
}

const emptyTickets = (): KpiOperatorTickets => ({ created: 0, callbacks: 0, closed: 0, closedLate: 0 });

/**
 * Tickets per extension for [from, to): created by the operator, callback calls made, tickets closed by the operator
 * after a confirmed callback (force-closes excluded) and, of those, closed after `callback_due_at`.
 */
export function ticketsByOperator(
  tickets: readonly OperatorTicketFact[],
  attempts: readonly CallbackAttemptFact[],
  period: readonly [Date, Date],
): Map<string, KpiOperatorTickets> {
  const [from, to] = [period[0].getTime(), period[1].getTime()];
  const inPeriod = (d: Date | null) => d !== null && d.getTime() >= from && d.getTime() < to;
  const out = new Map<string, KpiOperatorTickets>();
  const get = (ext: string) => {
    let t = out.get(ext);
    if (!t) {
      t = emptyTickets();
      out.set(ext, t);
    }
    return t;
  };
  for (const t of tickets) {
    if (t.creatorExtension && inPeriod(t.createdAt)) get(t.creatorExtension).created++;
    if (t.closedByExtension && inPeriod(t.closedAt) && t.callbackOutcome !== 'forced') {
      const row = get(t.closedByExtension);
      row.closed++;
      if (t.callbackDueAt && (t.closedAt as Date).getTime() > t.callbackDueAt.getTime()) row.closedLate++;
    }
  }
  for (const a of attempts) if (a.extension && inPeriod(a.startedAt)) get(a.extension).callbacks++;
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
 * Talk seconds per operator for the calls that started at or after `since` (in scope, not internal) — the same sum as
 * `operatorStats().talkSec`, limited to the time the presence log covers so the talk share compares like with like.
 */
export function talkSince(calls: readonly AssembledCall[], scope: CallScope, since: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of calls) {
    if (c.startEpochMs < since || !inScope(c, scope) || c.direction === 'internal') continue;
    for (const [ext, sec] of Object.entries(c.operatorTalk)) if (sec > 0) out.set(ext, (out.get(ext) ?? 0) + sec);
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
  /** Talk seconds since the presence log started (talkSince), for the talk share. */
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
      tickets: input.tickets.get(ext) ?? emptyTickets(),
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
