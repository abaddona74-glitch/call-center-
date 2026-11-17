import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT, auditActions } from './support/e2e-app.js';

let e2e: E2eApp;
let root: Client;
let exec: Client;
let obs: Client;
let op: Client;
let execId: number;
let opId: number;

beforeAll(async () => {
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  execId = await createUser(root, { username: 'boss-exec', password: 'Exec-Pass-1234', role: 'executive' });
  await createUser(root, { username: 'watcher', password: 'Watch-Pass-123', role: 'observer' });
  opId = await createUser(root, { username: 'op101', password: 'Oper-Pass-1234', extension: '101' });
  exec = await loginAs(e2e, 'boss-exec', 'Exec-Pass-1234');
  obs = await loginAs(e2e, 'watcher', 'Watch-Pass-123');
  op = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
});
afterAll(() => e2e?.close());

const rootId = 1;

describe('permissions by role', () => {
  it('only users.manage (superuser) reaches the users admin; executive, observer and operator get 403', async () => {
    for (const [name, c] of [
      ['executive', exec],
      ['observer', obs],
      ['operator', op],
    ] as const) {
      expect((await c.get('/users')).status, name).toBe(403);
      expect((await c.get(`/users/${opId}`)).status, name).toBe(403);
      expect(
        (await c.post('/users', { username: 'x1', password: 'Strong-Pass-123', role: 'operator', extension: '150' }))
          .status,
        name,
      ).toBe(403);
      expect((await c.patch(`/users/${opId}`, { email: 'a@b.uz' })).status, name).toBe(403);
      expect((await c.post(`/users/${opId}/password`, { password: 'Strong-Pass-123' })).status, name).toBe(403);
      expect((await c.delete(`/users/${opId}`)).status, name).toBe(403);
      expect((await c.get('/operator-groups')).status, name).toBe(403);
      expect((await c.post('/operator-groups', { name: 'X1', permissions: {} })).status, name).toBe(403);
      expect((await c.get(`/users/${opId}/passkeys`)).status, name).toBe(403);
      expect((await c.post('/auth/impersonation', { userId: opId })).status, name).toBe(403);
    }
  });

  it('/auth/me carries the effective permissions', async () => {
    const e = (await exec.get('/auth/me')).body.user;
    expect(e.permissions).toEqual(expect.arrayContaining(['settings.manage', 'audit.view', 'actions.call']));
    expect(e.permissions).not.toContain('users.manage');
    expect(e.permissions).not.toContain('impersonate');
    const o = (await obs.get('/auth/me')).body.user;
    expect(o.permissions.every((p: string) => /\.(view|listen)$/.test(p))).toBe(true);
  });

  it('audit log needs audit.view: superuser and executive yes, observer and operator no', async () => {
    expect((await root.get('/audit')).status).toBe(200);
    expect((await exec.get('/audit')).status).toBe(200);
    expect((await obs.get('/audit')).status).toBe(403);
    expect((await op.get('/audit')).status).toBe(403);
  });
});

