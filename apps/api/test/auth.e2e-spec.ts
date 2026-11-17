import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT, auditActions } from './support/e2e-app.js';

let e2e: E2eApp;
let root: Client;

beforeAll(async () => {
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
});
afterAll(() => e2e?.close());

describe('login / me / logout', () => {
  it('logs in with an HttpOnly cookie and returns the user with permissions', async () => {
    const c = new Client(e2e);
    const res = await c.login(ROOT.username, ROOT.password);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'root', role: 'superuser', permissions: { canSeeContacts: true } });
    expect(JSON.stringify(res.body)).not.toContain(c.cookie!.split('=')[1]);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('root');

    expect((await c.post('/auth/logout')).status).toBe(204);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('is case-insensitive for usernames and rejects wrong passwords generically', async () => {
    const c = new Client(e2e);
    expect((await c.login('ROOT', ROOT.password)).status).toBe(200);
    const bad = await new Client(e2e).login('root', 'nope');
    const unknown = await new Client(e2e).login('no-such-user', 'nope');
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.message).toBe(unknown.body.message);
  });

  it('exposes login options publicly', async () => {
    const res = await new Client(e2e).get('/auth/options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ passkeys: true, passwordReset: true });
  });

  it('requires a session everywhere else', async () => {
    const anon = new Client(e2e);
    for (const path of [
      '/auth/me',
      '/auth/sessions',
      '/auth/passkeys',
      '/users',
      '/sessions',
      '/security/settings',
      '/audit',
    ]) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });
});

describe('login protection', () => {
  const victim = { username: 'lockme', password: 'Victim-Pass-123' };

  beforeAll(async () => {
    await createUser(root, { username: victim.username, password: victim.password });
  });

  it('locks username+IP after 5 failures, but the user can still log in from another address', async () => {
    const attacker = new Client(e2e);
    const left: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await attacker.login(victim.username, 'wrong');
      expect(res.status).toBe(401);
      left.push(res.body.message.match(/Attempts left: (\d+)/)?.[1]);
    }
    expect(left).toEqual(['4', '3', '2', '1', '0']);
    const blocked = await attacker.login(victim.username, victim.password);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Try again in \d+ s/);

    // the real user, elsewhere, is not affected
    expect((await new Client(e2e).login(victim.username, victim.password)).status).toBe(200);

    const lockouts = await root.get('/security/lockouts');
    expect(lockouts.status).toBe(200);
    const entry = lockouts.body.items.find(
      (l: { kind: string; ip: string }) => l.kind === 'user_ip' && l.ip === attacker.ip,
    );
    expect(entry).toMatchObject({ username: victim.username });

    // admin unlock
    expect((await root.delete(`/security/lockouts/${entry.id}`)).status).toBe(204);
    expect((await attacker.login(victim.username, victim.password)).status).toBe(200);
    expect(await auditActions(e2e.db)).toContain('security.unlock');
  });

  it('locks an IP that sprays many usernames', async () => {
    const put = await root.put('/security/settings', { maxAttempts: 10, lockoutMinutes: 5, ipMaxAttempts: 5 });
    expect(put.status).toBe(200);
    try {
      const sprayer = new Client(e2e);
      for (let i = 0; i < 5; i++) expect((await sprayer.login(`ghost${i}`, 'x')).status).toBe(401);
      const blocked = await sprayer.login(ROOT.username, ROOT.password);
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toMatch(/Try again in \d+ s/); // our lockout, not the request throttler

      const locked = (await root.get('/security/lockouts')).body.items;
      expect(locked).toContainEqual(expect.objectContaining({ kind: 'ip', ip: sprayer.ip, username: null }));
      expect((await root.post('/security/lockouts/clear')).body.unlocked).toBeGreaterThan(0);
      const after = (await root.get('/security/lockouts')).body.items;
      expect(after.find((l: { ip: string }) => l.ip === sprayer.ip)).toBeUndefined();
      expect(await auditActions(e2e.db)).toContain('security.unlock_all');
    } finally {
      await root.put('/security/settings', { maxAttempts: 5, lockoutMinutes: 15, ipMaxAttempts: 30 });
    }
  });

  it('settings: admin reads, only superuser writes, operator gets 403', async () => {
    await createUser(root, { username: 'sec-admin', password: 'Admin-Pass-123', role: 'admin' });
    await createUser(root, { username: 'sec-op', password: 'Oper-Pass-1234' });
    const admin = await loginAs(e2e, 'sec-admin', 'Admin-Pass-123');
    const op = await loginAs(e2e, 'sec-op', 'Oper-Pass-1234');

    expect((await admin.get('/security/settings')).body).toEqual({
      maxAttempts: 5,
      lockoutMinutes: 15,
      ipMaxAttempts: 30,
    });
    expect(
      (await admin.put('/security/settings', { maxAttempts: 3, lockoutMinutes: 1, ipMaxAttempts: 10 })).status,
    ).toBe(403);
    expect((await admin.get('/security/lockouts')).status).toBe(200);
    expect((await op.get('/security/settings')).status).toBe(403);
    expect((await op.get('/security/lockouts')).status).toBe(403);
    expect((await op.post('/security/lockouts/clear')).status).toBe(403);
    expect(
      (await root.put('/security/settings', { maxAttempts: 2, lockoutMinutes: 1, ipMaxAttempts: 10 })).status,
    ).toBe(400);
  });
});

