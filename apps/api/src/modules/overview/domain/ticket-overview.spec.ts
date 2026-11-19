import type { OverviewTicketMetric } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import {
  type TicketMetricContext,
  matchesTicketMetric,
  matchesTicketSearch,
  ticketMetricSource,
  toTicketListItem,
} from './ticket-list.js';
import {
  buildOverviewTickets,
  isCallbackOverdueNow,
  isOverdueNow,
  type OverviewExecutiveRef,
  type OverviewRegionRef,
  type OverviewTicketFact,
  regionFilterOf,
  ticketTotals,
} from './ticket-overview.js';

const now = new Date('2026-11-30T12:00:00Z');
const TASH = 1;
const SAM = 11;
const OLD = 20; // deactivated region
const regions: OverviewRegionRef[] = [
  { id: TASH, code: 'toshkent-shahri', nameUz: 'Toshkent shahri', nameRu: 'г. Ташкент', isActive: true },
  { id: SAM, code: 'samarqand', nameUz: 'Samarqand', nameRu: 'Самаркандская область', isActive: true },
  { id: OLD, code: 'eski', nameUz: 'Eski', nameRu: 'Старая', isActive: false },
];
const executives: OverviewExecutiveRef[] = [
  { userId: 5, username: 'ali', regionIds: [TASH] },
  { userId: 6, username: 'vali', regionIds: [TASH, SAM] },
  { userId: 7, username: 'bek', regionIds: [SAM] },
];

let nextId = 1;
const t = (over: Partial<OverviewTicketFact>): OverviewTicketFact => ({
  id: nextId++,
  status: 'new',
  regionId: TASH,
  assigneeUserId: null,
  assigneeLabel: null,
  resolvedByUserId: null,
  resolvedByLabel: null,
  resolution: null,
  createdAt: new Date('2026-11-23T10:00:00Z'),
  dueAt: new Date('2026-11-26T10:00:00Z'),
  resolvedAt: null,
  callbackDueAt: null,
  closedAt: null,
  organizationName: null,
  ...over,
});

// The period's tickets (created 23.11, due 26.11 10:00 UTC).
const closedInTime = t({
  status: 'closed',
  assigneeUserId: 5,
  assigneeLabel: 'Ali',
  resolvedByUserId: 5,
  resolvedByLabel: 'Ali',
  resolution: 'done',
  resolvedAt: new Date('2026-11-24T10:00:00Z'), // 24 h
  callbackDueAt: new Date('2026-11-25T10:00:00Z'),
  closedAt: new Date('2026-11-24T22:00:00Z'), // 36 h, callback in time
});
const rejectedLate = t({
  status: 'callback_pending',
  assigneeUserId: 6,
  assigneeLabel: 'Vali',
  resolvedByUserId: 6,
  resolvedByLabel: 'Vali',
  resolution: 'rejected',
  resolvedAt: new Date('2026-11-27T10:00:00Z'), // 96 h, after due
  callbackDueAt: new Date('2026-11-28T10:00:00Z'), // callback overdue now
});
const heldOverdue = t({ status: 'in_progress', assigneeUserId: 6, assigneeLabel: 'Vali' });
const queuedInTime = t({ status: 'new', regionId: SAM, dueAt: new Date('2026-12-02T10:00:00Z') });
const noRegion = t({ status: 'new', regionId: null, dueAt: new Date('2026-12-02T10:00:00Z') });
const cohort = [closedInTime, rejectedLate, heldOverdue, queuedInTime, noRegion];

// Open tickets created before the period: still count "now".
const olderQueued = t({
  status: 'new',
  regionId: SAM,
  createdAt: new Date('2026-11-10T10:00:00Z'),
  dueAt: new Date('2026-11-13T10:00:00Z'),
});
const olderHeld = t({
  status: 'assigned',
  regionId: SAM,
  assigneeUserId: 7,
  assigneeLabel: 'Bek',
  createdAt: new Date('2026-11-11T10:00:00Z'),
  dueAt: new Date('2026-11-14T10:00:00Z'),
});
const open = [rejectedLate, heldOverdue, queuedInTime, noRegion, olderQueued, olderHeld];

// Vali took the first ticket before Ali (released it back to the queue): "taken" counts both.
const takers = new Map<number, number[]>([
  [closedInTime.id, [6, 5]],
  [rejectedLate.id, [6]],
  [heldOverdue.id, [6]],
]);

const build = (region?: number | null) =>
  buildOverviewTickets({ cohort, open, takers, regions, executives, region, now });

