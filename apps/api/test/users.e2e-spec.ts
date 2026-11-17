import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT, auditActions } from './support/e2e-app.js';

let e2e: E2eApp;
let root: Client;
let admin: Client;
let op: Client;
let adminId: number;
let opId: number;

beforeAll(async () => {
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  adminId = await createUser(root, { username: 'boss-admin', password: 'Admin-Pass-123', role: 'admin' });
  opId = await createUser(root, { username: 'op101', password: 'Oper-Pass-1234', extension: '101' });
  admin = await loginAs(e2e, 'boss-admin', 'Admin-Pass-123');
  op = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
});
afterAll(() => e2e?.close());

const rootId = 1;

describe('users admin: access', () => {
  it('operators get 403 on every admin endpoint', async () => {
    expect((await op.get('/users')).status).toBe(403);
    expect((await op.get(`/users/${opId}`)).status).toBe(403);
    expect(
      (await op.post('/users', { username: 'x1', password: 'Strong-Pass-123', role: 'operator', extension: '150' }))
        .status,
    ).toBe(403);
    expect((await op.patch(`/users/${opId}`, { email: 'a@b.uz' })).status).toBe(403);
    expect((await op.post(`/users/${opId}/password`, { password: 'Strong-Pass-123' })).status).toBe(403);
    expect((await op.delete(`/users/${adminId}`)).status).toBe(403);
    expect((await op.get('/operator-groups')).status).toBe(403);
    expect((await op.post('/operator-groups', { name: 'X', permissions: {} })).status).toBe(403);
    expect((await op.get(`/users/${opId}/passkeys`)).status).toBe(403);
    expect((await op.get('/audit')).status).toBe(403);
  });

  it('lists users without secrets and marks what the viewer may manage', async () => {
    const res = await admin.get('/users');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash|scrypt|webauthn/i);
    const byName = Object.fromEntries(
      res.body.items.map((u: { username: string; canManage: boolean }) => [u.username, u.canManage]),
    );
    expect(byName).toMatchObject({ root: false, 'boss-admin': false, op101: true });
    const forRoot = Object.fromEntries(
      (await root.get('/users')).body.items.map((u: { username: string; canManage: boolean }) => [
        u.username,
        u.canManage,
      ]),
    );
    expect(forRoot).toMatchObject({ root: false, 'boss-admin': true, op101: true });

    expect(
      (await admin.get('/users?role=operator')).body.items.every((u: { role: string }) => u.role === 'operator'),
    ).toBe(true);
    expect((await admin.get('/users?search=op1')).body.items.map((u: { username: string }) => u.username)).toEqual([
      'op101',
    ]);
  });
});

