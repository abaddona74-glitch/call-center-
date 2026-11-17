import { countArray, notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `viewer/data/tickets.json` → tickets, ticket comments and attachments (owned by S5).
 * Copy the file into `--data-dir` as `tickets.json`.
 * Mapping notes (docs/rewrite/legacy/data.md §2.2, §2.4, §5.1):
 *
 * TODO(S5):
 * - Two formats: `{ lastCleanedMonday, updatedAt, total, tickets: Ticket[] }` and a bare `Ticket[]`.
 * - `id` `'TK-<n>'` → keep as the ticket code; `status` pending|in_progress|completed|rejected → enum.
 * - `acceptedBy` / `completedBy` `{ id, name, at(ms) }` and `rejectedBy` `{ id, name, at, reason }`
 *   → `*_by_ext`, `*_by_name`, `*_at` columns + `reject_reason`; `createdAt`/`updatedAt` epoch ms → timestamptz.
 * - `creatorId` / `targetOperatorId` (`'all'` or an extension) are extensions, not user ids.
 * - `comments[]` (`isSystem` marks system comments) → ticket comments; `files[]` on tickets and comments
 *   → attachments; the files live in legacy `viewer/public/uploads/tickets/` and must be copied too
 *   (needs an extra CLI argument for that folder).
 * - Completed tickets are purged weekly by legacy anyway — decide whether to migrate them.
 * - Idempotency: insert-if-absent by ticket code.
 */
export const ticketsMapper = notImplementedMapper(
  { name: 'tickets', owner: 'S5' },
  { jsonFiles: [{ file: 'tickets.json', count: (d) => (Array.isArray(d) ? d.length : countArray('tickets')(d)) }] },
);
