import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { TicketDetail } from '@cc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HTML_XSS, PDF_MIN, PNG_1PX, SVG_XSS, docx, paragraph, plainZip } from '../../../test/fixtures/files.js';
import { type S5TestApp, type TestUser, createS5TestApp } from '../../../test/s5-harness.js';
import { RealtimeService } from '../realtime/realtime.service.js';

describe('tickets (e2e)', () => {
  let t: S5TestApp;
  let admin: TestUser;
  let creator: TestUser;
  let creator2: TestUser;
  let receiver: TestUser;
  let receiver2: TestUser;
  let noExt: TestUser;
  let broadcast: ReturnType<typeof vi.spyOn>;

  const http = () => request(t.app.getHttpServer());
  const uploads = () => readdir(path.join(t.tmp, 'uploads'));

  function create(user: TestUser, fields: Record<string, string>, files: Array<[Buffer, string]> = []) {
    const req = http().post('/api/tickets').set('Authorization', user.auth);
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    for (const [buf, name] of files) req.attach('files', buf, name);
    return req;
  }

  beforeAll(async () => {
    t = await createS5TestApp();
    // Ticket ids >= 90000 belong to the legacy tickets mapper test, which may run in parallel.
    await t.db.deleteFrom('tickets').where('id', '<', 90000).execute();
    admin = await t.createUser('executive', null);
    creator = await t.createUser('operator', '201');
    creator2 = await t.createUser('operator', '205');
    receiver = await t.createUser('operator', '101');
    receiver2 = await t.createUser('operator', '103');
    noExt = await t.createUser('operator', null);
    broadcast = vi.spyOn(t.app.get(RealtimeService), 'broadcast');
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('context', () => {
    it('tells each user their party', async () => {
      const c = await http().get('/api/tickets/context').set('Authorization', creator.auth).expect(200);
      expect(c.body).toMatchObject({ party: 'creator', canCreate: true, canCleanup: false });
      const ids = c.body.assignees.map((a: { userId: number }) => a.userId);
      expect(ids).toEqual(expect.arrayContaining([receiver.id, receiver2.id]));
      expect(ids).not.toContain(creator2.id);
      expect(ids).not.toContain(noExt.id);

      const r = await http().get('/api/tickets/context').set('Authorization', receiver.auth).expect(200);
      expect(r.body).toMatchObject({ party: 'receiver', canCreate: false, assignees: [] });
      const n = await http().get('/api/tickets/context').set('Authorization', noExt.auth).expect(200);
      expect(n.body.party).toBe('none');
      await http().get('/api/tickets/context').expect(401);
    });
  });

  describe('create', () => {
    it('only creators and admins open tickets', async () => {
      await create(receiver, { body: 'x' }).expect(403);
      await create(noExt, { body: 'x' }).expect(403);
      await create(creator, {}).expect(400);
    });

    it('takes identity from the session, never from the body', async () => {
      const res = await create(creator, {
        body: 'Mijoz qayta qo‘ng‘iroq qilishni so‘radi',
        customerPhone: '+998 90 123 45 67',
        isUrgent: 'true',
        targetUserId: String(receiver.id),
        creatorId: '999',
        creatorName: 'hacker',
        operatorId: String(admin.id),
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'open',
        isUrgent: true,
        customerPhone: '+998 90 123 45 67',
        creator: { userId: creator.id, label: creator.username, extension: '201' },
        target: { userId: receiver.id, extension: '101' },
        assignee: null,
      });
      expect(res.body.code).toBe(`TK-${res.body.id}`);
      expect(res.body.id).toBeGreaterThanOrEqual(1001);
    });

    it('accepts the web form payload (empty phone, target "all", urgent false)', async () => {
      const res = await create(creator, { body: 'from the form', customerPhone: '', isUrgent: 'false', targetUserId: 'all' }).expect(201);
      expect(res.body).toMatchObject({ customerPhone: null, isUrgent: false, target: null });
    });

    it('refuses targets that are not receivers', async () => {
      await create(creator, { body: 'x', targetUserId: String(creator2.id) }).expect(400);
      await create(creator, { body: 'x', targetUserId: '999999' }).expect(400);
      await create(creator, { body: 'x', targetUserId: 'abc' }).expect(400);
    });

    it('never reuses ids', async () => {
      const a = await create(creator, { body: 'a' }).expect(201);
      await http().delete(`/api/tickets/${a.body.id}`).set('Authorization', creator.auth).expect(204);
      const b = await create(creator, { body: 'b' }).expect(201);
      expect(b.body.id).toBeGreaterThan(a.body.id);
      await http().get(`/api/tickets/${a.body.id}`).set('Authorization', admin.auth).expect(404);
    });
  });

  describe('attachments', () => {
    it('accepts images, PDF and DOCX; the stored name follows the content', async () => {
      const before = (await uploads()).length;
      const res = await create(creator, { body: 'files' }, [
        [PNG_1PX, 'shot.png'],
        [PNG_1PX, 'evil.html'],
        [PDF_MIN, 'doc.pdf'],
        [await docx(paragraph('Salom <script>alert(1)</script> dunyo')), 'xat.docx'],
      ]).expect(201);
      expect(res.body.attachments.map((a: { fileName: string; kind: string }) => [a.fileName, a.kind])).toEqual([
        ['shot.png', 'image'],
        ['evil.png', 'image'],
        ['doc.pdf', 'pdf'],
        ['xat.docx', 'docx'],
      ]);
      expect((await uploads()).length).toBe(before + 4);
    });

    it.each([
      ['SVG with script', SVG_XSS, 'x.svg'],
      ['HTML', HTML_XSS, 'x.html'],
      ['HTML disguised as PNG', HTML_XSS, 'x.png'],
      ['zip disguised as DOCX', null, 'x.docx'],
      ['text', Buffer.from('hello'), 'x.txt'],
      ['empty file', Buffer.alloc(0), 'x.png'],
    ])('refuses %s and stores nothing', async (_label, data, name) => {
      const before = (await uploads()).length;
      const buf = data ?? (await plainZip());
      const res = await create(creator, { body: 'bad' }, [
        [PNG_1PX, 'ok.png'],
        [buf, name],
      ]).expect(415);
      expect(res.body.message).toMatch(/only images/);
      expect((await uploads()).length).toBe(before);
    });

    it('refuses files over the size limit', async () => {
      const big = Buffer.concat([PNG_1PX, Buffer.alloc(1024 * 1024 + 10)]);
      await create(creator, { body: 'big' }, [[big, 'big.png']]).expect(413);
    });

    it('serves attachments only as downloads, to users who can see the ticket', async () => {
      const res = await create(creator, { body: 'dl', targetUserId: String(receiver.id) }, [[PNG_1PX, 'a.png']]).expect(201);
      const att = res.body.attachments[0];
      const url = `/api/tickets/${res.body.id}/attachments/${att.id}`;
      const dl = await http().get(url).set('Authorization', receiver.auth).expect(200);
      expect(dl.headers['content-type']).toBe('image/png');
      expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="a\.png"/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-security-policy']).toContain('sandbox');

      await http().get(url).set('Authorization', receiver2.auth).expect(404);
      await http().get(url).expect(401);
      // attachment id of another ticket
      const other = await create(creator, { body: 'other' }, [[PNG_1PX, 'b.png']]).expect(201);
      await http()
        .get(`/api/tickets/${res.body.id}/attachments/${other.body.attachments[0].id}`)
        .set('Authorization', admin.auth)
        .expect(404);
      await http().get(`/api/tickets/${res.body.id}/attachments/..%2F..%2Fetc`).set('Authorization', admin.auth).expect(400);
    });

    it('previews DOCX as sanitized HTML', async () => {
      const res = await create(creator, { body: 'docx' }, [
        [await docx(paragraph('Assalomu alaykum <script>alert(1)</script>')), 'xat.docx'],
      ]).expect(201);
      const att = res.body.attachments[0];
      const p = await http()
        .get(`/api/tickets/${res.body.id}/attachments/${att.id}/preview`)
        .set('Authorization', receiver.auth)
        .expect(200);
      expect(p.body.html).toContain('Assalomu alaykum');
      expect(p.body.html).not.toMatch(/<script/i);
      const png = await create(creator, { body: 'png' }, [[PNG_1PX, 'a.png']]).expect(201);
      await http()
        .get(`/api/tickets/${png.body.id}/attachments/${png.body.attachments[0].id}/preview`)
        .set('Authorization', admin.auth)
        .expect(400);
    });
  });

  describe('visibility', () => {
    it('follows the party rules', async () => {
      const mine = await create(creator, { body: 'only for 101', targetUserId: String(receiver.id) }).expect(201);
      const all = await create(creator, { body: 'for everyone' }).expect(201);
      const byAdmin = await create(admin, { body: 'admin ticket', targetUserId: String(receiver.id) }).expect(201);

      await http().get(`/api/tickets/${mine.body.id}`).set('Authorization', receiver.auth).expect(200);
      await http().get(`/api/tickets/${mine.body.id}`).set('Authorization', receiver2.auth).expect(404);
      await http().get(`/api/tickets/${mine.body.id}`).set('Authorization', creator2.auth).expect(200);
      await http().get(`/api/tickets/${mine.body.id}`).set('Authorization', noExt.auth).expect(404);
      await http().get(`/api/tickets/${byAdmin.body.id}`).set('Authorization', creator2.auth).expect(404);
      await http().get(`/api/tickets/${byAdmin.body.id}`).set('Authorization', receiver.auth).expect(200);

      const list2 = await http().get('/api/tickets').set('Authorization', receiver2.auth).expect(200);
      const ids2 = list2.body.items.map((i: { id: number }) => i.id);
      expect(ids2).toContain(all.body.id);
      expect(ids2).not.toContain(mine.body.id);
      expect(ids2).not.toContain(byAdmin.body.id);

      const none = await http().get('/api/tickets').set('Authorization', noExt.auth).expect(200);
      expect(none.body.items).toEqual([]);

      const mineList = await http().get('/api/tickets?filter=mine').set('Authorization', receiver.auth).expect(200);
      expect(mineList.body.items.map((i: { id: number }) => i.id)).toContain(mine.body.id);
      expect(mineList.body.items.map((i: { id: number }) => i.id)).not.toContain(all.body.id);
      expect(mineList.body.stats.all).toBeGreaterThanOrEqual(mineList.body.stats.mine);
      await http().get('/api/tickets?filter=deleted').set('Authorization', receiver.auth).expect(400);
    });

    it('sends WS notices only to users who may see the ticket', async () => {
      broadcast.mockClear();
      const res = await create(creator, { body: 'ws', targetUserId: String(receiver.id), isUrgent: 'true' }).expect(201);
      const call = broadcast.mock.calls.find(
        (c: unknown[]) => c[0] === 'tickets.changed' && (c[1] as { id: number }).id === res.body.id,
      ) as unknown[] | undefined;
      if (!call) throw new Error('tickets.changed was not broadcast');
      const userIds = (call[2] as { userIds: number[] }).userIds;
      expect(userIds).toEqual(expect.arrayContaining([receiver.id, creator.id, creator2.id, admin.id]));
      expect(userIds).not.toContain(receiver2.id);
      expect(userIds).not.toContain(noExt.id);
      expect(call[1]).toMatchObject({ action: 'created', isUrgent: true, code: res.body.code });
    });
  });

  describe('state machine', () => {
    let ticket: TicketDetail;
    const act = (user: TestUser, action: string, body?: object) =>
      http().post(`/api/tickets/${ticket.id}/${action}`).set('Authorization', user.auth).send(body ?? {});

    beforeAll(async () => {
      ticket = (await create(creator, { body: 'flow', targetUserId: String(receiver.id) }).expect(201)).body;
    });

    it('enforces who may move it', async () => {
      await act(receiver2, 'accept').expect(404); // cannot even see it
      await act(creator, 'accept').expect(403);
      await act(creator2, 'accept').expect(403);
      // identity in the body is ignored
      await act(creator2, 'accept', { operatorId: receiver.id, userId: receiver.id }).expect(403);
      await act(receiver, 'complete').expect(409);
    });

    it('open → accepted → rejected → accepted → completed', async () => {
      const accepted = await act(receiver, 'accept').expect(200);
      expect(accepted.body).toMatchObject({ status: 'accepted', assignee: { userId: receiver.id } });
      expect(accepted.body.permissions).toMatchObject({ complete: true, reject: true, accept: false });
      await act(receiver, 'accept').expect(409);

      await act(receiver, 'reject', {}).expect(400);
      const rejected = await act(receiver, 'reject', { reason: 'Mijoz raqami noto‘g‘ri' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'rejected', rejectReason: 'Mijoz raqami noto‘g‘ri', rejectedBy: { userId: receiver.id } });
      expect(rejected.body.comments.at(-1)).toMatchObject({ isSystem: true, body: 'Mijoz raqami noto‘g‘ri' });

      const again = await act(receiver, 'accept').expect(200);
      expect(again.body).toMatchObject({ status: 'accepted', rejectReason: null });
      const done = await act(receiver, 'complete').expect(200);
      expect(done.body).toMatchObject({ status: 'completed', completedBy: { userId: receiver.id } });
      expect(done.body.permissions).toMatchObject({ accept: false, reject: false, complete: false, edit: false });

      for (const a of ['accept', 'complete']) await act(admin, a).expect(409);
      await act(admin, 'reject', { reason: 'late' }).expect(409);
      await http().patch(`/api/tickets/${ticket.id}`).set('Authorization', creator.auth).send({ body: 'x' }).expect(403);
    });

    it('is audited', async () => {
      const rows = await t.db
        .selectFrom('auditLog')
        .select(['action', 'actorUserId'])
        .where('target', '=', `ticket:${ticket.id}`)
        .execute();
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining(['tickets.create', 'tickets.accept', 'tickets.reject', 'tickets.complete', 'tickets.denied']),
      );
      expect(rows.find((r) => r.action === 'tickets.accept')?.actorUserId).toBe(receiver.id);
    });
  });

  describe('edit, comments, delete, cleanup', () => {
    it('only the creator or an admin edits; re-targeting only while open', async () => {
      const res = await create(creator, { body: 'edit me', targetUserId: String(receiver.id) }).expect(201);
      const url = `/api/tickets/${res.body.id}`;
      await http().patch(url).set('Authorization', creator2.auth).send({ body: 'x' }).expect(403);
      await http().patch(url).set('Authorization', receiver.auth).send({ body: 'x' }).expect(403);
      await http().patch(url).set('Authorization', creator.auth).send({}).expect(400);
      const edited = await http()
        .patch(url)
        .set('Authorization', creator.auth)
        .send({ body: 'edited', isUrgent: true, targetUserId: receiver2.id })
        .expect(200);
      expect(edited.body).toMatchObject({ body: 'edited', isUrgent: true, target: { userId: receiver2.id } });
      await http().get(url).set('Authorization', receiver.auth).expect(404);
      await http().post(`${url}/accept`).set('Authorization', receiver2.auth).expect(200);
      await http().patch(url).set('Authorization', creator.auth).send({ targetUserId: null }).expect(409);
    });

    it('comments with attachments from anyone who can see the ticket', async () => {
      const res = await create(creator, { body: 'chat' }).expect(201);
      const url = `/api/tickets/${res.body.id}/comments`;
      const c = await http()
        .post(url)
        .set('Authorization', receiver2.auth)
        .field('body', 'Qabul qildim')
        .attach('files', PNG_1PX, 'shot.png')
        .expect(201);
      expect(c.body.comments.at(-1)).toMatchObject({
        body: 'Qabul qildim',
        isSystem: false,
        author: { userId: receiver2.id },
        attachments: [{ fileName: 'shot.png', kind: 'image' }],
      });
      expect(c.body.commentCount).toBe(1);
      await http().post(url).set('Authorization', receiver2.auth).field('body', '').expect(400);
      await http().post(url).set('Authorization', noExt.auth).field('body', 'hi').expect(404);
      await http().post(url).set('Authorization', receiver2.auth).attach('files', SVG_XSS, 'x.svg').expect(415);
    });

    it('delete: creator while open, admin always; files are removed', async () => {
      const res = await create(creator, { body: 'del', targetUserId: String(receiver.id) }, [[PNG_1PX, 'a.png']]).expect(201);
      const url = `/api/tickets/${res.body.id}`;
      await http().delete(url).set('Authorization', receiver.auth).expect(403);
      await http().delete(url).set('Authorization', creator2.auth).expect(403);
      await http().post(`${url}/accept`).set('Authorization', receiver.auth).expect(200);
      await http().delete(url).set('Authorization', creator.auth).expect(403);
      const before = (await uploads()).length;
      await http().delete(url).set('Authorization', admin.auth).expect(204);
      expect((await uploads()).length).toBe(before - 1);
      await http().get(url).set('Authorization', admin.auth).expect(404);
    });

    it('cleanup of completed tickets is admin-only', async () => {
      await http().post('/api/tickets/cleanup').set('Authorization', creator.auth).expect(403);
      const res = await http().post('/api/tickets/cleanup').set('Authorization', admin.auth).expect(200);
      expect(res.body.removed).toBeGreaterThanOrEqual(1);
      const left = await t.db
        .selectFrom('tickets')
        .select('id')
        .where('status', '=', 'completed')
        .where('id', '<', 90000)
        .execute();
      expect(left).toEqual([]);
    });
  });
});
