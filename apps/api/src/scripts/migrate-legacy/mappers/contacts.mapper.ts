import { notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `client_contacts` → contacts table (owned by S4).
 * Mapping notes (docs/rewrite/legacy/data.md §1.1.7, §5.1):
 *
 * TODO(S4):
 * - `phone` (PK; legacy `cleanContactPhone`: digits only, `998` stripped from 12-digit numbers, other lengths
 *   kept) → normalise with `normalizeUzPhone` from @cc/shared; report rows that collide after normalising
 *   and rows it rejects.
 * - `name` is NOT NULL but may be '' (when organization or telegram id is given); `organization`, `notes`.
 * - `language`: lower-cased free text (`uz`, `ru`, …) [?]; '' → null.
 * - `telegram_user_id`: text, '' → NULL, otherwise bigint.
 * - `created_at`, `updated_at`: server-local text → timestamptz via parseLegacyLocalTime().
 * - Idempotency: insert-if-absent by normalised phone.
 */
export const contactsMapper = notImplementedMapper(
  { name: 'contacts', owner: 'S4' },
  { sqliteTables: ['client_contacts'] },
);
