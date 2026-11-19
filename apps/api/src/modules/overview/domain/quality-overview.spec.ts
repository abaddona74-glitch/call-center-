import type { CallAnalysisStats } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { type AnalysisFacts, aggregateAnalyses } from '../../call-analysis/domain/aggregate.js';
import { buildOverviewQuality } from './quality-overview.js';

const t = (ru: string) => ({ uz: ru, ru });
const base: AnalysisFacts = {
  callId: '1',
  startedAt: '2026-11-16T09:00:00.000Z',
  operatorExt: '101',
  topic: t('Ключ ЭЦП'),
  topicKey: 'ключ эцп',
  subtopic: t('срок'),
  problem: t('секретный текст проблемы'),
  summary: t('секретный итог'),
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
  { ...base, callId: '2', outcome: 'info_only', overall: 7, sentimentEnd: 'neutral' },
  {
    ...base,
    callId: '3',
    outcome: 'unresolved',
    overall: 2,
    redFlagCodes: ['rudeness', 'no_greeting'],
    sentimentEnd: 'negative',
  },
  { ...base, callId: '4', outcome: 'ticket_opened', overall: 6, hasTicket: true },
];
const stats = (facts: AnalysisFacts[]): CallAnalysisStats => ({
  range: { from: '2026-11-16', to: '2026-11-16' },
  promptVersion: 'v4-test',
  versions: [{ version: 'v4-test', count: facts.length }],
  ...aggregateAnalyses(facts, { names: new Map() }),
});

describe('buildOverviewQuality', () => {
  it('totals of the current version, the share of answered calls and the handled rate', () => {
    const q = buildOverviewQuality(stats(rows), 8);
    expect(q).toMatchObject({
      promptVersion: 'v4-test',
      analyzed: 4,
      answeredCalls: 8,
      analyzedShare: 50,
      avgOverall: 6,
      redFlagCalls: 1,
      handledRate: 75, // resolved + info_only + ticket_opened
      sentimentEnd: { positive: 2, neutral: 1, negative: 1 },
    });
    expect(q.outcomes).toContainEqual({ outcome: 'unresolved', count: 1 });
    expect(q.redFlags).toContainEqual({ code: 'rudeness', count: 1 });
  });

  it('carries no per-call texts (no problems, summaries, topics, operators)', () => {
    const json = JSON.stringify(buildOverviewQuality(stats(rows), 8));
    expect(json).not.toContain('секретный');
    expect(json).not.toContain('Ключ ЭЦП');
    expect(Object.keys(buildOverviewQuality(stats(rows), 8))).not.toContain('operators');
  });

  it('empty: no analysed calls (analysis off) and no PBX', () => {
    const q = buildOverviewQuality(stats([]), null);
    expect(q).toMatchObject({
      analyzed: 0,
      answeredCalls: null,
      analyzedShare: null,
      avgOverall: null,
      redFlagCalls: 0,
      handledRate: null,
      sentimentEnd: { positive: 0, neutral: 0, negative: 0 },
    });
    expect(buildOverviewQuality(stats([]), 0).analyzedShare).toBeNull();
  });
});
