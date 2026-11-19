import { z } from 'zod';
import { CallDirectionSchema, CdrCallIdSchema } from './cdr.js';
import { IsoDateSchema } from './common.js';
import { TicketStatusSchema } from './tickets.js';

/**
 * AI analysis of call recordings (docs/rewrite/CALL-ANALYSIS.md): speech-to-text with speaker turns, then an LLM
 * that tells operator from client and fills the rubric below. The work runs in `apps/analysis-worker`, which talks
 * to the API over HTTP with a service token (the AI servers are not reachable from the call-center network).
 *
 * Access (owner decision 2026-11-19):
 *  - one call's transcript and analysis — whoever may play its recording (`CDR_ACCESS['calls.recordings']`);
 *  - aggregates across operators — like the statistics page (`CDR_ACCESS['stats.read']`);
 *  - the queue, backfill and retries — `analysis.manage` (superuser).
 */

// --- rubric ------------------------------------------------------------------------------------

/**
 * Version of the prompt + rubric the worker used. Bump it whenever the prompt, the topic list semantics,
 * the scores or the flags change; every stored result keeps the version it was made with.
 */
export const CALL_ANALYSIS_PROMPT_VERSION = 'v3-2026-11-19';
/**
 * Versions: v1 — first pilot rubric; v2 — scores anchored on the operator manual standard, calibrated overall;
 * v3 — v2 + the model corrects the role of single transcript lines that diarization gave to the wrong side.
 */

export const CALL_ANALYSIS_JOB_STATUSES = ['queued', 'processing', 'done', 'failed', 'skipped'] as const;
export const CallAnalysisJobStatusSchema = z.enum(CALL_ANALYSIS_JOB_STATUSES);
export type CallAnalysisJobStatus = z.infer<typeof CallAnalysisJobStatusSchema>;

/**
 * How the call ended for the client:
 *  resolved          — the operator solved the problem during the call;
 *  ticket_opened     — a request (ticket/ariza) was registered for another team;
 *  callback_promised — the operator promised to call back / the client will be contacted;
 *  transferred       — the call was transferred to another extension or department;
 *  unresolved        — the problem stayed unsolved and nothing was promised;
 *  info_only         — the client only asked for information (nothing to solve).
 */
export const CALL_OUTCOMES = [
  'resolved',
  'ticket_opened',
  'callback_promised',
  'transferred',
  'unresolved',
  'info_only',
] as const;
export const CallOutcomeSchema = z.enum(CALL_OUTCOMES);
export type CallOutcome = z.infer<typeof CallOutcomeSchema>;

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export const SentimentSchema = z.enum(SENTIMENTS);
export type Sentiment = z.infer<typeof SentimentSchema>;

/** The five rubric criteria, each scored 1–5 (definitions: docs/rewrite/METRICS.md §8). */
export const KPI_CRITERIA = ['greeting', 'politeness', 'understanding', 'solution', 'closing'] as const;
export type KpiCriterion = (typeof KPI_CRITERIA)[number];

/**
 * Operator red flags:
 *  rudeness          — rude, irritated or dismissive tone;
 *  wrong_information — told the client something wrong;
 *  interrupting      — repeatedly cut the client off;
 *  no_greeting       — no greeting / did not name the call center;
 *  long_hold         — left the client waiting in silence without explaining;
 *  refused_help      — refused to help without redirecting the client;
 *  unprofessional    — slang, profanity, personal talk, eating, etc.
 */
export const RED_FLAGS = [
  'rudeness',
  'wrong_information',
  'interrupting',
  'no_greeting',
  'long_hold',
  'refused_help',
  'unprofessional',
] as const;
export const RedFlagCodeSchema = z.enum(RED_FLAGS);
export type RedFlagCode = z.infer<typeof RedFlagCodeSchema>;

export const ANALYSIS_LANGUAGES = ['uz', 'ru', 'mixed'] as const;
export const AnalysisLanguageSchema = z.enum(ANALYSIS_LANGUAGES);
export type AnalysisLanguage = z.infer<typeof AnalysisLanguageSchema>;

export const TRANSCRIPT_ROLES = ['operator', 'client', 'unknown'] as const;
export const TranscriptRoleSchema = z.enum(TRANSCRIPT_ROLES);
export type TranscriptRole = z.infer<typeof TranscriptRoleSchema>;

/** How speech was turned into speaker turns (docs/rewrite/CALL-ANALYSIS.md §STT). */
export const STT_STRATEGIES = ['turns', 'chunks'] as const;
export const SttStrategySchema = z.enum(STT_STRATEGIES);
export type SttStrategy = z.infer<typeof SttStrategySchema>;

