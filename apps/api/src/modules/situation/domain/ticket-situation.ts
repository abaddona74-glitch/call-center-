/**
 * Tickets right now for the live situation board (docs/rewrite/METRICS.md §10.2). Pure: no Nest, no DB.
 *
 * Deadlines use the tickets module's own SLA rules (`isOverdue`, `isCallbackOverdue`) on the stored `due_at` /
 * `callback_due_at` (set by the working calendar when the ticket was opened / finished), so "overdue" here is the
 * same ticket set the tickets pages highlight and the overview dashboard counts as overdue now.
 */
import {
  SITUATION_HELD_TICKETS_MAX,
  type SituationHeldTicket,
  type SituationRegionQueue,
  type SituationRegionRef,
  type SituationTickets,
  type SituationWorker,
  type TicketStatus,
  ticketCode,
} from '@cc/shared';
import { isCallbackOverdue, isOverdue } from '../../tickets/domain/sla.js';

export interface SituationTicketFact {
  id: number;
  status: TicketStatus;
  regionId: number | null;
  assigneeUserId: number | null;
  assignedAt: Date | null;
  createdAt: Date;
  dueAt: Date | null;
  resolvedAt: Date | null;
  callbackDueAt: Date | null;
  closedAt: Date | null;
  /** Entered the current region's queue (created, forwarded or released back). */
  regionChangedAt: Date;
}

export interface SituationRegion {
  id: number;
  code: string;
  nameUz: string;
  nameRu: string;
}

export interface SituationExecutive {
  userId: number;
  username: string;
  /** `ticket_executive_regions`. */
  regionIds: number[];
}

export interface SituationTicketsInput {
  /** Every ticket that is not closed. */
  open: readonly SituationTicketFact[];
  /** Counts since the start of today (Tashkent). */
  today: { opened: number; resolved: number; closed: number };
  /** userId → tickets that user finished (done / rejected) today. */
  resolvedTodayBy: ReadonlyMap<number, number>;
  /** Every region (deactivated too: old tickets may point at them), directory order. */
  regions: readonly SituationRegion[];
  /** Active users assigned to regions. */
  executives: readonly SituationExecutive[];
  /** userId → username of everyone else holding tickets (e.g. the superuser, a deactivated executive). */
  usernames: ReadonlyMap<number, string>;
  now: Date;
  /** End of today (Tashkent midnight), for "due today". */
  dayEnd: Date;
  slaWorkingDays: number;
  callbackSlaWorkingDays: number;
}

export const NO_REGION: Omit<SituationRegionRef, 'code'> = { nameUz: 'Hududsiz', nameRu: 'Без региона' };

/** Still with the region: in its queue or held by an executive. */
const WITH_REGION = new Set<TicketStatus>(['new', 'assigned', 'in_progress']);
const HELD = new Set<TicketStatus>(['assigned', 'in_progress']);

export function buildSituationTickets(input: SituationTicketsInput): SituationTickets {
  const { open, now } = input;
  const regionById = new Map(input.regions.map((r) => [r.id, r]));
  const refOf = (id: number | null): SituationRegionRef => {
    const r = id === null ? undefined : regionById.get(id);
    return r ? { code: r.code, nameUz: r.nameUz, nameRu: r.nameRu } : { code: null, ...NO_REGION };
  };
  const overdueNow = (t: SituationTicketFact) => WITH_REGION.has(t.status) && isOverdue(t, now);

  const statusCount = (s: TicketStatus) => open.filter((t) => t.status === s).length;
  const withRegion = open.filter((t) => WITH_REGION.has(t.status));

  return {
    open: {
      total: open.length,
      new: statusCount('new'),
      assigned: statusCount('assigned'),
      inProgress: statusCount('in_progress'),
      callbackPending: statusCount('callback_pending'),
    },
    overdue: withRegion.filter(overdueNow).length,
    dueToday: withRegion.filter((t) => !overdueNow(t) && t.dueAt !== null && t.dueAt <= input.dayEnd).length,
    callbackOverdue: open.filter((t) => t.status === 'callback_pending' && isCallbackOverdue(t, now)).length,
    today: { ...input.today },
    waiting: regionQueues(input, refOf, overdueNow),
    workers: workers(input, refOf, overdueNow),
    slaWorkingDays: input.slaWorkingDays,
    callbackSlaWorkingDays: input.callbackSlaWorkingDays,
    generatedAt: now.toISOString(),
  };
}

