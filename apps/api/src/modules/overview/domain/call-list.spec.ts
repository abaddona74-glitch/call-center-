import { describe, expect, it } from 'vitest';
import { type AnalysisFacts, aggregateAnalyses } from '../../call-analysis/domain/aggregate.js';
import { calls, inbound, internal, outbound } from '../../../pbx/calls/testing/cdr-fixtures.js';
import { inScope, summarize } from '../../stats/domain/metrics.js';
import { analysedCallFallback, matchesCallMetric, matchesQualityMetric } from './call-list.js';

describe('call lists behind the call numbers (list total == the summary number)', () => {
  it('every metric, both scopes', () => {
    const rows = [
      inbound({ at: '2026-11-16 09:00:00', caller: '998901234567', outcome: 'answered', answeredBy: '101', talk: 100 }),
      inbound({ at: '2026-11-16 09:30:00', caller: '935551122', outcome: 'abandoned', rung: ['101'] }),
      inbound({ at: '2026-11-16 10:30:00', caller: 'anonymous', outcome: 'ivr' }),
      inbound({ at: '2026-11-16 22:00:00', caller: '977778899', outcome: 'after_hours' }),
      outbound({ at: '2026-11-16 11:00:00', ext: '101', number: '935551122', disposition: 'ANSWERED', talk: 60 }),
      outbound({ at: '2026-11-16 11:10:00', ext: '101', number: '0977778899', disposition: 'BUSY' }),
      internal({ at: '2026-11-16 11:30:00', from: '101', to: '103' }),
    ].flat();
    const all = calls(rows);
    expect(all.length).toBe(7);
    for (const scope of ['working', 'all'] as const) {
      const s = summarize(all, { from: '2026-11-16', to: '2026-11-16', scope });
      const count = (m: Parameters<typeof matchesCallMetric>[1]) =>
        all.filter((c) => inScope(c, scope) && matchesCallMetric(c, m)).length;
      expect(count('total'), scope).toBe(s.totalCalls);
      expect(count('inbound')).toBe(s.inbound.offered);
      expect(count('outbound')).toBe(s.outbound.connected);
      expect(count('answered')).toBe(s.inbound.answered);
      expect(count('unanswered')).toBe(s.inbound.offered - s.inbound.answered);
      expect(count('abandoned')).toBe(s.inbound.abandoned);
      expect(count('ivr')).toBe(s.inbound.ivr);
      expect(count('afterHours')).toBe(s.inbound.afterHours);
      expect(count('talked')).toBe(s.inbound.answered + s.outbound.connected);
    }
  });
});

describe('analysed calls behind the quality numbers', () => {
  const t = (ru: string) => ({ uz: ru, ru });
  const base: AnalysisFacts = {
    callId: '1',
    startedAt: '2026-11-16T04:00:00.000Z',
    operatorExt: '101',
    topic: t('ЭЦП'),
    topicKey: 'эцп',
    subtopic: t('x'),
    problem: t('x'),
    summary: t('x'),
    outcome: 'resolved',
    scores: { greeting: null, politeness: 5, understanding: 4, solution: 4, closing: 5 },
    overall: 9,
    redFlagCodes: [],
    sentimentStart: 'neutral',
    sentimentEnd: 'positive',
    hasTicket: false,
  };
  const rows: AnalysisFacts[] = [
    base,
    { ...base, callId: '2', outcome: 'info_only', sentimentEnd: 'neutral' },
    {
      ...base,
      callId: '3',
      outcome: 'unresolved',
      redFlagCodes: ['rudeness', 'no_greeting'],
      sentimentEnd: 'negative',
    },
    { ...base, callId: '4', outcome: 'ticket_opened', redFlagCodes: ['rudeness'] },
  ];
  const agg = aggregateAnalyses(rows, { names: new Map() });

  it('each number equals its list', () => {
    const count = (f: Parameters<typeof matchesQualityMetric>[1]) =>
      rows.filter((r) => matchesQualityMetric(r, f)).length;
    expect(count({ metric: 'analyzed' })).toBe(agg.totals.analyzed);
    expect(count({ metric: 'flagged' })).toBe(agg.totals.redFlagCalls);
    expect(count({ metric: 'handled' })).toBe(3);
    for (const f of agg.redFlags) expect(count({ metric: 'flag', flag: f.code }), f.code).toBe(f.count);
    for (const o of agg.outcomes) expect(count({ metric: 'outcome', outcome: o.outcome }), o.outcome).toBe(o.count);
    for (const s of ['positive', 'neutral', 'negative'] as const)
      expect(count({ metric: 'sentiment', sentiment: s }), s).toBe(agg.sentiment.end[s]);
  });

  it('a fallback row when the CDR has no such call', () => {
    expect(analysedCallFallback(base)).toMatchObject({
      id: '1',
      date: '2026-11-16',
      time: '09:00:00',
      operator: { ext: '101', name: null },
      clientNumber: null,
      hasRecording: true,
    });
  });
});
