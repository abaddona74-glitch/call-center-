import { notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `blacklist` → blocked numbers table (owned by S4).
 * Mapping notes (docs/rewrite/legacy/data.md §1.1.18, §4, §5.1):
 *
 * TODO(S4):
 * - Despite the name this is a per-operator block list for extension 114 only (scope `ext:114`), not global.
 * - `number` (PK; `998XXXXXXXXX` for 9/12-digit input, else raw digits); `variants` JSON array text → text[];
 *   `note` (≤ 200 chars; `'Asterisk 114'` marks rows imported from AstDB).
 * - `created_at`, `updated_at` are SQLite CURRENT_TIMESTAMP (UTC) → parseLegacyUtcTime().
 * - Reconcile with AstDB family `blacklist_114` at cutover through the AMI module — this CLI never talks to the PBX.
 * - Idempotency: insert-if-absent by number.
 */
export const blacklistMapper = notImplementedMapper(
  { name: 'blacklist', owner: 'S4' },
  { sqliteTables: ['blacklist'] },
);
