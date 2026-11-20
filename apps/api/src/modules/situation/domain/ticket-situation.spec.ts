import { SITUATION_HELD_TICKETS_MAX, type TicketStatus } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { isCallbackOverdue, isOverdue } from '../../tickets/domain/sla.js';
import {
  type SituationExecutive,
  type SituationRegion,
  type SituationTicketFact,
  type SituationTicketsInput,
  buildSituationTickets,
} from './ticket-situation.js';

/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`${wall}+05:00`);
const NOW = tk('2026-11-19T15:00:00');
const DAY_END = tk('2026-11-20T00:00:00');

const regions: SituationRegion[] = [
  { id: 1, code: 'toshkent-shahri', nameUz: 'Toshkent shahri', nameRu: 'г. Ташкент' },
  { id: 2, code: 'samarqand', nameUz: 'Samarqand', nameRu: 'Самарканд' },
  { id: 3, code: 'buxoro', nameUz: 'Buxoro', nameRu: 'Бухара' },
];
const executives: SituationExecutive[] = [
  { userId: 10, username: 'masul_toshkent', regionIds: [1] },
  { userId: 11, username: 'masul_samarqand', regionIds: [2, 1] },
  { userId: 12, username: 'masul_buxoro', regionIds: [3] },
];

let nextId = 100;
function ticket(status: TicketStatus, v: Partial<SituationTicketFact> = {}): SituationTicketFact {
  const createdAt = v.createdAt ?? tk('2026-11-18T10:00:00');
  return {
    id: nextId++,
    status,
    regionId: 1,
    assigneeUserId: null,
    assignedAt: null,
    createdAt,
    dueAt: tk('2026-11-21T10:00:00'),
    resolvedAt: null,
    callbackDueAt: null,
    closedAt: null,
    regionChangedAt: createdAt,
    ...v,
  };
}

const input = (open: SituationTicketFact[], extra: Partial<SituationTicketsInput> = {}): SituationTicketsInput => ({
  open,
  today: { opened: 4, resolved: 2, closed: 1 },
  callbacks: { pending: 3, resolved: 5 },
  resolvedTodayBy: new Map([[10, 2]]),
  regions,
  executives,
  usernames: new Map([[1, 'root']]),
  now: NOW,
  dayEnd: DAY_END,
  slaWorkingDays: 3,
  callbackSlaWorkingDays: 1,
  ...extra,
});

describe('buildSituationTickets — open tickets now', () => {
  it('counts the open tickets by status (closed ones are never passed in)', () => {
    const r = buildSituationTickets(
      input([
        ticket('new'),
        ticket('new', { regionId: 2 }),
        ticket('assigned', { assigneeUserId: 10, assignedAt: tk('2026-11-19T09:00:00') }),
        ticket('in_progress', { assigneeUserId: 10, assignedAt: tk('2026-11-19T08:00:00') }),
        ticket('callback_pending', { resolvedAt: tk('2026-11-19T11:00:00') }),
      ]),
    );
    expect(r.open).toEqual({ total: 5, new: 2, assigned: 1, inProgress: 1, callbackPending: 1 });
    expect(r.today).toEqual({ opened: 4, resolved: 2, closed: 1 });
    expect(r.callbacks).toEqual({ total: 8, pending: 3, resolved: 5 });
    expect(r).toMatchObject({ slaWorkingDays: 3, callbackSlaWorkingDays: 1, generatedAt: NOW.toISOString() });
  });

  it('overdue = with the region after due_at (the tickets SLA rule); due today; callback overdue', () => {
    const late = ticket('in_progress', {
      assigneeUserId: 10,
      assignedAt: tk('2026-11-17T10:00:00'),
      dueAt: tk('2026-11-19T10:00:00'),
    });
    const lateNew = ticket('new', { dueAt: tk('2026-11-18T10:00:00') });
    const dueTonight = ticket('assigned', {
      assigneeUserId: 11,
      assignedAt: tk('2026-11-19T09:00:00'),
      dueAt: tk('2026-11-19T18:00:00'),
    });
    const dueTomorrow = ticket('new', { dueAt: tk('2026-11-20T09:00:00') });
    // finished late, waiting for the callback: not "overdue now" (it left the region), callback not due yet
    const resolvedLate = ticket('callback_pending', {
      dueAt: tk('2026-11-18T10:00:00'),
      resolvedAt: tk('2026-11-19T11:00:00'),
      callbackDueAt: tk('2026-11-20T11:00:00'),
    });
    const callbackLate = ticket('callback_pending', {
      resolvedAt: tk('2026-11-17T11:00:00'),
      callbackDueAt: tk('2026-11-18T11:00:00'),
    });
    const all = [late, lateNew, dueTonight, dueTomorrow, resolvedLate, callbackLate];
    const r = buildSituationTickets(input(all));

    expect(r.overdue).toBe(2);
    expect(r.dueToday).toBe(1);
    expect(r.callbackOverdue).toBe(1);
    // the same sets the tickets module's SLA functions give
    const withRegion = all.filter((t) => ['new', 'assigned', 'in_progress'].includes(t.status));
    expect(withRegion.filter((t) => isOverdue(t, NOW))).toHaveLength(r.overdue);
    expect(all.filter((t) => t.status === 'callback_pending' && isCallbackOverdue(t, NOW)).map((t) => t.id)).toEqual([
      callbackLate.id,
    ]);
  });
});

