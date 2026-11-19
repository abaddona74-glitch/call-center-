import {
  CALL_ANALYSIS_PROMPT_VERSION,
  type SkipReason,
  type SttStrategy,
  type WorkerJob,
  type WorkerResult,
} from '@cc/shared';
import { type LlmRun, LlmOutputError, analyzeTranscript } from './analyze.js';
import type { ApiClient } from './api-client.js';
import type { LlmClient } from './llm/llm-client.js';
import { toTranscript } from './llm/output.js';
import { type TopicHint, speakerLetters } from './llm/prompt.js';
import { log } from './log.js';
import { ServiceError, type SpeakerOptions, type SttClient } from './stt/stt-client.js';
import { type SttRun, dropEchoedTurns, transcribeCall } from './stt/transcribe.js';
import { callLanguage } from './text/language.js';
import { WavError, parseWav } from './wav.js';

export interface PipelineDeps {
  api: ApiClient;
  stt: SttClient;
  llm: LlmClient;
}

export interface PipelineOptions {
  workerId: string;
  strategy: SttStrategy;
  turnConcurrency: number;
  ruThreshold: number;
  thinking: boolean;
  maxAudioSec: number;
  speakers?: SpeakerOptions;
}

/** Less speech than this (seconds of recognised turns) is not a conversation. */
const MIN_SPEECH_SEC = 3;

export type JobOutcome =
  | { kind: 'done'; audioSec: number; sttMs: number; llmMs: number; segments: number; sttRequests: number }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'failed'; retryable: boolean; error: string };

class Skip extends Error {
  constructor(readonly reason: SkipReason) {
    super(reason);
  }
}

/** Builds the result posted to the API (pure; tested with mocked STT/LLM output). */
export function buildResult(input: {
  workerId: string;
  stt: SttRun;
  llm: LlmRun;
  letters: ReadonlyMap<string, string>;
  audioSec: number;
  sttMs: number;
  thinking: boolean;
  llmModel: string;
}): WorkerResult {
  const segments = toTranscript(input.stt.segments, input.letters, input.llm.roles, input.llm.roleFixes);
  return {
    workerId: input.workerId,
    transcript: {
      // the model's judgement of the spoken language, or ours when STT re-ran turns in Russian
      language:
        input.stt.rerun && input.llm.analysis.language === 'uz'
          ? callLanguage(segments.map((s) => s.text))
          : input.llm.analysis.language,
      segments,
      audioSec: Math.round(input.audioSec * 100) / 100,
    },
    analysis: input.llm.analysis,
    meta: {
      promptVersion: CALL_ANALYSIS_PROMPT_VERSION,
      sttStrategy: input.stt.strategy,
      sttModel: input.stt.model.slice(0, 200),
      llmModel: input.llmModel.split('/').filter(Boolean).at(-1)?.slice(0, 200) ?? 'llm',
      thinking: input.thinking,
      sttMs: input.sttMs,
      llmMs: input.llm.ms,
      llmAttempts: input.llm.attempts,
      sttRerun: input.stt.rerun,
    },
  };
}

/**
 * One job: recording → STT → LLM → result. Never throws: the outcome is reported to the API (done / skipped /
 * failed with a retry flag). Logs carry the call id and timings only.
 */
