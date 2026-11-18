import { describe, expect, it } from 'vitest';
import {
  type TicketFacts,
  TICKET_TRANSITIONS,
  canCallBack,
  canComment,
  canViewTicket,
  decideAction,
  inView,
  isUnread,
  nextStatus,
  ticketActions,
  ticketActor,
  ticketAudience,
} from './ticket-workflow.js';

const TASHKENT = 1;
const SAMARQAND = 11;

const superuser = ticketActor({ id: 1, role: 'superuser', extension: '100' });
const observer = ticketActor({ id: 2, role: 'observer', extension: null });
const exec = ticketActor({ id: 3, role: 'executive', extension: null }, [TASHKENT]);
const execOther = ticketActor({ id: 4, role: 'admin', extension: null }, [TASHKENT]); // pre-S1 name
const execSam = ticketActor({ id: 5, role: 'executive', extension: null }, [SAMARQAND]);
const op = ticketActor({ id: 6, role: 'operator', extension: '201' });
const op2 = ticketActor({ id: 7, role: 'operator', extension: '202' });
const opNoExt = ticketActor({ id: 8, role: 'operator', extension: null });

function ticket(over: Partial<TicketFacts> = {}): TicketFacts {
  return {
    status: 'new',
    regionId: TASHKENT,
    creatorUserId: op.userId,
    assigneeUserId: null,
    closedByUserId: null,
    customerPhone: '901234567',
    callbackUserIds: [],
    ...over,
  };
}

