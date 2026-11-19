import {
  CALL_OUTCOMES,
  type CallAnalysisStats,
  type CallOutcome,
  KPI_CRITERIA,
  LEGACY_KPI_CRITERIA,
  type KpiScores,
  type LocalizedText,
  RED_FLAGS,
  type RedFlagCode,
  type Sentiment,
} from '@cc/shared';

/** One analysed call as the aggregates need it. */
export interface AnalysisFacts {
  callId: string;
  /** ISO-8601. */
  startedAt: string;
  operatorExt: string | null;
  topic: LocalizedText;
  /** topicKey(topic) from @cc/shared: the grouping key. */
  topicKey: string;
  subtopic: LocalizedText;
  problem: LocalizedText;
  summary: LocalizedText;
  outcome: CallOutcome;
  scores: KpiScores;
  overall: number;
  redFlagCodes: RedFlagCode[];
  sentimentStart: Sentiment;
  sentimentEnd: Sentiment;
  /** A ticket really exists for the call (tickets.origin_call_id or ticket_calls.call_id). */
  hasTicket: boolean;
}

/** Outcomes where the client's request was handled in the call: solved, answered, or registered as a ticket. */
export const HANDLED_OUTCOMES: readonly CallOutcome[] = ['resolved', 'info_only', 'ticket_opened'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (values: number[]) => (values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null);

/** Averages per criterion over the rows that have the score (the greeting is scored only in v1–v3 rows). */
function avgScores(rows: readonly AnalysisFacts[]): CallAnalysisStats['totals']['avgScores'] {
  return Object.fromEntries(
    [...LEGACY_KPI_CRITERIA, ...KPI_CRITERIA].map((k) => [
      k,
      mean(rows.map((r) => r.scores[k]).filter((v): v is number => v !== null)),
    ]),
  ) as CallAnalysisStats['totals']['avgScores'];
}

/** The most frequent wording in a topic group. */
function labelOf(list: readonly AnalysisFacts[]): LocalizedText {
  const counts = new Map<string, { topic: LocalizedText; n: number }>();
  for (const r of list) {
    const key = `${r.topic.uz}\n${r.topic.ru}`;
    const c = counts.get(key) ?? { topic: r.topic, n: 0 };
    c.n++;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0].topic;
}

/**
 * Aggregates of the "Tahlil" page (definitions: docs/rewrite/METRICS.md §8), over rows of ONE prompt version (the
 * caller filters). Topics are free text grouped by their key; `topicFilter` (a key) narrows only the problems list (the
 * page filters it by clicking a topic); every other figure covers the whole period/operator selection.
 */
export function aggregateAnalyses(
  rows: readonly AnalysisFacts[],
  opts: {
    names: ReadonlyMap<string, string>;
    topicFilter?: string;
    problemsLimit?: number;
    flaggedLimit?: number;
  },
): Omit<CallAnalysisStats, 'range' | 'promptVersion' | 'versions'> {
  const flagged = rows.filter((r) => r.redFlagCodes.length > 0);
  const claimed = rows.filter((r) => r.outcome === 'ticket_opened');

  const byTopic = new Map<string, AnalysisFacts[]>();
  for (const r of rows) {
    const list = byTopic.get(r.topicKey) ?? [];
    list.push(r);
    byTopic.set(r.topicKey, list);
  }
  const topics = [...byTopic.entries()]
    .map(([key, list]) => ({
      key,
      ...labelOf(list),
      count: list.length,
      avgOverall: mean(list.map((r) => r.overall)),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const countSentiment = (pick: (r: AnalysisFacts) => Sentiment) => ({
    positive: rows.filter((r) => pick(r) === 'positive').length,
    neutral: rows.filter((r) => pick(r) === 'neutral').length,
    negative: rows.filter((r) => pick(r) === 'negative').length,
  });

  const byOperator = new Map<string, AnalysisFacts[]>();
  for (const r of rows) {
    if (!r.operatorExt) continue;
    const list = byOperator.get(r.operatorExt) ?? [];
    list.push(r);
    byOperator.set(r.operatorExt, list);
  }
  const operators = [...byOperator.entries()]
    .map(([ext, list]) => ({
      ext,
      name: opts.names.get(ext) ?? null,
      analyzed: list.length,
      avgOverall: mean(list.map((r) => r.overall)),
      avgScores: avgScores(list),
      redFlagCalls: list.filter((r) => r.redFlagCodes.length > 0).length,
      resolvedRate: round2((list.filter((r) => HANDLED_OUTCOMES.includes(r.outcome)).length / list.length) * 100),
    }))
    .sort((a, b) => b.analyzed - a.analyzed || a.ext.localeCompare(b.ext, undefined, { numeric: true }));

  const newestFirst = (a: AnalysisFacts, b: AnalysisFacts) => b.startedAt.localeCompare(a.startedAt);
  const problems = rows
    .filter((r) => !opts.topicFilter || r.topicKey === opts.topicFilter)
    .filter((r) => r.problem.ru || r.problem.uz)
    .sort(newestFirst)
    .slice(0, opts.problemsLimit ?? 100)
    .map((r) => ({
      callId: r.callId,
      startedAt: r.startedAt,
      operatorExt: r.operatorExt,
      topicKey: r.topicKey,
      topic: r.topic,
      subtopic: r.subtopic,
      problem: r.problem,
      outcome: r.outcome,
    }));

  const flaggedCalls = [...flagged]
    .sort((a, b) => a.overall - b.overall || b.redFlagCodes.length - a.redFlagCodes.length || newestFirst(a, b))
    .slice(0, opts.flaggedLimit ?? 50)
    .map((r) => ({
      callId: r.callId,
      startedAt: r.startedAt,
      operatorExt: r.operatorExt,
      overall: r.overall,
      flags: r.redFlagCodes,
      summary: r.summary,
    }));

  return {
    totals: {
      analyzed: rows.length,
      avgOverall: mean(rows.map((r) => r.overall)),
      avgScores: avgScores(rows),
      redFlagCalls: flagged.length,
      ticketClaimed: claimed.length,
      ticketClaimedConfirmed: claimed.filter((r) => r.hasTicket).length,
      ticketMissed: rows.filter((r) => r.hasTicket && r.outcome !== 'ticket_opened').length,
    },
    topics,
    outcomes: CALL_OUTCOMES.map((outcome) => ({ outcome, count: rows.filter((r) => r.outcome === outcome).length })),
    sentiment: { start: countSentiment((r) => r.sentimentStart), end: countSentiment((r) => r.sentimentEnd) },
    redFlags: RED_FLAGS.map((code) => ({ code, count: flagged.filter((r) => r.redFlagCodes.includes(code)).length })),
    operators,
    problems,
    flaggedCalls,
  };
}
