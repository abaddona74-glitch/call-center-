import type {
  KpiExecutiveFigures,
  KpiExecutiveRegion,
  KpiExecutiveRow,
  KpiExecutiveTicketMetric,
  TicketEventKind,
} from '@cc/shared';

/**
 * «KPI xodimlar» — the "Mas'ul shaxslar" (executives), attributed by the ticket events (docs/rewrite/METRICS.md §11.3).
 * Pure: no Nest, no DB.
 *
 * Every event of a ticket is replayed in order to know the ticket's region at that moment: it starts in the region of
 * the `created` event (if that has none: the region before the first forward, else the ticket's current region) and
 * moves with each `forwarded` event. An action belongs to its actor and to the region the
 * ticket was in when it happened (a forward to the region it was sent FROM). A ticket enters a region's queue when it
 * is created there, forwarded there or released back there; that is the start of the wait until someone takes it.
 */

export interface KpiTicketEventFact {
  id: number;
  ticketId: number;
  kind: TicketEventKind;
  actorUserId: number | null;
  fromRegionId: number | null;
  toRegionId: number | null;
  createdAt: Date;
}

export interface KpiTicketFact {
  id: number;
  /** Current region (the start region of tickets without a `created` event, e.g. migrated ones). */
  regionId: number | null;
  dueAt: Date | null;
}

/** A ticket someone holds right now (assigned / in_progress). */
export interface KpiHoldingFact {
  id: number;
  assigneeUserId: number;
  regionId: number | null;
  dueAt: Date | null;
}

export interface KpiRegionRef {
  id: number;
  code: string;
  nameUz: string;
  nameRu: string;
}

export interface KpiExecutiveRef {
  userId: number;
  username: string;
  /** Assigned regions (`ticket_executive_regions`). */
  regionIds: number[];
}

/** The tickets behind one person's numbers in one region (sets: a ticket counts once per number). */
interface Acc {
  taken: Set<number>;
  done: Set<number>;
  rejected: Set<number>;
  released: Set<number>;
  forwarded: Set<number>;
  late: Set<number>;
  takeMs: number[];
  resolveMs: number[];
  holding: Set<number>;
  overdueNow: Set<number>;
}

const emptyAcc = (): Acc => ({
  taken: new Set(),
  done: new Set(),
  rejected: new Set(),
  released: new Set(),
  forwarded: new Set(),
  late: new Set(),
  takeMs: [],
  resolveMs: [],
  holding: new Set(),
  overdueNow: new Set(),
});

/** Region key: a region id, or "none" for tickets without a region. */
export type RegionKey = number | 'none';
const keyOf = (regionId: number | null): RegionKey => regionId ?? 'none';

const hoursAvg = (ms: number[]) =>
  ms.length ? Math.round((ms.reduce((a, b) => a + b, 0) / ms.length / 3_600_000) * 10) / 10 : null;

const union = (accs: readonly Acc[], pick: (a: Acc) => Set<number>) => {
  const out = new Set<number>();
  for (const a of accs) for (const id of pick(a)) out.add(id);
  return out;
};

function figures(accs: readonly Acc[], arrived: number | null): KpiExecutiveFigures {
  const done = union(accs, (a) => a.done).size;
  const rejected = union(accs, (a) => a.rejected).size;
  const late = union(accs, (a) => a.late).size;
  const resolved = done + rejected;
  return {
    arrived,
    taken: union(accs, (a) => a.taken).size,
    done,
    rejected,
    released: union(accs, (a) => a.released).size,
    forwarded: union(accs, (a) => a.forwarded).size,
    late,
    onTimeRate: resolved ? Math.round(((resolved - late) / resolved) * 1000) / 10 : null,
    avgTakeHours: hoursAvg(accs.flatMap((a) => a.takeMs)),
    avgResolveHours: hoursAvg(accs.flatMap((a) => a.resolveMs)),
    holdingNow: union(accs, (a) => a.holding).size,
    overdueNow: union(accs, (a) => a.overdueNow).size,
  };
}

