/**
 * The calls behind the call and call-quality numbers of the overview dashboard (owner, 19.11.2026). Call metrics use
 * the summary's definitions (stats/domain/metrics.ts `summarize`, METRICS.md §2) and the spec checks each list count
 * against it; quality metrics use the call-analysis aggregation's (§8). Pure: no Nest, no DB.
 */
import {
  type CallListItem,
  type CallOutcome,
  type OverviewCallMetric,
  type OverviewQualityMetric,
  type RedFlagCode,
  type Sentiment,
} from '@cc/shared';
import type { AnalysisFacts } from '../../call-analysis/domain/aggregate.js';
import { HANDLED_OUTCOMES } from '../../call-analysis/domain/aggregate.js';
import type { AssembledCall } from '../../../pbx/calls/call-assembler.js';

/** One summary number's calls; the scope (working time / all) is applied by the caller, as in `summarize`. */
export function matchesCallMetric(c: AssembledCall, metric: OverviewCallMetric): boolean {
  const inbound = c.direction === 'inbound';
  const connectedOut = c.direction === 'outbound' && c.status === 'answered';
  switch (metric) {
    case 'total':
      return inbound || connectedOut;
    case 'inbound':
      return inbound;
    case 'outbound':
      return connectedOut;
    case 'answered':
      return inbound && c.status === 'answered';
    case 'unanswered':
      return inbound && c.status !== 'answered';
    case 'abandoned':
      return inbound && c.status === 'abandoned';
    case 'ivr':
      return inbound && c.status === 'ivr';
    case 'afterHours':
      return inbound && c.status === 'after_hours';
    case 'talked':
      return (inbound && c.status === 'answered') || connectedOut;
  }
}

export type QualityFacts = Omit<AnalysisFacts, 'hasTicket'>;

export interface QualityFilter {
  metric: OverviewQualityMetric;
  flag?: RedFlagCode;
  outcome?: CallOutcome;
  sentiment?: Sentiment;
}

/** One quality number's analysed calls (current prompt version). */
export function matchesQualityMetric(a: QualityFacts, f: QualityFilter): boolean {
  switch (f.metric) {
    case 'analyzed':
      return true;
    case 'handled':
      return HANDLED_OUTCOMES.includes(a.outcome);
    case 'flagged':
      return a.redFlagCodes.length > 0;
    case 'flag':
      return f.flag !== undefined && a.redFlagCodes.includes(f.flag);
    case 'outcome':
      return a.outcome === f.outcome;
    case 'sentiment':
      return a.sentimentEnd === f.sentiment;
  }
}

/**
 * A list row for an analysed call the CDR no longer returns (or the PBX is unreachable): what the analysis job knows,
 * so the list still adds up to the number.
 */
export function analysedCallFallback(a: QualityFacts): CallListItem {
  const started = new Date(a.startedAt);
  const wall = new Date(started.getTime() + 5 * 3_600_000).toISOString(); // Asia/Tashkent, no DST
  return {
    id: a.callId,
    startedAt: a.startedAt,
    date: wall.slice(0, 10),
    time: wall.slice(11, 19),
    // Analysed calls are answered inbound/outbound calls; the job row does not say which, inbound is the usual one.
    direction: 'inbound',
    status: 'answered',
    transferred: false,
    clientNumber: null,
    clientNumberRaw: null,
    hiddenNumber: false,
    operator: a.operatorExt ? { ext: a.operatorExt, name: null } : null,
    operators: a.operatorExt ? [{ ext: a.operatorExt, name: null }] : [],
    transfers: [],
    missedBy: [],
    talkSec: 0,
    waitSec: null,
    durationSec: 0,
    inWorkingHours: true,
    hangupBy: 'unknown',
    hasRecording: true,
    recordingFile: null,
  };
}
