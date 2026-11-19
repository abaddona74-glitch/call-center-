/**
 * Ticket figures of the overview dashboard (docs/rewrite/METRICS.md §8). Pure: no Nest, no DB.
 *
 * Two views:
 *  - the period: tickets CREATED in it (one cohort, like the ticket reports), each in its current state;
 *  - now: tickets not closed yet, whatever their creation date (backlog, overdue right now).
 * SLA rules are the tickets module's (`isOverdue`, `isCallbackOverdue`), so the numbers match the ticket reports.
 */
import {
  OVERVIEW_NO_REGION,
  type OverviewExecutiveRow,
  type OverviewNow,
  type OverviewOverdueTicket,
  type OverviewRegionRow,
  type OverviewStatusCount,
  type OverviewTicketTotals,
  TICKET_STATUSES,
  type TicketResolution,
  type TicketStatus,
  ticketCode,
} from '@cc/shared';
import { hoursBetween, isCallbackOverdue, isOverdue } from '../../tickets/domain/sla.js';

export interface OverviewTicketFact {
  id: number;
  status: TicketStatus;
  regionId: number | null;
  assigneeUserId: number | null;
  assigneeLabel: string | null;
  resolvedByUserId: number | null;
  resolvedByLabel: string | null;
  resolution: TicketResolution | null;
  createdAt: Date;
  dueAt: Date | null;
  resolvedAt: Date | null;
  callbackDueAt: Date | null;
  closedAt: Date | null;
}

export interface OverviewRegionRef {
  id: number;
  code: string;
  nameUz: string;
  nameRu: string;
  isActive: boolean;
}

export interface OverviewExecutiveRef {
  userId: number;
  username: string;
  /** Regions from `ticket_executive_regions`. */
  regionIds: number[];
}

/** `undefined` = whole country; `null` = tickets without a region. */
export type RegionFilter = number | null | undefined;

export interface OverviewTicketsInput {
  /** Created in the period, every region. */
  cohort: readonly OverviewTicketFact[];
  /** Not closed right now, every region. */
  open: readonly OverviewTicketFact[];
  /** Ticket id → users who took it ("assigned" events). */
  takers: ReadonlyMap<number, readonly number[]>;
  /** In display order. */
  regions: readonly OverviewRegionRef[];
  executives: readonly OverviewExecutiveRef[];
  region: RegionFilter;
  now: Date;
}

export interface OverviewTicketsResult {
  totals: OverviewTicketTotals;
  byStatus: OverviewStatusCount[];
  now: OverviewNow;
  regions: OverviewRegionRow[];
  executives: OverviewExecutiveRow[];
}

export const NO_REGION_NAMES = { nameUz: 'Hududsiz', nameRu: 'Без региона' } as const;
const OLDEST_OVERDUE_LIMIT = 10;
/** Statuses where the ticket is still with the region (the SLA clock runs). */
const WITH_REGION: ReadonlySet<TicketStatus> = new Set(['new', 'assigned', 'in_progress']);
const HELD: ReadonlySet<TicketStatus> = new Set(['assigned', 'in_progress']);

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

const matches = (t: OverviewTicketFact, region: RegionFilter) => region === undefined || t.regionId === region;

/** Still with the region after `due_at`, right now. */
export function isOverdueNow(t: OverviewTicketFact, now: Date): boolean {
  return WITH_REGION.has(t.status) && t.dueAt !== null && now.getTime() > t.dueAt.getTime();
}

/** Waiting for the operator's callback after `callback_due_at`, right now. */
export function isCallbackOverdueNow(t: OverviewTicketFact, now: Date): boolean {
  return t.status !== 'closed' && t.closedAt === null && isCallbackOverdue(t, now);
}

/** Users who took the ticket: "assigned" events, plus the current holder and the resolver (rows migrated without events). */
function takersOf(t: OverviewTicketFact, takers: ReadonlyMap<number, readonly number[]>): Set<number> {
  const out = new Set(takers.get(t.id) ?? []);
  if (t.assigneeUserId !== null) out.add(t.assigneeUserId);
  if (t.resolvedByUserId !== null) out.add(t.resolvedByUserId);
  return out;
}