export interface ExecutiveKpiInput {
  /** Every event (up to the period end) of the tickets that have an event in the period. */
  events: readonly KpiTicketEventFact[];
  tickets: readonly KpiTicketFact[];
  holding: readonly KpiHoldingFact[];
  regions: readonly KpiRegionRef[];
  /** Active users assigned to regions. */
  executives: readonly KpiExecutiveRef[];
  /** userId → username, for actors who are not (or no longer) assigned to a region. */
  names: ReadonlyMap<number, string>;
  period: readonly [Date, Date];
  now: Date;
}

interface Replay {
  /** userId → region → the tickets behind each number. */
  accs: Map<number, Map<RegionKey, Acc>>;
  /** region → tickets that entered its queue in the period (created there or forwarded in). */
  arrivals: Map<RegionKey, Set<number>>;
  assignedOf: Map<number, Set<number>>;
}

/** Replays every ticket's events once: who did what, in which region, in the period (and who holds what now). */
function replay(input: ExecutiveKpiInput): Replay {
  const [from, to] = [input.period[0].getTime(), input.period[1].getTime()];
  const inPeriod = (d: Date) => d.getTime() >= from && d.getTime() < to;
  const ticketById = new Map(input.tickets.map((t) => [t.id, t]));
  const accs = new Map<number, Map<RegionKey, Acc>>();
  const acc = (userId: number, region: RegionKey) => {
    let byRegion = accs.get(userId);
    if (!byRegion) {
      byRegion = new Map();
      accs.set(userId, byRegion);
    }
    let a = byRegion.get(region);
    if (!a) {
      a = emptyAcc();
      byRegion.set(region, a);
    }
    return a;
  };
  const arrivals = new Map<RegionKey, Set<number>>();
  const arrive = (region: RegionKey, ticketId: number) =>
    arrivals.set(region, (arrivals.get(region) ?? new Set()).add(ticketId));

  const byTicket = new Map<number, KpiTicketEventFact[]>();
  for (const e of input.events) {
    const list = byTicket.get(e.ticketId) ?? [];
    list.push(e);
    byTicket.set(e.ticketId, list);
  }

  for (const [ticketId, list] of byTicket) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
    const ticket = ticketById.get(ticketId);
    const created = list.find((e) => e.kind === 'created');
    const firstForward = list.find((e) => e.kind === 'forwarded');
    // A region set at creation, else (no region on the event, e.g. imported data) the region before the first
    // forward, else the ticket's current one — nothing else moves a ticket between regions.
    let region: number | null =
      created?.toRegionId ?? (firstForward ? firstForward.fromRegionId : (ticket?.regionId ?? null));
    let queuedAt: number | null = null;
    let holder: { userId: number; at: number } | null = null;
    const dueAt = ticket?.dueAt?.getTime() ?? null;

    for (const e of list) {
      const at = e.createdAt.getTime();
      const counted = inPeriod(e.createdAt);
      const here = keyOf(region);
      switch (e.kind) {
        case 'created':
          queuedAt = at;
          if (counted) arrive(here, ticketId);
          break;
        case 'forwarded':
          if (counted && e.actorUserId !== null)
            acc(e.actorUserId, keyOf(e.fromRegionId ?? region)).forwarded.add(ticketId);
          region = e.toRegionId;
          queuedAt = at;
          holder = null;
          if (counted) arrive(keyOf(region), ticketId);
          break;
        case 'released':
          if (counted && e.actorUserId !== null) acc(e.actorUserId, here).released.add(ticketId);
          queuedAt = at;
          holder = null;
          break;
        case 'assigned':
          if (e.actorUserId === null) break;
          if (counted) {
            const a = acc(e.actorUserId, here);
            a.taken.add(ticketId);
            if (queuedAt !== null) a.takeMs.push(at - queuedAt);
          }
          holder = { userId: e.actorUserId, at };
          queuedAt = null;
          break;
        case 'done':
        case 'rejected':
          if (e.actorUserId === null) break;
          if (counted) {
            const a = acc(e.actorUserId, here);
            (e.kind === 'done' ? a.done : a.rejected).add(ticketId);
            if (dueAt !== null && at > dueAt) a.late.add(ticketId);
            if (holder?.userId === e.actorUserId) a.resolveMs.push(at - holder.at);
          }
          holder = null;
          break;
        default: // started, returned, callback_attempt, closed: no region work
          break;
      }
    }
  }

  for (const h of input.holding) {
    const a = acc(h.assigneeUserId, keyOf(h.regionId));
    a.holding.add(h.id);
    if (h.dueAt && input.now.getTime() > h.dueAt.getTime()) a.overdueNow.add(h.id);
  }

  return { accs, arrivals, assignedOf: new Map(input.executives.map((e) => [e.userId, new Set(e.regionIds)])) };
}