describe('change own password', () => {
  it('requires the current password, ends other sessions and closes their sockets', async () => {
    await createUser(root, { username: 'changer', password: 'Old-Password-1' });
    const a = await loginAs(e2e, 'changer', 'Old-Password-1');
    const b = await loginAs(e2e, 'changer', 'Old-Password-1');
    const { closed } = await b.openSocket();

    const wrong = await a.post('/auth/password', { currentPassword: 'nope', newPassword: 'New-Password-1' });
    expect(wrong.status).toBe(400);
    const tooShort = await a.post('/auth/password', { currentPassword: 'Old-Password-1', newPassword: 'short' });
    expect(tooShort.status).toBe(400);

    const ok = await a.post('/auth/password', { currentPassword: 'Old-Password-1', newPassword: 'New-Password-1' });
    expect(ok.status).toBe(200);
    expect(ok.body.revokedSessions).toBe(1);
    expect(await closed).toMatchObject({ code: 4001 });

    expect((await a.get('/auth/me')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
    expect((await new Client(e2e).login('changer', 'Old-Password-1')).status).toBe(401);
    expect((await new Client(e2e).login('changer', 'New-Password-1')).status).toBe(200);
    expect(await auditActions(e2e.db)).toContain('auth.password.changed');
  });
});

describe('own sessions', () => {
  it('lists own sessions without tokens and revokes another one', async () => {
    await createUser(root, { username: 'multi', password: 'Multi-Pass-123' });
    const a = await loginAs(e2e, 'multi', 'Multi-Pass-123');
    const b = await loginAs(e2e, 'multi', 'Multi-Pass-123');
    const list = await a.get('/auth/sessions');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    const token = a.cookie!.split('=')[1];
    expect(JSON.stringify(list.body)).not.toContain(token);
    const current = list.body.items.find((s: { isCurrent: boolean }) => s.isCurrent);
    const other = list.body.items.find((s: { isCurrent: boolean }) => !s.isCurrent);
    expect(current.canRevoke).toBe(false);

    expect((await a.delete(`/auth/sessions/${current.id}`)).status).toBe(404);
    expect((await root.delete(`/auth/sessions/${other.id}`)).status).toBe(404); // not root's session
    expect((await a.delete(`/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await b.get('/auth/me')).status).toBe(401);
  });
});

describe('sessions admin', () => {
  it('admins see and revoke operator sessions only; superuser sees all', async () => {
    await createUser(root, { username: 'sa-admin', password: 'Admin-Pass-123', role: 'admin' });
    await createUser(root, { username: 'sa-op', password: 'Oper-Pass-1234' });
    const admin = await loginAs(e2e, 'sa-admin', 'Admin-Pass-123');
    const op = await loginAs(e2e, 'sa-op', 'Oper-Pass-1234');

    const seen = await admin.get('/sessions');
    expect(seen.status).toBe(200);
    const roles = new Set(
      seen.body.items.map((s: { role: string; username: string }) => (s.username === 'sa-admin' ? 'self' : s.role)),
    );
    expect(roles.has('superuser')).toBe(false);
    expect(roles.has('operator')).toBe(true);

    const all = await root.get('/sessions');
    const rootSession = all.body.items.find(
      (s: { username: string; isCurrent: boolean }) => s.username === 'root' && !s.isCurrent,
    );
    expect(rootSession).toBeTruthy();
    expect((await admin.delete(`/sessions/${rootSession.id}`)).status).toBe(403);

    const opSession = seen.body.items.find((s: { username: string }) => s.username === 'sa-op');
    const { closed } = await op.openSocket();
    expect((await admin.delete(`/sessions/${opSession.id}`)).status).toBe(204);
    expect((await closed).code).toBe(4001);
    expect((await op.get('/auth/me')).status).toBe(401);

    expect((await op.get('/sessions')).status).toBe(401);
    const op2 = await loginAs(e2e, 'sa-op', 'Oper-Pass-1234');
    expect((await op2.get('/sessions')).status).toBe(403);
    expect((await root.delete(`/sessions/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await root.delete('/sessions/not-a-hash')).status).toBe(400);
  });
});