describe('users admin: RBAC rules', () => {
  it('admin creates operators only', async () => {
    const created = await admin.post('/users', {
      username: 'op102',
      password: 'Strong-Pass-123',
      role: 'operator',
      extension: '102',
      email: 'Op102@Example.uz',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      username: 'op102',
      role: 'operator',
      email: 'op102@example.uz',
      canManage: true,
    });

    for (const role of ['admin', 'superuser']) {
      const res = await admin.post('/users', { username: `new-${role}`, password: 'Strong-Pass-123', role });
      expect(res.status, role).toBe(403);
    }
    // validation: operator without extension, weak password, bad username
    expect(
      (await admin.post('/users', { username: 'noext', password: 'Strong-Pass-123', role: 'operator' })).status,
    ).toBe(400);
    expect(
      (await admin.post('/users', { username: 'weak', password: '123', role: 'operator', extension: '120' })).status,
    ).toBe(400);
    expect(
      (await admin.post('/users', { username: 'bad name!', password: 'Strong-Pass-123', extension: '120' })).status,
    ).toBe(400);
    // duplicates (case-insensitive)
    expect(
      (await admin.post('/users', { username: 'OP102', password: 'Strong-Pass-123', extension: '120' })).status,
    ).toBe(409);
    expect(
      (
        await admin.post('/users', {
          username: 'op103',
          password: 'Strong-Pass-123',
          extension: '103',
          email: 'op102@example.uz',
        })
      ).status,
    ).toBe(409);
  });

  it('admin cannot promote operators or touch admins/superusers', async () => {
    expect((await admin.patch(`/users/${opId}`, { role: 'admin' })).status).toBe(403);
    expect((await admin.patch(`/users/${opId}`, { role: 'superuser' })).status).toBe(403);
    expect((await admin.patch(`/users/${rootId}`, { email: 'x@y.uz' })).status).toBe(403);
    expect((await admin.patch(`/users/${adminId}`, { email: 'x@y.uz' })).status).toBe(403); // not even self
    expect((await admin.post(`/users/${rootId}/password`, { password: 'Hijack-Pass-123' })).status).toBe(403);
    expect((await admin.delete(`/users/${rootId}`)).status).toBe(403);
    expect((await admin.get(`/users/${rootId}/passkeys`)).status).toBe(403);

    const ok = await admin.patch(`/users/${opId}`, { extension: '111', email: 'op101@example.uz' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ extension: '111', email: 'op101@example.uz' });
    expect((await admin.patch(`/users/${opId}`, { extension: null })).status).toBe(400); // operators need an extension
  });

  it('superuser manages everyone and the last superuser is protected', async () => {
    expect((await root.delete(`/users/${rootId}`)).status).toBe(403); // not self
    expect((await root.patch(`/users/${rootId}`, { role: 'admin' })).status).toBe(403); // not own role
    expect((await root.patch(`/users/${rootId}`, { isActive: false })).status).toBe(403);

    const su2 = await createUser(root, { username: 'second-su', password: 'Second-Su-123', role: 'superuser' });
    const second = await loginAs(e2e, 'second-su', 'Second-Su-123');
    // demoting root is allowed while another superuser exists...
    expect((await second.patch(`/users/${rootId}`, { role: 'admin' })).status).toBe(200);
    // ...but now second-su is the last one
    const demotedRoot = await loginAs(e2e, ROOT.username, ROOT.password);
    expect((await demotedRoot.patch(`/users/${su2}`, { role: 'admin' })).status).toBe(403); // admin now
    expect((await second.patch(`/users/${rootId}`, { role: 'superuser' })).status).toBe(200);
    root = await loginAs(e2e, ROOT.username, ROOT.password);

    // with two superusers, deleting one works; the remaining one cannot be removed by the other admins
    expect((await root.delete(`/users/${su2}`)).status).toBe(204);
    expect((await second.get('/auth/me')).status).toBe(401);
  });

  it('cannot remove the last active superuser even indirectly', async () => {
    const su3 = await createUser(root, { username: 'third-su', password: 'Third-Su-1234', role: 'superuser' });
    const third = await loginAs(e2e, 'third-su', 'Third-Su-1234');
    expect((await root.patch(`/users/${su3}`, { isActive: false })).status).toBe(200);
    // root is now the only active superuser: the deactivated one cannot act, nobody can demote root
    expect((await third.get('/auth/me')).status).toBe(401);
    expect((await new Client(e2e).login('third-su', 'Third-Su-1234')).status).toBe(401);
    expect((await root.patch(`/users/${su3}`, { isActive: true })).status).toBe(200);
    const again = await loginAs(e2e, 'third-su', 'Third-Su-1234');
    expect((await again.patch(`/users/${rootId}`, { isActive: false })).status).toBe(200);
    // now third-su is the last active superuser
    expect((await again.patch(`/users/${su3}`, { role: 'admin' })).status).toBe(403); // own role
    expect((await again.delete(`/users/${su3}`)).status).toBe(403); // self
    const r = await new Client(e2e).login(ROOT.username, ROOT.password);
    expect(r.status).toBe(401);
    expect((await again.patch(`/users/${rootId}`, { isActive: true })).status).toBe(200);
    root = await loginAs(e2e, ROOT.username, ROOT.password);
    expect((await root.patch(`/users/${su3}`, { role: 'admin' })).status).toBe(200);
    // root alone again
    const su = (await root.get('/users?role=superuser')).body.items.filter((u: { isActive: boolean }) => u.isActive);
    expect(su).toHaveLength(1);
  });

  it('password reset by admin ends the sessions of the user', async () => {
    const victim = await loginAs(e2e, 'op102', 'Strong-Pass-123');
    const { closed } = await victim.openSocket();
    const id = (await admin.get('/users?search=op102')).body.items[0].id;
    const res = await admin.post(`/users/${id}/password`, { password: 'Reset-Pass-1234' });
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBe(1);
    expect((await closed).code).toBe(4001);
    expect((await victim.get('/auth/me')).status).toBe(401);
    expect((await new Client(e2e).login('op102', 'Reset-Pass-1234')).status).toBe(200);
    expect((await admin.post(`/users/${adminId}/password`, { password: 'Reset-Pass-1234' })).status).toBe(403); // self
  });

  it('deactivation and deletion end sessions; every change is audited', async () => {
    const id = await createUser(admin, { username: 'temp-op', password: 'Temp-Pass-1234', extension: '130' });
    const temp = await loginAs(e2e, 'temp-op', 'Temp-Pass-1234');
    expect((await admin.patch(`/users/${id}`, { isActive: false })).status).toBe(200);
    expect((await temp.get('/auth/me')).status).toBe(401);
    expect((await new Client(e2e).login('temp-op', 'Temp-Pass-1234')).status).toBe(401);
    expect((await admin.delete(`/users/${id}`)).status).toBe(204);
    expect((await admin.get(`/users/${id}`)).status).toBe(404);

    expect(await auditActions(e2e.db, `user:${id}`)).toEqual([
      'users.create',
      'auth.login',
      'users.deactivate',
      'users.delete',
    ]);
    expect(await auditActions(e2e.db)).toEqual(
      expect.arrayContaining(['users.update', 'users.role_change', 'users.password_reset']),
    );
  });
});