describe('state machine', () => {
  it('follows TICKETS.md exactly', () => {
    expect(nextStatus('new', 'assign')).toBe('assigned');
    expect(nextStatus('assigned', 'start')).toBe('in_progress');
    expect(nextStatus('in_progress', 'resolve')).toBe('done');
    expect(nextStatus('in_progress', 'reject')).toBe('rejected');
    expect(nextStatus('done', 'return')).toBe('callback_pending');
    expect(nextStatus('rejected', 'return')).toBe('callback_pending');
    expect(nextStatus('callback_pending', 'close')).toBe('closed');
    for (const s of ['new', 'assigned', 'in_progress'] as const) expect(nextStatus(s, 'forward')).toBe('new');
    for (const s of ['assigned', 'in_progress'] as const) expect(nextStatus(s, 'release')).toBe('new');
  });

  it('allows nothing else', () => {
    const allowed = Object.entries(TICKET_TRANSITIONS).flatMap(([from, map]) =>
      Object.keys(map).map((a) => `${from}:${a}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'new:assign',
        'new:forward',
        'assigned:start',
        'assigned:forward',
        'assigned:release',
        'in_progress:resolve',
        'in_progress:reject',
        'in_progress:forward',
        'in_progress:release',
        'done:return',
        'rejected:return',
        'callback_pending:close',
      ].sort(),
    );
    expect(nextStatus('closed', 'forward')).toBeNull();
    expect(nextStatus('new', 'resolve')).toBeNull();
    expect(nextStatus('callback_pending', 'forward')).toBeNull();
    expect(nextStatus('done', 'close')).toBeNull();
    expect(nextStatus('new', 'release')).toBeNull();
    expect(nextStatus('done', 'release')).toBeNull();
  });
});

describe('visibility', () => {
  it('executives see only their regions', () => {
    expect(canViewTicket(exec, ticket())).toBe(true);
    expect(canViewTicket(execSam, ticket())).toBe(false);
    expect(canViewTicket(exec, ticket({ regionId: null }))).toBe(false);
    // once forwarded away it disappears for the old region
    expect(canViewTicket(exec, ticket({ regionId: SAMARQAND, assigneeUserId: exec.userId }))).toBe(false);
  });

  it('operators see their own tickets, the callback queue and what they closed', () => {
    expect(canViewTicket(op, ticket())).toBe(true);
    expect(canViewTicket(op2, ticket())).toBe(false);
    expect(canViewTicket(op2, ticket({ status: 'in_progress' }))).toBe(false);
    expect(canViewTicket(op2, ticket({ status: 'callback_pending' }))).toBe(true);
    expect(canViewTicket(op2, ticket({ status: 'closed' }))).toBe(false);
    expect(canViewTicket(op2, ticket({ status: 'closed', closedByUserId: op2.userId }))).toBe(true);
  });

  it('an operator who only called back keeps read-only access after closing; a stranger does not', () => {
    const closed = ticket({ status: 'closed', creatorUserId: 99, closedByUserId: 98, callbackUserIds: [op2.userId] });
    expect(canViewTicket(op2, closed)).toBe(true);
    expect(canViewTicket(op, closed)).toBe(false);
    expect(canViewTicket(opNoExt, closed)).toBe(false);
    expect(ticketActions(op2, closed, { hasOpenAttempt: false })).toEqual({
      assign: false,
      start: false,
      resolve: false,
      reject: false,
      forward: false,
      release: false,
      comment: false,
      call: false,
      recordOutcome: false,
      forceClose: false,
      delete: false,
    });
    // and it is in their "mine" list
    expect(inView(op2, closed, 'mine')).toBe(true);
    expect(inView(op, closed, 'mine')).toBe(false);
  });

  it('superuser and observer see everything, observer read-only', () => {
    expect(canViewTicket(superuser, ticket({ regionId: null }))).toBe(true);
    expect(canViewTicket(observer, ticket({ regionId: SAMARQAND }))).toBe(true);
    expect(canViewTicket(observer, ticket({ regionId: null, status: 'closed', creatorUserId: 99 }))).toBe(true);
    expect(canComment(observer, ticket())).toBe(false);
    expect(decideAction(observer, ticket(), 'assign')).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('observer can change nothing, in any status', () => {
    const statuses = ['new', 'assigned', 'in_progress', 'done', 'rejected', 'callback_pending', 'closed'] as const;
    for (const status of statuses) {
      for (const regionId of [TASHKENT, null]) {
        const t = ticket({ status, regionId, assigneeUserId: observer.userId, callbackUserIds: [observer.userId] });
        expect(Object.values(ticketActions(observer, t, { hasOpenAttempt: true })).some(Boolean)).toBe(false);
        for (const a of ['assign', 'start', 'resolve', 'reject', 'forward', 'release', 'return', 'close'] as const) {
          expect(decideAction(observer, t, a, { note: 'xx', regionId: SAMARQAND }).ok).toBe(false);
        }
      }
    }
  });
});

describe('executive actions', () => {
  it('take → start → done by the same executive', () => {
    expect(decideAction(exec, ticket(), 'assign')).toEqual({ ok: true, value: 'assigned' });
    const assigned = ticket({ status: 'assigned', assigneeUserId: exec.userId });
    expect(decideAction(exec, assigned, 'start')).toEqual({ ok: true, value: 'in_progress' });
    const working = ticket({ status: 'in_progress', assigneeUserId: exec.userId });
    expect(decideAction(exec, working, 'resolve')).toEqual({ ok: true, value: 'done' });
    expect(decideAction(exec, working, 'reject', { note: 'Raqam noto‘g‘ri' })).toEqual({ ok: true, value: 'rejected' });
  });

  it('rejected needs a note', () => {
    const working = ticket({ status: 'in_progress', assigneeUserId: exec.userId });
    expect(decideAction(exec, working, 'reject')).toMatchObject({ ok: false, code: 'invalid' });
    expect(decideAction(exec, working, 'reject', { note: ' ' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it("another executive of the same region sees but cannot change someone else's ticket", () => {
    const assigned = ticket({ status: 'in_progress', assigneeUserId: exec.userId });
    expect(canViewTicket(execOther, assigned)).toBe(true);
    for (const a of ['resolve', 'reject', 'forward'] as const) {
      expect(decideAction(execOther, assigned, a, { note: 'xx', regionId: SAMARQAND })).toMatchObject({
        ok: false,
        code: 'forbidden',
      });
    }
    expect(decideAction(superuser, assigned, 'resolve')).toEqual({ ok: true, value: 'done' });
  });

  it('cross-region access looks like a missing ticket', () => {
    expect(decideAction(execSam, ticket(), 'assign')).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('wrong status is a conflict', () => {
    expect(decideAction(exec, ticket({ status: 'assigned', assigneeUserId: 99 }), 'assign')).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    expect(decideAction(superuser, ticket({ status: 'closed' }), 'forward', { regionId: 2 })).toMatchObject({
      ok: false,
      code: 'conflict',
    });
  });

  it('forward: needs another region and a comment; `new` tickets by any executive of the region', () => {
    expect(decideAction(exec, ticket(), 'forward', { regionId: SAMARQAND, note: 'Samarqandga tegishli' })).toEqual({
      ok: true,
      value: 'new',
    });
    expect(decideAction(exec, ticket(), 'forward', { regionId: SAMARQAND })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(decideAction(exec, ticket(), 'forward', { regionId: TASHKENT, note: 'xx' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(decideAction(exec, ticket(), 'forward', { note: 'xx' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('triage (no region): only the superuser routes it, without a comment', () => {
    const triage = ticket({ regionId: null });
    expect(decideAction(superuser, triage, 'forward', { regionId: TASHKENT })).toEqual({ ok: true, value: 'new' });
    expect(decideAction(superuser, triage, 'assign')).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('operators cannot do regional work', () => {
    expect(decideAction(op, ticket(), 'assign')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(decideAction(op, ticket(), 'forward', { regionId: SAMARQAND, note: 'xx' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });

  it('release: the executive who holds it, with a note, back to the same queue', () => {
    const assigned = ticket({ status: 'assigned', assigneeUserId: exec.userId });
    const working = ticket({ status: 'in_progress', assigneeUserId: exec.userId });
    expect(decideAction(exec, assigned, 'release', { note: 'Boshqa ijrochi olsin' })).toEqual({
      ok: true,
      value: 'new',
    });
    expect(decideAction(exec, working, 'release', { note: 'Ta’tilga chiqyapman' })).toEqual({ ok: true, value: 'new' });
    expect(decideAction(exec, working, 'release')).toMatchObject({ ok: false, code: 'invalid' });
    expect(decideAction(exec, working, 'release', { note: ' ' })).toMatchObject({ ok: false, code: 'invalid' });
    // another executive of the region, an executive of another region, an operator
    expect(decideAction(execOther, working, 'release', { note: 'xx' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(decideAction(execSam, working, 'release', { note: 'xx' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(decideAction(op, working, 'release', { note: 'xx' })).toMatchObject({ ok: false, code: 'forbidden' });
    // the superuser may (he may do everything)
    expect(decideAction(superuser, working, 'release', { note: 'xx' })).toEqual({ ok: true, value: 'new' });
    // nothing to release in the queue or after the region is done
    expect(decideAction(exec, ticket(), 'release', { note: 'xx' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(
      decideAction(exec, ticket({ status: 'callback_pending', assigneeUserId: exec.userId }), 'release', {
        note: 'xx',
      }),
    ).toMatchObject({ ok: false, code: 'conflict' });
    expect(ticketActions(exec, working, { hasOpenAttempt: false }).release).toBe(true);
    expect(ticketActions(execOther, working, { hasOpenAttempt: false }).release).toBe(false);
  });

  it('return and close are never done through decideAction', () => {
    expect(decideAction(superuser, ticket({ status: 'done' }), 'return')).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(decideAction(superuser, ticket({ status: 'callback_pending' }), 'close')).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });
});

describe('callback and actions summary', () => {
  it('any operator with an extension can call back a queued ticket', () => {
    const queued = ticket({ status: 'callback_pending', creatorUserId: 99 });
    expect(canCallBack(op2, queued)).toBe(true);
    expect(canCallBack(opNoExt, queued)).toBe(false);
    expect(canCallBack(exec, queued)).toBe(false);
    expect(canCallBack(op2, { ...queued, customerPhone: null })).toBe(false);
    expect(canCallBack(op2, ticket({ status: 'in_progress', creatorUserId: op2.userId }))).toBe(false);
  });

  it('summarizes what the UI may offer', () => {
    const a = ticketActions(exec, ticket(), { hasOpenAttempt: false });
    expect(a).toMatchObject({ assign: true, start: false, resolve: false, forward: true, call: false, delete: false });
    const b = ticketActions(op2, ticket({ status: 'callback_pending' }), { hasOpenAttempt: true });
    expect(b).toMatchObject({ call: true, recordOutcome: true, assign: false, forceClose: false });
    expect(ticketActions(superuser, ticket({ status: 'callback_pending' }), { hasOpenAttempt: false })).toMatchObject({
      forceClose: true,
      delete: true,
      recordOutcome: false,
    });
  });
});

describe('views and unread', () => {
  it('splits tickets into views per role', () => {
    expect(inView(op, ticket(), 'mine')).toBe(true);
    expect(inView(exec, ticket({ status: 'in_progress', assigneeUserId: exec.userId }), 'mine')).toBe(true);
    expect(inView(exec, ticket({ status: 'closed', assigneeUserId: exec.userId }), 'mine')).toBe(false);
    expect(inView(exec, ticket(), 'queue')).toBe(true);
    expect(inView(exec, ticket({ status: 'assigned' }), 'queue')).toBe(false);
    expect(inView(superuser, ticket({ regionId: SAMARQAND }), 'queue')).toBe(true);
    expect(inView(op2, ticket({ status: 'callback_pending' }), 'callback')).toBe(true);
    expect(inView(superuser, ticket({ regionId: null }), 'triage')).toBe(true);
  });

  it('a new ticket in my region is unread until I open it after it arrived', () => {
    const t = { ...ticket(), regionChangedAt: new Date('2026-11-17T10:00:00Z') };
    expect(isUnread(exec, t, null)).toBe(true);
    expect(isUnread(exec, t, new Date('2026-11-17T09:00:00Z'))).toBe(true);
    expect(isUnread(exec, t, new Date('2026-11-17T10:05:00Z'))).toBe(false);
    expect(isUnread(exec, { ...t, status: 'assigned' }, null)).toBe(false);
    expect(isUnread(execSam, t, null)).toBe(false);
    expect(isUnread(superuser, t, null)).toBe(false);
    expect(isUnread(observer, t, null)).toBe(false);
  });
});

describe('WS audience', () => {
  const actors = [superuser, observer, exec, execOther, execSam, op, op2, opNoExt];

  it('a new ticket: its region, its creator, superuser and observer; unread to the region executives', () => {
    const a = ticketAudience(actors, null, ticket());
    expect(a.changed.sort()).toEqual(
      [superuser.userId, observer.userId, exec.userId, execOther.userId, op.userId].sort(),
    );
    expect(a.revoked).toEqual([]);
    expect(a.unread.map((x) => x.userId).sort()).toEqual([exec.userId, execOther.userId].sort());
  });

  it('release puts it back to the queue: same audience, unread re-counted for the region (not observer)', () => {
    const before = ticket({ status: 'in_progress', assigneeUserId: exec.userId });
    const a = ticketAudience(actors, before, ticket());
    expect(a.changed).toContain(observer.userId);
    expect(a.revoked).toEqual([]);
    expect(a.unread.map((x) => x.userId).sort()).toEqual([exec.userId, execOther.userId].sort());
  });

  it('closing: operators who called back keep it, the others lose it', () => {
    const before = ticket({ status: 'callback_pending', creatorUserId: 99, callbackUserIds: [op2.userId] });
    const after = { ...before, status: 'closed' as const, closedByUserId: op2.userId };
    const a = ticketAudience(actors, before, after);
    expect(a.changed.sort()).toEqual(
      [superuser.userId, observer.userId, exec.userId, execOther.userId, op2.userId].sort(),
    );
    expect(a.revoked.sort()).toEqual([op.userId, opNoExt.userId].sort());
    expect(a.unread).toEqual([]);
  });
});