function regionQueues(
  input: SituationTicketsInput,
  refOf: (id: number | null) => SituationRegionRef,
  overdueNow: (t: SituationTicketFact) => boolean,
): SituationRegionQueue[] {
  const byRegion = new Map<number | null, SituationTicketFact[]>();
  for (const t of input.open) {
    if (t.status !== 'new') continue;
    const list = byRegion.get(t.regionId) ?? [];
    list.push(t);
    byRegion.set(t.regionId, list);
  }
  const rows: Array<SituationRegionQueue & { at: number }> = [];
  for (const [regionId, list] of byRegion) {
    const at = Math.min(...list.map((t) => t.regionChangedAt.getTime()));
    rows.push({
      ...refOf(regionId),
      waiting: list.length,
      overdue: list.filter(overdueNow).length,
      oldestSince: new Date(at).toISOString(),
      executives: regionId === null ? 0 : input.executives.filter((e) => e.regionIds.includes(regionId)).length,
      at,
    });
  }
  // The longest-waiting queue first; equal ages — the bigger queue first.
  return rows
    .sort((a, b) => a.at - b.at || b.waiting - a.waiting || a.nameUz.localeCompare(b.nameUz))
    .map(({ at: _at, ...row }) => row);
}

function workers(
  input: SituationTicketsInput,
  refOf: (id: number | null) => SituationRegionRef,
  overdueNow: (t: SituationTicketFact) => boolean,
): SituationWorker[] {
  const order = new Map(input.regions.map((r, i) => [r.id, i]));
  const held = new Map<number, SituationTicketFact[]>();
  for (const t of input.open) {
    if (!HELD.has(t.status) || t.assigneeUserId === null) continue;
    const list = held.get(t.assigneeUserId) ?? [];
    list.push(t);
    held.set(t.assigneeUserId, list);
  }

  const people = new Map<number, { username: string; regionIds: number[] }>();
  for (const e of input.executives) people.set(e.userId, { username: e.username, regionIds: e.regionIds });
  for (const userId of held.keys())
    if (!people.has(userId))
      people.set(userId, { username: input.usernames.get(userId) ?? `#${userId}`, regionIds: [] });

  const since = (t: SituationTicketFact) => (t.assignedAt ?? t.createdAt).getTime();
  const rows = [...people].map(([userId, p]) => {
    const list = [...(held.get(userId) ?? [])].sort((a, b) => since(a) - since(b) || a.id - b.id);
    const tickets: SituationHeldTicket[] = list.slice(0, SITUATION_HELD_TICKETS_MAX).map((t) => ({
      id: t.id,
      code: ticketCode(t.id),
      status: t.status,
      since: new Date(since(t)).toISOString(),
      dueAt: t.dueAt?.toISOString() ?? null,
      overdue: overdueNow(t),
    }));
    const worker: SituationWorker = {
      userId,
      username: p.username,
      regions: [...p.regionIds].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)).map((id) => refOf(id)),
      holding: list.length,
      assigned: list.filter((t) => t.status === 'assigned').length,
      inProgress: list.filter((t) => t.status === 'in_progress').length,
      overdue: list.filter(overdueNow).length,
      resolvedToday: input.resolvedTodayBy.get(userId) ?? 0,
      tickets,
    };
    return { worker, oldest: list.length ? since(list[0]) : Number.POSITIVE_INFINITY };
  });
  // Busiest first, then whoever has held a ticket the longest, then by name.
  return rows
    .sort(
      (a, b) =>
        b.worker.holding - a.worker.holding ||
        a.oldest - b.oldest ||
        b.worker.resolvedToday - a.worker.resolvedToday ||
        a.worker.username.localeCompare(b.worker.username),
    )
    .map((r) => r.worker);
}
