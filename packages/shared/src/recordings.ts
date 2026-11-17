import { z } from 'zod';
import { IsoDateSchema } from './common.js';

/**
 * Call recordings (Asterisk `monitor` folder over read-only SFTP).
 * Paths in the API are always RELATIVE to the monitor root, e.g. "2026/11/17" or
 * "2026/11/17/q-200-901234567-20261117-100000-1763370000.1.wav". The server re-validates them.
 */

/** Audio file extensions the explorer shows and the API streams. */
export const RECORDING_EXTENSIONS = ['wav', 'mp3', 'gsm', 'ogg'] as const;

/** A WAV that is only a header (no conversation). Legacy: "ovoz yozuvi bo'sh: 0 soniya". */
export const EMPTY_RECORDING_MAX_BYTES = 44;
/** Asterisk records 8 kHz 16-bit mono: 16000 bytes per second after the 44-byte header. */
export const WAV_BYTES_PER_SECOND = 16_000;

/** Duration estimate used by the legacy UI: (size - 44) / 16000. */
export function estimateRecordingSeconds(size: number): number {
  return Math.max(0, Math.round((size - EMPTY_RECORDING_MAX_BYTES) / WAV_BYTES_PER_SECOND));
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function isSafeRelativePath(value: string): boolean {
  if (value === '') return true;
  if (value.length > 255) return false;
  return value.split('/').every((s) => s !== '.' && s !== '..' && s.length <= 128 && SEGMENT.test(s));
}

/** Directory inside the monitor root ("" = root). */
export const RecordingDirPathSchema = z
  .string()
  .trim()
  .max(255)
  .transform((v) => v.replace(/^\/+|\/+$/g, ''))
  .refine(isSafeRelativePath, 'Invalid path');

/** Audio file inside the monitor root. */
export const RecordingFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !v.startsWith('/') && isSafeRelativePath(v), 'Invalid path')
  .refine(
    (v) => RECORDING_EXTENSIONS.some((ext) => v.toLowerCase().endsWith(`.${ext}`)),
    'Not an audio file',
  );

/** Asterisk uniqueid / linkedid, e.g. "1763370000.1". */
export const CallUniqueIdSchema = z.string().trim().regex(/^\d{6,14}\.\d{1,10}$/, 'Invalid call id');

/**
 * Explorer type badge (legacy `classifyAudioFile`, dashboard.js):
 *  - empty: header only, nothing to play ("Bo'sh (0 soniya)");
 *  - robot: abandoned, or a short queue recording — the caller only heard the queue prompts;
 *  - talk: a real conversation.
 * Legacy also had an unanchored "operator extension" regex that matched almost every name, so it
 * never changed the result; it is left out on purpose.
 */
export const RecordingKindSchema = z.enum(['empty', 'robot', 'talk']);
export type RecordingKind = z.infer<typeof RecordingKindSchema>;
/** Queue recordings smaller than this (~17 s) are "robot" (legacy threshold). */
export const ROBOT_QUEUE_MAX_BYTES = 280_000;

export function recordingKind(name: string, size: number): RecordingKind {
  if (!size || size <= EMPTY_RECORDING_MAX_BYTES) return 'empty';
  const n = name.toLowerCase();
  const isQueue = n.startsWith('q-') || n.includes('-queue-') || n.includes('ext-queues');
  if (n.includes('abandon') || (isQueue && size < ROBOT_QUEUE_MAX_BYTES)) return 'robot';
  return 'talk';
}

export const RecordingDirSchema = z.object({
  name: z.string(),
  path: z.string(),
  modifiedAt: z.string().nullable(),
});
export type RecordingDir = z.infer<typeof RecordingDirSchema>;

export const RecordingFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  durationSec: z.number().int().nonnegative(),
  modifiedAt: z.string().nullable(),
  kind: RecordingKindSchema,
});
export type RecordingFile = z.infer<typeof RecordingFileSchema>;

export const RecordingTreeQuerySchema = z.object({
  path: RecordingDirPathSchema.default(''),
});
export type RecordingTreeQuery = z.infer<typeof RecordingTreeQuerySchema>;

export const RecordingTreeResponseSchema = z.object({
  path: z.string(),
  directories: z.array(RecordingDirSchema),
  files: z.array(RecordingFileSchema),
});
export type RecordingTreeResponse = z.infer<typeof RecordingTreeResponseSchema>;

const DownloadFlagSchema = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

export const RecordingStreamQuerySchema = z.object({
  path: RecordingFilePathSchema,
  download: DownloadFlagSchema,
});
export type RecordingStreamQuery = z.infer<typeof RecordingStreamQuerySchema>;

export const RecordingDownloadQuerySchema = z.object({
  download: DownloadFlagSchema,
});
export type RecordingDownloadQuery = z.infer<typeof RecordingDownloadQuerySchema>;

/** The recording that belongs to one call (exact CDR `recordingfile`, no guessing). */
export const CallRecordingSchema = z.object({
  uniqueid: z.string(),
  calldate: z.string().nullable(),
  file: RecordingFileSchema,
});
export type CallRecording = z.infer<typeof CallRecordingSchema>;

export const RecordingsStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
});
export type RecordingsStatus = z.infer<typeof RecordingsStatusSchema>;

// ---------------------------------------------------------------------------
// ZIP export jobs (built in the background, progress over WS `recordings.zipJob`)
// ---------------------------------------------------------------------------

export const ZipJobStatusSchema = z.enum(['queued', 'processing', 'ready', 'failed', 'cancelled']);
export type ZipJobStatus = z.infer<typeof ZipJobStatusSchema>;

/** Upper bound accepted by the schema; the server applies its own (configurable, lower) limit. */
export const ZIP_JOB_MAX_ITEMS = 5000;

export const ZipNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((v) => v.replace(/[^\p{L}\p{N}._ ()-]+/gu, '_'));

export const CreateZipJobRequestSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('files'),
    paths: z.array(RecordingFilePathSchema).min(1).max(ZIP_JOB_MAX_ITEMS),
    zipName: ZipNameSchema.optional(),
  }),
  z.object({
    source: z.literal('calls'),
    uniqueids: z.array(CallUniqueIdSchema).min(1).max(ZIP_JOB_MAX_ITEMS),
    zipName: ZipNameSchema.optional(),
  }),
  z.object({
    source: z.literal('range'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    /** Exact client number (normalized server-side) or operator extension. */
    search: z.string().trim().max(32).optional(),
    zipName: ZipNameSchema.optional(),
  }),
]);
export type CreateZipJobRequest = z.input<typeof CreateZipJobRequestSchema>;

export const ZipJobSchema = z.object({
  id: z.string(),
  status: ZipJobStatusSchema,
  /** 1-based position while queued, 0 otherwise. */
  queuePosition: z.number().int(),
  total: z.number().int(),
  processed: z.number().int(),
  added: z.number().int(),
  skipped: z.number().int(),
  /** 0..100 */
  progress: z.number().int(),
  currentFile: z.string().nullable(),
  bytesWritten: z.number().int(),
  zipName: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  /** The ready file is deleted after this moment. */
  expiresAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type ZipJob = z.infer<typeof ZipJobSchema>;

export const ZipJobListResponseSchema = z.object({ items: z.array(ZipJobSchema) });
export type ZipJobListResponse = z.infer<typeof ZipJobListResponseSchema>;

export const ZipJobIdSchema = z.string().regex(/^zip_[A-Za-z0-9_-]{8,40}$/, 'Invalid job id');
