import type { TicketStatus } from '../tickets.js';

/**
 * Ticket events. Sent only to users who may see the ticket (same rule as GET /tickets).
 * Payloads are small notices; clients refetch the ticket over REST to get their own permissions.
 */
export type TicketChangeAction = 'created' | 'updated' | 'accepted' | 'rejected' | 'completed' | 'commented';

export interface TicketsServerEvents {
  'tickets.changed': {
    id: number;
    code: string;
    action: TicketChangeAction;
    status: TicketStatus;
    isUrgent: boolean;
    /** First characters of the ticket text (for toasts). */
    preview: string;
    actor: { userId: number | null; label: string };
    /** Receivers the ticket is addressed to: null = everyone. */
    targetUserId: number | null;
    targetLabel: string | null;
    creatorUserId: number | null;
    at: string;
  };
  'tickets.deleted': { id: number; code: string };
  /** Completed tickets were purged (manually or by schedule). */
  'tickets.purged': { removed: number };
}
