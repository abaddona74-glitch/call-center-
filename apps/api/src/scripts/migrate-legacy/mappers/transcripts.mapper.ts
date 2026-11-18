import { countArray, notMigratedMapper } from './not-implemented.js';

/**
 * Legacy STT data: `call_transcriptions`, `stt_learned_rules`, `stt_custom_rules.json`
 * (docs/rewrite/legacy/data.md §1.1.15–1.1.17). Not migrated — owner decision 2026-11-18
 * (docs/rewrite/DECISIONS.md, "Перенос данных legacy"): topics and transcripts are dropped.
 * `call_topic_analytics` is synthetic and is not migrated either. The counts stay in the report.
 */
export const transcriptsMapper = notMigratedMapper(
  { name: 'transcripts', owner: 'stage 2 (STT) / S5' },
  {
    sqliteTables: ['call_transcriptions', 'stt_learned_rules'],
    jsonFiles: [{ file: 'stt_custom_rules.json', count: countArray() }],
  },
  'owner decision 2026-11-18 — transcripts and STT rules are dropped',
);