describe('ticketTotals', () => {
  it('counts the period cohort in its current state, with the ticket-report SLA rules', () => {
    expect(ticketTotals(cohort, takers, now)).toEqual({
      received: 5,
      taken: 3,
      done: 1,
      rejected: 1,
      closed: 1,
      open: 4,
      overdue: 2,
      overdueOpen: 1, // held after due
      overdueLate: 1, // rejected after due
      callbackOverdue: 1,
      avgResolutionHours: 60, // (24 + 96) / 2
      avgCloseHours: 36,
    });
  });

  it('is all zeros / null for no tickets', () => {
    const z = ticketTotals([], new Map(), now);
    expect(z.received).toBe(0);
    expect(z.avgResolutionHours).toBeNull();
    expect(z.avgCloseHours).toBeNull();
  });

  it('counts the holder as a taker when a migrated ticket has no events', () => {
    expect(ticketTotals([t({ status: 'assigned', assigneeUserId: 9 })], new Map(), now).taken).toBe(1);
  });
});

describe('now', () => {
  it('overdue now = still with the region after due; callback overdue = waiting after callback due', () => {
    expect(isOverdueNow(heldOverdue, now)).toBe(true);
    expect(isOverdueNow(queuedInTime, now)).toBe(false);
    expect(isOverdueNow(rejectedLate, now)).toBe(false); // with the operators now
    expect(isCallbackOverdueNow(rejectedLate, now)).toBe(true);
    expect(isCallbackOverdueNow(closedInTime, now)).toBe(false);
  });

  it('backlog by status, overdue whatever the creation date, the oldest first', () => {
    const r = build();
    expect(r.now.overdue).toBe(3); // heldOverdue + olderQueued + olderHeld
    expect(r.now.callbackOverdue).toBe(1);
    expect(r.now.byStatus).toEqual([
      { status: 'new', count: 3 },
      { status: 'assigned', count: 1 },
      { status: 'in_progress', count: 1 },
      { status: 'done', count: 0 },
      { status: 'rejected', count: 0 },
      { status: 'callback_pending', count: 1 },
    ]);
    expect(r.now.oldestOverdue.map((x) => [x.code, x.regionCode, x.executive])).toEqual([
      [`TK-${olderQueued.id}`, 'samarqand', null],
      [`TK-${olderHeld.id}`, 'samarqand', 'Bek'],
      [`TK-${heldOverdue.id}`, 'toshkent-shahri', 'Vali'],
    ]);
    expect(r.now.oldestOverdue[0].dueAt).toBe('2026-11-13T10:00:00.000Z');
  });
});

describe('buildOverviewTickets', () => {
  it('regions: every active one (map), deactivated only with tickets, "Hududsiz" last', () => {
    const r = build();
    expect(r.regions.map((x) => [x.code, x.received, x.overdue, x.overdueNow, x.executives])).toEqual([
      ['toshkent-shahri', 3, 2, 1, 2],
      ['samarqand', 1, 0, 2, 2],
      [null, 1, 0, 0, 0],
    ]);
    expect(r.regions.at(-1)).toMatchObject({ regionId: null, nameUz: 'Hududsiz', nameRu: 'Без региона' });
    const withOld = buildOverviewTickets({
      cohort: [...cohort, t({ regionId: OLD })],
      open,
      takers,
      regions,
      executives,
      region: undefined,
      now,
    });
    expect(withOld.regions.map((x) => x.code)).toEqual(['toshkent-shahri', 'samarqand', 'eski', null]);
  });

  it('executives: taken / done / rejected / overdue from the period, holding and overdue now', () => {
    const r = build();
    expect(r.executives).toEqual([
      {
        userId: 6,
        name: 'Vali',
        regions: ['toshkent-shahri', 'samarqand'],
        taken: 3,
        done: 0,
        rejected: 1,
        overdue: 2, // rejected late + held after due
        avgResolutionHours: 96,
        holdingNow: 1,
        overdueNow: 1,
      },
      {
        userId: 5,
        name: 'Ali',
        regions: ['toshkent-shahri'],
        taken: 1,
        done: 1,
        rejected: 0,
        overdue: 0,
        avgResolutionHours: 24,
        holdingNow: 0,
        overdueNow: 0,
      },
      {
        userId: 7,
        name: 'Bek',
        regions: ['samarqand'],
        taken: 0,
        done: 0,
        rejected: 0,
        overdue: 0,
        avgResolutionHours: null,
        holdingNow: 1,
        overdueNow: 1,
      },
    ]);
  });

  it('an executive without any ticket still gets a row (username as the name)', () => {
    const r = buildOverviewTickets({
      cohort: [],
      open: [],
      takers: new Map(),
      regions,
      executives,
      region: undefined,
      now,
    });
    expect(r.executives.map((e) => e.name).sort()).toEqual(['ali', 'bek', 'vali']);
    expect(r.regions).toHaveLength(2); // no "Hududsiz", no deactivated region
  });

  it('a region filter narrows totals, now and executives, never the map rows', () => {
    const r = build(SAM);
    expect(r.totals.received).toBe(1);
    expect(r.now.overdue).toBe(2);
    expect(r.executives.map((e) => e.name)).toEqual(['Bek', 'vali']); // Samarqand's executives only
    expect(r.regions).toHaveLength(3);

    const none = build(null);
    expect(none.totals.received).toBe(1);
    expect(none.executives).toEqual([]);
  });

  it('a superuser who took a ticket shows up next to the executives', () => {
    const r = buildOverviewTickets({
      cohort: [t({ status: 'assigned', assigneeUserId: 1, assigneeLabel: 'root' })],
      open: [],
      takers: new Map(),
      regions,
      executives,
      region: undefined,
      now,
    });
    expect(r.executives.find((e) => e.userId === 1)).toMatchObject({ name: 'root', taken: 1, regions: [] });
  });
});

