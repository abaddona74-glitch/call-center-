import type {
  AnalysisJobMode,
  AnalysisLanguage,
  CallAnalysisJobStatus,
  CallDirection,
  CallOutcome,
  LocalizedText,
  RedFlag,
  RedFlagCode,
  Sentiment,
  SkipReason,
  SttStrategy,
  TranscriptSegment,
} from '@cc/shared';
import type { ColumnType, Generated, Selectable } from 'kysely';

/** jsonb: written as a JSON string, read as the parsed value. */
type Json<T> = ColumnType<T, string, string>;

export interface CallAnalysisJobsTable {
  callId: string;
  callStartedAt: Date;
  /** Asia/Tashkent date of the call start; pg reads `date` as a Date: select `call_date::text` when needed. */
  callDate: ColumnType<Date, string, string>;
  direction: CallDirection;
  operatorExt: string | null;
  talkSec: number;
  recordingFile: string | null;
  source: 'auto' | 'manual';
  status: Generated<CallAnalysisJobStatus>;
  /** full = STT + LLM; llm_only = LLM on the stored transcript (re-analysis). */
  mode: Generated<AnalysisJobMode>;
  attempts: Generated<number>;
  notBefore: Date | null;
  leaseOwner: string | null;
  leasedAt: Date | null;
  leaseUntil: Date | null;
  lastError: string | null;
  skipReason: SkipReason | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  finishedAt: Date | null;
}

export interface CallAnalysisWorkersTable {
  workerId: string;
  lastSeenAt: Generated<Date>;
}

export interface CallTranscriptsTable {
  callId: string;
  language: AnalysisLanguage;
  segments: Json<TranscriptSegment[]>;
  audioSec: number;
  sttStrategy: SttStrategy;
  sttModel: string;
  sttMs: number;
  sttRerun: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface CallAnalysesTable {
  callId: string;
  promptVersion: string;
  llmModel: string;
  thinking: boolean;
  llmMs: number;
  llmAttempts: number;
  /** Free text in the model's words; statistics group by topicKey (topicKey() in @cc/shared). */
  topic: Json<LocalizedText>;
  topicKey: string;
  subtopic: Json<LocalizedText>;
  problem: Json<LocalizedText>;
  summary: Json<LocalizedText>;
  recommendation: Json<LocalizedText>;
  outcome: CallOutcome;
  /** v1–v3 only (null since v4: the greeting is not scored). */
  scoreGreeting: number | null;
  /** The operator's greeting phrase (v4+; null in older rows, '' when the opening is not in the recording). */
  greetingPhrase: string | null;
  scorePoliteness: number;
  scoreUnderstanding: number;
  scoreSolution: number;
  scoreClosing: number;
  overall: number;
  redFlags: Json<RedFlag[]>;
  redFlagCodes: ColumnType<RedFlagCode[], string[], string[]>;
  sentimentStart: Sentiment;
  sentimentEnd: Sentiment;
  language: AnalysisLanguage;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type CallAnalysisJobRow = Selectable<CallAnalysisJobsTable>;
export type CallAnalysisRow = Selectable<CallAnalysesTable>;
export type CallTranscriptRow = Selectable<CallTranscriptsTable>;

declare module '../../database/db.js' {
  interface DB {
    callAnalysisJobs: CallAnalysisJobsTable;
    callAnalysisWorkers: CallAnalysisWorkersTable;
    callTranscripts: CallTranscriptsTable;
    callAnalyses: CallAnalysesTable;
  }
}