describe('buildSituationTickets — new tickets waiting per region', () => {
  it('lists regions with new tickets, the longest-waiting first, with overdue ones and the executives', () => {
    const r = buildSituationTickets(
      input([
        ticket('new', { regionId: 1, regionChangedAt: tk('2026-11-19T12:00:00') }),
        ticket('new', { regionId: 1, regionChangedAt: tk('2026-11-19T14:00:00') }),
        // forwarded to Samarqand this morning, created long ago and overdue
        ticket('new', {
          regionId: 2,
          createdAt: tk('2026-11-10T10:00:00'),
          dueAt: tk('2026-11-13T10:00:00'),
          regionChangedAt: tk('2026-11-19T09:00:00'),
        }),
        ticket('new', { regionId: null, regionChangedAt: tk('2026-11-19T13:00:00') }),
        ticket('assigned', { regionId: 3, assigneeUserId: 12, assignedAt: tk('2026-11-19T10:00:00') }),
      ]),
    );
    expect(r.waiting).toEqual([
      {
        code: 'samarqand',
        nameUz: 'Samarqand',
        nameRu: 'Самарканд',
        waiting: 1,
        overdue: 1,
        oldestSince: tk('2026-11-19T09:00:00').toISOString(),
        executives: 1,
      },
      {
        code: 'toshkent-shahri',
        nameUz: 'Toshkent shahri',
        nameRu: 'г. Ташкент',
        waiting: 2,
        overdue: 0,
        oldestSince: tk('2026-11-19T12:00:00').toISOString(),
        executives: 2,
      },
      {
        code: null,
        nameUz: 'Hududsiz',
        nameRu: 'Без региона',
        waiting: 1,
        overdue: 0,
        oldestSince: tk('2026-11-19T13:00:00').toISOString(),
        executives: 0,
      },
    ]);
  });

  it('is empty when every new ticket has been taken', () => {
    expect(buildSituationTickets(input([ticket('in_progress', { assigneeUserId: 10 })])).waiting).toEqual([]);
  });
});

describe('buildSituationTickets — who works on tickets', () => {
  it('every executive (idle ones too) and anyone else holding tickets, busiest first', () => {
    const r = buildSituationTickets(
      input([
        ticket('in_progress', { assigneeUserId: 11, assignedAt: tk('2026-11-19T08:00:00') }),
        ticket('assigned', { assigneeUserId: 11, assignedAt: tk('2026-11-19T12:00:00') }),
        ticket('in_progress', { assigneeUserId: 1, assignedAt: tk('2026-11-19T07:00:00') }), // the superuser
        ticket('in_progress', { assigneeUserId: 99, assignedAt: tk('2026-11-19T11:00:00') }), // deactivated, no name
      ]),
    );
    expect(r.workers.map((w) => [w.username, w.holding])).toEqual([
      ['masul_samarqand', 2],
      ['root', 1], // held since 07:00
      ['#99', 1], // since 11:00
      ['masul_toshkent', 0], // resolved 2 today: before the other idle one
      ['masul_buxoro', 0],
    ]);
    const sam = r.workers[0];
    expect(sam).toMatchObject({ assigned: 1, inProgress: 1, overdue: 0, resolvedToday: 0 });
    // regions in directory order, whatever order they were assigned in
    expect(sam.regions.map((x) => x.code)).toEqual(['toshkent-shahri', 'samarqand']);
    expect(r.workers[1].regions).toEqual([]);
    expect(r.workers[3]).toMatchObject({ resolvedToday: 2, tickets: [] });
  });

  it('lists the held tickets oldest first with their code, time taken and deadline state', () => {
    const fresh = ticket('assigned', { assigneeUserId: 10, assignedAt: tk('2026-11-19T14:00:00') });
    const old = ticket('in_progress', {
      assigneeUserId: 10,
      assignedAt: tk('2026-11-17T09:00:00'),
      dueAt: tk('2026-11-19T09:00:00'),
    });
    // migrated without assigned_at: the creation time stands in
    const legacy = ticket('in_progress', { assigneeUserId: 10, createdAt: tk('2026-11-18T08:00:00') });
    const w = buildSituationTickets(input([fresh, old, legacy])).workers[0];
    expect(w).toMatchObject({ username: 'masul_toshkent', holding: 3, overdue: 1 });
    expect(w.tickets).toEqual([
      {
        id: old.id,
        code: `TK-${old.id}`,
        status: 'in_progress',
        since: tk('2026-11-17T09:00:00').toISOString(),
        dueAt: tk('2026-11-19T09:00:00').toISOString(),
        overdue: true,
      },
      expect.objectContaining({ id: legacy.id, since: tk('2026-11-18T08:00:00').toISOString(), overdue: false }),
      expect.objectContaining({ id: fresh.id, status: 'assigned', overdue: false }),
    ]);
  });

  it('caps the listed tickets but keeps the full count', () => {
    const many = Array.from({ length: SITUATION_HELD_TICKETS_MAX + 3 }, (_, i) =>
      ticket('in_progress', { assigneeUserId: 12, assignedAt: new Date(NOW.getTime() - (i + 1) * 60_000) }),
    );
    const w = buildSituationTickets(input(many)).workers[0];
    expect(w.holding).toBe(SITUATION_HELD_TICKETS_MAX + 3);
    expect(w.tickets).toHaveLength(SITUATION_HELD_TICKETS_MAX);
    expect(w.tickets[0].id).toBe(many.at(-1)!.id); // the oldest
  });

  it('ignores tickets not held (new, callback_pending) for the workers', () => {
    const r = buildSituationTickets(
      input([
        ticket('new', { assigneeUserId: null }),
        ticket('callback_pending', { assigneeUserId: 10, resolvedAt: tk('2026-11-19T10:00:00') }),
      ]),
    );
    expect(r.workers.every((w) => w.holding === 0)).toBe(true);
  });
});
