import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from '../../src/modules/realtime/realtime.service.js';
import { type E2eContext, auditRows, createE2eApp } from './e2e-app.js';

let ctx: E2eContext;
let broadcast: ReturnType<typeof vi.spyOn>;
const http = () => request(ctx.app.getHttpServer());

beforeAll(async () => {
  ctx = await createE2eApp('contacts');
  broadcast = vi.spyOn(ctx.app.get(RealtimeService), 'broadcast');
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('access by operator group (server-side)', () => {
  it('tells the UI what the user may do', async () => {
    const get = (auth: string) => http().get('/api/contacts/access').set('Authorization', auth).expect(200);
    expect((await get(ctx.users.admin.auth)).body).toEqual({ canView: true, canEdit: true });
    expect((await get(ctx.users.op101.auth)).body).toEqual({ canView: true, canEdit: true });
    expect((await get(ctx.users.op205.auth)).body).toEqual({ canView: false, canEdit: false });
  });

  it('denies every phonebook endpoint to the restricted group', async () => {
    const a = ctx.users.op205.auth;
    await http().get('/api/contacts').set('Authorization', a).expect(403);
    await http().get('/api/contacts/901234567').set('Authorization', a).expect(403);
    await http().get('/api/contacts/top-active').set('Authorization', a).expect(403);
    await http().post('/api/contacts').set('Authorization', a).send({ phone: '901234567', name: 'X' }).expect(403);
    await http()
      .put('/api/contacts/901234567')
      .set('Authorization', a)
      .send({ phone: '901234567', name: 'X' })
      .expect(403);
    await http().delete('/api/contacts/901234567').set('Authorization', a).expect(403);
  });

  it('requires a session', async () => {
    await http().get('/api/contacts').expect(401);
  });
});

describe('phonebook', () => {
  it('creates a contact keyed by the normalized phone, audited and announced without data', async () => {
    broadcast.mockClear();
    const res = await http()
      .post('/api/contacts')
      .set('Authorization', ctx.users.op101.auth)
      .send({
        phone: '+998 (90) 123-45-67',
        name: '  Aliyev Vali ',
        organization: 'Toshkent sh.',
        language: 'uz',
        telegram: '@vali_aliyev',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      phone: '901234567',
      name: 'Aliyev Vali',
      organization: 'Toshkent sh.',
      language: 'uz',
      note: '',
      telegram: '@vali_aliyev',
    });
    expect(broadcast).toHaveBeenCalledWith('contacts.changed', { at: expect.any(String) });
    const [audit] = await auditRows(ctx.db, 'contacts.create');
    expect(audit).toMatchObject({ target: 'contact:901234567', actor_label: 'op101' });
  });

  it('upserts on the same phone in any spelling (legacy POST semantics)', async () => {
    const res = await http()
      .post('/api/contacts')
      .set('Authorization', ctx.users.admin.auth)
      .send({ phone: '998901234567', name: 'Aliyev Vali', note: 'Prefers Russian', language: 'ru' })
      .expect(200);
    expect(res.body).toMatchObject({ phone: '901234567', language: 'ru', note: 'Prefers Russian', telegram: null });
    expect((await auditRows(ctx.db, 'contacts.update')).length).toBe(1);
  });

  it.each([
    [{ phone: '101', name: 'Ext' }, 'phone'],
    [{ phone: 'abc', name: 'X' }, 'phone'],
    [{ phone: '901112233' }, 'name'],
    [{ phone: '901112233', name: 'X', language: 'de' }, 'language'],
    [{ phone: '901112233', name: 'X', telegram: 'not a handle!' }, 'telegram'],
    [{ phone: '901112233', name: 'x'.repeat(121) }, 'name'],
    [{ phone: '901112233', name: 'bad\u0007bell' }, 'name'],
  ])('rejects invalid input %j', async (body, field) => {
    const res = await http().post('/api/contacts').set('Authorization', ctx.users.admin.auth).send(body).expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toContain(field);
  });

  it('accepts a contact with only an organization or only a Telegram id', async () => {
    await http()
      .post('/api/contacts')
      .set('Authorization', ctx.users.admin.auth)
      .send({ phone: '711234567', organization: 'Hokimiyat' })
      .expect(200);
    await http()
      .post('/api/contacts')
      .set('Authorization', ctx.users.admin.auth)
      .send({ phone: '935550000', telegram: '123456789' })
      .expect(200);
  });

  it('searches by name, organization, note and phone digits, and filters by language', async () => {
    const q = (query: Record<string, string>) =>
      http().get('/api/contacts').query(query).set('Authorization', ctx.users.op101.auth).expect(200);
    expect((await q({ q: 'aliyev' })).body.items.map((c: { phone: string }) => c.phone)).toEqual(['901234567']);
    expect((await q({ q: 'hokim' })).body.items.map((c: { phone: string }) => c.phone)).toEqual(['711234567']);
    expect((await q({ q: 'russian' })).body.total).toBe(1);
    expect((await q({ q: '998 90 123' })).body.items.map((c: { phone: string }) => c.phone)).toEqual(['901234567']);
    expect((await q({ q: '%' })).body.total).toBe(0); // LIKE wildcards are escaped
    expect((await q({ language: 'none' })).body.total).toBe(2);
    expect((await q({ language: 'ru' })).body.total).toBe(1);
    expect((await q({})).body.total).toBe(3);
  });

  it('reads one contact by any spelling of the number', async () => {
    const res = await http().get('/api/contacts/+998901234567').set('Authorization', ctx.users.op101.auth).expect(200);
    expect(res.body.name).toBe('Aliyev Vali');
    await http().get('/api/contacts/909999999').set('Authorization', ctx.users.op101.auth).expect(404);
  });

  it('moves a contact to a new number, refusing to overwrite another contact', async () => {
    await http()
      .put('/api/contacts/711234567')
      .set('Authorization', ctx.users.op101.auth)
      .send({ phone: '901234567', organization: 'Hokimiyat' })
      .expect(409);
    const res = await http()
      .put('/api/contacts/711234567')
      .set('Authorization', ctx.users.op101.auth)
      .send({ phone: '712223344', organization: 'Hokimiyat', note: 'moved' })
      .expect(200);
    expect(res.body).toMatchObject({ phone: '712223344', note: 'moved' });
    await http().get('/api/contacts/711234567').set('Authorization', ctx.users.op101.auth).expect(404);
    await http()
      .put('/api/contacts/700000000')
      .set('Authorization', ctx.users.op101.auth)
      .send({ phone: '700000000', name: 'X' })
      .expect(404);
  });

  it('deletes with an audit record', async () => {
    await http().delete('/api/contacts/712223344').set('Authorization', ctx.users.op101.auth).expect(204);
    await http().delete('/api/contacts/712223344').set('Authorization', ctx.users.op101.auth).expect(404);
    const [audit] = await auditRows(ctx.db, 'contacts.delete');
    expect(audit).toMatchObject({ target: 'contact:712223344', details: { before: { organization: 'Hokimiyat' } } });
  });

  it('top callers need the PBX database (503 when it is not configured)', async () => {
    await http().get('/api/contacts/top-active').set('Authorization', ctx.users.op101.auth).expect(503);
    await http().get('/api/contacts/top-active?limit=100').set('Authorization', ctx.users.op101.auth).expect(400);
  });
});
