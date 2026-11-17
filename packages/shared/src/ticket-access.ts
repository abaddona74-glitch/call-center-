/**
 * Who may do what with tickets — the ONE place that maps a session user to ticket capabilities
 * (docs/rewrite/TICKETS.md). API services, the WS filter and the web UI all go through it.
 *
 * Until S1's permission model is merged this reads role names. It accepts both the current roles
 * (`operator | admin | superuser`, where `admin` acts as a regional executive) and S1's roles
 * (`operator | observer | executive | superuser`), so it keeps working on either side of that merge.
 *
 * After S1 lands, only this file changes: `ticketCapabilities()` should read
 * `hasPermission(user, 'tickets.…')` (add `tickets.create`, `tickets.work`, `tickets.callback`,
 * `tickets.viewAll`, `tickets.manage`, `tickets.reports` to S1's PERMISSIONS / ROLE_PERMISSIONS).
 * `ticketActorKind()` stays: executives are scoped to their regions, operators to their own tickets
 * plus the shared callback queue.
 */

export type TicketActorKind = 'superuser' | 'executive' | 'observer' | 'operator' | 'none';

export interface TicketCapabilities {
  /** Sees every ticket (superuser, observer). */
  viewAll: boolean;
  /** Opens tickets (from a call, from the history). */
  create: boolean;
  /** Regional work: take, start, done / rejected, forward. Executives: only in their regions. */
  work: boolean;
  /** Calls citizens back from the shared callback queue and closes tickets. */
  callback: boolean;
  /** Writes in the ticket chat. */
  comment: boolean;
  /** Regions, cities/districts, categories, executive ↔ regions. */
  manageDirectories: boolean;
  /** Ticket reports (executives: only their regions). */
  reports: boolean;
  /** Close without a confirmed call (with a reason), delete, triage tickets without a region. */
  administer: boolean;
}

export function ticketActorKind(user: { role: string } | null | undefined): TicketActorKind {
  switch (user?.role) {
    case 'superuser':
      return 'superuser';
    case 'executive':
    case 'admin': // pre-S1 role name; S1 maps the old admin level to executive
      return 'executive';
    case 'observer':
      return 'observer';
    case 'operator':
      return 'operator';
    default:
      return 'none';
  }
}

const NONE: TicketCapabilities = {
  viewAll: false,
  create: false,
  work: false,
  callback: false,
  comment: false,
  manageDirectories: false,
  reports: false,
  administer: false,
};

export function ticketCapabilities(user: { role: string } | null | undefined): TicketCapabilities {
  switch (ticketActorKind(user)) {
    case 'superuser':
      return {
        viewAll: true,
        create: true,
        work: true,
        callback: true,
        comment: true,
        manageDirectories: true,
        reports: true,
        administer: true,
      };
    case 'executive':
      return { ...NONE, work: true, comment: true, reports: true };
    case 'observer':
      return { ...NONE, viewAll: true, reports: true };
    case 'operator':
      return { ...NONE, create: true, callback: true, comment: true };
    default:
      return NONE;
  }
}
