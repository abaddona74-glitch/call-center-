import { describe, expect, it } from 'vitest';
import {
  CallAnalysisBackfillRequestSchema,
  CallAnalysisSchema,
  CallAnalysisStatsQuerySchema,
  CallAnalysisStatusQuerySchema,
  type CallAnalysis,
  TranscriptSegmentSchema,
  WorkerFailRequestSchema,
  WorkerJobSchema,
  WorkerTranscriptSchema,
  WorkerLeaseRequestSchema,
  WorkerResultSchema,
} from './call-analysis.js';
import { CDR_ACCESS, canAccessCdr } from './cdr-access.js';

const analysis: CallAnalysis = {
  topicCode: 'eri_key',
  subtopic: { uz: 'Kalit muddati', ru: 'Срок ключа' },
  problem: { uz: 'Kalit ishlamayapti', ru: 'Ключ не работает' },
  summary: { uz: 'Qisqa', ru: 'Кратко' },
  outcome: 'resolved',
  scores: { greeting: 5, politeness: 4, understanding: 4, solution: 3, closing: 5 },
  overall: 8,
  redFlags: [{ code: 'interrupting', note: 'Перебил дважды', at: 31.5 }],
  sentimentStart: 'negative',
  sentimentEnd: 'positive',
  language: 'uz',
  recommendation: { uz: 'Tinglang', ru: 'Дослушивать клиента' },
};

const result = {
  workerId: 'mac-1',
  transcript: {
    language: 'uz',
    audioSec: 120.5,
    segments: [
      { start: 0, end: 3.2, role: 'operator', speaker: 'SPEAKER_01', text: 'Assalomu alaykum' },
      { start: 3.4, end: 6, role: 'client', speaker: 'SPEAKER_00', text: 'Salom' },
    ],
  },
  analysis,
  meta: {
    promptVersion: 'v1',
    sttStrategy: 'turns',
    sttModel: 'whisper-uz',
    llmModel: 'deepseek',
    thinking: false,
    sttMs: 12_000,
    llmMs: 4_000,
    llmAttempts: 1,
    sttRerun: false,
  },
};

describe('CallAnalysisSchema', () => {
  it('accepts a full rubric', () => {
    expect(CallAnalysisSchema.parse(analysis)).toEqual(analysis);
  });

  it('rejects scores outside the scales and unknown enums', () => {
    const bad: unknown[] = [
      { ...analysis, scores: { ...analysis.scores, greeting: 0 } },
      { ...analysis, scores: { ...analysis.scores, closing: 6 } },
      { ...analysis, scores: { ...analysis.scores, solution: 3.5 } },
      { ...analysis, overall: 11 },
      { ...analysis, outcome: 'escalated' },
      { ...analysis, sentimentEnd: 'angry' },
      { ...analysis, redFlags: [{ code: 'swearing', note: '', at: null }] },
      { ...analysis, topicCode: 'Bad Code' },
      { ...analysis, problem: { uz: 'x' } },
      { ...analysis, summary: { uz: 'x'.repeat(1201), ru: '' } },
    ];
    for (const b of bad) expect(CallAnalysisSchema.safeParse(b).success).toBe(false);
  });
});

describe('TranscriptSegmentSchema', () => {
  it('needs end ≥ start and a known role', () => {
    expect(
      TranscriptSegmentSchema.safeParse({ start: 2, end: 1, role: 'client', speaker: null, text: '' }).success,
    ).toBe(false);
    expect(
      TranscriptSegmentSchema.safeParse({ start: 1, end: 2, role: 'agent', speaker: null, text: '' }).success,
    ).toBe(false);
    expect(
      TranscriptSegmentSchema.safeParse({ start: 1, end: 1, role: 'unknown', speaker: null, text: '' }).success,
    ).toBe(true);
  });
});