/** Period figures of a set of tickets created in the period. */
export function ticketTotals(
  tickets: readonly OverviewTicketFact[],
  takers: ReadonlyMap<number, readonly number[]>,
  now: Date,
): OverviewTicketTotals {
  const totals: OverviewTicketTotals = {
    received: tickets.length,
    taken: 0,
    done: 0,
    rejected: 0,
    closed: 0,
    open: 0,
    overdue: 0,
    overdueOpen: 0,
    overdueLate: 0,
    callbackOverdue: 0,
    avgResolutionHours: null,
    avgCloseHours: null,
  };
  const resolution: number[] = [];
  const close: number[] = [];
  for (const t of tickets) {
    if (takersOf(t, takers).size > 0) totals.taken++;
    if (t.resolution === 'done') totals.done++;
    if (t.resolution === 'rejected') totals.rejected++;
    if (t.status === 'closed') totals.closed++;
    else totals.open++;
    if (isOverdue(t, now)) {
      totals.overdue++;
      if (t.resolvedAt) totals.overdueLate++;
      else totals.overdueOpen++;
    }
    if (isCallbackOverdue(t, now)) totals.callbackOverdue++;
    if (t.resolvedAt) resolution.push(hoursBetween(t.createdAt, t.resolvedAt));
    if (t.status === 'closed' && t.closedAt) close.push(hoursBetween(t.createdAt, t.closedAt));
  }
  totals.avgResolutionHours = avg(resolution);
  totals.avgCloseHours = avg(close);
  return totals;
}

function statusCounts(
  tickets: readonly OverviewTicketFact[],
  statuses: readonly TicketStatus[],
): OverviewStatusCount[] {
  const counts = new Map<TicketStatus, number>();
  for (const t of tickets) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  return statuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

function nowView(
  open: readonly OverviewTicketFact[],
  regionsById: ReadonlyMap<number, OverviewRegionRef>,
  now: Date,
): OverviewNow {
  const overdue = open
    .filter((t) => isOverdueNow(t, now))
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime() || a.id - b.id);
  const oldestOverdue: OverviewOverdueTicket[] = overdue.slice(0, OLDEST_OVERDUE_LIMIT).map((t) => {
    const region = t.regionId === null ? undefined : regionsById.get(t.regionId);
    return {
      id: t.id,
      code: ticketCode(t.id),
      regionCode: region?.code ?? null,
      regionNameUz: region?.nameUz ?? NO_REGION_NAMES.nameUz,
      regionNameRu: region?.nameRu ?? NO_REGION_NAMES.nameRu,
      status: t.status,
      dueAt: (t.dueAt as Date).toISOString(),
      executive: HELD.has(t.status) ? t.assigneeLabel : null,
    };
  });
  return {
    byStatus: statusCounts(
      open.filter((t) => t.status !== 'closed'),
      TICKET_STATUSES.filter((s) => s !== 'closed'),
    ),
    overdue: overdue.length,
    callbackOverdue: open.filter((t) => isCallbackOverdueNow(t, now)).length,
    oldestOverdue,
  };
}

function regionRows(input: OverviewTicketsInput): OverviewRegionRow[] {
  const { cohort, open, takers, regions, executives, now } = input;
  const executivesOf = new Map<number, number>();
  for (const e of executives)
    for (const id of new Set(e.regionIds)) executivesOf.set(id, (executivesOf.get(id) ?? 0) + 1);

  const row = (regionId: number | null, ref: { code: string | null; nameUz: string; nameRu: string }) => ({
    regionId,
    code: ref.code,
    nameUz: ref.nameUz,
    nameRu: ref.nameRu,
    ...ticketTotals(
      cohort.filter((t) => t.regionId === regionId),
      takers,
      now,
    ),
    executives: regionId === null ? 0 : (executivesOf.get(regionId) ?? 0),
    overdueNow: open.filter((t) => t.regionId === regionId && isOverdueNow(t, now)).length,
  });
  // `regions` holds every directory row (tickets reference regions with a RESTRICT foreign key); a deactivated
  // region is shown only while it has tickets.
  const hasData = (id: number | null) => cohort.some((t) => t.regionId === id) || open.some((t) => t.regionId === id);
  const rows = regions.filter((r) => r.isActive || hasData(r.id)).map((r) => row(r.id, r));
  if (hasData(null)) rows.push(row(null, { code: null, ...NO_REGION_NAMES }));
  return rows;
}

