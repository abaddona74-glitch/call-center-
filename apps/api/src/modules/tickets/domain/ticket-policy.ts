import {
  type Permission,
  type Role,
  type TicketParty,
  type TicketPermissions,
  type TicketStatus,
  type TicketTransition,
  hasPermission,
} from '@cc/shared';

/**
 * Ticket rules in one place (pure functions, unit-tested). The legacy viewer trusted `operatorId`
 * from request bodies; here the viewer always comes from the session.
 */

export interface TicketViewer {
  userId: number;
  role: Role;
  extension: string | null;
  permissions?: readonly Permission[] | null;
}

/** The facts about a ticket that permissions depend on. */
export interface TicketFacts {
  status: TicketStatus;
  creatorUserId: number | null;
  /** Party of the creator at creation time. */
  creatorParty: 'admin' | 'creator';
  /** true = addressed to every receiver. */
  targetAll: boolean;
  targetUserId: number | null;
  assigneeUserId: number | null;
}

/**
 * `tickets.process` (executive/superuser) → admin; operator with extension ≥ `creatorFrom` ("200" group)
 * → creator; other operators with an extension → receiver; no extension → none.
 * Interim (legacy model) until S7's region-scoped workflow (docs/rewrite/TICKETS.md) replaces it.
 */
export function ticketParty(
  viewer: Pick<TicketViewer, 'role' | 'extension' | 'permissions'>,
  creatorFrom: number,
): TicketParty {
  if (hasPermission(viewer, 'tickets.process')) return 'admin';
  const ext = viewer.extension && /^\d{2,6}$/.test(viewer.extension) ? Number(viewer.extension) : null;
  if (ext === null) return 'none';
  return ext >= creatorFrom ? 'creator' : 'receiver';
}

export function canCreateTicket(party: TicketParty): boolean {
  return party === 'admin' || party === 'creator';
}

/**
 * Visibility (legacy rules): creators see tickets opened by creators; receivers see tickets
 * addressed to everyone or to them (and the ones they accepted); admins see everything.
 */
export function canViewTicket(t: TicketFacts, v: TicketViewer, party: TicketParty): boolean {
  switch (party) {
    case 'admin':
      return true;
    case 'creator':
      return t.creatorParty === 'creator' || t.creatorUserId === v.userId;
    case 'receiver':
      return t.targetAll || t.targetUserId === v.userId || t.assigneeUserId === v.userId;
    default:
      return false;
  }
}

/** State machine: which transition leads where. Anything not listed is not allowed. */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, Partial<Record<TicketTransition, TicketStatus>>>> = {
  open: { accept: 'accepted', reject: 'rejected' },
  accepted: { complete: 'completed', reject: 'rejected' },
  rejected: { accept: 'accepted' },
  completed: {},
};

export function nextStatus(status: TicketStatus, transition: TicketTransition): TicketStatus | null {
  return TICKET_TRANSITIONS[status][transition] ?? null;
}

/**
 * Who may move the ticket:
 *  - accept (open|rejected → accepted): a receiver it is addressed to, or an admin;
 *  - reject (open → rejected): same as accept; (accepted → rejected): the assignee or an admin;
 *  - complete (accepted → completed): the assignee or an admin.
 * Creators do not process their own tickets (they edit or delete them while open).
 */
export function canTransition(t: TicketFacts, v: TicketViewer, party: TicketParty, transition: TicketTransition): boolean {
  if (!nextStatus(t.status, transition)) return false;
  if (!canViewTicket(t, v, party)) return false;
  if (party === 'admin') return true;
  const addressedToMe = party === 'receiver' && (t.targetAll || t.targetUserId === v.userId);
  const isAssignee = t.assigneeUserId !== null && t.assigneeUserId === v.userId;
  switch (transition) {
    case 'accept':
      return addressedToMe;
    case 'reject':
      return t.status === 'open' ? addressedToMe : isAssignee;
    case 'complete':
      return isAssignee;
    default:
      return false;
  }
}

function isCreator(t: TicketFacts, v: TicketViewer): boolean {
  return t.creatorUserId !== null && t.creatorUserId === v.userId;
}

/** Edit text/phone/urgency: the creator or an admin, until the ticket is completed. */
export function canEditTicket(t: TicketFacts, v: TicketViewer, party: TicketParty): boolean {
  if (t.status === 'completed' || !canViewTicket(t, v, party)) return false;
  return party === 'admin' || isCreator(t, v);
}

/** Re-addressing only makes sense before anyone accepted it. */
export function canRetargetTicket(t: TicketFacts, v: TicketViewer, party: TicketParty): boolean {
  return t.status === 'open' && canEditTicket(t, v, party);
}

/** Delete: an admin at any time, the creator only while nobody has taken it. */
export function canDeleteTicket(t: TicketFacts, v: TicketViewer, party: TicketParty): boolean {
  if (party === 'admin') return true;
  return isCreator(t, v) && t.status === 'open' && canViewTicket(t, v, party);
}

export function canCommentTicket(t: TicketFacts, v: TicketViewer, party: TicketParty): boolean {
  return canViewTicket(t, v, party);
}

export function ticketPermissions(t: TicketFacts, v: TicketViewer, party: TicketParty): TicketPermissions {
  return {
    accept: canTransition(t, v, party, 'accept'),
    reject: canTransition(t, v, party, 'reject'),
    complete: canTransition(t, v, party, 'complete'),
    edit: canEditTicket(t, v, party),
    delete: canDeleteTicket(t, v, party),
    comment: canCommentTicket(t, v, party),
  };
}

/** "Mine": creators — what I opened; receivers — addressed to me or accepted by me; admins — opened or accepted by me. */
export function isMine(t: TicketFacts, v: TicketViewer, party: TicketParty): boolean {
  if (party === 'creator') return isCreator(t, v);
  if (party === 'receiver') return t.targetUserId === v.userId || t.assigneeUserId === v.userId;
  return isCreator(t, v) || t.assigneeUserId === v.userId;
}
