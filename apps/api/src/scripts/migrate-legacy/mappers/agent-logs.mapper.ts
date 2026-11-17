import { notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `agent_3cx_call_logs` → agent call events table (owned by S4). It is the only history of
 * per-operator missed counts and the 3CX journal.
 * Mapping notes (docs/rewrite/legacy/data.md §1.0, §1.1.3–1.1.5, §5.1):
 *
 * TODO(S4):
 * - `event_time`, `start_time`, `end_time`: format is whatever the desktop agent sent (`/` replaced by `-`);
 *   verify on prod first: `SELECT DISTINCT length(event_time), substr(event_time,11,1) FROM agent_3cx_call_logs`.
 *   CDR-backfilled rows carry PBX `calldate` (PBX timezone [?]).
 * - `event_type` stored as sent (not upper-cased) → upper-case enum, `'1'` → DIALLED, `'2'` → ANSWERED;
 *   keep the original in `raw_event_type`.
 * - `source` enum derived from `hostname = 'Asterisk PBX'` (cdr_backfill) vs anything else (desktop_agent).
 * - `operator_id` (extension) → operator ext; `caller_id` may be `'Yashirin raqam'` (hidden number).
 * - Idempotency: the legacy UNIQUE (operator_id, caller_id, start_time) → ON CONFLICT DO NOTHING on the same key.
 * - Related tables `operator_reject_events` / `operator_missed_events` have no writers (DEAD-R) and are dropped,
 *   but check their prod row counts before cutover; `calls` and `operator_daily_stats` are dropped too.
 */
export const agentLogsMapper = notImplementedMapper(
  { name: 'agent-logs', owner: 'S4' },
  { sqliteTables: ['agent_3cx_call_logs'] },
);
