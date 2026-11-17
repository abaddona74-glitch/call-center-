import { countArray, notImplementedMapper } from './not-implemented.js';

/**
 * Legacy STT data → transcripts and STT rules tables. ROADMAP puts STT/Gemini in stage 2 ("moved as is");
 * transcripts hang off recordings (S5) — confirm the owner.
 * Mapping notes (docs/rewrite/legacy/data.md §1.1.15–1.1.17, §2.1, §5.1):
 *
 * TODO(stage 2 / S5):
 * - `call_transcriptions` → call transcripts: key by `recording_file` basename (UNIQUE) plus an optional
 *   `cdr_uniqueid` parsed from the file name `-(\d+\.\d+)\.wav`; keep `call_key` as a legacy alias (it is NOT
 *   the CDR uniqueid); `transcription` → raw text, `formatted_transcription` → clean text;
 *   `created_at` is CURRENT_TIMESTAMP (UTC) → parseLegacyUtcTime(); drop `topic`, `sub_topic`, `confidence`
 *   (never written).
 * - `stt_learned_rules` + `stt_custom_rules.json` (`[{ pattern, replace }]`, RegExp source used with 'gi')
 *   → STT rules (`kind` learned|regex, pattern, replacement, occurrences); learned `raw_word` is
 *   case-insensitive UNIQUE. Skip rules the legacy startup cleanup deletes (length(raw_word) > 28, …).
 * - `call_topic_analytics` is synthetic (SYNTH) — do NOT migrate; topics are recomputed from real transcripts.
 * - Idempotency: insert-if-absent by recording basename / raw_word / pattern.
 */
export const transcriptsMapper = notImplementedMapper(
  { name: 'transcripts', owner: 'stage 2 (STT) / S5' },
  {
    sqliteTables: ['call_transcriptions', 'stt_learned_rules'],
    jsonFiles: [{ file: 'stt_custom_rules.json', count: countArray() }],
  },
);
