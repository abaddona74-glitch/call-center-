import { TICKET_STATUSES, type TicketReport, type TicketReportRow, type TicketStatus } from '@cc/shared';
import { hoursBetween, isCallbackOverdue, isOverdue } from './sla.js';

/** The ticket facts a report needs. */
export interface ReportTicket {
  status: TicketStatus;
  regionId: number | null;
  categoryId: number | null;
  /** Who resolved it (done/rejected), else who holds it. */
  executiveUserId: number | null;
  executiveLabel: string | null;
  createdAt: Date;
  dueAt: Date | null;
  resolvedAt: Date | null;
  callbackDueAt: Date | null;
  closedAt: Date | null;
}

export interface NamedRef {
  nameUz: string;
  nameRu: string;
}

interface Acc {
  total: number;
  resolved: number;
  overdue: number;
  callbackOverdue: number;
  hours: number[];
}

const empty = (): Acc => ({ total: 0, resolved: 0, overdue: 0, callbackOverdue: 0, hours: [] });
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * Pure aggregation for GET /tickets/reports: by region, category, status and executive; overdue share and
 * average time to resolution (created → done/rejected, calendar hours); "callback overdue" (the callback SLA,
 * done/rejected → closed) is a separate metric. `now` decides overdue for tickets still open.
 */
export function buildTicketReport(
  tickets: ReportTicket[],
  names: { regions: Map<number, NamedRef>; categories: Map<number, NamedRef> },
  range: { from: string; to: string },
  now: Date,
): TicketReport {
  const byRegion = new Map<number | null, Acc>();
  const byCategory = new Map<number | null, Acc>();
  const byExecutive = new Map<number | null, Acc & { label: string }>();
  const byStatus = new Map<TicketStatus, number>();
  const total = empty();
  let closed = 0;

  for (const t of tickets) {
    const over = isOverdue({ status: t.status, dueAt: t.dueAt, resolvedAt: t.resolvedAt }, now);
    const callbackOver = isCallbackOverdue({ callbackDueAt: t.callbackDueAt, closedAt: t.closedAt }, now);
    const hours = t.resolvedAt ? hoursBetween(t.createdAt, t.resolvedAt) : null;
    const add = (acc: Acc) => {
      acc.total++;
      if (t.resolvedAt) acc.resolved++;
      if (over) acc.overdue++;
      if (callbackOver) acc.callbackOverdue++;
      if (hours !== null) acc.hours.push(hours);
    };
    add(total);
    const r = byRegion.get(t.regionId) ?? empty();
    add(r);
    byRegion.set(t.regionId, r);
    const c = byCategory.get(t.categoryId) ?? empty();
    add(c);
    byCategory.set(t.categoryId, c);
    if (t.executiveUserId !== null || t.executiveLabel !== null) {
      const e = byExecutive.get(t.executiveUserId) ?? { ...empty(), label: t.executiveLabel ?? '—' };
      add(e);
      byExecutive.set(t.executiveUserId, e);
    }
    byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    if (t.status === 'closed') closed++;
  }

  const row = (id: number | null, name: NamedRef, a: Acc): TicketReportRow => ({
    id,
    nameUz: name.nameUz,
    nameRu: name.nameRu,
    total: a.total,
    resolved: a.resolved,
    overdue: a.overdue,
    callbackOverdue: a.callbackOverdue,
    avgResolutionHours: avg(a.hours),
  });
  const unknown: NamedRef = { nameUz: 'Koʻrsatilmagan', nameRu: 'Не указано' };
  const sortRows = (rows: TicketReportRow[]) =>
    rows.sort((a, b) => b.total - a.total || a.nameUz.localeCompare(b.nameUz));

  return {
    from: range.from,
    to: range.to,
    total: total.total,
    resolved: total.resolved,
    closed,
    overdue: total.overdue,
    overdueShare: total.total ? Math.round((total.overdue / total.total) * 1000) / 1000 : 0,
    callbackOverdue: total.callbackOverdue,
    callbackOverdueShare: total.resolved ? Math.round((total.callbackOverdue / total.resolved) * 1000) / 1000 : 0,
    avgResolutionHours: avg(total.hours),
    byStatus: TICKET_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })),
    byRegion: sortRows([...byRegion].map(([id, a]) => row(id, (id !== null && names.regions.get(id)) || unknown, a))),
    byCategory: sortRows(
      [...byCategory].map(([id, a]) => row(id, (id !== null && names.categories.get(id)) || unknown, a)),
    ),
    byExecutive: sortRows([...byExecutive].map(([id, a]) => row(id, { nameUz: a.label, nameRu: a.label }, a))),
  };
}