const score5 = z.number().int().min(1).max(5);
export const KpiScoresSchema = z.object({
  greeting: score5,
  politeness: score5,
  understanding: score5,
  solution: score5,
  closing: score5,
});
export type KpiScores = z.infer<typeof KpiScoresSchema>;

/** A short text in both UI languages (the LLM writes both). */
const localized = (max: number) => z.object({ uz: z.string().trim().max(max), ru: z.string().trim().max(max) });
export const LocalizedTextSchema = localized(1000);
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const TopicCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Invalid topic code');

export const CallTopicSchema = z.object({
  code: TopicCodeSchema,
  nameUz: z.string(),
  nameRu: z.string(),
  active: z.boolean(),
  sort: z.number().int(),
});
export type CallTopic = z.infer<typeof CallTopicSchema>;

export const RedFlagSchema = z.object({
  code: RedFlagCodeSchema,
  /** What happened, in Russian (short, no personal data). */
  note: z.string().trim().max(300),
  /** Seconds from the start of the recording, when known. */
  at: z.number().nonnegative().nullable(),
});
export type RedFlag = z.infer<typeof RedFlagSchema>;

/** The rubric filled for one call. Free texts must not carry card, passport or phone numbers (worker masks digits). */
export const CallAnalysisSchema = z.object({
  topicCode: TopicCodeSchema,
  subtopic: localized(160),
  /** The client's problem in one sentence: what statistics list as "problems". */
  problem: localized(400),
  summary: localized(1200),
  outcome: CallOutcomeSchema,
  scores: KpiScoresSchema,
  /** Overall operator score 1–10. */
  overall: z.number().int().min(1).max(10),
  redFlags: z.array(RedFlagSchema).max(10),
  sentimentStart: SentimentSchema,
  sentimentEnd: SentimentSchema,
  language: AnalysisLanguageSchema,
  /** One concrete tip for the operator. */
  recommendation: localized(400),
});
export type CallAnalysis = z.infer<typeof CallAnalysisSchema>;

export const TranscriptSegmentSchema = z
  .object({
    /** Seconds from the start of the recording. */
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    role: TranscriptRoleSchema,
    /** Diarization label (SPEAKER_00…), null when unknown. */
    speaker: z.string().max(40).nullable(),
    text: z.string().max(5000),
  })
  .refine((s) => s.end >= s.start, { message: '`end` must not be before `start`', path: ['end'] });
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

// --- worker API (service token) ---------------------------------------------------------------

export const WorkerIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/, 'Invalid worker id');

export const WorkerLeaseRequestSchema = z.object({
  workerId: WorkerIdSchema,
  limit: z.number().int().min(1).max(10).default(1),
  /** The job returns to the queue if no result arrives within this time. */
  leaseSec: z.number().int().min(60).max(3600).default(900),
});
export type WorkerLeaseRequest = z.infer<typeof WorkerLeaseRequestSchema>;

/**
 * full — recording → STT → LLM; llm_only — re-run only the LLM on the stored transcript (a new prompt/rubric version:
 * seconds per call instead of the STT minute).
 */
export const ANALYSIS_JOB_MODES = ['full', 'llm_only'] as const;
export const AnalysisJobModeSchema = z.enum(ANALYSIS_JOB_MODES);
export type AnalysisJobMode = z.infer<typeof AnalysisJobModeSchema>;

export const WorkerJobSchema = z.object({
  callId: CdrCallIdSchema,
  mode: AnalysisJobModeSchema,
  /** ISO-8601 with offset (Asia/Tashkent). */
  startedAt: z.string(),
  direction: CallDirectionSchema,
  operatorExt: z.string().nullable(),
  talkSec: z.number().int(),
  /** Including this lease. */
  attempts: z.number().int(),
  leaseUntil: z.string(),
});
export type WorkerJob = z.infer<typeof WorkerJobSchema>;

export const WorkerLeaseResponseSchema = z.object({
  jobs: z.array(WorkerJobSchema),
  /** Active topics for the prompt. */
  topics: z.array(CallTopicSchema.pick({ code: true, nameUz: true, nameRu: true })),
});
export type WorkerLeaseResponse = z.infer<typeof WorkerLeaseResponseSchema>;

export const WorkerResultSchema = z.object({
  workerId: WorkerIdSchema,
  transcript: z.object({
    language: AnalysisLanguageSchema,
    segments: z.array(TranscriptSegmentSchema).max(5000),
    audioSec: z.number().nonnegative(),
  }),
  analysis: CallAnalysisSchema,
  meta: z.object({
    promptVersion: z.string().min(1).max(40),
    sttStrategy: SttStrategySchema,
    sttModel: z.string().max(200),
    llmModel: z.string().max(200),
    thinking: z.boolean(),
    sttMs: z.number().int().nonnegative(),
    llmMs: z.number().int().nonnegative(),
    /** LLM calls made (2 = the first answer failed validation). */
    llmAttempts: z.number().int().min(1).max(5),
    /** STT was re-run in Russian. */
    sttRerun: z.boolean(),
  }),
});
export type WorkerResult = z.infer<typeof WorkerResultSchema>;

