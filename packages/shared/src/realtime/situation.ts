import type { SituationTelephony, SituationTickets } from '../situation.js';

/**
 * The live situation board «Hozirgi holat» (permission `situation.view` only). Each event carries the whole part;
 * the client replaces it. Initial state: GET /api/situation.
 */
export interface SituationServerEvents {
  /** Telephony now (unmasked numbers), at most one a second and only when something changed. */
  'situation.telephony': SituationTelephony;
  /** Tickets now: on every ticket change (coalesced) and every 30 s (overdue moments pass without an event). */
  'situation.tickets': SituationTickets;
}