describe('worker contracts', () => {
  it('lease request: defaults and limits', () => {
    expect(WorkerLeaseRequestSchema.parse({ workerId: 'mac-1' })).toEqual({
      workerId: 'mac-1',
      limit: 1,
      leaseSec: 900,
    });
    expect(WorkerLeaseRequestSchema.safeParse({ workerId: 'mac 1' }).success).toBe(false);
    expect(WorkerLeaseRequestSchema.safeParse({ workerId: 'mac-1', limit: 11 }).success).toBe(false);
    expect(WorkerLeaseRequestSchema.safeParse({ workerId: 'mac-1', leaseSec: 30 }).success).toBe(false);
  });

  it('result: accepts a valid submission and rejects a broken one', () => {
    expect(WorkerResultSchema.safeParse(result).success).toBe(true);
    expect(WorkerResultSchema.safeParse({ ...result, meta: { ...result.meta, sttStrategy: 'magic' } }).success).toBe(
      false,
    );
    expect(WorkerResultSchema.safeParse({ ...result, analysis: { ...analysis, overall: 0 } }).success).toBe(false);
  });

  it('fail: a message is required', () => {
    expect(WorkerFailRequestSchema.safeParse({ workerId: 'w', error: '  ', retryable: true }).success).toBe(false);
    expect(WorkerFailRequestSchema.safeParse({ workerId: 'w', error: 'STT 503', retryable: true }).success).toBe(true);
  });
});

describe('llm_only re-analysis', () => {
  it('a leased job says its mode; the stored transcript validates', () => {
    expect(
      WorkerJobSchema.safeParse({
        callId: '1.2',
        mode: 'llm_only',
        startedAt: '2026-11-13T09:00:00+05:00',
        direction: 'inbound',
        operatorExt: '101',
        talkSec: 30,
        attempts: 1,
        leaseUntil: '2026-11-13T09:20:00Z',
      }).success,
    ).toBe(true);
    expect(
      WorkerTranscriptSchema.safeParse({
        ...result.transcript,
        sttStrategy: 'turns',
        sttModel: 'w',
        sttMs: 1,
        sttRerun: false,
      }).success,
    ).toBe(true);
  });
});

describe('read contracts', () => {
  it('status query: splits, dedupes and validates ids', () => {
    expect(CallAnalysisStatusQuerySchema.parse({ ids: '1.1, 2.2,1.1,' }).ids).toEqual(['1.1', '2.2']);
    expect(CallAnalysisStatusQuerySchema.safeParse({ ids: "1.1,x' or 1=1" }).success).toBe(false);
  });

  it('stats query: from ≤ to, operator is an extension', () => {
    expect(CallAnalysisStatsQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(
      CallAnalysisStatsQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-02', operator: 'abc' }).success,
    ).toBe(false);
    expect(CallAnalysisStatsQuerySchema.parse({ from: '2026-11-01', to: '2026-11-02', operator: '101' }).operator).toBe(
      '101',
    );
  });

  it('backfill: a date range or call ids, not both', () => {
    expect(CallAnalysisBackfillRequestSchema.safeParse({ from: '2026-11-01', to: '2026-11-02' }).success).toBe(true);
    expect(CallAnalysisBackfillRequestSchema.safeParse({ callIds: ['1794544201.2101100'] }).success).toBe(true);
    expect(CallAnalysisBackfillRequestSchema.safeParse({ callIds: [] }).success).toBe(false);
    expect(
      CallAnalysisBackfillRequestSchema.safeParse({ from: '2026-11-01', to: '2026-11-02', callIds: ['1.1'] }).success,
    ).toBe(false);
  });
});

describe('access', () => {
  const as = (role: 'superuser' | 'executive' | 'observer' | 'operator') => ({ role });
  it('per-call analysis follows the recordings right; aggregates follow statistics; the queue is superuser-only', () => {
    expect(CDR_ACCESS['analysis.call']).toBe(CDR_ACCESS['calls.recordings']);
    expect(CDR_ACCESS['analysis.stats']).toBe(CDR_ACCESS['stats.read']);
    expect(canAccessCdr(as('operator'), 'analysis.call')).toBe(false);
    expect(canAccessCdr(as('observer'), 'analysis.call')).toBe(true);
    expect(canAccessCdr(as('operator'), 'analysis.stats')).toBe(false);
    expect(canAccessCdr(as('executive'), 'analysis.stats')).toBe(true);
    expect(canAccessCdr(as('superuser'), 'analysis.manage')).toBe(true);
    expect(canAccessCdr(as('executive'), 'analysis.manage')).toBe(false);
    expect(canAccessCdr(as('observer'), 'analysis.manage')).toBe(false);
  });
});
