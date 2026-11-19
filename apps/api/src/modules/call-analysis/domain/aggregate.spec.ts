import { describe, expect, it } from 'vitest';
import { type AnalysisFacts, aggregateAnalyses } from './aggregate.js';

const t = (ru: string) => ({ uz: ru, ru });
const base: AnalysisFacts = {
  callId: '1',
  startedAt: '2026-11-13T09:00:00.000Z',
  operatorExt: '101',
  topicCode: 'eri_key',
  subtopic: t('срок'),
  problem: t('ключ'),
  summary: t('итог'),
  outcome: 'resolved',
  scores: { greeting: 5, politeness: 5, understanding: 4, solution: 4, closing: 5 },
  overall: 9,
  redFlagCodes: [],
  sentimentStart: 'neutral',
  sentimentEnd: 'positive',
  hasTicket: false,
};
const rows: AnalysisFacts[] = [
  base,
  {
    ...base,
    callId: '2',
    startedAt: '2026-11-13T10:00:00.000Z',
    operatorExt: '102',
    topicCode: 'edo',
    outcome: 'ticket_opened',
    hasTicket: true,
    overall: 4,
    scores: { greeting: 1, politeness: 2, understanding: 3, solution: 2, closing: 1 },
    redFlagCodes: ['rudeness', 'no_greeting'],
    sentimentStart: 'negative',
    sentimentEnd: 'negative',
  },
  { ...base, callId: '3', startedAt: '2026-11-13T11:00:00.000Z', outcome: 'ticket_opened', overall: 7 },
  {
    ...base,
    callId: '4',
    startedAt: '2026-11-13T12:00:00.000Z',
    operatorExt: '102',
    outcome: 'unresolved',
    hasTicket: true,
    overall: 6,
    redFlagCodes: ['interrupting'],
  },
];
const topics = [
  { code: 'edo', nameUz: 'EDO', nameRu: 'ЭДО', sort: 10 },
  { code: 'eri_key', nameUz: 'ERI', nameRu: 'ЭЦП', sort: 40 },
];

describe('aggregateAnalyses', () => {
  const s = aggregateAnalyses(rows, { topics, names: new Map([['101', 'Aziza']]) });

  it('totals, averages and the ticket ground truth', () => {
    expect(s.totals).toEqual({
      analyzed: 4,
      avgOverall: 6.5,
      avgScores: { greeting: 4, politeness: 4.25, understanding: 3.75, solution: 3.5, closing: 4 },
      redFlagCalls: 2,
      ticketClaimed: 2,
      ticketClaimedConfirmed: 1,
      ticketMissed: 1,
    });
  });

  it('topics by count with names, outcomes and sentiment', () => {
    expect(s.topics.map((x) => [x.code, x.count, x.nameRu])).toEqual([
      ['eri_key', 3, 'ЭЦП'],
      ['edo', 1, 'ЭДО'],
    ]);
    expect(s.outcomes.find((o) => o.outcome === 'ticket_opened')?.count).toBe(2);
    expect(s.outcomes).toHaveLength(6);
    expect(s.sentiment.start).toEqual({ positive: 0, neutral: 3, negative: 1 });
    expect(s.sentiment.end).toEqual({ positive: 3, neutral: 0, negative: 1 });
    expect(s.redFlags.find((f) => f.code === 'rudeness')?.count).toBe(1);
  });

  it('per operator: name, KPI averages, red-flag calls, handled share', () => {
    expect(s.operators.map((o) => [o.ext, o.name, o.analyzed, o.avgOverall, o.redFlagCalls, o.resolvedRate])).toEqual([
      ['101', 'Aziza', 2, 8, 0, 100],
      ['102', null, 2, 5, 2, 50],
    ]);
  });

  it('flagged calls lowest score first; problems newest first, narrowed by the topic filter', () => {
    expect(s.flaggedCalls.map((c) => c.callId)).toEqual(['2', '4']);
    expect(s.problems.map((p) => p.callId)).toEqual(['4', '3', '2', '1']);
    const edo = aggregateAnalyses(rows, { topics, names: new Map(), topicFilter: 'edo' });
    expect(edo.problems.map((p) => p.callId)).toEqual(['2']);
    expect(edo.totals.analyzed).toBe(4);
  });

  it('an empty period has null averages', () => {
    const empty = aggregateAnalyses([], { topics, names: new Map() });
    expect(empty.totals.avgOverall).toBeNull();
    expect(empty.totals.avgScores.greeting).toBeNull();
    expect(empty.operators).toEqual([]);
  });
});