describe('operator groups and permissions', () => {
  it('seeds the legacy groups and applies flags to operators only', async () => {
    const groups = (await admin.get('/operator-groups')).body.items;
    const zangiota = groups.find((g: { name: string }) => g.name === 'Zangiota');
    expect(zangiota.permissions.canSeeContacts).toBe(false);

    const meBefore = (await op.get('/auth/me')).body.user;
    expect(meBefore.permissions.canSeeContacts).toBe(true);

    expect((await admin.patch(`/users/${opId}`, { groupId: zangiota.id })).status).toBe(200);
    const fresh = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
    const me = (await fresh.get('/auth/me')).body.user;
    expect(me.groupId).toBe(zangiota.id);
    expect(me.permissions).toEqual({
      canSeeContacts: false,
      canEditContacts: false,
      canUseRemoteDesktop: false,
      canRequestHelp: false,
      canUseTools: false,
    });
    // admins are never restricted by a group
    expect((await root.patch(`/users/${adminId}`, { groupId: zangiota.id })).status).toBe(200);
    expect((await admin.get('/auth/me')).body.user.permissions.canSeeContacts).toBe(true);
  });

  it('creates, updates and deletes groups; members fall back to no group', async () => {
    const created = await admin.post('/operator-groups', {
      name: 'Night shift',
      description: 'after hours',
      permissions: {
        canSeeContacts: true,
        canEditContacts: false,
        canUseRemoteDesktop: false,
        canRequestHelp: true,
        canUseTools: true,
      },
    });
    expect(created.status).toBe(201);
    expect((await admin.post('/operator-groups', { name: 'night SHIFT', permissions: {} })).status).toBe(409);
    expect((await admin.post('/operator-groups', { name: 'x', permissions: {} })).status).toBe(400);

    const id = created.body.id;
    const upd = await admin.patch(`/operator-groups/${id}`, {
      permissions: { ...created.body.permissions, canEditContacts: true },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.permissions.canEditContacts).toBe(true);

    const member = await createUser(admin, {
      username: 'night-op',
      password: 'Night-Pass-123',
      extension: '140',
      groupId: id,
    });
    expect((await admin.get('/operator-groups')).body.items.find((g: { id: number }) => g.id === id).memberCount).toBe(
      1,
    );
    expect((await admin.delete(`/operator-groups/${id}`)).status).toBe(204);
    expect((await admin.get(`/users/${member}`)).body.groupId).toBeNull();
    expect((await admin.patch(`/users/${member}`, { groupId: 99999 })).status).toBe(400);
    expect(await auditActions(e2e.db)).toEqual(
      expect.arrayContaining(['groups.create', 'groups.update', 'groups.delete']),
    );
  });
});

describe('audit log viewer', () => {
  it('filters by action prefix, actor and date, with pagination', async () => {
    const all = await admin.get('/audit?pageSize=5');
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.total).toBeGreaterThan(5);
    const page2 = await admin.get('/audit?pageSize=5&page=2');
    expect(page2.body.items[0].id).toBeLessThan(all.body.items[4].id);

    const users = await admin.get('/audit?action=users.&pageSize=200');
    expect(users.body.items.length).toBeGreaterThan(0);
    expect(users.body.items.every((e: { action: string }) => e.action.startsWith('users.'))).toBe(true);
    const exact = await admin.get('/audit?action=users.create&pageSize=200');
    expect(exact.body.items.every((e: { action: string }) => e.action === 'users.create')).toBe(true);
    const star = await admin.get('/audit?action=groups*');
    expect(star.body.items.every((e: { action: string }) => e.action.startsWith('groups'))).toBe(true);

    const byActor = await admin.get('/audit?actor=boss-adm&pageSize=200');
    expect(byActor.body.items.length).toBeGreaterThan(0);
    expect(byActor.body.items.every((e: { actorLabel: string }) => e.actorLabel === 'boss-admin')).toBe(true);

    const future = await admin.get('/audit?from=2099-01-01');
    expect(future.body.total).toBe(0);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
    expect((await admin.get(`/audit?from=${today}&to=${today}`)).body.total).toBe(all.body.total);
    expect((await admin.get('/audit?from=17-11-2026')).status).toBe(400);

    const actions = await admin.get('/audit/actions');
    expect(actions.body.items).toEqual(expect.arrayContaining(['auth.login', 'users.create']));
  });
});