describe('regionFilterOf', () => {
  it('maps the query value to a region id, null for "none", rejects unknown codes', () => {
    expect(regionFilterOf(undefined, regions)).toEqual({ ok: true, filter: undefined });
    expect(regionFilterOf('none', regions)).toEqual({ ok: true, filter: null });
    expect(regionFilterOf('samarqand', regions)).toEqual({ ok: true, filter: SAM });
    expect(regionFilterOf('atlantida', regions)).toEqual({ ok: false });
  });
});

describe('ticket lists behind the numbers (list total == the number)', () => {
  const r = build();
  const ctx = (over: Partial<TicketMetricContext> = {}): TicketMetricContext => ({ now, takers, ...over });
  const count = (metric: OverviewTicketMetric, over: Partial<TicketMetricContext> = {}, region?: number | null) => {
    const source = ticketMetricSource(metric) === 'now' ? open : cohort;
    return source.filter(
      (x) => (region === undefined || x.regionId === region) && matchesTicketMetric(x, metric, ctx(over)),
    ).length;
  };

  it('period totals', () => {
    const totals = r.totals;
    for (const m of [
      'received',
      'taken',
      'done',
      'rejected',
      'closed',
      'open',
      'overdue',
      'overdueOpen',
      'overdueLate',
      'callbackOverdue',
    ] as const) {
      expect(count(m), m).toBe(totals[m]);
    }
    expect(count('resolved')).toBe(2); // the average resolution time is over these
    expect(count('closeTimed')).toBe(1);
    expect(count('onTime')).toBe(totals.done + totals.rejected - totals.overdueLate);
  });

  it('now: backlog by status, overdue, callback overdue', () => {
    expect(count('nowOpen')).toBe(r.now.byStatus.reduce((s, x) => s + x.count, 0));
    for (const s of r.now.byStatus) expect(count('nowStatus', { status: s.status }), s.status).toBe(s.count);
    expect(count('nowOverdue')).toBe(r.now.overdue);
    expect(count('nowCallbackOverdue')).toBe(r.now.callbackOverdue);
  });

  it('regions (map and table) with the region filter', () => {
    for (const row of r.regions) {
      expect(count('received', {}, row.regionId)).toBe(row.received);
      expect(count('closed', {}, row.regionId)).toBe(row.closed);
      expect(count('overdue', {}, row.regionId)).toBe(row.overdue);
      expect(count('nowOverdue', {}, row.regionId)).toBe(row.overdueNow);
    }
  });

  it('Mas’ul rows', () => {
    for (const e of r.executives) {
      const ex = { executive: e.userId };
      expect(count('exTaken', ex), e.name).toBe(e.taken);
      expect(count('exDone', ex), e.name).toBe(e.done);
      expect(count('exRejected', ex), e.name).toBe(e.rejected);
      expect(count('exOverdue', ex), e.name).toBe(e.overdue);
      expect(count('exHolding', ex), e.name).toBe(e.holdingNow);
      expect(count('exOverdueNow', ex), e.name).toBe(e.overdueNow);
    }
    expect(count('exResolved', { executive: 6 })).toBe(1);
  });

  it('list rows: overdue hours, who, search', () => {
    const byId = new Map(regions.map((x) => [x.id, x]));
    const late = toTicketListItem(rejectedLate, byId, now);
    expect(late).toMatchObject({
      code: `TK-${rejectedLate.id}`,
      executive: 'Vali',
      overdueHours: 24,
      regionCode: 'toshkent-shahri',
    });
    expect(toTicketListItem(heldOverdue, byId, now).overdueHours).toBe(98); // 26.11 10:00 → 30.11 12:00
    expect(toTicketListItem(queuedInTime, byId, now)).toMatchObject({ overdueHours: null, executive: null });
    expect(toTicketListItem(noRegion, byId, now)).toMatchObject({ regionCode: null, regionNameUz: 'Hududsiz' });
    expect(matchesTicketSearch(late, `tk-${rejectedLate.id}`)).toBe(true);
    expect(matchesTicketSearch(late, String(rejectedLate.id))).toBe(true);
    expect(matchesTicketSearch(late, 'vali')).toBe(true);
    expect(matchesTicketSearch(late, 'samarqand')).toBe(false);
  });
});
