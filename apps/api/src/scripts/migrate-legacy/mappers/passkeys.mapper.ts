import { notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `auth_passkeys` → WebAuthn credentials table (owned by S1).
 * Mapping notes (docs/rewrite/legacy/data.md §1.1.14, §1.4, §5.1):
 *
 * TODO(S1):
 * - BLOCKER: `users` has no `webauthn_user_id` column yet. The WebAuthn user handle is the UTF-8 of the
 *   legacy `auth_users.webauthn_user_id` UUID *string*; it must be migrated verbatim (extend users.mapper.ts)
 *   or every passkey breaks. Postgres `uuid` is fine as long as the handle is encoded from the string form.
 * - `id` (credential id, base64url text) → keep as-is, it is the primary key and the lookup key at login.
 * - `user_id` → legacy ids are NOT kept in `users`; resolve legacy `auth_users.username` → `users.id`
 *   (case-insensitive). Skip passkeys whose user was skipped by the users mapper.
 * - `public_key` BLOB (COSE bytes) → bytea, byte-for-byte; `counter` → bigint; `device_type` text;
 *   `backed_up` 0/1 → boolean; `transports` JSON array text (or NULL) → text[]; `device_name` → name.
 * - `created_at`, `last_used_at`: server-local text → timestamptz via parseLegacyLocalTime().
 * - Drop the denormalised snapshots `username`, `operator_id`, `webauthn_user_id` on the passkey row.
 * - The new deployment must keep the same WEBAUTHN_RP_ID / origins.
 * - Idempotency: insert-if-absent by credential id.
 */
export const passkeysMapper = notImplementedMapper(
  { name: 'passkeys', owner: 'S1' },
  { sqliteTables: ['auth_passkeys'] },
);
