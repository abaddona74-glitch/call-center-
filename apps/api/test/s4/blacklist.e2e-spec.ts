import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type E2eContext, auditRows, createE2eApp } from './e2e-app.js';

let ctx: E2eContext;
const http = () => request(ctx.app.getHttpServer());
const asAdmin = (req: request.Test) => req.set('Authorization', ctx.users.admin.auth);

beforeAll(async () => {
  ctx = await createE2eApp('blacklist');
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

beforeEach(() => {
  ctx.ami.connected = true;
  ctx.ami.failWith = null;
});

describe('permissions', () => {
  it('is admin only — operators get 403, no session 401', async () => {
    await http().get('/api/blacklist').expect(401);
    await http().get('/api/blacklist').set('Authorization', ctx.users.op101.auth).expect(403);
    await http()
      .post('/api/blacklist')
      .set('Authorization', ctx.users.op101.auth)
      .send({ number: '901234567' })
      .expect(403);
    await http().delete('/api/blacklist/1').set('Authorization', ctx.users.op101.auth).expect(403);
    await http().post('/api/blacklist/sync').set('Authorization', ctx.users.op101.auth).expect(403);
  });
});

describe('AstDB through AMI', () => {
  it('per-operator block writes blacklist_114 for both caller-id forms and leaves the global list alone (legacy bug fixed)', async () => {
    // a number already blocked globally on the PBX
    ctx.ami.db.set('blacklist/901234567', 'global');
    const res = await asAdmin(http().post('/api/blacklist'))
      .send({ number: '+998 90 123 45 67', note: 'Haqorat qiladi', scope: 'operator', extension: '114' })
      .expect(200);
    expect(res.body).toMatchObject({
      number: '901234567',
      variants: ['901234567', '998901234567'],
      scope: 'operator',
      extension: '114',
      note: 'Haqorat qiladi',
      syncState: 'synced',
      createdBy: 'admin1',
    });
    expect(ctx.ami.family('blacklist_114')).toEqual({
      '901234567': 'Haqorat qiladi',
      '998901234567': 'Haqorat qiladi',
    });
    expect(ctx.ami.family('blacklist')).toEqual({ '901234567': 'global' }); // untouched
    expect(ctx.ami.calls.some((c) => c.startsWith('del blacklist/'))).toBe(false);
  });

  it('global block writes the FreePBX family; removing it never touches the operator list', async () => {
    ctx.ami.db.clear();
    const op = await asAdmin(http().post('/api/blacklist'))
      .send({ number: '935551122', scope: 'operator', extension: '114' })
      .expect(200);
    const global = await asAdmin(http().post('/api/blacklist'))
      .send({ number: '935551122', scope: 'global', note: 'spam' })
      .expect(200);
    expect(ctx.ami.family('blacklist')).toEqual({ '935551122': 'spam', '998935551122': 'spam' });
    expect(ctx.ami.family('blacklist_114')).toEqual({ '935551122': '1', '998935551122': '1' });

    await asAdmin(http().delete(`/api/blacklist/${global.body.id}`)).expect(204);
    expect(ctx.ami.family('blacklist')).toEqual({});
    expect(ctx.ami.family('blacklist_114')).toEqual({ '935551122': '1', '998935551122': '1' });

    await asAdmin(http().delete(`/api/blacklist/${op.body.id}`)).expect(204);
    expect(ctx.ami.family('blacklist_114')).toEqual({});
    await asAdmin(http().delete(`/api/blacklist/${op.body.id}`)).expect(404);
  });

  it('sanitizes the AstDB value (no AMI header injection)', async () => {
    await asAdmin(http().post('/api/blacklist'))
      .send({ number: '977001122', scope: 'global', note: 'x"; Action: Originate' })
      .expect(200);
    expect(ctx.ami.family('blacklist')['977001122']).toBe('x Action: Originate');
    await asAdmin(http().post('/api/blacklist'))
      .send({ number: '977001123', scope: 'global', note: 'line\r\nAction: Logoff' })
      .expect(400);
  });

  it('re-adding the same number updates the note (upsert)', async () => {
    const res = await asAdmin(http().post('/api/blacklist'))
      .send({ number: '977001122', scope: 'global', note: 'updated' })
      .expect(200);
    expect(res.body.note).toBe('updated');
    expect(ctx.ami.family('blacklist')['977001122']).toBe('updated');
    const list = await asAdmin(http().get('/api/blacklist')).expect(200);
    expect(list.body.items.filter((i: { number: string }) => i.number === '977001122')).toHaveLength(1);
  });

  it('validates scope, extension and number', async () => {
    const post = (body: object) => asAdmin(http().post('/api/blacklist')).send(body);
    await post({ number: '901234567', scope: 'operator' }).expect(400); // extension missing
    await post({ number: '901234567', scope: 'global', extension: '114' }).expect(400);
    await post({ number: '901234567', scope: 'operator', extension: '101' }).expect(400); // no personal list in the dialplan
    await post({ number: '12', scope: 'global' }).expect(400);
    await post({ number: '90123456789012345678', scope: 'global' }).expect(400);
  });
});

describe('when AMI is down', () => {
  it('keeps changes pending and applies them on sync once AMI is back', async () => {
    ctx.ami.db.clear();
    ctx.ami.connected = false;
    const added = await asAdmin(http().post('/api/blacklist'))
      .send({ number: '998887766', scope: 'global' })
      .expect(200);
    expect(added.body).toMatchObject({ syncState: 'pending', syncError: 'AMI is not connected' });
    const list = await asAdmin(http().get('/api/blacklist')).expect(200);
    expect(list.body.amiConnected).toBe(false);
    expect(ctx.ami.family('blacklist')).toEqual({});

    ctx.ami.connected = true;
    const sync = await asAdmin(http().post('/api/blacklist/sync')).expect(200);
    expect(sync.body).toMatchObject({ applied: expect.any(Number), failed: 0, amiConnected: true });
    expect(ctx.ami.family('blacklist')).toEqual({ '998887766': '1', '998998887766': '1' });

    // removal while AMI is down: shown as "removing" until applied
    ctx.ami.connected = false;
    await asAdmin(http().delete(`/api/blacklist/${added.body.id}`)).expect(204);
    const during = await asAdmin(http().get('/api/blacklist')).expect(200);
    expect(during.body.items.find((i: { id: number }) => i.id === added.body.id).syncState).toBe('removing');
    ctx.ami.connected = true;
    await asAdmin(http().post('/api/blacklist/sync')).expect(200);
    expect(ctx.ami.family('blacklist')).toEqual({});
    const after = await asAdmin(http().get('/api/blacklist')).expect(200);
    expect(after.body.items.find((i: { id: number }) => i.id === added.body.id)).toBeUndefined();
  });

  it('records AMI errors on the row', async () => {
    ctx.ami.failWith = new Error('Permission denied');
    const res = await asAdmin(http().post('/api/blacklist')).send({ number: '998880000', scope: 'global' }).expect(200);
    expect(res.body).toMatchObject({ syncState: 'error', syncError: 'Permission denied' });
  });

  it('audits every change', async () => {
    const actions = (await auditRows(ctx.db, 'blacklist.')).map((a) => a.action);
    expect(actions.filter((a) => a === 'blacklist.add').length).toBeGreaterThanOrEqual(5);
    expect(actions).toContain('blacklist.update');
    expect(actions).toContain('blacklist.remove');
  });
});