export async function processJob(
  job: WorkerJob,
  topicHints: readonly TopicHint[],
  deps: PipelineDeps,
  opts: PipelineOptions,
): Promise<JobOutcome> {
  const callId = job.callId;
  const t0 = Date.now();
  let outcome: JobOutcome;
  try {
    let stt: SttRun;
    let sttMs: number;
    let audioSec: number;
    if (job.mode === 'llm_only') {
      // a new prompt/rubric version on the stored transcript: no recording, no STT
      const stored = await deps.api.transcript(callId);
      stt = {
        strategy: stored.sttStrategy,
        model: stored.sttModel,
        rerun: stored.sttRerun,
        requests: 0,
        segments: stored.segments.map((x) => ({
          start: x.start,
          end: x.end,
          speaker: x.speaker,
          text: x.text,
          language: stored.language === 'ru' ? 'ru' : 'uz',
        })),
      };
      sttMs = stored.sttMs;
      audioSec = stored.audioSec;
    } else {
      const audio = await deps.api.recording(callId);
      let wav;
      try {
        wav = parseWav(audio);
      } catch (err) {
        if (err instanceof WavError) throw new Skip('unsupported_audio');
        throw err;
      }
      if (wav.durationSec < 1) throw new Skip('empty_recording');
      if (wav.durationSec > opts.maxAudioSec) throw new Skip('too_long');

      const sttStart = Date.now();
      stt = await transcribeCall(deps.stt, audio, wav, {
        strategy: opts.strategy,
        turnConcurrency: opts.turnConcurrency,
        ruThreshold: opts.ruThreshold,
        speakers: opts.speakers ?? { minSpeakers: 2, maxSpeakers: 3 },
      });
      sttMs = Date.now() - sttStart;
      audioSec = wav.durationSec;
    }
    stt = { ...stt, segments: dropEchoedTurns(stt.segments) };
    const speech = stt.segments.reduce((sum, x) => sum + (x.end - x.start), 0);
    if (stt.segments.length === 0 || speech < MIN_SPEECH_SEC) throw new Skip('no_speech');

    const letters = speakerLetters(stt.segments);
    const llm = await analyzeTranscript(deps.llm, {
      segments: stt.segments,
      letters,
      topicHints,
      direction: job.direction,
      audioSec,
      thinking: opts.thinking,
    });
    const result = buildResult({
      workerId: opts.workerId,
      stt,
      llm,
      letters,
      audioSec,
      sttMs,
      thinking: opts.thinking,
      llmModel: deps.llm.model,
    });
    await deps.api.submit(callId, result);
    outcome = {
      kind: 'done',
      audioSec,
      sttMs,
      llmMs: llm.ms,
      segments: result.transcript.segments.length,
      sttRequests: stt.requests,
    };
    log.info('job done', {
      callId,
      mode: job.mode,
      audioSec: Math.round(audioSec),
      sttMs,
      llmMs: llm.ms,
      llmAttempts: llm.attempts,
      promptTokens: llm.promptTokens,
      completionTokens: llm.completionTokens,
      sttRequests: stt.requests,
      segments: result.transcript.segments.length,
      strategy: stt.strategy,
      ruRerun: stt.rerun,
      totalMs: Date.now() - t0,
    });
    return outcome;
  } catch (err) {
    if (err instanceof Skip) {
      outcome = { kind: 'skipped', reason: err.reason };
    } else if (err instanceof ServiceError) {
      // 404 from our API: the call has no recording (anymore) — nothing to retry
      if (err.service === 'api' && err.status === 404) outcome = { kind: 'skipped', reason: 'no_recording' };
      else if (err.service === 'api' && err.status === 422) outcome = { kind: 'skipped', reason: 'empty_recording' };
      else outcome = { kind: 'failed', retryable: err.retryable, error: err.message };
    } else if (err instanceof LlmOutputError) {
      outcome = { kind: 'failed', retryable: true, error: err.message };
    } else {
      outcome = { kind: 'failed', retryable: true, error: `${(err as Error).name}: ${(err as Error).message}` };
    }
  }

  try {
    if (outcome.kind === 'skipped') await deps.api.skip(callId, outcome.reason);
    else if (outcome.kind === 'failed') await deps.api.fail(callId, outcome.error, outcome.retryable);
  } catch (err) {
    // the lease expires and the job comes back on its own
    log.warn('could not report the outcome', { callId, error: (err as Error).message });
  }
  if (outcome.kind === 'skipped') log.info('job skipped', { callId, reason: outcome.reason });
  if (outcome.kind === 'failed') {
    log.warn('job failed', { callId, retryable: outcome.retryable, error: outcome.error, totalMs: Date.now() - t0 });
  }
  return outcome;
}