function executiveRows(
  input: OverviewTicketsInput,
  cohort: readonly OverviewTicketFact[],
  open: readonly OverviewTicketFact[],
) {
  const { takers, regions, executives, region, now } = input;
  const codeOf = new Map(regions.map((r) => [r.id, r.code]));
  interface Acc {
    userId: number;
    name: string | null;
    regions: number[];
    taken: number;
    done: number;
    rejected: number;
    overdue: number;
    hours: number[];
    holdingNow: number;
    overdueNow: number;
  }
  const accs = new Map<number, Acc>();
  const acc = (userId: number): Acc => {
    let a = accs.get(userId);
    if (!a) {
      a = {
        userId,
        name: null,
        regions: [],
        taken: 0,
        done: 0,
        rejected: 0,
        overdue: 0,
        hours: [],
        holdingNow: 0,
        overdueNow: 0,
      };
      accs.set(userId, a);
    }
    return a;
  };
  // Every executive of the selected region (all of them without a filter) gets a row, even without tickets.
  for (const e of executives) {
    if (region === undefined || (region !== null && e.regionIds.includes(region))) acc(e.userId);
  }

  for (const t of cohort) {
    for (const userId of takersOf(t, takers)) acc(userId).taken++;
    if (t.resolvedByUserId !== null) {
      const a = acc(t.resolvedByUserId);
      a.name ??= t.resolvedByLabel;
      if (t.resolution === 'done') a.done++;
      if (t.resolution === 'rejected') a.rejected++;
      if (t.resolvedAt) a.hours.push(hoursBetween(t.createdAt, t.resolvedAt));
    }
    // Same attribution as the ticket reports: the resolver, else the holder.
    const owner = t.resolvedByUserId ?? t.assigneeUserId;
    if (owner !== null && isOverdue(t, now)) acc(owner).overdue++;
    if (t.assigneeUserId !== null) acc(t.assigneeUserId).name ??= t.assigneeLabel;
  }
  for (const t of open) {
    if (!HELD.has(t.status) || t.assigneeUserId === null) continue;
    const a = acc(t.assigneeUserId);
    a.name ??= t.assigneeLabel;
    a.holdingNow++;
    if (isOverdueNow(t, now)) a.overdueNow++;
  }
  const usernames = new Map(executives.map((e) => [e.userId, e.username]));
  for (const e of executives) if (accs.has(e.userId)) acc(e.userId).regions = e.regionIds;

  return [...accs.values()]
    .map((a): OverviewExecutiveRow => ({
      userId: a.userId,
      name: a.name ?? usernames.get(a.userId) ?? `#${a.userId}`,
      regions: a.regions.map((id) => codeOf.get(id)).filter((c): c is string => Boolean(c)),
      taken: a.taken,
      done: a.done,
      rejected: a.rejected,
      overdue: a.overdue,
      avgResolutionHours: avg(a.hours),
      holdingNow: a.holdingNow,
      overdueNow: a.overdueNow,
    }))
    .sort((a, b) => b.taken - a.taken || b.holdingNow - a.holdingNow || a.name.localeCompare(b.name));
}

export function buildOverviewTickets(input: OverviewTicketsInput): OverviewTicketsResult {
  const { region, now, takers } = input;
  const cohort = input.cohort.filter((t) => matches(t, region));
  const open = input.open.filter((t) => matches(t, region));
  return {
    totals: ticketTotals(cohort, takers, now),
    byStatus: statusCounts(cohort, TICKET_STATUSES),
    now: nowView(open, new Map(input.regions.map((r) => [r.id, r])), now),
    regions: regionRows(input),
    executives: executiveRows(input, cohort, open),
  };
}

/** The `region` query value → filter: a region id, null for "none", undefined when absent. */
export function regionFilterOf(
  value: string | undefined,
  regions: readonly OverviewRegionRef[],
): { ok: true; filter: RegionFilter } | { ok: false } {
  if (value === undefined) return { ok: true, filter: undefined };
  if (value === OVERVIEW_NO_REGION) return { ok: true, filter: null };
  const r = regions.find((x) => x.code === value);
  return r ? { ok: true, filter: r.id } : { ok: false };
}
