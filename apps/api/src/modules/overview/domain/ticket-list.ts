/**
 * The tickets behind each ticket number of the overview dashboard (owner, 19.11.2026). One matcher per number, with
 * the same rules as the aggregates in ticket-overview.ts, so a list's total equals the number it was opened from
 * (the spec checks every metric against `buildOverviewTickets`). Pure: no Nest, no DB.
 */
import { type OverviewTicketListItem, type OverviewTicketMetric, type TicketStatus, ticketCode } from '@cc/shared';
import { hoursBetween, isCallbackOverdue, isOverdue } from '../../tickets/domain/sla.js';
import {
  NO_REGION_NAMES,
  type OverviewRegionRef,
  type OverviewTicketFact,
  isCallbackOverdueNow,
  isOverdueNow,
  ticketTakers,
} from './ticket-overview.js';

const HELD: ReadonlySet<TicketStatus> = new Set(['assigned', 'in_progress']);

export interface TicketMetricContext {
  now: Date;
  takers: ReadonlyMap<number, readonly number[]>;
  /** `nowStatus` */
  status?: TicketStatus;
  /** `ex*`: the Mas'ul's user id. */
  executive?: number;
}

/** Which set a metric counts: the tickets created in the period, or the tickets not closed right now. */
export function ticketMetricSource(metric: OverviewTicketMetric): 'period' | 'now' {
  return metric.startsWith('now') || metric === 'exHolding' || metric === 'exOverdueNow' ? 'now' : 'period';
}

export function matchesTicketMetric(
  t: OverviewTicketFact,
  metric: OverviewTicketMetric,
  ctx: TicketMetricContext,
): boolean {
  const { now, executive } = ctx;
  const resolvedLate = t.resolvedAt !== null && isOverdue(t, now);
  switch (metric) {
    case 'received':
      return true;
    case 'taken':
      return ticketTakers(t, ctx.takers).size > 0;
    case 'done':
      return t.resolution === 'done';
    case 'rejected':
      return t.resolution === 'rejected';
    case 'closed':
      return t.status === 'closed';
    case 'open':
      return t.status !== 'closed';
    case 'overdue':
      return isOverdue(t, now);
    case 'overdueOpen':
      return isOverdue(t, now) && t.resolvedAt === null;
    case 'overdueLate':
      return resolvedLate;
    case 'callbackOverdue':
      return isCallbackOverdue(t, now);
    case 'resolved':
      return t.resolvedAt !== null;
    case 'closeTimed':
      return t.status === 'closed' && t.closedAt !== null;
    case 'onTime':
      return (t.resolution === 'done' || t.resolution === 'rejected') && !resolvedLate;
    case 'nowOpen':
      return t.status !== 'closed';
    case 'nowStatus':
      return t.status === ctx.status;
    case 'nowOverdue':
      return isOverdueNow(t, now);
    case 'nowCallbackOverdue':
      return isCallbackOverdueNow(t, now);
    case 'exTaken':
      return executive !== undefined && ticketTakers(t, ctx.takers).has(executive);
    case 'exDone':
      return t.resolvedByUserId === executive && t.resolution === 'done';
    case 'exRejected':
      return t.resolvedByUserId === executive && t.resolution === 'rejected';
    case 'exOverdue':
      return (t.resolvedByUserId ?? t.assigneeUserId) === executive && isOverdue(t, now);
    case 'exResolved':
      return t.resolvedByUserId === executive && t.resolvedAt !== null;
    case 'exHolding':
      return HELD.has(t.status) && t.assigneeUserId === executive;
    case 'exOverdueNow':
      return HELD.has(t.status) && t.assigneeUserId === executive && isOverdueNow(t, now);
  }
}

/** Hours past the due date: resolved late (at resolution) or still with the region (now); null when in time. */
export function overdueHoursOf(t: OverviewTicketFact, now: Date): number | null {
  if (!t.dueAt) return null;
  if (t.resolvedAt) return t.resolvedAt > t.dueAt ? hoursBetween(t.dueAt, t.resolvedAt) : null;
  return isOverdueNow(t, now) ? hoursBetween(t.dueAt, now) : null;
}

export function toTicketListItem(
  t: OverviewTicketFact,
  regionsById: ReadonlyMap<number, OverviewRegionRef>,
  now: Date,
): OverviewTicketListItem {
  const region = t.regionId === null ? undefined : regionsById.get(t.regionId);
  return {
    id: t.id,
    code: ticketCode(t.id),
    createdAt: t.createdAt.toISOString(),
    regionCode: region?.code ?? null,
    regionNameUz: region?.nameUz ?? NO_REGION_NAMES.nameUz,
    regionNameRu: region?.nameRu ?? NO_REGION_NAMES.nameRu,
    executive: t.resolvedByLabel ?? (HELD.has(t.status) || t.resolvedAt ? t.assigneeLabel : null),
    status: t.status,
    dueAt: t.dueAt?.toISOString() ?? null,
    overdueHours: overdueHoursOf(t, now),
    closedAt: t.closedAt?.toISOString() ?? null,
    organization: t.organizationName,
  };
}

/** Search: the ticket number ("TK-12", "12"), the Mas'ul, the organization or the region name. */
export function matchesTicketSearch(item: OverviewTicketListItem, search: string | undefined): boolean {
  if (!search) return true;
  const q = search.toLowerCase().replace(/\s+/g, ' ').trim();
  const digits = q.replace(/^tk-?/, '');
  if (/^\d+$/.test(digits) && String(item.id) === digits) return true;
  return [item.code, item.executive, item.organization, item.regionNameUz, item.regionNameRu].some(
    (v) => v !== null && v.toLowerCase().includes(q),
  );
}
