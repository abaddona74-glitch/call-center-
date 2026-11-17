import { notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `pending_callbacks` → callbacks table (owned by S4). Migrate ALL statuses: the dismissed/resolved
 * history is what stops old missed calls from reappearing ("don't resurrect" rule).
 * Mapping notes (docs/rewrite/legacy/data.md §1.1.6, §1.2, §5.1):
 *
 * TODO(S4):
 * - `status` pending|resolved|dismissed → enum; `source` abandoned|ivr_non_working → enum (`manual` is never
 *   written; ROADMAP adds `after_hours`); `resolution_type` operator_outbound|client_inbound|NULL → enum.
 * - `dismissed_at` / `dismissed_by` are set for BOTH dismissed and resolved rows → `closed_at` / `closed_by`.
 *   `dismissed_by` is a username (dismiss) or a tag like `operator_101_inbound`, `3cx_answered_101` (resolve).
 * - `call_time`: CDR `calldate` (PBX timezone [?]) or AMI Tashkent local; `last_outbound_time`, `created_at`,
 *   `updated_at`: server-local → timestamptz via parseLegacyLocalTime().
 * - `last_outbound_operator` (`Oybek (101)`, `Operator 101`, plain name; junk 'NULL'/'null'/'\N' → NULL)
 *   → `last_outbound_operator_ext` parsed from `(\d{2,4})` plus the raw label.
 * - `phone` → `normalizeUzPhone`; legacy deletes `%2020159%`, `712020159`, length < 7 or > 12 at startup → skip.
 * - Drop `caller_name` and `notes` (never written).
 * - Several pending rows per phone exist; the new partial UNIQUE (phone) WHERE status='pending' needs a
 *   dedupe rule (keep the latest call_time, sum attempts?) — report merged rows.
 * - Idempotency: there is no natural key — keep the legacy id (e.g. a `legacy_id` column) or another stable key.
 */
export const callbacksMapper = notImplementedMapper(
  { name: 'callbacks', owner: 'S4' },
  { sqliteTables: ['pending_callbacks'] },
);
