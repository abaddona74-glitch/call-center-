import {
  CALL_OUTCOMES,
  type CallAnalysis,
  KPI_CRITERIA,
  RED_FLAGS,
  SENTIMENTS,
  TRANSCRIPT_ROLES,
  type TranscriptRole,
  type TranscriptSegment,
} from '@cc/shared';
import { z } from 'zod';
import type { RawSegment } from '../stt/transcribe.js';

const text = z.string().trim();
const score5 = z.number().int().min(1).max(5);

/** What the LLM must return (snake_case, as in the prompt). */
export const LlmOutputSchema = z.object({
  speaker_roles: z.record(z.string().regex(/^[A-Z]$/), z.enum(TRANSCRIPT_ROLES)),
  /** 1-based transcript lines whose role differs from their speaker letter's (diarization slips). */
  role_fixes: z
    .array(z.object({ line: z.number().int().min(1), role: z.enum(TRANSCRIPT_ROLES) }))
    .max(100)
    .default([]),
  language: z.enum(['uz', 'ru', 'mixed']),
  topic: z.string(),
  subtopic_uz: text,
  subtopic_ru: text,
  problem_uz: text,
  problem_ru: text,
  summary_uz: text.min(1),
  summary_ru: text.min(1),
  outcome: z.enum(CALL_OUTCOMES),
  scores: z.object(Object.fromEntries(KPI_CRITERIA.map((k) => [k, score5])) as Record<(typeof KPI_CRITERIA)[number], typeof score5>),
  overall: z.number().int().min(1).max(10),
  red_flags: z
    .array(z.object({ code: z.enum(RED_FLAGS), note_ru: text, at_sec: z.number().nonnegative().nullable() }))
    .max(10),
  sentiment_start: z.enum(SENTIMENTS),
  sentiment_end: z.enum(SENTIMENTS),
  recommendation_uz: text,
  recommendation_ru: text,
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

/** Model output text → JSON value (tolerates ```json fences and text around the object). */
export function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const a = trimmed.indexOf('{');
    const b = trimmed.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(trimmed.slice(a, b + 1));
    throw new Error('the answer is not JSON');
  }
}

/** Validation issues for the retry prompt and for logs: paths and messages only, never values. */
export function issuesOf(error: z.ZodError): string[] {
  return error.issues.slice(0, 15).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

/**
 * Personal data that must not reach summary fields even if the model writes it: long digit runs (cards, PINFL,
 * phones, remote-access IDs, also when grouped with spaces/dashes), passport series ("AA 1234567"), e-mails.
 */
export function maskPersonalData(value: string): string {
  return value
    .replace(/\b[A-Z]{2}\s?\d{7}\b/g, '***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***')
    .replace(/\+?\d(?:[\s-]?\d){6,}/g, '***');
}

const clip = (value: string, max: number) => maskPersonalData(value).slice(0, max).trim();
const loc = (uz: string, ru: string, max: number) => ({ uz: clip(uz, max), ru: clip(ru, max) });

/** LLM output → the shared rubric (unknown topic → "other", texts masked and clipped to the contract limits). */
export function toAnalysis(out: LlmOutput, topicCodes: ReadonlySet<string>): CallAnalysis {
  return {
    topicCode: topicCodes.has(out.topic) ? out.topic : 'other',
    subtopic: loc(out.subtopic_uz, out.subtopic_ru, 160),
    problem: loc(out.problem_uz, out.problem_ru, 400),
    summary: loc(out.summary_uz, out.summary_ru, 1200),
    outcome: out.outcome,
    scores: out.scores,
    overall: out.overall,
    redFlags: out.red_flags.map((f) => ({ code: f.code, note: clip(f.note_ru, 300), at: f.at_sec })),
    sentimentStart: out.sentiment_start,
    sentimentEnd: out.sentiment_end,
    language: out.language,
    recommendation: loc(out.recommendation_uz, out.recommendation_ru, 400),
  };
}

/** Transcript with roles from the model's speaker mapping (letters were given in order of first appearance). */
export function toTranscript(
  segments: readonly RawSegment[],
  letters: ReadonlyMap<string, string>,
  roles: Record<string, TranscriptRole>,
  fixes: ReadonlyMap<number, TranscriptRole> = new Map(),
): TranscriptSegment[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  return segments.map((s, i) => {
    const letter = s.speaker ? letters.get(s.speaker) : undefined;
    return {
      start: round(s.start),
      end: round(Math.max(s.end, s.start)),
      role: fixes.get(i) ?? ((letter && roles[letter]) || 'unknown'),
      speaker: s.speaker,
      text: s.text.slice(0, 5000),
    };
  });
}
