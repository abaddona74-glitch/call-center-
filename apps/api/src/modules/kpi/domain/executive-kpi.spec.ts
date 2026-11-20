import type { TicketEventKind } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import {
  buildExecutiveKpi,
  type ExecutiveKpiInput,
  executiveTicketIds,
  type KpiTicketEventFact,
} from './executive-kpi.js';

/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`2026-11-${wall}+05:00`);

const T = 1; // Toshkent shahri
const S = 2; // Samarqand
const B = 3; // Buxoro
const E1 = 10; // masul_t: Toshkent
const E2 = 20; // masul_s: Samarqand
const ROOT = 1; // superuser, no regions

let seq = 0;
const ev = (
  ticketId: number,
  kind: TicketEventKind,
  at: string,
  actorUserId: number | null,
  regions: { from?: number | null; to?: number | null } = {},
): KpiTicketEventFact => ({
  id: ++seq,
  ticketId,
  kind,
  actorUserId,
  fromRegionId: regions.from ?? null,
  toRegionId: regions.to ?? null,
  createdAt: tk(at),
});

/**
 * Period 16–17 Nov 2026 (Tashkent), now = 18 Nov 12:00.
 *  #1 created in T 16th 09:00; E1 takes 10:00, done 14:00.
 *  #2 created in T 15th (before the period, due 16th 12:00); E1 takes 16th 08:00, releases 09:00; ROOT takes 11:00,
 *     rejects 13:00 (late).
 *  #3 created in T 16th 10:00; E1 forwards it to S 11:00; E2 takes 12:00 and still holds it.
 *  #4 E2 holds it since the 11th, overdue since the 13th (no event in the period).
 *  #5 created in S 17th 09:00, nobody took it.
 *  #6 created in T on the 18th (after the period).
 *  #7 migrated (no `created` event), region B; E1 takes it on the 17th.
 */
const input = (): ExecutiveKpiInput => ({
  events: [
    ev(1, 'created', '16T09:00:00', 100, { to: T }),
    ev(1, 'assigned', '16T10:00:00', E1),
    ev(1, 'started', '16T10:05:00', E1),
    ev(1, 'done', '16T14:00:00', E1),
    ev(1, 'returned', '16T14:00:00', null),
    ev(2, 'created', '15T09:00:00', 100, { to: T }),
    ev(2, 'assigned', '16T08:00:00', E1),
    ev(2, 'released', '16T09:00:00', E1),
    ev(2, 'assigned', '16T11:00:00', ROOT),
    ev(2, 'rejected', '16T13:00:00', ROOT),
    ev(3, 'created', '16T10:00:00', 100, { to: T }),
    ev(3, 'forwarded', '16T11:00:00', E1, { from: T, to: S }),
    ev(3, 'assigned', '16T12:00:00', E2),
    ev(5, 'created', '17T09:00:00', 100, { to: S }),
    ev(7, 'assigned', '17T10:00:00', E1),
  ],
  tickets: [
    { id: 1, regionId: T, dueAt: tk('19T09:00:00') },
    { id: 2, regionId: T, dueAt: tk('16T12:00:00') },
    { id: 3, regionId: S, dueAt: tk('19T10:00:00') },
    { id: 5, regionId: S, dueAt: tk('20T09:00:00') },
    { id: 7, regionId: B, dueAt: null },
  ],
  holding: [
    { id: 3, assigneeUserId: E2, regionId: S, dueAt: tk('19T10:00:00') },
    { id: 4, assigneeUserId: E2, regionId: S, dueAt: tk('13T09:00:00') },
    { id: 7, assigneeUserId: E1, regionId: B, dueAt: null },
  ],
  regions: [
    { id: T, code: 'toshkent-shahri', nameUz: 'Toshkent shahri', nameRu: 'г. Ташкент' },
    { id: S, code: 'samarqand', nameUz: 'Samarqand', nameRu: 'Самарканд' },
    { id: B, code: 'buxoro', nameUz: 'Buxoro', nameRu: 'Бухара' },
  ],
  executives: [
    { userId: E1, username: 'masul_t', regionIds: [T] },
    { userId: E2, username: 'masul_s', regionIds: [S] },
  ],
  names: new Map([[ROOT, 'root']]),
  period: [tk('16T00:00:00'), tk('18T00:00:00')],
  now: tk('18T12:00:00'),
});