export function buildExecutiveKpi(input: ExecutiveKpiInput): KpiExecutiveRow[] {
  const { accs, arrivals, assignedOf } = replay(input);
  const regionOrder = new Map(input.regions.map((r, i) => [r.id, i]));
  const regionById = new Map(input.regions.map((r) => [r.id, r]));
  const userIds = new Set<number>([...input.executives.map((e) => e.userId), ...accs.keys()]);

  const rows: KpiExecutiveRow[] = [];
  for (const userId of userIds) {
    const assigned = assignedOf.get(userId) ?? new Set<number>();
    const byRegion = accs.get(userId) ?? new Map<RegionKey, Acc>();
    const keys = new Set<RegionKey>([...assigned, ...byRegion.keys()]);
    const order = (k: RegionKey) => [
      assigned.has(k as number) ? 0 : 1,
      k === 'none' ? 1e9 : (regionOrder.get(k) ?? 1e8),
    ];
    const sorted = [...keys].sort((a, b) => {
      const [x0, x1] = order(a);
      const [y0, y1] = order(b);
      return x0 - y0 || x1 - y1;
    });
    const regions: KpiExecutiveRegion[] = sorted.map((k) => {
      const ref = k === 'none' ? null : regionById.get(k);
      const isAssigned = k !== 'none' && assigned.has(k);
      return {
        regionId: k === 'none' ? null : k,
        code: ref?.code ?? null,
        nameUz: ref?.nameUz ?? (k === 'none' ? 'Hududsiz' : `#${k}`),
        nameRu: ref?.nameRu ?? (k === 'none' ? 'Без области' : `#${k}`),
        assigned: isAssigned,
        ...figures([byRegion.get(k) ?? emptyAcc()], isAssigned ? (arrivals.get(k)?.size ?? 0) : null),
      };
    });
    rows.push({
      userId,
      name: input.executives.find((e) => e.userId === userId)?.username ?? input.names.get(userId) ?? `#${userId}`,
      totals: figures([...byRegion.values()], assigned.size ? arrivedIn(arrivals, assigned).size : null),
      regions,
    });
  }
  return rows.sort((a, b) => b.totals.taken - a.totals.taken || a.name.localeCompare(b.name));
}

function arrivedIn(arrivals: ReadonlyMap<RegionKey, Set<number>>, regions: Iterable<RegionKey>): Set<number> {
  const out = new Set<number>();
  for (const k of regions) for (const id of arrivals.get(k) ?? []) out.add(id);
  return out;
}

/**
 * The tickets behind one of a person's numbers — their whole row (`region` undefined) or one region — from the same
 * replay as buildExecutiveKpi, so a list adds up to its number. `arrived` covers the person's assigned regions (the
 * whole row) or the given region; `resolved` = done + rejected.
 */
export function executiveTicketIds(
  input: ExecutiveKpiInput,
  userId: number,
  region: RegionKey | undefined,
  metric: KpiExecutiveTicketMetric,
): Set<number> {
  const { accs, arrivals, assignedOf } = replay(input);
  const byRegion = accs.get(userId) ?? new Map<RegionKey, Acc>();
  const picked = region === undefined ? [...byRegion.values()] : [byRegion.get(region) ?? emptyAcc()];
  switch (metric) {
    case 'arrived':
      return arrivedIn(arrivals, region === undefined ? (assignedOf.get(userId) ?? []) : [region]);
    case 'resolved':
      return new Set([...union(picked, (a) => a.done), ...union(picked, (a) => a.rejected)]);
    default:
      return union(picked, (a) => a[metric]);
  }
}
