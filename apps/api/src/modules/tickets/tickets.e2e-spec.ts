import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { LiveCall, Role, Ticket, TicketDetail } from '@cc/shared';
import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ThrottlerGuard } from '@nestjs/throttler';
import { sql } from 'kysely';
import request from 'supertest';
import { type MockInstance, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTML_XSS, PDF_MIN, PNG_1PX, docx, paragraph } from '../../../test/fixtures/files.js';
import { type S5TestApp, type TestUser, createS5TestApp } from '../../../test/s5-harness.js';
import { CallEvents } from '../../common/events/domain-events.js';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { ActionsService } from '../actions/actions.service.js';
import { LiveService } from '../live/live.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { TicketRecordingsService } from './ticket-recordings.service.js';

/**
 * Tickets workflow (docs/rewrite/TICKETS.md) end to end on a real Postgres. AMI, CDR and SFTP are faked at
 * the service boundary (live call state, PbxCallsService.findCall, ActionsService.originate,
 * RecordingsService.file/prepareStream); AMI call events are emitted like the live module does.
 * Executives use the pre-S1 role name `admin` (ticketActorKind maps it to executive). The observer (an S1
 * role) is inserted by widening users_role_check for the "owner decisions" block and restoring it after.
 */
describe('tickets workflow (e2e)', () => {
  let t: S5TestApp;
  let superuser: TestUser;
  let exec: TestUser;
  let execOther: TestUser;
  let execSam: TestUser;
  let op: TestUser;
  let op2: TestUser;
  let opNoExt: TestUser;
  let tashkent: number;
  let samarqand: number;
  let andijon: number;
  let category: number;
  let broadcast: MockInstance<RealtimeService['broadcast']>;
  let originate: ReturnType<typeof vi.spyOn>;
  let callControl: ReturnType<typeof vi.spyOn>;
  let findCall: ReturnType<typeof vi.spyOn>;
  let recordingFile: ReturnType<typeof vi.spyOn>;

  const http = () => request(t.app.getHttpServer());
  const uploads = () => readdir(path.join(t.tmp, 'uploads'));
  const events = () => t.app.get(EventEmitter2);

  function create(user: TestUser, fields: Record<string, string | number>, files: Array<[Buffer, string]> = []) {
    const req = http().post('/api/tickets').set('Authorization', user.auth);
    for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
    for (const [buf, name] of files) req.attach('files', buf, name);
    return req;
  }

  const base = () => ({
    regionId: tashkent,
    categoryId: category,
    phone: '+998 90 123 45 67',
    description: 'ERI kaliti ishlamayapti',
  });

  async function newTicket(user = op, over: Record<string, string | number> = {}): Promise<TicketDetail> {
    const res = await create(user, { ...base(), ...over });
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as TicketDetail;
  }

  const post = (user: TestUser, url: string, body: object = {}) =>
    http().post(url).set('Authorization', user.auth).send(body);
  const get = (user: TestUser, url: string) => http().get(url).set('Authorization', user.auth);

  /** A ticket that went through the region and waits in the callback queue. */
  async function queued(creator = op): Promise<TicketDetail> {
    const tk = await newTicket(creator);
    await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
    await post(exec, `/api/tickets/${tk.id}/start`).expect(200);
    const res = await post(exec, `/api/tickets/${tk.id}/resolve`, { note: 'Kalit qayta yozildi' }).expect(200);
    return res.body as TicketDetail;
  }

  function liveCall(over: Partial<LiveCall> = {}): LiveCall {
    return {
      id: '1763373600.11',
      direction: 'inbound',
      state: 'talking',
      phone: '901112233',
      callerName: null,
      queue: '2020159',
      extension: '201',
      ringing: [],
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      answeredAt: new Date(Date.now() - 50_000).toISOString(),
      stateSince: new Date(Date.now() - 50_000).toISOString(),
      ...over,
    };
  }

  function pastCall(over: Partial<AssembledCall> = {}): { call: AssembledCall; legs: [] } {
    return {
      call: {
        id: '1763370000.5',
        start: '2026-11-17 14:00:00',
        startEpochMs: Date.parse('2026-11-17T09:00:00Z'),
        clientNumber: '935557788',
        operators: ['201'],
        firstOperator: '201',
        finalOperator: '201',
        status: 'answered',
        talkSec: 42,
        recordingFile: 'q-2020159-935557788-20261117-140000-1763370000.5.wav',
        ...over,
      } as AssembledCall,
      legs: [],
    };
  }

  beforeAll(async () => {
    t = await createS5TestApp();
    // 90001/90002 belong to the legacy tickets mapper e2e (same database).
    await t.db.deleteFrom('tickets').where('id', 'not in', [90001, 90002]).execute();
    await t.db.deleteFrom('ticketExecutiveRegions').execute();
    const regions = await t.db.selectFrom('ticketRegions').select(['id', 'code']).execute();
    tashkent = regions.find((r) => r.code === 'toshkent-shahri')!.id;
    samarqand = regions.find((r) => r.code === 'samarqand')!.id;
    andijon = regions.find((r) => r.code === 'andijon')!.id;
    category = (await t.db.selectFrom('ticketCategories').select('id').orderBy('sortOrder').executeTakeFirstOrThrow())
      .id;

    superuser = await t.createUser('superuser', '100');
    exec = await t.createUser('admin', null);
    execOther = await t.createUser('admin', null);
    execSam = await t.createUser('admin', null);
    op = await t.createUser('operator', '201');
    op2 = await t.createUser('operator', '202');
    opNoExt = await t.createUser('operator', null);

    // Many tickets per minute from one test client: the per-IP rate limit is not under test here.
    vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    broadcast = vi.spyOn(t.app.get(RealtimeService), 'broadcast');
    originate = vi
      .spyOn(t.app.get(ActionsService), 'originate')
      .mockResolvedValue({ ok: true, message: 'Calling your phone…' });
    callControl = vi.spyOn(t.app.get(LiveService), 'callControl').mockReturnValue(null);
    findCall = vi.spyOn(t.app.get(PbxCallsService), 'findCall').mockResolvedValue(null);
    recordingFile = vi.spyOn(t.app.get(RecordingsService), 'file').mockImplementation(async (p: string) => ({
      name: p.split('/').pop() as string,
      path: p,
      size: 64_000,
      durationSec: 4,
      modifiedAt: null,
      kind: 'talk' as const,
    }));
    vi.spyOn(t.app.get(RecordingsService), 'prepareStream').mockImplementation(async () => ({
      status: 200,
      headers: { 'Content-Type': 'audio/wav', 'Content-Length': '4' },
      stream: Readable.from([Buffer.from('RIFF')]),
    }));
  });

  beforeEach(() => {
    broadcast.mockClear();
    originate.mockClear();
    callControl.mockReturnValue(null);
    findCall.mockResolvedValue(null);
  });

  afterAll(async () => {
    await t?.close();
  });

  // -------------------------------------------------------------------------------------------------
  describe('directories', () => {
    it('everyone with ticket access reads them: 14 seeded regions with uz/ru names, categories', async () => {
      const res = await get(op, '/api/tickets/directories').expect(200);
      expect(res.body.regions.length).toBeGreaterThanOrEqual(14);
      expect(res.body.regions.find((r: { code: string }) => r.code === 'qoraqalpogiston')).toMatchObject({
        nameRu: 'Республика Каракалпакстан',
        cities: [],
      });
      expect(res.body.categories.map((c: { nameRu: string }) => c.nameRu)).toEqual(
        expect.arrayContaining(['Ключ ЭЦП', 'ЭДО', 'Другое']),
      );
      await http().get('/api/tickets/directories').expect(401);
    });

    it('only the superuser edits regions, cities and categories; changes are audited', async () => {
      const region = { code: `test-${Date.now()}`, nameUz: 'Sinov viloyati', nameRu: 'Тестовая область' };
      await post(exec, '/api/tickets/directories/regions', region).expect(403);
      await post(op, '/api/tickets/directories/regions', region).expect(403);
      const r = await post(superuser, '/api/tickets/directories/regions', region).expect(201);
      await post(superuser, '/api/tickets/directories/regions', region).expect(409);
      await post(superuser, '/api/tickets/directories/regions', { ...region, code: 'Bad Code' }).expect(400);
      await http()
        .patch(`/api/tickets/directories/regions/${r.body.id}`)
        .set('Authorization', superuser.auth)
        .send({ nameRu: 'Новая' })
        .expect(200);

      const city = await post(superuser, `/api/tickets/directories/regions/${r.body.id}/cities`, {
        nameUz: 'Markaz',
        nameRu: 'Центр',
      }).expect(201);
      await post(exec, `/api/tickets/directories/regions/${r.body.id}/cities`, {
        nameUz: 'X tumani',
        nameRu: 'X район',
      }).expect(403);
      await post(superuser, `/api/tickets/directories/regions/${r.body.id}/cities`, {
        nameUz: 'Markaz',
        nameRu: 'Центр',
      }).expect(409);
      // a region with cities cannot be deleted
      await http()
        .delete(`/api/tickets/directories/regions/${r.body.id}`)
        .set('Authorization', superuser.auth)
        .expect(409);
      await http()
        .patch(`/api/tickets/directories/cities/${city.body.id}`)
        .set('Authorization', superuser.auth)
        .send({ isActive: false })
        .expect(200);
      await http()
        .delete(`/api/tickets/directories/cities/${city.body.id}`)
        .set('Authorization', exec.auth)
        .expect(403);
      await http()
        .delete(`/api/tickets/directories/cities/${city.body.id}`)
        .set('Authorization', superuser.auth)
        .expect(204);
      await http()
        .delete(`/api/tickets/directories/regions/${r.body.id}`)
        .set('Authorization', superuser.auth)
        .expect(204);

      const cat = await post(superuser, '/api/tickets/directories/categories', {
        nameUz: `Sinov ${Date.now()}`,
        nameRu: 'Тест',
      }).expect(201);
      await http()
        .patch(`/api/tickets/directories/categories/${cat.body.id}`)
        .set('Authorization', exec.auth)
        .send({ nameRu: 'Новое имя' })
        .expect(403);
      await http()
        .delete(`/api/tickets/directories/categories/${cat.body.id}`)
        .set('Authorization', superuser.auth)
        .expect(204);

      const audit = await t.db.selectFrom('auditLog').select('action').where('action', 'like', 'tickets.%').execute();
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'tickets.region.create',
          'tickets.region.update',
          'tickets.city.create',
          'tickets.city.delete',
          'tickets.region.delete',
          'tickets.category.create',
        ]),
      );
    });

    it('a region or category used by tickets can only be deactivated', async () => {
      const tk = await newTicket();
      await http()
        .delete(`/api/tickets/directories/regions/${tashkent}`)
        .set('Authorization', superuser.auth)
        .expect(409);
      await http()
        .delete(`/api/tickets/directories/categories/${category}`)
        .set('Authorization', superuser.auth)
        .expect(409);
      expect(tk.region?.id).toBe(tashkent);
    });

    it('assigns executives to regions (many-to-many)', async () => {
      const put = (user: TestUser, userId: number, regionIds: number[]) =>
        http()
          .put(`/api/tickets/directories/executives/${userId}/regions`)
          .set('Authorization', user.auth)
          .send({ regionIds });
      await put(exec, exec.id, [tashkent]).expect(403);
      await put(superuser, op.id, [tashkent]).expect(400);
      await put(superuser, exec.id, [999_999]).expect(400);
      expect((await put(superuser, exec.id, [tashkent, andijon]).expect(200)).body.regionIds).toEqual(
        [tashkent, andijon].sort((a, b) => a - b),
      );
      await put(superuser, execOther.id, [tashkent]).expect(200);
      await put(superuser, execSam.id, [samarqand]).expect(200);
      const list = await get(superuser, '/api/tickets/directories/executives').expect(200);
      expect(list.body.find((e: { userId: number }) => e.userId === execSam.id).regionIds).toEqual([samarqand]);
      await get(exec, '/api/tickets/directories/executives').expect(403);

      const ctx = await get(exec, '/api/tickets/context').expect(200);
      expect(ctx.body).toMatchObject({
        kind: 'executive',
        capabilities: { work: true, create: false },
        slaWorkingDays: 3,
      });
      expect(ctx.body.regionIds).toEqual(expect.arrayContaining([tashkent, andijon]));
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe('create', () => {
    it('operator opens a ticket by hand; identity from the session; phone normalized; SLA due date set', async () => {
      const res = await create(op, {
        ...base(),
        customerName: 'Aliyev Vali',
        creatorUserId: superuser.id,
        status: 'closed',
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'new',
        customerPhone: '901234567',
        customerName: 'Aliyev Vali',
        region: { id: tashkent },
        creator: { userId: op.id, extension: '201' },
        overdue: false,
        lastContact: null,
      });
      const days = (Date.parse(res.body.dueAt) - Date.parse(res.body.createdAt)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(3);
      expect(days).toBeLessThanOrEqual(7);
      expect(res.body.events).toEqual([
        expect.objectContaining({
          kind: 'created',
          toStatus: 'new',
          actor: expect.objectContaining({ userId: op.id }),
        }),
      ]);
    });

    it('validates region, city, category and phone', async () => {
      await create(op, { ...base(), regionId: '' }).expect(400);
      await create(op, { ...base(), categoryId: 999_999 }).expect(400);
      await create(op, { ...base(), phone: '' }).expect(400);
      await create(op, { ...base(), description: '' }).expect(400);
      const city = await post(superuser, `/api/tickets/directories/regions/${samarqand}/cities`, {
        nameUz: `Urgut ${Date.now()}`,
        nameRu: 'Ургут',
      }).expect(201);
      await create(op, { ...base(), cityId: city.body.id }).expect(400); // city of another region
      const ok = await create(op, { ...base(), regionId: samarqand, cityId: city.body.id }).expect(201);
      expect(ok.body.city).toMatchObject({ id: city.body.id, nameRu: 'Ургут' });
    });

    it('executives cannot open tickets', async () => {
      await create(exec, base()).expect(403);
    });

    it('during a call: phone and call id come from the live state, not the request', async () => {
      callControl.mockReturnValue({ call: liveCall(), partyChannel: null, operatorChannel: null });
      const pre = await get(op, '/api/tickets/call-prefill?callId=1763373600.11').expect(200);
      expect(pre.body).toMatchObject({ source: 'live', phone: '901112233', openTickets: [] });
      await get(op2, '/api/tickets/call-prefill?callId=1763373600.11').expect(403);

      const res = await create(op, { ...base(), callId: '1763373600.11', phone: '909999999' }).expect(201);
      expect(res.body).toMatchObject({
        customerPhone: '901112233',
        originCallId: '1763373600.11',
        lastContact: { userId: op.id },
        lastContactIsMe: true,
      });
      expect(res.body.calls).toEqual([
        expect.objectContaining({
          kind: 'origin',
          callId: '1763373600.11',
          recording: { status: 'pending', fileName: null },
        }),
      ]);
      await create(op2, { ...base(), callId: '1763373600.11' }).expect(403);
      await create(op, { ...base(), callId: 'not-a-call' }).expect(400);

      // the call ends → the recording is looked up and attached
      findCall.mockResolvedValue(pastCall({ id: '1763373600.11', recordingFile: '2026/11/17/in-901112233.wav' }));
      await events().emitAsync(CallEvents.Ended, {
        callId: '1763373600.11',
        direction: 'inbound',
        phone: '901112233',
        at: new Date().toISOString(),
        extension: '201',
        answered: true,
        talkSeconds: 70,
        hangupParty: 'client',
      });
      await t.db
        .updateTable('ticketCalls')
        .set({ recordingNextAt: new Date(0) })
        .where('ticketId', '=', res.body.id)
        .execute();
      expect(await t.app.get(TicketRecordingsService).linkDue(new Date())).toBeGreaterThanOrEqual(1);
      const after = await get(op, `/api/tickets/${res.body.id}`).expect(200);
      expect(after.body.calls[0]).toMatchObject({
        talkSeconds: 70,
        recording: { status: 'found', fileName: 'in-901112233.wav' },
      });
    });

    it('from the history: only a call the operator took part in; its recording is attached', async () => {
      findCall.mockResolvedValue(pastCall());
      const pre = await get(op, '/api/tickets/call-prefill?callId=1763370000.5').expect(200);
      expect(pre.body).toMatchObject({ source: 'history', phone: '935557788' });
      await create(op2, { ...base(), callId: '1763370000.5' }).expect(403);
      const res = await create(op, { ...base(), callId: '1763370000.5' }).expect(201);
      expect(res.body.customerPhone).toBe('935557788');
      await t.db
        .updateTable('ticketCalls')
        .set({ recordingNextAt: new Date(0) })
        .where('ticketId', '=', res.body.id)
        .execute();
      await t.app.get(TicketRecordingsService).linkDue(new Date());
      const after = await get(op, `/api/tickets/${res.body.id}`).expect(200);
      expect(after.body.calls[0].recording).toEqual({
        status: 'found',
        fileName: 'q-2020159-935557788-20261117-140000-1763370000.5.wav',
      });
      expect(recordingFile).toHaveBeenCalledWith('2026/11/17/q-2020159-935557788-20261117-140000-1763370000.5.wav');

      findCall.mockResolvedValue(null);
      await get(op, '/api/tickets/call-prefill?callId=1763370000.99').expect(404);
      await create(op, { ...base(), callId: '1763370000.99' }).expect(404);
    });

    it('a missing recording is retried and then given up', async () => {
      findCall.mockResolvedValue(pastCall({ id: '1763370000.7', recordingFile: null }));
      const res = await create(op, { ...base(), callId: '1763370000.7' }).expect(201);
      const svc = t.app.get(TicketRecordingsService);
      await t.db
        .updateTable('ticketCalls')
        .set({ recordingNextAt: new Date(0) })
        .where('ticketId', '=', res.body.id)
        .execute();
      await svc.linkDue(new Date());
      let row = await t.db
        .selectFrom('ticketCalls')
        .selectAll()
        .where('ticketId', '=', res.body.id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ recordingStatus: 'pending', recordingChecks: 1 });
      await t.db
        .updateTable('ticketCalls')
        .set({ recordingNextAt: new Date(0), recordingDeadline: new Date(0) })
        .where('id', '=', row.id)
        .execute();
      await svc.linkDue(new Date());
      row = await t.db.selectFrom('ticketCalls').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
      expect(row.recordingStatus).toBe('none');
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe('visibility', () => {
    it('executives see only their regions; operators their own tickets; cross-region looks missing', async () => {
      const tk = await newTicket(op, { regionId: samarqand });
      await get(execSam, `/api/tickets/${tk.id}`).expect(200);
      await get(exec, `/api/tickets/${tk.id}`).expect(404);
      await get(op2, `/api/tickets/${tk.id}`).expect(404);
      await get(superuser, `/api/tickets/${tk.id}`).expect(200);
      const execList = await get(exec, '/api/tickets?view=all').expect(200);
      expect(execList.body.items.map((i: { id: number }) => i.id)).not.toContain(tk.id);
      const samList = await get(execSam, '/api/tickets?view=queue').expect(200);
      expect(samList.body.items.map((i: { id: number }) => i.id)).toContain(tk.id);
      expect(samList.body.items.every((i: { region: { id: number } }) => i.region.id === samarqand)).toBe(true);
      const mine = await get(op, '/api/tickets?view=mine').expect(200);
      expect(mine.body.items.map((i: { id: number }) => i.id)).toContain(tk.id);
      expect((await get(op2, '/api/tickets?view=mine').expect(200)).body.items).toEqual([]);
      await get(opNoExt, '/api/tickets?view=all').expect(200);
      await http().get('/api/tickets').expect(401);
    });

    it('filters: status, region, search by code / phone', async () => {
      const tk = await newTicket(op, { phone: '977001122' });
      const byCode = await get(superuser, `/api/tickets?q=TK-${tk.id}`).expect(200);
      expect(byCode.body.items.map((i: { id: number }) => i.id)).toEqual([tk.id]);
      const byPhone = await get(superuser, '/api/tickets?q=7700112').expect(200);
      expect(byPhone.body.items.map((i: { id: number }) => i.id)).toContain(tk.id);
      const byRegion = await get(superuser, `/api/tickets?regionId=${samarqand}`).expect(200);
      expect(byRegion.body.items.every((i: { region: { id: number } }) => i.region.id === samarqand)).toBe(true);
      await get(superuser, '/api/tickets?status=bogus').expect(400);
    });

    it('WS: a new ticket is announced only to users who may see it, with the unread counter for executives', async () => {
      const tk = await newTicket(op);
      const changed = broadcast.mock.calls.filter((c) => c[0] === 'tickets.changed');
      const ids = changed.flatMap((c) => (c[2] as { userIds: number[] }).userIds);
      expect(ids).toEqual(expect.arrayContaining([exec.id, execOther.id, superuser.id, op.id]));
      expect(ids).not.toContain(execSam.id);
      expect(ids).not.toContain(op2.id);
      expect(changed[0][1]).toMatchObject({ id: tk.id, action: 'created', status: 'new', regionId: tashkent });
      const unread = broadcast.mock.calls.filter((c) => c[0] === 'tickets.unread');
      expect(unread.map((c) => (c[2] as { userIds: number[] }).userIds[0])).toEqual(
        expect.arrayContaining([exec.id, execOther.id]),
      );
      expect(unread.map((c) => (c[2] as { userIds: number[] }).userIds[0])).not.toContain(execSam.id);
    });

    it('unread: a new ticket of my region until I open it', async () => {
      const tk = await newTicket(op);
      const before = (await get(exec, '/api/tickets/unread').expect(200)).body.count;
      expect(before).toBeGreaterThanOrEqual(1);
      const list = await get(exec, '/api/tickets?view=queue').expect(200);
      expect(list.body.items.find((i: { id: number }) => i.id === tk.id).unread).toBe(true);
      await get(exec, `/api/tickets/${tk.id}`).expect(200);
      expect((await get(exec, '/api/tickets/unread').expect(200)).body.count).toBe(before - 1);
      expect((await get(op, '/api/tickets/unread').expect(200)).body.count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe('regional workflow', () => {
    it('new → assigned → in_progress → done → callback_pending, with the timeline and audit', async () => {
      const tk = await newTicket();
      await post(execSam, `/api/tickets/${tk.id}/assign`).expect(404);
      await post(op, `/api/tickets/${tk.id}/assign`).expect(403);
      const a = await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
      expect(a.body).toMatchObject({
        status: 'assigned',
        assignee: { userId: exec.id },
        actions: { start: true, assign: false },
      });
      await post(execOther, `/api/tickets/${tk.id}/assign`).expect(409);
      await post(execOther, `/api/tickets/${tk.id}/start`).expect(403);
      // another executive of the region sees it but cannot change it
      expect((await get(execOther, `/api/tickets/${tk.id}`).expect(200)).body.actions).toMatchObject({
        start: false,
        forward: false,
      });
      await post(exec, `/api/tickets/${tk.id}/resolve`).expect(409);
      await post(exec, `/api/tickets/${tk.id}/start`).expect(200);
      await post(exec, `/api/tickets/${tk.id}/reject`, {}).expect(400);
      const done = await post(exec, `/api/tickets/${tk.id}/resolve`, { note: 'Hal qilindi' }).expect(200);
      expect(done.body).toMatchObject({
        status: 'callback_pending',
        resolution: 'done',
        resolutionNote: 'Hal qilindi',
        resolvedBy: { userId: exec.id },
      });
      expect(done.body.events.map((e: { kind: string }) => e.kind)).toEqual([
        'created',
        'assigned',
        'started',
        'done',
        'returned',
      ]);
      expect(done.body.events.at(-1)).toMatchObject({ fromStatus: 'done', toStatus: 'callback_pending', actor: null });
      const audit = await t.db
        .selectFrom('auditLog')
        .select('action')
        .where('target', '=', `ticket:${tk.id}`)
        .execute();
      expect(audit.map((x) => x.action)).toEqual(
        expect.arrayContaining([
          'tickets.create',
          'tickets.assign',
          'tickets.start',
          'tickets.resolve',
          'tickets.denied',
        ]),
      );
    });

    it('rejected needs a note and also returns to operators', async () => {
      const tk = await newTicket();
      await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
      await post(exec, `/api/tickets/${tk.id}/start`).expect(200);
      await post(exec, `/api/tickets/${tk.id}/reject`, { note: ' ' }).expect(400);
      const r = await post(exec, `/api/tickets/${tk.id}/reject`, { note: 'Bizning hududga tegishli emas' }).expect(200);
      expect(r.body).toMatchObject({ status: 'callback_pending', resolution: 'rejected' });
    });

    it('forward to another region: back to `new` there, the old region loses it', async () => {
      const tk = await newTicket();
      await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
      await post(execOther, `/api/tickets/${tk.id}/forward`, { regionId: samarqand, note: 'xx' }).expect(403);
      await post(exec, `/api/tickets/${tk.id}/forward`, { regionId: samarqand }).expect(400);
      await post(exec, `/api/tickets/${tk.id}/forward`, { regionId: tashkent, note: 'xx' }).expect(400);
      await post(exec, `/api/tickets/${tk.id}/forward`, { regionId: 999_999, note: 'xx' }).expect(400);
      broadcast.mockClear();
      await post(exec, `/api/tickets/${tk.id}/forward`, { regionId: samarqand, note: 'Samarqandga tegishli' }).expect(
        200,
      );
      await get(exec, `/api/tickets/${tk.id}`).expect(404);
      const s = await get(execSam, `/api/tickets/${tk.id}`).expect(200);
      expect(s.body).toMatchObject({ status: 'new', region: { id: samarqand }, assignee: null, city: null });
      expect(s.body.events.at(-1)).toMatchObject({
        kind: 'forwarded',
        fromRegion: { id: tashkent },
        toRegion: { id: samarqand },
        note: 'Samarqandga tegishli',
      });
      const revoked = broadcast.mock.calls.find((c) => c[0] === 'tickets.revoked');
      const lostAccess = (revoked as unknown[])[2] as { userIds: number[] };
      expect(lostAccess.userIds).toEqual(expect.arrayContaining([exec.id, execOther.id]));
      expect(lostAccess.userIds).not.toContain(execSam.id);
    });

    it('triage: a ticket without a region is visible only to the superuser, who routes it', async () => {
      const tk = await newTicket();
      await t.db.updateTable('tickets').set({ regionId: null }).where('id', '=', tk.id).execute();
      await get(exec, `/api/tickets/${tk.id}`).expect(404);
      const tri = await get(superuser, '/api/tickets?view=triage').expect(200);
      expect(tri.body.items.map((i: { id: number }) => i.id)).toContain(tk.id);
      await post(superuser, `/api/tickets/${tk.id}/assign`).expect(409);
      await post(superuser, `/api/tickets/${tk.id}/forward`, { regionId: tashkent }).expect(200);
      await get(exec, `/api/tickets/${tk.id}`).expect(200);
    });

    it('the superuser may act for any region', async () => {
      const tk = await newTicket(op, { regionId: samarqand });
      await post(superuser, `/api/tickets/${tk.id}/assign`).expect(200);
      await post(superuser, `/api/tickets/${tk.id}/start`).expect(200);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe('callback', () => {
    const ended = (callId: string, talkSeconds: number, answered = true, ext = '202', phone = '901234567') =>
      events().emitAsync(CallEvents.Ended, {
        callId,
        direction: 'outbound',
        phone,
        at: new Date().toISOString(),
        extension: ext,
        answered,
        talkSeconds,
        hangupParty: 'operator',
      });
    const answered = (callId: string, ext = '202', phone = '901234567') =>
      events().emitAsync(CallEvents.Answered, {
        callId,
        direction: 'outbound',
        phone,
        at: new Date().toISOString(),
        extension: ext,
      });

    it('every operator sees the shared queue; tickets of citizens I talked to come first', async () => {
      const a = await queued();
      const b = await queued();
      await t.db
        .updateTable('tickets')
        .set({ lastContactUserId: op2.id, lastContactLabel: 'op2', lastContactAt: new Date() })
        .where('id', '=', a.id)
        .execute();
      const list2 = await get(op2, '/api/tickets?view=callback').expect(200);
      const ids2 = list2.body.items.map((i: { id: number }) => i.id);
      expect(ids2.indexOf(a.id)).toBeLessThan(ids2.indexOf(b.id));
      expect(list2.body.items[0]).toMatchObject({ lastContactIsMe: true, actions: { call: true } });
      // for op neither is "mine": the oldest resolution first; once op talked to b's citizen, b goes up
      let ids1 = (await get(op, '/api/tickets?view=callback').expect(200)).body.items.map((i: { id: number }) => i.id);
      expect(ids1.indexOf(a.id)).toBeLessThan(ids1.indexOf(b.id));
      await t.db
        .updateTable('tickets')
        .set({ lastContactUserId: op.id, lastContactLabel: 'op', lastContactAt: new Date() })
        .where('id', '=', b.id)
        .execute();
      ids1 = (await get(op, '/api/tickets?view=callback').expect(200)).body.items.map((i: { id: number }) => i.id);
      expect(ids1.indexOf(b.id)).toBeLessThan(ids1.indexOf(a.id));
    });

    it('call → AMI confirms ≥ 10 s → outcome closes the ticket; recording of the callback attached', async () => {
      const tk = await queued();
      await post(exec, `/api/tickets/${tk.id}/callback/call`).expect(403);
      await post(opNoExt, `/api/tickets/${tk.id}/callback/call`).expect(403);
      await post(op2, `/api/tickets/${tk.id}/callback/outcome`, { outcome: 'informed' }).expect(409); // no call yet

      const c = await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(200);
      expect(originate).toHaveBeenCalledWith(expect.objectContaining({ id: op2.id }), { to: '901234567' });
      expect(c.body.calls.at(-1)).toMatchObject({
        kind: 'callback',
        attemptStatus: 'dialing',
        operator: { userId: op2.id, extension: '202' },
      });
      await post(op, `/api/tickets/${tk.id}/callback/call`).expect(409); // someone is already calling

      // another number / extension does not count
      await answered('1763380000.1', '202', '909999999');
      await answered('1763380000.2', '203');
      let row = await t.db
        .selectFrom('ticketCalls')
        .selectAll()
        .where('ticketId', '=', tk.id)
        .where('kind', '=', 'callback')
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ attemptStatus: 'dialing', callId: null });

      await answered('1763380000.3');
      row = await t.db.selectFrom('ticketCalls').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ attemptStatus: 'answered', callId: '1763380000.3' });
      await ended('1763380000.3', 35);
      const d = await get(op2, `/api/tickets/${tk.id}`).expect(200);
      expect(d.body.status).toBe('callback_pending');
      expect(d.body.calls.at(-1)).toMatchObject({ attemptStatus: 'connected', talkSeconds: 35 });
      expect(d.body.actions.recordOutcome).toBe(true);
      await post(op, `/api/tickets/${tk.id}/callback/outcome`, { outcome: 'informed' }).expect(409); // not op's attempt

      const closed = await post(op2, `/api/tickets/${tk.id}/callback/outcome`, {
        outcome: 'informed',
        note: 'Fuqaro mamnun',
      }).expect(200);
      expect(closed.body).toMatchObject({
        status: 'closed',
        closedBy: { userId: op2.id },
        callbackOutcome: 'informed',
        callbackNote: 'Fuqaro mamnun',
        callbackAttempts: 1,
      });
      expect(closed.body.events.at(-1)).toMatchObject({
        kind: 'closed',
        fromStatus: 'callback_pending',
        toStatus: 'closed',
      });
      // op2 closed it → still sees it; another operator who is not the creator does not
      await get(op2, `/api/tickets/${tk.id}`).expect(200);
      const op3 = await t.createUser('operator', '203');
      await get(op3, `/api/tickets/${tk.id}`).expect(404);

      findCall.mockResolvedValue(pastCall({ id: '1763380000.3', recordingFile: '2026/11/17/out-202-901234567.wav' }));
      await t.db
        .updateTable('ticketCalls')
        .set({ recordingNextAt: new Date(0) })
        .where('id', '=', row.id)
        .execute();
      await t.app.get(TicketRecordingsService).linkDue(new Date());
      const withRec = await get(op2, `/api/tickets/${tk.id}`).expect(200);
      expect(withRec.body.calls.at(-1).recording).toEqual({ status: 'found', fileName: 'out-202-901234567.wav' });
    });

    it('a conversation shorter than 10 s does not close; not reached is an attempt; outcome during the call waits', async () => {
      const tk = await queued();
      await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(200);
      await answered('1763380001.1');
      // outcome given while still talking: kept, applied when the call ends
      const pending = await post(op2, `/api/tickets/${tk.id}/callback/outcome`, { outcome: 'informed' }).expect(200);
      expect(pending.body.status).toBe('callback_pending');
      await ended('1763380001.1', 6);
      let d = await get(op2, `/api/tickets/${tk.id}`).expect(200);
      expect(d.body).toMatchObject({ status: 'callback_pending', callbackAttempts: 1 });
      expect(d.body.calls.at(-1)).toMatchObject({ attemptStatus: 'not_connected', outcome: 'informed' });

      // unanswered call: success outcome refused, not reached accepted
      await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(200);
      await ended('1763380001.2', 0, false);
      await post(op2, `/api/tickets/${tk.id}/callback/outcome`, { outcome: 'unresolved' }).expect(409);
      d = await post(op2, `/api/tickets/${tk.id}/callback/outcome`, {
        outcome: 'not_reached',
        note: 'Javob bermadi',
      }).expect(200);
      expect(d.body).toMatchObject({ status: 'callback_pending', callbackAttempts: 2 });
      expect(d.body.events.filter((e: { kind: string }) => e.kind === 'callback_attempt')).toHaveLength(2);

      // outcome first, then a confirmed conversation closes the ticket from the AMI event
      await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(200);
      await answered('1763380001.3');
      await post(op2, `/api/tickets/${tk.id}/callback/outcome`, { outcome: 'other', note: 'Boshqa' }).expect(200);
      await ended('1763380001.3', 12);
      d = await get(op2, `/api/tickets/${tk.id}`).expect(200);
      expect(d.body).toMatchObject({ status: 'closed', callbackOutcome: 'other', closedBy: { userId: op2.id } });
    });

    it('a refused Originate marks the attempt failed and frees the ticket', async () => {
      const tk = await queued();
      originate.mockRejectedValueOnce(new ConflictException('Extension 202 is busy'));
      await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(409);
      const d = await get(op2, `/api/tickets/${tk.id}`).expect(200);
      expect(d.body.calls.at(-1)).toMatchObject({ attemptStatus: 'failed' });
      await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(200);
    });

    it('only the superuser closes without a call (with a reason)', async () => {
      const tk = await queued();
      await post(op, `/api/tickets/${tk.id}/close`, { note: 'Kerak emas' }).expect(403);
      await post(superuser, `/api/tickets/${tk.id}/close`, {}).expect(400);
      const c = await post(superuser, `/api/tickets/${tk.id}/close`, { note: 'Fuqaro o‘zi keldi' }).expect(200);
      expect(c.body).toMatchObject({ status: 'closed', callbackOutcome: 'forced' });
      await post(superuser, `/api/tickets/${tk.id}/close`, { note: 'again' }).expect(409);
      await post(op2, `/api/tickets/${tk.id}/callback/call`).expect(404);
    });

    it('a later conversation with the citizen updates "who talked last"', async () => {
      const tk = await queued();
      const ext = String(3000 + Math.floor(Math.random() * 6000)); // unique: the test database keeps users of earlier runs
      const op5 = await t.createUser('operator', ext);
      await events().emitAsync(CallEvents.Ended, {
        callId: '1763380002.1',
        direction: 'inbound',
        phone: '901234567',
        at: new Date().toISOString(),
        extension: ext,
        answered: true,
        talkSeconds: 40,
        hangupParty: 'client',
      });
      const d = await get(superuser, `/api/tickets/${tk.id}`).expect(200);
      expect(d.body).toMatchObject({ lastContact: { userId: op5.id, extension: ext } });
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe('chat, attachments, recordings', () => {
    it('accepts images, PDF and DOCX by content; refuses the rest', async () => {
      const before = (await uploads()).length;
      const res = await create(op, base(), [
        [PNG_1PX, 'evil.html'],
        [PDF_MIN, 'doc.pdf'],
      ]).expect(201);
      expect(res.body.attachments.map((a: { fileName: string }) => a.fileName)).toEqual(['evil.png', 'doc.pdf']);
      expect((await uploads()).length).toBe(before + 2);
      await create(op, base(), [[HTML_XSS, 'x.png']]).expect(415);
      expect((await uploads()).length).toBe(before + 2);
    });

    it('attachments only for users who see the ticket', async () => {
      const tk = (await create(op, base(), [[PNG_1PX, 'a.png']]).expect(201)).body as TicketDetail;
      const url = `/api/tickets/${tk.id}/attachments/${tk.attachments[0].id}`;
      const dl = await get(exec, url).expect(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="a\.png"/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      await get(execSam, url).expect(404);
      await get(op2, url).expect(404);
    });

    it('chat: writers who see the ticket; DOCX preview sanitized', async () => {
      const tk = await newTicket();
      const c = await http()
        .post(`/api/tickets/${tk.id}/comments`)
        .set('Authorization', exec.auth)
        .field('body', 'Ko‘rib chiqyapman')
        .attach('files', await docx(paragraph('Salom <script>alert(1)</script>')), 'xat.docx')
        .expect(201);
      expect(c.body.comments[0]).toMatchObject({ body: 'Ko‘rib chiqyapman', author: { userId: exec.id } });
      await http()
        .post(`/api/tickets/${tk.id}/comments`)
        .set('Authorization', execSam.auth)
        .field('body', 'x')
        .expect(404);
      await http().post(`/api/tickets/${tk.id}/comments`).set('Authorization', op.auth).field('body', '').expect(400);
      const att = c.body.comments[0].attachments[0];
      const p = await get(op, `/api/tickets/${tk.id}/attachments/${att.id}/preview`).expect(200);
      expect(p.body.html).toContain('Salom');
      expect(p.body.html).not.toMatch(/<script/i);
    });

    it('recordings are streamed only to users who see the ticket', async () => {
      findCall.mockResolvedValue(pastCall({ id: '1763370000.8' }));
      const tk = (await create(op, { ...base(), callId: '1763370000.8' }).expect(201)).body as TicketDetail;
      const url = `/api/tickets/${tk.id}/calls/${tk.calls[0].id}/recording`;
      await get(exec, url).expect(404); // not found yet
      await t.db
        .updateTable('ticketCalls')
        .set({ recordingNextAt: new Date(0) })
        .where('ticketId', '=', tk.id)
        .execute();
      await t.app.get(TicketRecordingsService).linkDue(new Date());
      const ok = await get(exec, url).expect(200);
      expect(ok.headers['content-type']).toBe('audio/wav');
      await get(execSam, url).expect(404);
      await get(op2, url).expect(404);
      await get(exec, `/api/tickets/${tk.id}/calls/999999/recording`).expect(404);
      const audit = await t.db
        .selectFrom('auditLog')
        .select('action')
        .where('target', '=', `ticket:${tk.id}`)
        .execute();
      expect(audit.map((a) => a.action)).toContain('tickets.recording.play');
    });

    it('delete: superuser only, files removed', async () => {
      const tk = (await create(op, base(), [[PNG_1PX, 'a.png']]).expect(201)).body as TicketDetail;
      const before = (await uploads()).length;
      await http().delete(`/api/tickets/${tk.id}`).set('Authorization', exec.auth).expect(403);
      await http().delete(`/api/tickets/${tk.id}`).set('Authorization', op.auth).expect(403);
      await http().delete(`/api/tickets/${tk.id}`).set('Authorization', superuser.auth).expect(204);
      expect((await uploads()).length).toBe(before - 1);
      await get(superuser, `/api/tickets/${tk.id}`).expect(404);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe('reports', () => {
    it('by region, category, status, executive; overdue share; average resolution time', async () => {
      const late = await queued();
      await t.db
        .updateTable('tickets')
        .set({
          dueAt: new Date(Date.now() - 86_400_000),
          resolvedAt: new Date(),
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        })
        .where('id', '=', late.id)
        .execute();
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const r = await get(superuser, `/api/tickets/reports?from=${from}&to=${today}`).expect(200);
      expect(r.body.total).toBeGreaterThan(5);
      expect(r.body.overdue).toBeGreaterThanOrEqual(1);
      expect(r.body.overdueShare).toBeGreaterThan(0);
      expect(r.body.avgResolutionHours).not.toBeNull();
      expect(r.body.byRegion.map((x: { id: number }) => x.id)).toEqual(expect.arrayContaining([tashkent, samarqand]));
      expect(r.body.byExecutive.find((x: { id: number }) => x.id === exec.id)?.resolved).toBeGreaterThanOrEqual(1);
      expect(r.body.byStatus.find((s: { status: string }) => s.status === 'closed').count).toBeGreaterThanOrEqual(1);

      const e = await get(execSam, `/api/tickets/reports?from=${from}&to=${today}`).expect(200);
      expect(e.body.byRegion.map((x: { id: number }) => x.id)).toEqual([samarqand]);
      await get(op, `/api/tickets/reports?from=${from}&to=${today}`).expect(403);
      await get(superuser, `/api/tickets/reports?from=${today}&to=${from}`).expect(400);
      await get(superuser, '/api/tickets/reports?from=2020-01-01&to=2026-12-31').expect(400);
    });
  });
  // -------------------------------------------------------------------------------------------------
  describe('owner decisions (18.11.2026)', () => {
    const ids = (items: Ticket[]) => items.map((i) => i.id);
    const sentTo = (event: string) =>
      broadcast.mock.calls.filter((c) => c[0] === event).flatMap((c) => (c[2] as { userIds: number[] }).userIds);

    describe('release back to the region queue', () => {
      it('only the executive who holds it, with a note; back to `new`, unread again for the region', async () => {
        const tk = await newTicket();
        await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
        await post(exec, `/api/tickets/${tk.id}/start`).expect(200);
        await post(execOther, `/api/tickets/${tk.id}/release`, { note: 'Men olaman' }).expect(403);
        await post(execSam, `/api/tickets/${tk.id}/release`, { note: 'xx' }).expect(404);
        await post(op, `/api/tickets/${tk.id}/release`, { note: 'xx' }).expect(403);
        await post(exec, `/api/tickets/${tk.id}/release`, {}).expect(400);
        await post(exec, `/api/tickets/${tk.id}/release`, { note: ' ' }).expect(400);

        // execOther already opened the ticket before it was taken: release makes it unread again
        await get(execOther, `/api/tickets/${tk.id}`).expect(200);
        broadcast.mockClear();
        const r = await post(exec, `/api/tickets/${tk.id}/release`, { note: 'Boshqa bo‘limga tegishli' }).expect(200);
        expect(r.body).toMatchObject({
          status: 'new',
          region: { id: tashkent },
          assignee: null,
          assignedAt: null,
          startedAt: null,
          dueAt: tk.dueAt, // the SLA keeps running from creation
          actions: { assign: true, release: false },
        });
        expect(r.body.events.at(-1)).toMatchObject({
          kind: 'released',
          fromStatus: 'in_progress',
          toStatus: 'new',
          actor: { userId: exec.id },
          note: 'Boshqa bo‘limga tegishli',
        });

        const changed = broadcast.mock.calls.find((c) => c[0] === 'tickets.changed');
        expect(changed?.[1]).toMatchObject({ id: tk.id, action: 'released', status: 'new', regionId: tashkent });
        expect(sentTo('tickets.changed')).toEqual(expect.arrayContaining([exec.id, execOther.id, superuser.id, op.id]));
        expect(sentTo('tickets.changed')).not.toContain(execSam.id);
        expect(sentTo('tickets.unread')).toEqual(expect.arrayContaining([exec.id, execOther.id]));

        const queueOther = await get(execOther, '/api/tickets?view=queue').expect(200);
        expect(queueOther.body.items.find((i: Ticket) => i.id === tk.id)?.unread).toBe(true);
        const queueMine = await get(exec, '/api/tickets?view=queue').expect(200);
        expect(queueMine.body.items.find((i: Ticket) => i.id === tk.id)?.unread).toBe(false);

        const audit = await t.db
          .selectFrom('auditLog')
          .select(['action', 'details'])
          .where('target', '=', `ticket:${tk.id}`)
          .where('action', '=', 'tickets.release')
          .executeTakeFirstOrThrow();
        expect(audit.details).toMatchObject({ from: 'in_progress', to: 'new', note: 'Boshqa bo‘limga tegishli' });

        // anyone of the region can take it now; nothing to release while it is in the queue
        await post(exec, `/api/tickets/${tk.id}/release`, { note: 'xx' }).expect(409);
        await post(execOther, `/api/tickets/${tk.id}/assign`).expect(200);
      });

      it('the superuser may release a ticket someone else holds', async () => {
        const tk = await newTicket();
        await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
        const r = await post(superuser, `/api/tickets/${tk.id}/release`, { note: 'Ijrochi kasal' }).expect(200);
        expect(r.body).toMatchObject({ status: 'new', assignee: null });
      });

      it('nobody assigns a ticket to someone else: "assign" always takes it for the caller', async () => {
        const tk = await newTicket();
        const r = await post(superuser, `/api/tickets/${tk.id}/assign`, { userId: exec.id, assigneeUserId: exec.id });
        expect(r.status).toBe(200);
        expect(r.body.assignee).toMatchObject({ userId: superuser.id });
      });
    });

    describe('operators keep closed tickets they called back on', () => {
      it('read-only card, timeline, attachments and recordings; a stranger operator gets 404', async () => {
        findCall.mockResolvedValue(pastCall({ id: '1763370000.21' }));
        const created = await create(op, { ...base(), callId: '1763370000.21' }, [[PNG_1PX, 'ariza.png']]).expect(201);
        const tk = created.body as TicketDetail;
        await t.db
          .updateTable('ticketCalls')
          .set({ recordingNextAt: new Date(0) })
          .where('ticketId', '=', tk.id)
          .execute();
        await t.app.get(TicketRecordingsService).linkDue(new Date());
        await post(exec, `/api/tickets/${tk.id}/assign`).expect(200);
        await post(exec, `/api/tickets/${tk.id}/start`).expect(200);
        await post(exec, `/api/tickets/${tk.id}/resolve`, { note: 'Hal qilindi' }).expect(200);

        const caller = await t.createUser('operator', String(3000 + Math.floor(Math.random() * 6000)));
        const stranger = await t.createUser('operator', null);
        await post(caller, `/api/tickets/${tk.id}/callback/call`).expect(200);
        broadcast.mockClear();
        await post(superuser, `/api/tickets/${tk.id}/close`, { note: 'Fuqaro o‘zi keldi' }).expect(200);
        expect(sentTo('tickets.changed')).toContain(caller.id);
        expect(sentTo('tickets.changed')).not.toContain(stranger.id);
        expect(sentTo('tickets.revoked')).toContain(stranger.id);
        expect(sentTo('tickets.revoked')).not.toContain(caller.id);

        const d = await get(caller, `/api/tickets/${tk.id}`).expect(200);
        expect(d.body.status).toBe('closed');
        expect(Object.values(d.body.actions).some(Boolean)).toBe(false);
        expect(d.body.events.map((e: { kind: string }) => e.kind)).toEqual(
          expect.arrayContaining(['created', 'assigned', 'started', 'done', 'returned', 'closed']),
        );
        const attachment = `/api/tickets/${tk.id}/attachments/${tk.attachments[0].id}`;
        const recording = `/api/tickets/${tk.id}/calls/${tk.calls[0].id}/recording`;
        await get(caller, attachment).expect(200);
        await get(caller, recording).expect(200);
        const mine = await get(caller, '/api/tickets?view=mine').expect(200);
        expect(ids(mine.body.items)).toContain(tk.id);

        await get(stranger, `/api/tickets/${tk.id}`).expect(404);
        await get(stranger, attachment).expect(404);
        await get(stranger, recording).expect(404);
        const all = await get(stranger, '/api/tickets?view=all').expect(200);
        expect(ids(all.body.items)).not.toContain(tk.id);

        // read-only: nothing to do with a closed ticket
        await http()
          .post(`/api/tickets/${tk.id}/comments`)
          .set('Authorization', caller.auth)
          .field('body', 'Yana savol')
          .expect(403);
        await post(caller, `/api/tickets/${tk.id}/callback/call`).expect(409);
        await post(caller, `/api/tickets/${tk.id}/callback/outcome`, { outcome: 'informed' }).expect(409);
      });
    });

    describe('callback SLA', () => {
      it('done/rejected + N working days; overdue in the queue and in reports, apart from the region SLA', async () => {
        const ctx = await get(op, '/api/tickets/context').expect(200);
        expect(ctx.body.callbackSlaWorkingDays).toBe(1);
        const tk = await queued();
        expect(tk.callbackDueAt).not.toBeNull();
        expect(Date.parse(tk.callbackDueAt as string)).toBeGreaterThan(Date.parse(tk.resolvedAt as string));
        expect(tk).toMatchObject({ overdue: false, callbackOverdue: false });

        await t.db
          .updateTable('tickets')
          .set({ callbackDueAt: new Date(Date.now() - 3_600_000) })
          .where('id', '=', tk.id)
          .execute();
        const q = await get(op2, '/api/tickets?view=callback').expect(200);
        expect(q.body.items.find((i: Ticket) => i.id === tk.id)).toMatchObject({
          callbackOverdue: true,
          overdue: false,
        });
        expect(q.body.counts.callbackOverdue).toBeGreaterThanOrEqual(1);

        const today = new Date().toISOString().slice(0, 10);
        const r = await get(superuser, `/api/tickets/reports?from=${today}&to=${today}`).expect(200);
        expect(r.body.callbackOverdue).toBeGreaterThanOrEqual(1);
        expect(r.body.callbackOverdueShare).toBeGreaterThan(0);
        expect(r.body.byRegion.find((x: { id: number }) => x.id === tashkent).callbackOverdue).toBeGreaterThanOrEqual(
          1,
        );
      });
    });

    describe('observer: everything, read-only', () => {
      let observer: TestUser;

      beforeAll(async () => {
        // S1 adds `observer` to users.role; until then widen the check for this block only.
        await sql`alter table users drop constraint users_role_check`.execute(t.db);
        await sql`alter table users add constraint users_role_check check (role in ('operator', 'admin', 'superuser', 'observer'))`.execute(
          t.db,
        );
        observer = await t.createUser('observer' as Role, null);
      });

      afterAll(async () => {
        await t.db
          .updateTable('users')
          .set({ role: 'operator', isActive: false })
          .where('role', '=', 'observer' as Role)
          .execute();
        await sql`alter table users drop constraint users_role_check`.execute(t.db);
        await sql`alter table users add constraint users_role_check check (role in ('operator', 'admin', 'superuser'))`.execute(
          t.db,
        );
      });

      it('sees every region: lists, cards, timeline, attachments, recordings, reports; no counter', async () => {
        findCall.mockResolvedValue(pastCall({ id: '1763370000.31' }));
        const tash = (await create(op, { ...base(), callId: '1763370000.31' }, [[PNG_1PX, 'a.png']]).expect(201))
          .body as TicketDetail;
        await t.db
          .updateTable('ticketCalls')
          .set({ recordingNextAt: new Date(0) })
          .where('ticketId', '=', tash.id)
          .execute();
        await t.app.get(TicketRecordingsService).linkDue(new Date());
        broadcast.mockClear();
        const sam = await newTicket(op, { regionId: samarqand });
        // WS: the observer gets the notices (lists refresh) but never the unread counter
        expect(sentTo('tickets.changed')).toContain(observer.id);
        expect(sentTo('tickets.unread')).not.toContain(observer.id);

        const ctx = await get(observer, '/api/tickets/context').expect(200);
        expect(ctx.body).toMatchObject({
          kind: 'observer',
          unread: 0,
          capabilities: { viewAll: true, reports: true, create: false, work: false, callback: false, comment: false },
        });
        expect((await get(observer, '/api/tickets/unread').expect(200)).body.count).toBe(0);
        const all = await get(observer, '/api/tickets?view=all').expect(200);
        expect(ids(all.body.items)).toEqual(expect.arrayContaining([tash.id, sam.id]));
        expect(all.body.items.every((i: Ticket) => !i.unread && !Object.values(i.actions).some(Boolean))).toBe(true);

        const d = await get(observer, `/api/tickets/${sam.id}`).expect(200);
        expect(d.body.events[0]).toMatchObject({ kind: 'created' });
        const reads = await t.db.selectFrom('ticketReads').selectAll().where('userId', '=', observer.id).execute();
        expect(reads).toEqual([]);
        await get(observer, `/api/tickets/${tash.id}/attachments/${tash.attachments[0].id}`).expect(200);
        await get(observer, `/api/tickets/${tash.id}/calls/${tash.calls[0].id}/recording`).expect(200);

        const today = new Date().toISOString().slice(0, 10);
        const r = await get(observer, `/api/tickets/reports?from=${today}&to=${today}`).expect(200);
        expect(r.body.byRegion.map((x: { id: number }) => x.id)).toEqual(expect.arrayContaining([tashkent, samarqand]));
      });

      it('cannot change anything', async () => {
        const fresh = await newTicket();
        const working = await newTicket();
        await post(exec, `/api/tickets/${working.id}/assign`).expect(200);
        await post(exec, `/api/tickets/${working.id}/start`).expect(200);
        const inQueue = await queued();
        const before = await t.db
          .selectFrom('tickets')
          .select(['id', 'version', 'status'])
          .where('id', 'in', [fresh.id, working.id, inQueue.id])
          .orderBy('id')
          .execute();

        await create(observer, base()).expect(403);
        await post(observer, `/api/tickets/${fresh.id}/assign`).expect(403);
        await post(observer, `/api/tickets/${fresh.id}/forward`, { regionId: samarqand, note: 'xx' }).expect(403);
        await post(observer, `/api/tickets/${working.id}/start`).expect(409); // already started
        await post(observer, `/api/tickets/${working.id}/resolve`, { note: 'xx' }).expect(403);
        await post(observer, `/api/tickets/${working.id}/reject`, { note: 'xx' }).expect(403);
        await post(observer, `/api/tickets/${working.id}/release`, { note: 'xx' }).expect(403);
        await post(observer, `/api/tickets/${working.id}/forward`, { regionId: samarqand, note: 'xx' }).expect(403);
        await http()
          .post(`/api/tickets/${fresh.id}/comments`)
          .set('Authorization', observer.auth)
          .field('body', 'Kuzatuvchi')
          .expect(403);
        await post(observer, `/api/tickets/${inQueue.id}/callback/call`).expect(403);
        await post(observer, `/api/tickets/${inQueue.id}/callback/outcome`, { outcome: 'informed' }).expect(403);
        await post(observer, `/api/tickets/${inQueue.id}/close`, { note: 'Yopilsin' }).expect(403);
        await http().delete(`/api/tickets/${fresh.id}`).set('Authorization', observer.auth).expect(403);
        await post(observer, '/api/tickets/directories/categories', { nameUz: 'Kuzatuv', nameRu: 'Наблюдение' }).expect(
          403,
        );
        await http()
          .put(`/api/tickets/directories/executives/${exec.id}/regions`)
          .set('Authorization', observer.auth)
          .send({ regionIds: [tashkent, samarqand] })
          .expect(403);
        expect(originate).not.toHaveBeenCalled();

        const after = await t.db
          .selectFrom('tickets')
          .select(['id', 'version', 'status'])
          .where('id', 'in', [fresh.id, working.id, inQueue.id])
          .orderBy('id')
          .execute();
        expect(after).toEqual(before);
        const comments = await t.db
          .selectFrom('ticketComments')
          .select('id')
          .where('ticketId', '=', fresh.id)
          .execute();
        expect(comments).toEqual([]);
      });
    });
  });
});