describe('buildExecutiveKpi', () => {
  const rows = buildExecutiveKpi(input());
  const row = (name: string) => rows.find((r) => r.name === name)!;

  it('one row per assigned executive and per other actor, most taken first', () => {
    expect(rows.map((r) => r.name)).toEqual(['masul_t', 'masul_s', 'root']);
  });

  it('attributes take / done / release / forward to the actor and the region at that moment', () => {
    expect(row('masul_t').totals).toEqual({
      arrived: 2, // #1 and #3 were created in T in the period (#2 before it, a release is not an arrival)
      taken: 3, // #1, #2 (T) and #7 (B)
      done: 1,
      rejected: 0,
      released: 1,
      forwarded: 1, // #3, counted in T (the region it was sent from)
      late: 0,
      onTimeRate: 100,
      avgTakeHours: 12, // #1 waited 1 h, #2 23 h since its creation; #7 has no queue time (migrated)
      avgResolveHours: 4,
      holdingNow: 1,
      overdueNow: 0,
    });
    expect(row('masul_t').regions.map((r) => [r.code, r.assigned, r.arrived, r.taken])).toEqual([
      ['toshkent-shahri', true, 2, 2],
      ['buxoro', false, null, 1],
    ]);
  });

  it('a forwarded ticket waits from the forward; holdings and overdue are counted now', () => {
    expect(row('masul_s').totals).toMatchObject({
      arrived: 2, // #3 forwarded in, #5 created
      taken: 1,
      avgTakeHours: 1,
      avgResolveHours: null,
      onTimeRate: null,
      holdingNow: 2,
      overdueNow: 1,
    });
  });

  it('after a release the wait starts again; late resolutions lower the on-time rate', () => {
    expect(row('root').totals).toMatchObject({
      arrived: null, // not assigned to any region
      taken: 1,
      rejected: 1,
      late: 1,
      onTimeRate: 0,
      avgTakeHours: 2,
      avgResolveHours: 2,
    });
    expect(row('root').regions).toMatchObject([{ code: 'toshkent-shahri', assigned: false, arrived: null }]);
  });

  it('nothing outside the period counts', () => {
    const later = buildExecutiveKpi({
      ...input(),
      period: [tk('19T00:00:00'), tk('20T00:00:00')],
    });
    expect(later.find((r) => r.name === 'masul_t')?.totals).toMatchObject({ arrived: 0, taken: 0, done: 0 });
    // …but who holds what right now does.
    expect(later.find((r) => r.name === 'masul_s')?.totals).toMatchObject({ holdingNow: 2, overdueNow: 1 });
  });

  it("a `created` event without a region (imported data) starts in the ticket's region", () => {
    const out = buildExecutiveKpi({
      ...input(),
      events: [ev(8, 'created', '16T09:00:00', 100), ev(8, 'assigned', '16T09:30:00', E1)],
      tickets: [{ id: 8, regionId: T, dueAt: null }],
      holding: [],
    });
    expect(out.find((r) => r.name === 'masul_t')?.regions[0]).toMatchObject({
      code: 'toshkent-shahri',
      arrived: 1,
      taken: 1,
      avgTakeHours: 0.5,
    });
  });

  it('executives without any work still get a row with their regions', () => {
    const out = buildExecutiveKpi({
      ...input(),
      events: [],
      holding: [],
      executives: [{ userId: 30, username: 'masul_b', regionIds: [B, T] }],
    });
    expect(out).toEqual([
      expect.objectContaining({
        name: 'masul_b',
        totals: expect.objectContaining({ arrived: 0, taken: 0, onTimeRate: null }),
        regions: [expect.objectContaining({ code: 'toshkent-shahri' }), expect.objectContaining({ code: 'buxoro' })],
      }),
    ]);
  });

  it('every list adds up to its number, for the whole row and for each region', () => {
    const data = input();
    for (const row of buildExecutiveKpi(data)) {
      const check = (
        figures: (typeof row)['totals'],
        region: Parameters<typeof executiveTicketIds>[2],
        where: string,
      ) => {
        const size = (m: Parameters<typeof executiveTicketIds>[3]) =>
          executiveTicketIds(data, row.userId, region, m).size;
        expect(size('taken'), where).toBe(figures.taken);
        expect(size('done'), where).toBe(figures.done);
        expect(size('rejected'), where).toBe(figures.rejected);
        expect(size('released'), where).toBe(figures.released);
        expect(size('forwarded'), where).toBe(figures.forwarded);
        expect(size('late'), where).toBe(figures.late);
        expect(size('resolved'), where).toBe(figures.done + figures.rejected);
        expect(size('holding'), where).toBe(figures.holdingNow);
        expect(size('overdueNow'), where).toBe(figures.overdueNow);
        if (figures.arrived !== null) expect(size('arrived'), where).toBe(figures.arrived);
      };
      check(row.totals, undefined, row.name);
      for (const r of row.regions) check(r, r.regionId ?? 'none', `${row.name} ${r.code}`);
    }
  });
});