describe('users admin (superuser)', () => {
  it('lists users without secrets, with what the viewer may do', async () => {
    const res = await root.get('/users');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt|webauthn/i);
    const byName = Object.fromEntries(
      res.body.items.map((u: { username: string; canManage: boolean; canImpersonate: boolean }) => [
        u.username,
        [u.canManage, u.canImpersonate],
      ]),
    );
    expect(byName).toMatchObject({ root: [false, false], 'boss-exec': [true, true], op101: [true, true] });
    expect(
      (await root.get('/users?role=operator')).body.items.every((u: { role: string }) => u.role === 'operator'),
    ).toBe(true);
    expect((await root.get('/users?search=op1')).body.items.map((u: { username: string }) => u.username)).toEqual([
      'op101',
    ]);
  });

  it('creates every role; validates input; usernames and emails are unique', async () => {
    for (const role of ['observer', 'executive', 'superuser'] as const) {
      const res = await root.post('/users', { username: `new-${role}`, password: 'Strong-Pass-123', role });
      expect(res.status, role).toBe(201);
      expect(res.body).toMatchObject({ role, mustChangePassword: false });
    }
    expect(
      (await root.post('/users', { username: 'old-admin', password: 'Strong-Pass-123', role: 'admin' })).status,
    ).toBe(400);
    const created = await root.post('/users', {
      username: 'op102',
      password: 'Strong-Pass-123',
      role: 'operator',
      extension: '102',
      email: 'Op102@Example.uz',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ username: 'op102', email: 'op102@example.uz' });
    expect(
      (await root.post('/users', { username: 'noext', password: 'Strong-Pass-123', role: 'operator' })).status,
    ).toBe(400);
    expect(
      (await root.post('/users', { username: 'weak', password: '123', role: 'operator', extension: '120' })).status,
    ).toBe(400);
    expect(
      (await root.post('/users', { username: 'OP102', password: 'Strong-Pass-123', extension: '120' })).status,
    ).toBe(409);
    expect(
      (
        await root.post('/users', {
          username: 'op103',
          password: 'Strong-Pass-123',
          extension: '103',
          email: 'op102@example.uz',
        })
      ).status,
    ).toBe(409);
  });

  it('changes roles; operators need an extension', async () => {
    expect((await root.patch(`/users/${opId}`, { role: 'observer' })).body.role).toBe('observer');
    expect((await root.patch(`/users/${opId}`, { role: 'operator' })).body.role).toBe('operator');
    expect((await root.patch(`/users/${opId}`, { extension: null })).status).toBe(400);
    expect((await root.patch(`/users/${execId}`, { email: 'boss@example.uz' })).status).toBe(200);
  });

  it('protects the last superuser and the superuser themself', async () => {
    expect((await root.delete(`/users/${rootId}`)).status).toBe(403);
    expect((await root.patch(`/users/${rootId}`, { role: 'executive' })).status).toBe(403);
    expect((await root.patch(`/users/${rootId}`, { isActive: false })).status).toBe(403);

    const su2 = (await root.get('/users?search=new-superuser')).body.items[0].id as number;
    const second = await loginAs(e2e, 'new-superuser', 'Strong-Pass-123');
    expect((await second.patch(`/users/${rootId}`, { role: 'executive' })).status).toBe(200); // two superusers
    const demotedRoot = await loginAs(e2e, ROOT.username, ROOT.password);
    expect((await demotedRoot.get('/users')).status).toBe(403); // executive now
    expect((await second.patch(`/users/${rootId}`, { role: 'superuser' })).status).toBe(200);
    root = await loginAs(e2e, ROOT.username, ROOT.password);
    expect((await root.patch(`/users/${su2}`, { isActive: false })).status).toBe(200);
    // root is now the only active superuser
    expect((await second.get('/auth/me')).status).toBe(401);
    expect((await root.patch(`/users/${su2}`, { isActive: true })).status).toBe(200);
    const again = await loginAs(e2e, 'new-superuser', 'Strong-Pass-123');
    expect((await again.patch(`/users/${rootId}`, { isActive: false })).status).toBe(200);
    expect((await again.patch(`/users/${su2}`, { role: 'executive' })).status).toBe(403); // own role
    expect((await again.patch(`/users/${rootId}`, { isActive: true })).status).toBe(200);
    root = await loginAs(e2e, ROOT.username, ROOT.password);
    expect((await root.delete(`/users/${su2}`)).status).toBe(204);
    const su = (await root.get('/users?role=superuser')).body.items.filter((u: { isActive: boolean }) => u.isActive);
    expect(su).toHaveLength(1);
    // with root as the last superuser, nobody can demote or delete it — not even root
    expect((await root.patch(`/users/${rootId}`, { role: 'operator', extension: '199' })).status).toBe(403);
  });

  it('deactivation and deletion end sessions; every change is audited', async () => {
    const id = await createUser(root, { username: 'temp-op', password: 'Temp-Pass-1234', extension: '130' });
    const temp = await loginAs(e2e, 'temp-op', 'Temp-Pass-1234');
    expect((await root.patch(`/users/${id}`, { isActive: false })).status).toBe(200);
    expect((await temp.get('/auth/me')).status).toBe(401);
    expect((await new Client(e2e).login('temp-op', 'Temp-Pass-1234')).status).toBe(401);
    expect((await root.delete(`/users/${id}`)).status).toBe(204);
    expect((await root.get(`/users/${id}`)).status).toBe(404);
    expect(await auditActions(e2e.db, `user:${id}`)).toEqual([
      'users.create',
      'auth.login',
      'users.deactivate',
      'users.delete',
    ]);
    expect(await auditActions(e2e.db)).toEqual(expect.arrayContaining(['users.update', 'users.role_change']));
  });
});

describe('forced password change', () => {
  it('blocks everything but me/password/logout (HTTP and WebSocket) until the password is changed', async () => {
    await createUser(root, {
      username: 'fresh-op',
      password: 'Temp-Pass-1234',
      extension: '140',
      mustChangePassword: true,
    });
    const c = new Client(e2e);
    const login = await c.login('fresh-op', 'Temp-Pass-1234');
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    expect((await c.get('/auth/me')).status).toBe(200);
    const blocked = await c.get('/auth/sessions');
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('Password change required');
    expect((await c.get('/auth/passkeys')).status).toBe(403);
    await expect(c.openSocket()).rejects.toThrow('socket closed early: 4403');

    const changed = await c.post('/auth/password', {
      currentPassword: 'Temp-Pass-1234',
      newPassword: 'Own-Password-99',
    });
    expect(changed.status).toBe(200);
    expect((await c.get('/auth/me')).body.user.mustChangePassword).toBe(false);
    expect((await c.get('/auth/sessions')).status).toBe(200);
    expect((await c.post('/auth/logout')).status).toBe(204);
  });

  it('a password set by the superuser must be replaced at the next login (unless told otherwise)', async () => {
    const victim = await loginAs(e2e, 'op102', 'Strong-Pass-123');
    const { closed } = await victim.openSocket();
    const id = (await root.get('/users?search=op102')).body.items[0].id;
    const res = await root.post(`/users/${id}/password`, { password: 'Reset-Pass-1234' });
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBe(1);
    expect((await closed).code).toBe(4001);
    expect((await root.get(`/users/${id}`)).body.mustChangePassword).toBe(true);

    const back = await loginAs(e2e, 'op102', 'Reset-Pass-1234');
    expect((await back.get('/auth/me')).body.user.mustChangePassword).toBe(true);
    expect((await back.get('/auth/sessions')).status).toBe(403);

    await root.post(`/users/${id}/password`, { password: 'Reset-Pass-5678', mustChangePassword: false });
    const free = await loginAs(e2e, 'op102', 'Reset-Pass-5678');
    expect((await free.get('/auth/sessions')).status).toBe(200);
    expect((await root.post(`/users/${rootId}/password`, { password: 'Reset-Pass-1234' })).status).toBe(403); // self
    expect(await auditActions(e2e.db, `user:${id}`)).toContain('users.password_reset');
  });
});