/** The stored transcript of a leased `llm_only` job. */
export const WorkerTranscriptSchema = z.object({
  language: AnalysisLanguageSchema,
  audioSec: z.number(),
  segments: z.array(TranscriptSegmentSchema),
  sttStrategy: SttStrategySchema,
  sttModel: z.string(),
  sttMs: z.number().int(),
  sttRerun: z.boolean(),
});
export type WorkerTranscript = z.infer<typeof WorkerTranscriptSchema>;

export const WorkerFailRequestSchema = z.object({
  workerId: WorkerIdSchema,
  /** No transcript text or phone numbers here: it is stored and shown to the superuser. */
  error: z.string().trim().min(1).max(500),
  /** true: back to the queue (with a delay) until the attempts run out; false: failed at once. */
  retryable: z.boolean(),
});
export type WorkerFailRequest = z.infer<typeof WorkerFailRequestSchema>;

export const SKIP_REASONS = ['no_recording', 'empty_recording', 'no_speech', 'too_long', 'unsupported_audio'] as const;
export const SkipReasonSchema = z.enum(SKIP_REASONS);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const WorkerSkipRequestSchema = z.object({ workerId: WorkerIdSchema, reason: SkipReasonSchema });
export type WorkerSkipRequest = z.infer<typeof WorkerSkipRequestSchema>;

export const WorkerAckSchema = z.object({ ok: z.literal(true), status: CallAnalysisJobStatusSchema });
export type WorkerAck = z.infer<typeof WorkerAckSchema>;

// --- read API ----------------------------------------------------------------------------------

export const CallAnalysisTicketSchema = z.object({ id: z.number().int(), status: TicketStatusSchema });

