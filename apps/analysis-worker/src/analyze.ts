import { type CallAnalysis, type CallDirection, type TranscriptRole } from '@cc/shared';
import type { ChatMessage, LlmClient } from './llm/llm-client.js';
import { LlmOutputSchema, extractJson, issuesOf, toAnalysis } from './llm/output.js';
import { type Topic, buildMessages, responseJsonSchema } from './llm/prompt.js';
import type { RawSegment } from './stt/transcribe.js';

export class LlmOutputError extends Error {
  /** The last raw answer — for local diagnostics only (contains call content: never log or send it). */
  lastContent = '';
  constructor(readonly issues: string[]) {
    super(`LLM output invalid after retry: ${issues.slice(0, 5).join('; ')}`);
    this.name = 'LlmOutputError';
  }
}

export interface LlmRun {
  analysis: CallAnalysis;
  roles: Record<string, TranscriptRole>;
  /** Segment index (0-based) → role, where the model corrected a single line. */
  roleFixes: Map<number, TranscriptRole>;
  attempts: number;
  ms: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

/**
 * Asks the model for the rubric (JSON schema-constrained); an answer that fails validation is sent back once with
 * the validation errors. Every speaker letter missing from the answer's mapping becomes "unknown".
 */
export async function analyzeTranscript(
  llm: LlmClient,
  input: {
    segments: readonly RawSegment[];
    letters: ReadonlyMap<string, string>;
    topics: readonly Topic[];
    direction: CallDirection;
    audioSec: number;
    thinking: boolean;
    /** Off for servers without constrained decoding. */
    useJsonSchema?: boolean;
  },
): Promise<LlmRun> {
  const started = Date.now();
  const letterList = [...input.letters.values()];
  const topicCodes = input.topics.map((t) => t.code);
  const messages: ChatMessage[] = buildMessages(input);
  const schema =
    input.useJsonSchema === false ? undefined : responseJsonSchema(letterList, topicCodes, input.segments.length);
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await llm.chat({ messages, thinking: input.thinking, jsonSchema: schema });
    promptTokens = (promptTokens ?? 0) + (res.promptTokens ?? 0);
    completionTokens = (completionTokens ?? 0) + (res.completionTokens ?? 0);
    let issues: string[];
    if (res.finishReason === 'length') {
      issues = [`the answer was cut at max_tokens (${res.content.length} chars)`];
      if (attempt === 2) throw Object.assign(new LlmOutputError(issues), { lastContent: res.content });
      continue;
    }
    try {
      const parsed = LlmOutputSchema.safeParse(extractJson(res.content));
      if (parsed.success) {
        const roles: Record<string, TranscriptRole> = {};
        for (const l of letterList) roles[l] = parsed.data.speaker_roles[l] ?? 'unknown';
        const roleFixes = new Map<number, TranscriptRole>();
        for (const f of parsed.data.role_fixes) if (f.line <= input.segments.length) roleFixes.set(f.line - 1, f.role);
        return {
          analysis: toAnalysis(parsed.data, new Set(topicCodes)),
          roles,
          roleFixes,
          attempts: attempt,
          ms: Date.now() - started,
          promptTokens,
          completionTokens,
        };
      }
      issues = issuesOf(parsed.error);
    } catch (err) {
      issues = [(err as Error).message];
    }
    if (attempt === 2) throw Object.assign(new LlmOutputError(issues), { lastContent: res.content });
    messages.push(
      { role: 'assistant', content: res.content.slice(0, 20_000) },
      {
        role: 'user',
        content: `Your JSON does not match the required format:\n- ${issues.join('\n- ')}\nReturn the corrected complete JSON object only.`,
      },
    );
  }
  throw new LlmOutputError(['unreachable']);
}
