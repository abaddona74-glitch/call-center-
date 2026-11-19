/**
 * Call quality block of the overview dashboard (docs/rewrite/METRICS.md §9.3): the «Tahlil» page's aggregates of the
 * current prompt version (call-analysis `aggregateAnalyses`), reduced to totals — no topics, problems, operators or
 * per-call texts — plus the analysed share of the period's answered calls. Pure: no Nest, no DB.
 */
import type { CallAnalysisStats, OverviewQuality } from '@cc/shared';
import { HANDLED_OUTCOMES } from '../../call-analysis/domain/aggregate.js';
import { percent } from '../../stats/domain/metrics.js';

export function buildOverviewQuality(stats: CallAnalysisStats, answeredCalls: number | null): OverviewQuality {
  const { analyzed } = stats.totals;
  const handled = stats.outcomes
    .filter((o) => HANDLED_OUTCOMES.includes(o.outcome))
    .reduce((sum, o) => sum + o.count, 0);
  return {
    range: stats.range,
    promptVersion: stats.promptVersion,
    analyzed,
    answeredCalls,
    analyzedShare: answeredCalls ? percent(analyzed, answeredCalls) : null,
    avgOverall: stats.totals.avgOverall,
    avgScores: stats.totals.avgScores,
    redFlagCalls: stats.totals.redFlagCalls,
    redFlags: stats.redFlags,
    outcomes: stats.outcomes,
    handledRate: analyzed ? percent(handled, analyzed) : null,
    sentimentEnd: stats.sentiment.end,
  };
}
