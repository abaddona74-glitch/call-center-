import {
  type TicketAction,
  type TicketActions,
  type TicketActorKind,
  type TicketCapabilities,
  type TicketStatus,
  type TicketView,
  ticketActorKind,
  ticketCapabilities,
} from '@cc/shared';

/**
 * Ticket workflow rules (docs/rewrite/TICKETS.md) as pure functions — no Nest, no database.
 * The service loads the facts, asks these functions, and only then writes.
 */

export interface TicketActor {
  userId: number;
  kind: TicketActorKind;
  capabilities: TicketCapabilities;
  extension: string | null;
  /** Executive: regions the user works for. */
  regionIds: ReadonlySet<number>;
}

export function ticketActor(
  user: { id: number; role: string; extension: string | null },
  regionIds: Iterable<number> = [],
): TicketActor {
  return {
    userId: user.id,
    kind: ticketActorKind(user),
    capabilities: ticketCapabilities(user),
    extension: user.extension,
    regionIds: new Set(regionIds),
  };
}

/** The facts about a ticket that rules depend on. */
export interface TicketFacts {
  status: TicketStatus;
  regionId: number | null;
  creatorUserId: number | null;
  assigneeUserId: number | null;
  closedByUserId: number | null;
  customerPhone: string | null;
}

/** Status after an action; anything not listed is not allowed. Forward keeps `new` (in another region). */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, Partial<Record<TicketAction, TicketStatus>>>> = {
  new: { assign: 'assigned', forward: 'new' },
  assigned: { start: 'in_progress', forward: 'new' },
  in_progress: { resolve: 'done', reject: 'rejected', forward: 'new' },
  done: { return: 'callback_pending' },
  rejected: { return: 'callback_pending' },
  callback_pending: { close: 'closed' },
  closed: {},
};

export function nextStatus(status: TicketStatus, action: TicketAction): TicketStatus | null {
  return TICKET_TRANSITIONS[status][action] ?? null;
}

/** States where the region still works on the ticket (forward is possible, SLA is running). */
export function isRegionalStage(status: TicketStatus): boolean {
  return status === 'new' || status === 'assigned' || status === 'in_progress';
}

export function inMyRegion(actor: TicketActor, t: Pick<TicketFacts, 'regionId'>): boolean {
  return t.regionId !== null && actor.regionIds.has(t.regionId);
}

/**
 * Visibility:
 *  - superuser, observer: everything;
 *  - executive: tickets currently in one of their regions;
 *  - operator: tickets they opened, the shared callback queue, tickets they closed.
 */
export function canViewTicket(actor: TicketActor, t: TicketFacts): boolean {
  if (actor.capabilities.viewAll) return true;
  switch (actor.kind) {
    case 'executive':
      return inMyRegion(actor, t);
    case 'operator':
      return t.creatorUserId === actor.userId || t.status === 'callback_pending' || t.closedByUserId === actor.userId;
    default:
      return false;
  }
}

export type Denial = { ok: false; code: 'not_found' | 'forbidden' | 'conflict' | 'invalid'; message: string };
export type Decision<T> = { ok: true; value: T } | Denial;

const deny = (code: Denial['code'], message: string): Denial => ({ ok: false, code, message });

export interface ActionInput {
  note?: string | null;
  /** forward: the target region. */
  regionId?: number | null;
}

const ACTION_VERB: Record<TicketAction, string> = {
  assign: 'taken',
  start: 'started',
  resolve: 'marked done',
  reject: 'rejected',
  forward: 'forwarded',
  return: 'returned to operators',
  close: 'closed',
};

/** May the actor work on this ticket as its region? (superuser: any region; executives: their regions.) */
function worksHere(actor: TicketActor, t: TicketFacts): boolean {
  if (!actor.capabilities.work) return false;
  return actor.capabilities.administer || inMyRegion(actor, t);
}

function isAssignee(actor: TicketActor, t: TicketFacts): boolean {
  return t.assigneeUserId !== null && t.assigneeUserId === actor.userId;
}

/**
 * Checks one workflow action by a person. `return` (done/rejected → callback queue) is the system's,
 * and `close` goes through the callback rules (ticket-callback.ts), so both are refused here.
 */
