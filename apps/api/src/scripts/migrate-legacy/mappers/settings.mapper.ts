import { notImplementedMapper } from './not-implemented.js';

/**
 * Legacy settings → `settings (key text PK, value jsonb, updated_at)` (owner: S1, admin settings).
 * Mapping notes (docs/rewrite/legacy/data.md §1.1.11, §2.1, §5.1):
 *
 * TODO(S1):
 * - SQLite `system_settings`: `auth_lockout_threshold` → `auth.lockout_threshold` (int, legacy clamps 3–10),
 *   `auth_lockout_duration_min` → `auth.lockout_duration_min` (int ≥ 1),
 *   `excluded_operators` (JSON array of extension strings) → `stats.excluded_operators`.
 * - `queue-sync-settings.json` `{ enabled }` → `queue.db_sync_enabled` (legacy default true when missing).
 * - `system_settings.json` (legacy repo root, NOT data/) `{ autoRecoverVms }` → `proxmox.auto_recover_vms`;
 *   `lastRecovery` is optional history.
 * - `updated_at` server-local text → timestamptz via parseLegacyLocalTime().
 * - Idempotency: insert-if-absent by key (never overwrite a value changed in the new system).
 */
export const settingsMapper = notImplementedMapper(
  { name: 'settings', owner: 'S1' },
  {
    sqliteTables: ['system_settings'],
    jsonFiles: [
      { file: 'queue-sync-settings.json', count: (d) => (d && typeof d === 'object' ? 1 : 0) },
      { file: 'system_settings.json', count: (d) => (d && typeof d === 'object' ? 1 : 0) },
    ],
  },
);
