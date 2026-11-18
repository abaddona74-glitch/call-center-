import type { CallAttemptStatus, TicketStatus } from '../tickets.js';

/**
 * Ticket events. Each one goes only to users who may see the ticket (same rule as GET /tickets):
 * executives of its region, its creator, every operator while it is in the callback queue, operators who
 * called it back, superusers and observers. Payloads are notices; clients refetch over REST to get their own actions.
 */
export type TicketChangeAction =
  | 'created'
  | 'assigned'
  | 'started'
  | 'done'
  | 'rejected'
  | 'returned'
  | 'forwarded'
  | 'released'
  | 'commented'
  | 'callback'
  | 'closed';

export interface TicketsServerEvents {
  'tickets.changed': {
    id: number;
    code: string;
    action: TicketChangeAction;
    status: TicketStatus;
    regionId: number | null;
    actor: { userId: number | null; label: string };
    /** Callback attempt state when action = 'callback'. */
    attemptStatus?: CallAttemptStatus;
    at: string;
  };
  /** The ticket is no longer visible to this user (forwarded to another region, left the callback queue, deleted). */
  'tickets.revoked': { id: number; code: string };
  /** Executives: unread new tickets of my regions (counter + sound in the UI; also after a release). */
  'tickets.unread': { count: number };
}
