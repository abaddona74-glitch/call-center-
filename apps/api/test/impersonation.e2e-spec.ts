import { sql } from 'kysely';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT } from './support/e2e-app.js';

let e2e: E2eApp;
let root: Client;
let opId: number;
let execId: number;

beforeAll(async () => {
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  opId = await createUser(root, { username: 'op150', password: 'Oper-Pass-1234', extension: '150' });
  execId = await createUser(root, { username: 'exec1', password: 'Exec-Pass-1234', role: 'executive' });
});
afterAll(() => e2e?.close());

/** A fresh superuser login (so each test has its own "own session"). */
const superuser = () => loginAs(e2e, ROOT.username, ROOT.password);

async function actAs(c: Client, userId: number) {
  const before = c.cookie;
  const res = await c.post('/auth/impersonation', { userId });
  c.adoptCookie(res);
  return { res, before };
}

describe('log in as another user', () => {
  it('only superusers may, never as a superuser or themselves', async () => {
    const exec = await loginAs(e2e, 'exec1', 'Exec-Pass-1234');
    expect((await exec.post('/auth/impersonation', { userId: opId })).status).toBe(403);
    const su = await superuser();
    expect((await su.post('/auth/impersonation', { userId: 1 })).status).toBe(403);
    const su2 = await createUser(root, { username: 'su-two', password: 'Super-Pass-123', role: 'superuser' });
    expect((await su.post('/auth/impersonation', { userId: su2 })).status).toBe(403);
    expect((await su.post('/auth/impersonation', { userId: 99999 })).status).toBe(404);
    expect((await su.delete('/auth/impersonation')).status).toBe(400); // not acting as anyone
  });

  it('opens a separate, time-limited session of the user with a visible marker; stop returns to the superuser', async () => {
    const su = await superuser();
    const { res, before } = await actAs(su, opId);
    expect(res.status).toBe(200);
    expect(su.cookie).not.toBe(before); // a new session, not a copied token
    expect(res.body.user).toMatchObject({
      username: 'op150',
      role: 'operator',
      impersonation: { by: { id: 1, username: 'root' } },
    });
    const minutes = (new Date(res.body.user.impersonation.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30);

    // the operator's own view and permissions
    expect((await su.get('/auth/me')).body.user.username).toBe('op150');
    expect((await su.get('/users')).status).toBe(403);
    // the superuser cannot take over the account from inside
    expect((await su.post('/auth/password', { currentPassword: 'x', newPassword: 'Taken-Over-123' })).status).toBe(403);
    expect((await su.post('/auth/email/start', { action: 'bind', email: 'x@y.uz', password: 'x' })).status).toBe(403);
    expect((await su.post('/auth/passkeys/registration/options', { password: 'x', name: 'x' })).status).toBe(403);
    expect((await su.post('/auth/impersonation', { userId: execId })).status).toBe(403);

    // the superuser's sessions list shows the impersonation
    const watcher = await superuser();
    const listed = (await watcher.get('/sessions')).body.items.find(
      (s: { username: string; impersonatedBy: string | null }) => s.username === 'op150' && s.impersonatedBy,
    );
    expect(listed).toMatchObject({ impersonatedBy: 'root' });

    const impersonationCookie = su.cookie;
    const stop = await su.delete('/auth/impersonation');
    expect(stop.status).toBe(200);
    su.adoptCookie(stop);
    expect(stop.body.user).toMatchObject({ username: 'root', impersonation: null });
    expect((await su.get('/users')).status).toBe(200);
    const stale = new Client(e2e);
    stale.cookie = impersonationCookie;
    expect((await stale.get('/auth/me')).status).toBe(401);
    stale.cookie = before;
    expect((await stale.get('/auth/me')).status).toBe(401); // the old own session was retired too
  });

  it('is audited under the superuser, with both names', async () => {
    const su = await superuser();
    await actAs(su, opId);
    await su.post('/auth/logout');
    const rows = await e2e.db
      .selectFrom('auditLog')
      .select(['action', 'actorUserId', 'actorLabel', 'target'])
      .where('action', 'like', 'auth.%')
      .where('target', '=', `user:${opId}`)
      .orderBy('id', 'desc')
      .limit(5)
      .execute();
    expect(rows.find((r) => r.action === 'auth.impersonate.start')).toMatchObject({
      actorUserId: 1,
      actorLabel: 'root',
    });
    const logout = await e2e.db
      .selectFrom('auditLog')
      .select(['actorUserId', 'actorLabel'])
      .where('action', '=', 'auth.logout')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(logout).toEqual({ actorUserId: 1, actorLabel: 'root → op150' });
  });

  it('ends when it expires, when the superuser session ends, or on logout', async () => {
    // expiry
    const a = await superuser();
    await actAs(a, opId);
    await sql`update sessions set expires_at = now() - interval '1 second' where impersonator_user_id is not null`.execute(
      e2e.db,
    );
    expect((await a.get('/auth/me')).status).toBe(401);

    // the superuser's own session is revoked elsewhere
    const b = await superuser();
    const { before } = await actAs(b, opId);
    const ownId = (
      await e2e.db
        .selectFrom('sessions')
        .select('parentSessionId')
        .where('impersonatorUserId', '=', 1)
        .orderBy('createdAt', 'desc')
        .executeTakeFirstOrThrow()
    ).parentSessionId!;
    expect(before).toBeTruthy();
    await root.delete(`/sessions/${ownId}`);
    expect((await b.get('/auth/me')).status).toBe(401);

    // logout while acting ends both sessions
    const c = await superuser();
    await actAs(c, opId);
    const parent = (
      await e2e.db
        .selectFrom('sessions')
        .select('parentSessionId')
        .where('impersonatorUserId', '=', 1)
        .orderBy('createdAt', 'desc')
        .executeTakeFirstOrThrow()
    ).parentSessionId!;
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect(
      await e2e.db.selectFrom('sessions').select('id').where('id', '=', parent).executeTakeFirst(),
    ).toBeUndefined();
  });

  it('works for accounts with a pending forced password change (the superuser is not forced)', async () => {
    const id = await createUser(root, {
      username: 'op151',
      password: 'Oper-Pass-1234',
      extension: '151',
      mustChangePassword: true,
    });
    const su = await superuser();
    await actAs(su, id);
    expect((await su.get('/auth/sessions')).status).toBe(200);
    expect((await su.get('/auth/me')).body.user.mustChangePassword).toBe(true);
  });

  it('dies when the superuser is demoted', async () => {
    const su2Id = (await root.get('/users?search=su-two')).body.items[0].id as number;
    const su2 = await loginAs(e2e, 'su-two', 'Super-Pass-123');
    await actAs(su2, opId);
    expect((await su2.get('/auth/me')).body.user.username).toBe('op150');
    expect((await root.patch(`/users/${su2Id}`, { role: 'executive' })).status).toBe(200);
    expect((await su2.get('/auth/me')).status).toBe(401);
  });
});
