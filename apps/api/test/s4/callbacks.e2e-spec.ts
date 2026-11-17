import type { Callback, CallbackListResponse } from '@cc/shared';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CallEvents } from '../../src/common/events/domain-events.js';
import { formatBusinessDateTime } from '../../src/modules/callbacks/domain/working-calendar.js';
import { RealtimeService } from '../../src/modules/realtime/realtime.service.js';
import { type E2eContext, auditRows, createE2eApp } from './e2e-app.js';

let ctx: E2eContext;
let events: EventEmitter2;
let broadcast: ReturnType<typeof vi.spyOn>;

const at = (local: string) => new Date(`${local}+05:00`).toISOString();
const http = () => request(ctx.app.getHttpServer());

async function list(query: Record<string, string> = {}, auth = ctx.users.admin.auth): Promise<CallbackListResponse> {
  const res = await http()
    .get('/api/callbacks')
    .query({ date: 'all', ...query })
    .set('Authorization', auth)
    .expect(200);
  return res.body as CallbackListResponse;
}

async function byPhone(phone: string): Promise<Callback[]> {
  return (await list({ phone })).items.filter((c) => c.phone === phone);
}

const abandon = (callId: string, phone: string | null, local: string, waitSeconds = 30) =>
  events.emitAsync(CallEvents.Abandoned, {
    callId,
    direction: 'inbound',
    phone,
    at: at(local),
    queue: '200',
    waitSeconds,
  });

const ended = (
  callId: string,
  phone: string | null,
  local: string,
  over: {
    direction?: 'inbound' | 'outbound' | 'internal';
    answered?: boolean;
    talkSeconds?: number;
    extension?: string | null;
  } = {},
) =>
  events.emitAsync(CallEvents.Ended, {
    callId,
    phone,
    at: at(local),
    direction: over.direction ?? 'inbound',
    answered: over.answered ?? false,
    talkSeconds: over.talkSeconds ?? 0,
    extension: over.extension ?? null,
    hangupParty: 'unknown',
  });