export function decideAction(
  actor: TicketActor,
  t: TicketFacts,
  action: TicketAction,
  input: ActionInput = {},
): Decision<TicketStatus> {
  if (!canViewTicket(actor, t)) return deny('not_found', 'Ticket not found');
  const to = nextStatus(t.status, action);
  if (!to) return deny('conflict', `A ticket in status "${t.status}" cannot be ${ACTION_VERB[action]}`);
  const admin = actor.capabilities.administer;

  switch (action) {
    case 'assign':
      if (t.regionId === null) return deny('conflict', 'Route the ticket to a region first');
      if (!worksHere(actor, t)) return deny('forbidden', 'Only executives of this region can take the ticket');
      return { ok: true, value: to };
    case 'start':
    case 'resolve':
      if (!worksHere(actor, t) || !(isAssignee(actor, t) || admin)) {
        return deny('forbidden', 'Only the executive who took the ticket can do this');
      }
      return { ok: true, value: to };
    case 'reject':
      if (!worksHere(actor, t) || !(isAssignee(actor, t) || admin)) {
        return deny('forbidden', 'Only the executive who took the ticket can do this');
      }
      if (!input.note || input.note.trim().length < 2) return deny('invalid', 'A note is required to reject a ticket');
      return { ok: true, value: to };
    case 'forward': {
      const triage = t.regionId === null;
      if (triage ? !admin : !worksHere(actor, t))
        return deny('forbidden', 'Only executives of this region can forward the ticket');
      if (t.status !== 'new' && !(isAssignee(actor, t) || admin)) {
        return deny('forbidden', 'Only the executive who took the ticket can forward it');
      }
      if (!input.regionId) return deny('invalid', 'Choose the region to forward to');
      if (input.regionId === t.regionId) return deny('invalid', 'The ticket is already in this region');
      if (!triage && (!input.note || input.note.trim().length < 2))
        return deny('invalid', 'Write why the ticket is forwarded');
      return { ok: true, value: to };
    }
    default:
      return deny('forbidden', 'This step is not done by hand');
  }
}

/** Comment in the ticket chat: everyone who sees it, except read-only roles. */
export function canComment(actor: TicketActor, t: TicketFacts): boolean {
  return actor.capabilities.comment && canViewTicket(actor, t) && t.status !== 'closed';
}

/** Operators (and the superuser, who has an extension) call back from the queue. */
export function canCallBack(actor: TicketActor, t: TicketFacts): boolean {
  return (
    actor.capabilities.callback &&
    actor.extension !== null &&
    t.status === 'callback_pending' &&
    t.customerPhone !== null &&
    canViewTicket(actor, t)
  );
}

export function canForceClose(actor: TicketActor, t: TicketFacts): boolean {
  return actor.capabilities.administer && t.status === 'callback_pending';
}

export function canDelete(actor: TicketActor): boolean {
  return actor.capabilities.administer;
}

/** Everything the viewer may do with the ticket (sent to the UI; the server re-checks every action). */
export function ticketActions(actor: TicketActor, t: TicketFacts, opts: { hasOpenAttempt: boolean }): TicketActions {
  const ok = (action: TicketAction, input?: ActionInput) => decideAction(actor, t, action, input).ok;
  const someOther = t.regionId === null ? 1 : t.regionId + 1;
  return {
    assign: ok('assign'),
    start: ok('start'),
    resolve: ok('resolve'),
    reject: ok('reject', { note: 'xx' }),
    forward: ok('forward', { regionId: someOther, note: 'xx' }),
    comment: canComment(actor, t),
    call: canCallBack(actor, t),
    recordOutcome: canCallBack(actor, t) && opts.hasOpenAttempt,
    forceClose: canForceClose(actor, t),
    delete: canDelete(actor),
  };
}

/** Does the ticket belong to the list view (for counts and filtering)? */
export function inView(actor: TicketActor, t: TicketFacts, view: TicketView): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'mine':
      if (actor.kind === 'operator') return t.creatorUserId === actor.userId;
      if (actor.kind === 'executive') return isAssignee(actor, t) && t.status !== 'closed';
      return t.creatorUserId === actor.userId || (isAssignee(actor, t) && t.status !== 'closed');
    case 'queue':
      return t.status === 'new' && t.regionId !== null && (actor.capabilities.viewAll || inMyRegion(actor, t));
    case 'callback':
      return t.status === 'callback_pending';
    case 'triage':
      return t.regionId === null && t.status !== 'closed';
    default:
      return false;
  }
}

/** Executive "unread": a `new` ticket of my region that I have not opened since it arrived there. */
export function isUnread(actor: TicketActor, t: TicketFacts & { regionChangedAt: Date }, readAt: Date | null): boolean {
  if (actor.kind !== 'executive' || t.status !== 'new' || !inMyRegion(actor, t)) return false;
  return readAt === null || readAt < t.regionChangedAt;
}