describe('operator groups and permissions', () => {
  it('seeds the legacy groups; a group removes permissions from operators only', async () => {
    const groups = (await root.get('/operator-groups')).body.items;
    const zangiota = groups.find((g: { name: string }) => g.name === 'Zangiota');
    expect(zangiota.permissions.canSeeContacts).toBe(false);
    expect((await op.get('/auth/me')).body.user.permissions).toContain('contacts.view');

    expect((await root.patch(`/users/${opId}`, { groupId: zangiota.id })).status).toBe(200);
    const fresh = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
    const me = (await fresh.get('/auth/me')).body.user;
    expect(me.groupId).toBe(zangiota.id);
    for (const p of ['contacts.view', 'contacts.manage', 'remoteDesktop.use', 'help.request', 'tools.use']) {
      expect(me.permissions).not.toContain(p);
    }
    expect(me.permissions).toContain('tickets.use');

    expect((await root.patch(`/users/${execId}`, { groupId: zangiota.id })).status).toBe(200);
    expect((await exec.get('/auth/me')).body.user.permissions).toContain('contacts.view');
  });

  it('creates, updates and deletes groups; members fall back to no group', async () => {
    const created = await root.post('/operator-groups', {
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
    expect((await root.post('/operator-groups', { name: 'night SHIFT', permissions: {} })).status).toBe(409);
    expect((await root.post('/operator-groups', { name: 'x', permissions: {} })).status).toBe(400);

    const id = created.body.id;
    const upd = await root.patch(`/operator-groups/${id}`, {
      permissions: { ...created.body.permissions, canEditContacts: true },
    });
    expect(upd.body.permissions.canEditContacts).toBe(true);

    const member = await createUser(root, {
      username: 'night-op',
      password: 'Night-Pass-123',
      extension: '141',
      groupId: id,
    });
    expect((await root.get('/operator-groups')).body.items.find((g: { id: number }) => g.id === id).memberCount).toBe(
      1,
    );
    expect((await root.delete(`/operator-groups/${id}`)).status).toBe(204);
    expect((await root.get(`/users/${member}`)).body.groupId).toBeNull();
    expect((await root.patch(`/users/${member}`, { groupId: 99999 })).status).toBe(400);
    expect(await auditActions(e2e.db)).toEqual(
      expect.arrayContaining(['groups.create', 'groups.update', 'groups.delete']),
    );
  });
});

describe('audit log viewer', () => {
  it('filters by action prefix, actor and date, with pagination', async () => {
    const all = await exec.get('/audit?pageSize=5');
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.total).toBeGreaterThan(5);
    const page2 = await exec.get('/audit?pageSize=5&page=2');
    expect(page2.body.items[0].id).toBeLessThan(all.body.items[4].id);

    const users = await exec.get('/audit?action=users.&pageSize=200');
    expect(users.body.items.length).toBeGreaterThan(0);
    expect(users.body.items.every((e: { action: string }) => e.action.startsWith('users.'))).toBe(true);
    const exact = await exec.get('/audit?action=users.create&pageSize=200');
    expect(exact.body.items.every((e: { action: string }) => e.action === 'users.create')).toBe(true);
    const star = await exec.get('/audit?action=groups*');
    expect(star.body.items.every((e: { action: string }) => e.action.startsWith('groups'))).toBe(true);

    const byActor = await exec.get('/audit?actor=roo&pageSize=200');
    expect(byActor.body.items.length).toBeGreaterThan(0);
    expect(byActor.body.items.every((e: { actorLabel: string }) => e.actorLabel === 'root')).toBe(true);

    expect((await exec.get('/audit?from=2099-01-01')).body.total).toBe(0);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
    expect((await exec.get(`/audit?from=${today}&to=${today}`)).body.total).toBe(all.body.total);
    expect((await exec.get('/audit?from=17-11-2026')).status).toBe(400);
    expect((await exec.get('/audit/actions')).body.items).toEqual(
      expect.arrayContaining(['auth.login', 'users.create']),
    );
  });
});
