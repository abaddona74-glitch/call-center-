import { ROLES, type Role } from './auth.js';
import { type Permission, hasPermission } from './permissions.js';

/**
 * Who may do what with tickets — the ONE place that maps a session user to ticket capabilities
 * (docs/rewrite/TICKETS.md). API services, the WS filter and the web UI all go through it.
 *
 * Everything is derived from S1's permissions (packages/shared/src/permissions.ts), never from role names:
 *   tickets.create / tickets.callback       — operators: open tickets, call citizens back and close;
 *   tickets.process                         — regional work (executives: only their regions);
 *   tickets.viewAll                         — every region (superuser; observers lost it on 19.11.2026);
 *   tickets.directories.manage              — regions, cities, categories, executive ↔ regions;
 *   tickets.administer                      — close without a confirmed call, delete, triage.
 * The actor kind decides the scope: an executive (process without viewAll) is limited to its regions;
 * an operator sees tickets it opened, the shared callback queue and closed tickets it called back on;
 * an "observer" actor (viewAll without process) sees everything read-only — no role has that by default any more:
 * the observer role sees only the overview dashboard (aggregates, permission `overview.view`).
 */

export type TicketActorKind = 'superuser' | 'executive' | 'observer' | 'operator' | 'none';

export interface TicketCapabilities {
  /** Sees every ticket (superuser). */
  viewAll: boolean;
  /** Opens tickets (from a call, from the history). */
  create: boolean;
  /** Regional work: take, start, done / rejected, forward, release back to the queue. Executives: only in their regions. */
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
  /**
   * Unread counter + chime/toast when a ticket arrives in (or is released back to) the queue of my regions.
   * Region-scoped workers only: whoever sees every region would be alerted for all of them.
   */
  regionAlerts: boolean;
}

/** A session user, or a user row (role as stored; without `permissions` the role's default set applies). */
export type TicketUser = { role: string; permissions?: readonly Permission[] | null };

const permits = (user: TicketUser, p: Permission) =>
  hasPermission(user as { role: Role; permissions?: readonly Permission[] | null }, p);

export function ticketActorKind(user: TicketUser | null | undefined): TicketActorKind {
  if (!user) return 'none';
  const can = (p: Permission) => permits(user, p);
  if (can('tickets.viewAll')) return can('tickets.process') ? 'superuser' : 'observer';
  if (can('tickets.process')) return 'executive';
  if (can('tickets.create') || can('tickets.callback')) return 'operator';
  return 'none';
}

export function ticketCapabilities(user: TicketUser | null | undefined): TicketCapabilities {
  const can = (p: Permission) => Boolean(user && permits(user, p));
  const viewAll = can('tickets.viewAll');
  const work = can('tickets.process');
  const create = can('tickets.create');
  const callback = can('tickets.callback');
  return {
    viewAll,
    create,
    work,
    callback,
    comment: work || create || callback,
    manageDirectories: can('tickets.directories.manage'),
    reports: work || viewAll,
    administer: can('tickets.administer'),
    regionAlerts: work && !viewAll,
  };
}

/** Roles that act as regional executives by default (for the "executive ↔ regions" screen). */
export const EXECUTIVE_ROLES: readonly Role[] = ROLES.filter((role) => ticketActorKind({ role }) === 'executive');