export const CallAnalysisDetailsSchema = z.object({
  callId: z.string(),
  job: z
    .object({
      status: CallAnalysisJobStatusSchema,
      attempts: z.number().int(),
      lastError: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  transcript: z
    .object({
      language: AnalysisLanguageSchema,
      segments: z.array(TranscriptSegmentSchema),
      audioSec: z.number(),
      sttStrategy: SttStrategySchema,
      createdAt: z.string(),
    })
    .nullable(),
  analysis: CallAnalysisSchema.extend({
    topicName: z.object({ uz: z.string(), ru: z.string() }),
    promptVersion: z.string(),
    llmModel: z.string(),
    createdAt: z.string(),
  }).nullable(),
  /** Ground truth next to the model's outcome: tickets really opened from / for this call. */
  tickets: z.array(CallAnalysisTicketSchema),
});
export type CallAnalysisDetails = z.infer<typeof CallAnalysisDetailsSchema>;

/** `ids=a,b,c` — analysis status of the calls on one history page. */
export const CallAnalysisStatusQuerySchema = z.object({
  ids: z
    .string()
    .max(4000)
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(CdrCallIdSchema).max(200)),
});
export type CallAnalysisStatusQuery = z.infer<typeof CallAnalysisStatusQuerySchema>;

export const CallAnalysisStatusItemSchema = z.object({
  callId: z.string(),
  status: CallAnalysisJobStatusSchema,
  overall: z.number().int().nullable(),
  topicCode: z.string().nullable(),
  redFlags: z.number().int(),
});
export const CallAnalysisStatusResponseSchema = z.object({ items: z.array(CallAnalysisStatusItemSchema) });
export type CallAnalysisStatusResponse = z.infer<typeof CallAnalysisStatusResponseSchema>;

/** Longest period for the aggregates. */
export const CALL_ANALYSIS_MAX_DAYS = 366;

export const CallAnalysisStatsQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    operator: z
      .string()
      .regex(/^[0-9]{2,6}$/)
      .optional(),
    topic: TopicCodeSchema.optional(),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type CallAnalysisStatsQuery = z.infer<typeof CallAnalysisStatsQuerySchema>;

const avgScoresSchema = z.object({
  greeting: z.number().nullable(),
  politeness: z.number().nullable(),
  understanding: z.number().nullable(),
  solution: z.number().nullable(),
  closing: z.number().nullable(),
});
const sentimentCounts = z.object({ positive: z.number().int(), neutral: z.number().int(), negative: z.number().int() });

export const CallAnalysisStatsSchema = z.object({
  range: z.object({ from: IsoDateSchema, to: IsoDateSchema }),
  totals: z.object({
    analyzed: z.number().int(),
    avgOverall: z.number().nullable(),
    avgScores: avgScoresSchema,
    redFlagCalls: z.number().int(),
    /** Calls the model said ended with a ticket, and how many of them really have one. */
    ticketClaimed: z.number().int(),
    ticketClaimedConfirmed: z.number().int(),
    /** Calls with a real ticket the model did not call `ticket_opened`. */
    ticketMissed: z.number().int(),
  }),
  topics: z.array(
    z.object({
      code: z.string(),
      nameUz: z.string(),
      nameRu: z.string(),
      count: z.number().int(),
      avgOverall: z.number().nullable(),
    }),
  ),
  outcomes: z.array(z.object({ outcome: CallOutcomeSchema, count: z.number().int() })),
  sentiment: z.object({ start: sentimentCounts, end: sentimentCounts }),
  redFlags: z.array(z.object({ code: RedFlagCodeSchema, count: z.number().int() })),
  operators: z.array(
    z.object({
      ext: z.string(),
      name: z.string().nullable(),
      analyzed: z.number().int(),
      avgOverall: z.number().nullable(),
      avgScores: avgScoresSchema,
      redFlagCalls: z.number().int(),
      /** Share of resolved + info_only + ticket_opened calls, %. */
      resolvedRate: z.number().nullable(),
    }),
  ),
  /** Latest client problems (topic filter applies). */
  problems: z.array(
    z.object({
      callId: z.string(),
      startedAt: z.string(),
      operatorExt: z.string().nullable(),
      topicCode: z.string(),
      subtopic: z.object({ uz: z.string(), ru: z.string() }),
      problem: z.object({ uz: z.string(), ru: z.string() }),
      outcome: CallOutcomeSchema,
    }),
  ),
  /** Calls with red flags, lowest scores first. */
  flaggedCalls: z.array(
    z.object({
      callId: z.string(),
      startedAt: z.string(),
      operatorExt: z.string().nullable(),
      overall: z.number().int(),
      flags: z.array(RedFlagCodeSchema),
      summary: z.object({ uz: z.string(), ru: z.string() }),
    }),
  ),
});
export type CallAnalysisStats = z.infer<typeof CallAnalysisStatsSchema>;

export const CallAnalysisQueueSchema = z.object({
  /** CALL_ANALYSIS_ENABLED: new calls are queued automatically. */
  autoEnqueue: z.boolean(),
  /** A worker token is configured on the API. */
  workerConfigured: z.boolean(),
  counts: z.object({
    queued: z.number().int(),
    processing: z.number().int(),
    done: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
  }),
  oldestQueuedCallAt: z.string().nullable(),
  lastDoneAt: z.string().nullable(),
  doneLastHour: z.number().int(),
  /** Mean lease → result time of the last 24 h, seconds. */
  avgProcessingSec: z.number().nullable(),
  workers: z.array(z.object({ workerId: z.string(), lastSeenAt: z.string(), processing: z.number().int() })),
  recentFailures: z.array(
    z.object({ callId: z.string(), attempts: z.number().int(), lastError: z.string().nullable(), updatedAt: z.string() }),
  ),
});
export type CallAnalysisQueue = z.infer<typeof CallAnalysisQueueSchema>;

/** Queue calls for analysis: answered calls with a recording in a date range, or exact call ids (pilot). */
export const CallAnalysisBackfillRequestSchema = z.union([
  z
    .object({ from: IsoDateSchema, to: IsoDateSchema })
    .strict()
    .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] }),
  z.object({ callIds: z.array(CdrCallIdSchema).min(1).max(1000) }).strict(),
]);
export type CallAnalysisBackfillRequest = z.infer<typeof CallAnalysisBackfillRequestSchema>;

export const CallAnalysisBackfillResponseSchema = z.object({
  /** Calls that match the rules (answered, recording, talk ≥ CALL_ANALYSIS_MIN_TALK_SEC). */
  eligible: z.number().int(),
  enqueued: z.number().int(),
  /** Already queued or analysed. */
  existing: z.number().int(),
  /** Call ids that were not found or do not match the rules. */
  rejected: z.number().int(),
});
export type CallAnalysisBackfillResponse = z.infer<typeof CallAnalysisBackfillResponseSchema>;

export const CallAnalysisRetryResponseSchema = z.object({ requeued: z.number().int() });

/** Re-run only the LLM (current prompt version) on analysed calls of a period or on exact call ids. */
export const CallAnalysisReanalyzeRequestSchema = CallAnalysisBackfillRequestSchema;
export type CallAnalysisReanalyzeRequest = CallAnalysisBackfillRequest;
export type CallAnalysisRetryResponse = z.infer<typeof CallAnalysisRetryResponseSchema>;

export const CallTopicListSchema = z.object({ items: z.array(CallTopicSchema) });
export type CallTopicList = z.infer<typeof CallTopicListSchema>;