beforeAll(async () => {
  ctx = await createE2eApp('callbacks');
  events = ctx.app.get(EventEmitter2);
  broadcast = vi.spyOn(ctx.app.get(RealtimeService), 'broadcast');
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('authentication', () => {
  it('rejects requests without a session', async () => {
    await http().get('/api/callbacks').expect(401);
    await http().post('/api/callbacks/1/notes').send({ text: 'x' }).expect(401);
  });
});

describe('live call events (synthetic, as published by the AMI module)', () => {
  it('a caller who left the queue during working hours gets a pending callback, pushed over WS', async () => {
    await events.emitAsync(CallEvents.QueueJoined, {
      callId: 'L1',
      direction: 'inbound',
      phone: '901234567',
      at: at('2026-11-17T10:00:00'),
      queue: '200',
    });
    await abandon('L1', '901234567', '2026-11-17T10:01:00', 60);

    const [cb] = await byPhone('901234567');
    expect(cb).toMatchObject({
      status: 'pending',
      category: 'pending',
      source: 'abandoned',
      sources: ['abandoned'],
      missedCount: 1,
      firstMissedAt: '2026-11-17T05:00:00.000Z', // start of the call, not the abandon moment
    });
    expect(broadcast).toHaveBeenCalledWith('callbacks.updated', { items: [expect.objectContaining({ id: cb.id })] });
  });

  it('the same call reported again (call.ended after call.abandoned) is not counted twice', async () => {
    await ended('L1', '901234567', '2026-11-17T10:01:00');
    const [cb] = await byPhone('901234567');
    expect(cb.missedCount).toBe(1);
  });

  it('a call that rang an operator who did not pick up is operator_missed', async () => {
    await events.emitAsync(CallEvents.QueueJoined, {
      callId: 'L2',
      direction: 'inbound',
      phone: '935551122',
      at: at('2026-11-17T10:05:00'),
      queue: '200',
    });
    await events.emitAsync(CallEvents.OperatorMissed, {
      callId: 'L2',
      direction: 'inbound',
      phone: '935551122',
      at: at('2026-11-17T10:05:10'),
      extension: '103',
      reason: 'no_answer',
    });
    await ended('L2', '935551122', '2026-11-17T10:06:00');
    const [cb] = await byPhone('935551122');
    expect(cb).toMatchObject({ status: 'pending', source: 'operator_missed' });
  });

  it('an answered call shorter than the threshold does not resolve the callback', async () => {
    await ended('L1b', '901234567', '2026-11-17T10:10:00', { answered: true, talkSeconds: 5, extension: '101' });
    const [cb] = await byPhone('901234567');
    expect(cb.status).toBe('pending');
    const details = await http().get(`/api/callbacks/${cb.id}`).set('Authorization', ctx.users.op101.auth).expect(200);
    expect(details.body.events.map((e: { kind: string }) => e.kind)).toContain('short_conversation');
  });

  it('a failed call back attempt makes it "unreachable" with who/why', async () => {
    await ended('O1', '901234567', '2026-11-17T10:20:00', { direction: 'outbound', extension: '103' });
    const [cb] = await byPhone('901234567');
    expect(cb).toMatchObject({
      status: 'pending',
      category: 'unreachable',
      outboundAttempts: 1,
      lastOutboundExtension: '103',
      lastOutboundCause: 'no_answer',
    });
  });

  it('a real conversation resolves it and records who, when and how', async () => {
    await ended('O2', '901234567', '2026-11-17T10:30:00', {
      direction: 'outbound',
      answered: true,
      talkSeconds: 45,
      extension: '103',
    });
    const [cb] = await byPhone('901234567');
    expect(cb).toMatchObject({
      status: 'resolved',
      category: 'resolved',
      closedAt: '2026-11-17T05:30:00.000Z',
      closedBy: 'ext 103',
      closeMethod: 'conversation',
      resolutionType: 'operator_outbound',
      resolvedExtension: '103',
      resolvedTalkSeconds: 45,
    });
  });

  it('an older missed call reported late does not resurrect the resolved callback', async () => {
    await abandon('L0', '901234567', '2026-11-17T10:15:00', 0);
    const cbs = await byPhone('901234567');
    expect(cbs).toHaveLength(1);
    expect(cbs[0].status).toBe('resolved');
  });

  it('a new missed call after the resolution opens a new callback', async () => {
    await abandon('L3', '901234567', '2026-11-17T11:00:00', 0);
    const cbs = await byPhone('901234567');
    expect(cbs.map((c) => c.status).sort()).toEqual(['pending', 'resolved']);
  });

  it('after-hours calls create after_hours callbacks that survive the next call (legacy B7/B8)', async () => {
    await abandon('W1', '977778899', '2026-11-21T11:00:00', 0); // Saturday
    const [first] = await byPhone('977778899');
    expect(first).toMatchObject({ status: 'pending', source: 'after_hours' });

    await abandon('W2', '977778899', '2026-11-23T09:00:00', 0); // Monday, working hours
    const cbs = await byPhone('977778899');
    expect(cbs).toHaveLength(1);
    expect(cbs[0]).toMatchObject({
      id: first.id,
      source: 'after_hours',
      sources: ['after_hours', 'abandoned'],
      missedCount: 2,
      lastMissedAt: '2026-11-23T04:00:00.000Z',
    });
    // visible in the default list (nothing is hidden like legacy ivr_non_working)
    expect((await list({ source: 'after_hours' })).items.map((c) => c.id)).toContain(first.id);
  });

  it('matches numbers exactly: a 7-digit number never touches a longer one containing it (legacy B6)', async () => {
    await abandon('X1', '991234567', '2026-11-17T12:00:00', 0);
    await abandon('X2', '1234567', '2026-11-17T12:01:00', 0);
    await ended('X3', '1234567', '2026-11-17T12:10:00', { answered: true, talkSeconds: 60, extension: '101' });
    expect((await byPhone('1234567'))[0].status).toBe('resolved');
    expect((await byPhone('991234567'))[0].status).toBe('pending');
  });

  it('ignores hidden callers and internal calls', async () => {
    const before = (await list()).total;
    await abandon('H1', null, '2026-11-17T12:30:00');
    await ended('H2', '101', '2026-11-17T12:31:00', { direction: 'internal' });
    expect((await list()).total).toBe(before);
  });
});

describe('list filters', () => {
  it('returns category counts for the filter and narrows by category, source and phone digits', async () => {
    const all = await list();
    expect(all.counts.resolved).toBeGreaterThanOrEqual(2);
    expect(all.counts.pending + all.counts.unreachable + all.counts.resolved + all.counts.dismissed).toBe(all.total);

    const resolved = await list({ category: 'resolved' });
    expect(resolved.items.every((c) => c.status === 'resolved')).toBe(true);
    expect(resolved.counts).toEqual(all.counts);

    expect((await list({ source: 'operator_missed' })).items.map((c) => c.phone)).toEqual(['935551122']);
    expect((await list({ phone: '+998 97 777' })).items.map((c) => c.phone)).toEqual(['977778899']);
  });

  it('filters by a day (Tashkent): pending by last missed call, closed by close time', async () => {
    const day = await list({ date: '2026-11-21' });
    expect(day.items.map((c) => c.phone)).toEqual([]); // the after-hours callback moved to Monday
    const monday = await list({ date: '2026-11-23' });
    expect(monday.items.map((c) => c.phone)).toEqual(['977778899']);
  });

  it('validates the query', async () => {
    await http().get('/api/callbacks?date=yesterday').set('Authorization', ctx.users.admin.auth).expect(400);
    await http().get('/api/callbacks?pageSize=10000').set('Authorization', ctx.users.admin.auth).expect(400);
  });

  it('operators see the list too (read-only work list)', async () => {
    const res = await list({}, ctx.users.op205.auth);
    expect(res.total).toBeGreaterThan(0);
  });
});

describe('manual actions and permissions', () => {
  let target: Callback;

  beforeAll(async () => {
    [target] = await byPhone('935551122');
  });

  it('operators may not dismiss or resolve callbacks', async () => {
    await http()
      .post(`/api/callbacks/${target.id}/dismiss`)
      .set('Authorization', ctx.users.op101.auth)
      .send({ reason: 'spam call' })
      .expect(403);
    await http()
      .post(`/api/callbacks/${target.id}/resolve`)
      .set('Authorization', ctx.users.op101.auth)
      .send({ reason: 'talked' })
      .expect(403);
  });

  it('a manual close needs a reason', async () => {
    await http()
      .post(`/api/callbacks/${target.id}/dismiss`)
      .set('Authorization', ctx.users.admin.auth)
      .send({})
      .expect(400);
    await http()
      .post(`/api/callbacks/${target.id}/dismiss`)
      .set('Authorization', ctx.users.admin.auth)
      .send({ reason: ' a ' })
      .expect(400);
  });

  it('operators can log attempt notes', async () => {
    const res = await http()
      .post(`/api/callbacks/${target.id}/notes`)
      .set('Authorization', ctx.users.op101.auth)
      .send({ text: 'Called from mobile, no answer. Retry at 15:00' })
      .expect(200);
    expect(res.body.lastNote).toMatchObject({ text: 'Called from mobile, no answer. Retry at 15:00', author: 'op101' });
  });

  it('operators can take a callback and release their own, but not assign others', async () => {
    const path = `/api/callbacks/${target.id}/assign`;
    await http().post(path).set('Authorization', ctx.users.op101.auth).send({ userId: ctx.users.op205.id }).expect(403);
    const took = await http()
      .post(path)
      .set('Authorization', ctx.users.op101.auth)
      .send({ userId: ctx.users.op101.id })
      .expect(200);
    expect(took.body.assignee).toEqual({ id: ctx.users.op101.id, username: 'op101' });
    expect((await list({ assignee: 'me' }, ctx.users.op101.auth)).items.map((c) => c.id)).toEqual([target.id]);
    // someone else's callback cannot be taken over or released by another operator
    await http().post(path).set('Authorization', ctx.users.op205.auth).send({ userId: ctx.users.op205.id }).expect(403);
    await http().post(path).set('Authorization', ctx.users.op205.auth).send({ userId: null }).expect(403);
    // admins assign anyone
    const reassigned = await http()
      .post(path)
      .set('Authorization', ctx.users.admin.auth)
      .send({ userId: ctx.users.op205.id })
      .expect(200);
    expect(reassigned.body.assignee.username).toBe('op205');
    await http().post(path).set('Authorization', ctx.users.admin.auth).send({ userId: 999999 }).expect(404);
  });

  it('admins dismiss with a reason; who/when/why is stored and audited', async () => {
    const res = await http()
      .post(`/api/callbacks/${target.id}/dismiss`)
      .set('Authorization', ctx.users.admin.auth)
      .send({ reason: 'Wrong number, citizen confirmed' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'dismissed',
      closedBy: 'admin1',
      closeMethod: 'manual',
      closeReason: 'Wrong number, citizen confirmed',
    });
    expect(res.body.closedAt).toEqual(expect.any(String));
    await http()
      .post(`/api/callbacks/${target.id}/dismiss`)
      .set('Authorization', ctx.users.admin.auth)
      .send({ reason: 'again' })
      .expect(409);

    const audit = await auditRows(ctx.db, 'callbacks.');
    expect(audit.map((a) => a.action)).toEqual([
      'callbacks.note',
      'callbacks.assign',
      'callbacks.assign',
      'callbacks.dismiss',
    ]);
    expect(audit.at(-1)).toMatchObject({
      target: `callback:${target.id}`,
      actor_label: 'admin1',
      details: { phone: '935551122', reason: 'Wrong number, citizen confirmed' },
    });
  });

  it('admins can close as handled outside the PBX', async () => {
    const [cb] = (await byPhone('991234567')).filter((c) => c.status === 'pending');
    const res = await http()
      .post(`/api/callbacks/${cb.id}/resolve`)
      .set('Authorization', ctx.users.admin.auth)
      .send({ reason: 'Answered in Telegram' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'resolved',
      closeMethod: 'manual',
      resolutionType: null,
      closeReason: 'Answered in Telegram',
    });
  });

  it('shows the timeline of a callback', async () => {
    const res = await http().get(`/api/callbacks/${target.id}`).set('Authorization', ctx.users.op205.auth).expect(200);
    expect(res.body.events.map((e: { kind: string }) => e.kind)).toEqual([
      'dismissed',
      'assigned',
      'assigned',
      'note',
      'missed',
    ]);
    await http().get('/api/callbacks/999999').set('Authorization', ctx.users.op205.auth).expect(404);
    await http().get('/api/callbacks/abc').set('Authorization', ctx.users.op205.auth).expect(400);
  });

  it('dismiss-all is admin only, needs a reason and is audited', async () => {
    await http()
      .post('/api/callbacks/dismiss-all')
      .set('Authorization', ctx.users.op101.auth)
      .send({ reason: 'cleanup' })
      .expect(403);
    await http()
      .post('/api/callbacks/dismiss-all')
      .set('Authorization', ctx.users.admin.auth)
      .send({ date: 'all' })
      .expect(400);
    const pendingBefore = (await list()).items.filter(
      (c) => c.status === 'pending' && c.lastMissedAt.startsWith('2026-11-23'),
    ).length;
    const res = await http()
      .post('/api/callbacks/dismiss-all')
      .set('Authorization', ctx.users.admin.auth)
      .send({ reason: 'Test cleanup of one day', date: '2026-11-23' })
      .expect(200);
    expect(res.body).toEqual({ dismissed: pendingBefore });
    const [audit] = (await auditRows(ctx.db, 'callbacks.dismiss_all')).slice(-1);
    expect(audit.details).toMatchObject({ count: pendingBefore, reason: 'Test cleanup of one day' });
  });
});

describe('settings', () => {
  it('only admins read or change the working calendar', async () => {
    await http().get('/api/callbacks/settings').set('Authorization', ctx.users.op101.auth).expect(403);
    const res = await http().get('/api/callbacks/settings').set('Authorization', ctx.users.admin.auth).expect(200);
    expect(res.body).toEqual({
      workDays: [1, 2, 3, 4, 5],
      workStart: '08:00',
      workEnd: '21:00',
      holidays: [],
      minTalkSeconds: 10,
    });
  });

  it('validates and audits changes, and the new calendar applies to the next calls', async () => {
    const put = (body: object, auth = ctx.users.admin.auth) =>
      http().put('/api/callbacks/settings').set('Authorization', auth).send(body);
    const next = {
      workDays: [1, 2, 3, 4, 5, 6],
      workStart: '09:00',
      workEnd: '18:00',
      holidays: ['2026-12-08'],
      minTalkSeconds: 20,
    };
    await put(next, ctx.users.op101.auth).expect(403);
    await put({ ...next, workStart: '18:00', workEnd: '09:00' }).expect(400);
    await put({ ...next, workDays: [1, 1] }).expect(400);
    await put({ ...next, minTalkSeconds: 0 }).expect(400);
    const res = await put(next).expect(200);
    expect(res.body).toEqual(next);
    const [audit] = await auditRows(ctx.db, 'callbacks.settings');
    expect(audit.details.after).toEqual(next);

    await abandon('S1', '904445566', '2026-11-28T10:00:00', 0); // Saturday is a working day now
    expect((await byPhone('904445566'))[0].source).toBe('abandoned');
    await abandon('S2', '904445577', '2026-12-08T10:00:00', 0); // holiday
    expect((await byPhone('904445577'))[0].source).toBe('after_hours');
    await ended('S3', '904445566', '2026-11-28T10:30:00', { answered: true, talkSeconds: 15, extension: '101' }); // < 20 s now
    expect((await byPhone('904445566'))[0].status).toBe('pending');
  });
});

describe('CDR reconciliation (calls missed while the API was down)', () => {
  const ago = (minutes: number) => formatBusinessDateTime(new Date(Date.now() - minutes * 60_000), 'Asia/Tashkent');

  beforeAll(() => {
    const base = {
      dcontext: 'ext-queues',
      channel: 'SIP/712020159-0001',
      lastdata: '',
      dst: '200',
      dstchannel: '',
      disposition: 'NO ANSWER',
      duration: 20,
      billsec: 0,
    };
    ctx.cdr.legs = [
      // missed, then the operator called back and talked → resolved
      { ...base, calldate: ago(120), src: '998933334455', uniqueid: 'c1', linkedid: 'c1' },
      {
        ...base,
        calldate: ago(100),
        src: '105',
        dst: '933334455',
        dcontext: 'from-internal',
        channel: 'SIP/105-0009',
        dstchannel: 'SIP/712020159-0010',
        disposition: 'ANSWERED',
        duration: 70,
        billsec: 60,
        uniqueid: 'c2',
        linkedid: 'c2',
      },
      // missed and never reached → pending
      { ...base, calldate: ago(90), src: '933336677', uniqueid: 'c3', linkedid: 'c3' },
      // busy call back attempt → unreachable
      {
        ...base,
        calldate: ago(60),
        src: '106',
        dst: '933336677',
        dcontext: 'from-internal',
        channel: 'SIP/106-0011',
        dstchannel: 'SIP/712020159-0012',
        disposition: 'BUSY',
        uniqueid: 'c4',
        linkedid: 'c4',
      },
    ];
  });

  it('is admin only', async () => {
    await http().post('/api/callbacks/sync').set('Authorization', ctx.users.op101.auth).send({}).expect(403);
  });

  it('replays the CDR through the same rules and is idempotent', async () => {
    const first = await http()
      .post('/api/callbacks/sync')
      .set('Authorization', ctx.users.admin.auth)
      .send({ hours: 6 })
      .expect(200);
    expect(first.body).toMatchObject({ scannedRows: 4, calls: 4, created: 2, resolved: 1, failedAttempts: 1 });

    expect((await byPhone('933334455'))[0]).toMatchObject({
      status: 'resolved',
      closedBy: 'ext 105',
      resolutionType: 'operator_outbound',
    });
    expect((await byPhone('933336677'))[0]).toMatchObject({
      status: 'pending',
      category: 'unreachable',
      lastOutboundCause: 'busy',
      lastOutboundExtension: '106',
    });

    const second = await http()
      .post('/api/callbacks/sync')
      .set('Authorization', ctx.users.admin.auth)
      .send({ hours: 6 })
      .expect(200);
    expect(second.body).toMatchObject({ created: 0, appended: 0, resolved: 0, failedAttempts: 0, skipped: 4 });
    expect((await auditRows(ctx.db, 'callbacks.sync')).length).toBe(2);
  });

  it('does not double count a call already seen live (same linkedid)', async () => {
    await abandon(
      'c5',
      '933338899',
      formatBusinessDateTime(new Date(Date.now() - 30 * 60_000), 'Asia/Tashkent').replace(' ', 'T'),
      0,
    );
    ctx.cdr.legs.push({
      calldate: ago(30),
      src: '933338899',
      dst: '200',
      dcontext: 'ext-queues',
      channel: 'SIP/712020159-0020',
      dstchannel: '',
      lastdata: '',
      disposition: 'NO ANSWER',
      duration: 10,
      billsec: 0,
      uniqueid: 'c5',
      linkedid: 'c5',
    });
    await http().post('/api/callbacks/sync').set('Authorization', ctx.users.admin.auth).send({ hours: 6 }).expect(200);
    expect((await byPhone('933338899'))[0].missedCount).toBe(1);
  });
});
