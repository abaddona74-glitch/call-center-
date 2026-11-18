import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLegacySources } from '../src/scripts/migrate-legacy/legacy-sources.js';
import { passkeysMapper } from '../src/scripts/migrate-legacy/mappers/passkeys.mapper.js';
import { usersMapper } from '../src/scripts/migrate-legacy/mappers/users.mapper.js';
import {
  Client,
  createE2eApp,
  createUser,
  type E2eApp,
  loginAs,
  ORIGIN,
  ROOT,
  RP_ID,
  auditActions,
} from './support/e2e-app.js';
import { SoftAuthenticator } from './support/soft-authenticator.js';

let e2e: E2eApp;
let root: Client;
let alice: Client;
let aliceId: number;
const device = new SoftAuthenticator(RP_ID, ORIGIN);

beforeAll(async () => {
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  aliceId = await createUser(root, { username: 'alice', password: 'Alice-Pass-1234', extension: '105' });
  alice = await loginAs(e2e, 'alice', 'Alice-Pass-1234');
});
afterAll(() => e2e?.close());

async function register(c: Client, auth: SoftAuthenticator, name: string, password = 'Alice-Pass-1234') {
  const opts = await c.post('/auth/passkeys/registration/options', { password, name });
  expect(opts.status).toBe(200);
  return c.post('/auth/passkeys/registration/verify', { credential: auth.register(opts.body) });
}

async function passkeyLogin(auth: SoftAuthenticator, overrides?: Parameters<SoftAuthenticator['authenticate']>[1]) {
  const c = new Client(e2e);
  const opts = await c.post('/auth/passkeys/login/options');
  expect(opts.status).toBe(200);
  expect(opts.body.allowCredentials ?? []).toEqual([]);
  const res = await c.post('/auth/passkeys/login/verify', { credential: auth.authenticate(opts.body, overrides) });
  c.adoptCookie(res);
  return { c, res };
}

describe('registration', () => {
  it('requires the current password and returns legacy-compatible options', async () => {
    expect(
      (await alice.post('/auth/passkeys/registration/options', { password: 'wrong', name: 'Laptop' })).status,
    ).toBe(400);
    const opts = await alice.post('/auth/passkeys/registration/options', {
      password: 'Alice-Pass-1234',
      name: 'Laptop',
    });
    expect(opts.body.rp).toEqual({ name: 'Call Center', id: RP_ID });
    expect(opts.body.user.name).toBe('105 · alice');
    expect(opts.body.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    // user handle = UTF-8 bytes of the users.webauthn_user_id UUID string (as legacy)
    const { webauthnUserId } = await e2e.db
      .selectFrom('users')
      .select('webauthnUserId')
      .where('id', '=', aliceId)
      .executeTakeFirstOrThrow();
    expect(Buffer.from(opts.body.user.id, 'base64url').toString('utf8')).toBe(webauthnUserId);
  });

  it('registers, lists and renames a passkey', async () => {
    const res = await register(alice, device, 'Laptop');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: device.id, name: 'Laptop', backedUp: false });

    const list = await alice.get('/auth/passkeys');
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/publicKey|counter/);
    const renamed = await alice.patch(`/auth/passkeys/${device.id}`, { name: 'Work laptop' });
    expect(renamed.body.name).toBe('Work laptop');
  });

  it('rejects replayed, foreign-origin and duplicate registrations', async () => {
    const opts = await alice.post('/auth/passkeys/registration/options', { password: 'Alice-Pass-1234', name: 'Evil' });
    const other = new SoftAuthenticator(RP_ID, 'https://evil.example');
    expect(
      (await alice.post('/auth/passkeys/registration/verify', { credential: other.register(opts.body) })).status,
    ).toBe(400);
    // challenge was single-use
    const again = new SoftAuthenticator(RP_ID, ORIGIN);
    expect(
      (await alice.post('/auth/passkeys/registration/verify', { credential: again.register(opts.body) })).status,
    ).toBe(400);
    // same authenticator twice
    expect((await register(alice, device, 'Dup')).status).toBe(409);
  });
});

describe('passwordless login', () => {
  it('logs in with the passkey and marks the session', async () => {
    const { c, res } = await passkeyLogin(device);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'alice', role: 'operator' });
    expect((await c.get('/auth/me')).body.user.username).toBe('alice');
    const sessions = (await c.get('/auth/sessions')).body.items;
    expect(sessions.find((s: { isCurrent: boolean }) => s.isCurrent).viaPasskey).toBe(true);
    const pk = (await alice.get('/auth/passkeys')).body.items[0];
    expect(pk.lastUsedAt).not.toBeNull();
    expect(await auditActions(e2e.db, `user:${aliceId}`)).toContain('auth.login.passkey');
  });

  it('rejects a wrong user handle, a foreign origin and an unknown credential', async () => {
    expect(
      (await passkeyLogin(device, { userHandle: Buffer.from(randomUUID()).toString('base64url') })).res.status,
    ).toBe(401);
    expect((await passkeyLogin(device, { userHandle: null })).res.status).toBe(401);
    expect((await passkeyLogin(device, { origin: 'https://evil.example' })).res.status).toBe(401);
    const stranger = new SoftAuthenticator(RP_ID, ORIGIN);
    stranger.userHandle = device.userHandle;
    expect((await passkeyLogin(stranger)).res.status).toBe(401);
  });

  it('rejects a disabled account', async () => {
    const bobId = await createUser(root, { username: 'bob', password: 'Bob-Pass-12345', extension: '106' });
    const bob = await loginAs(e2e, 'bob', 'Bob-Pass-12345');
    const bobKey = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await register(bob, bobKey, 'Phone', 'Bob-Pass-12345')).status).toBe(201);
    expect((await root.patch(`/users/${bobId}`, { isActive: false })).status).toBe(200);
    expect((await passkeyLogin(bobKey)).res.status).toBe(401);
  });

  it('works for passkeys imported from the legacy SQLite table', async () => {
    // legacy: auth_passkeys.id = base64url credential id, public_key = COSE bytes, handle = UTF-8(uuid)
    const legacyUuid = randomUUID();
    const carolId = await createUser(root, { username: 'carol', password: 'Carol-Pass-1234', extension: '107' });
    await e2e.db.updateTable('users').set({ webauthnUserId: legacyUuid }).where('id', '=', carolId).execute();
    const legacyKey = new SoftAuthenticator(RP_ID, ORIGIN);
    legacyKey.counter = 41;
    await e2e.db
      .insertInto('passkeys')
      .values({
        id: legacyKey.id,
        userId: carolId,
        publicKey: Buffer.from(legacyKey.cosePublicKey()),
        counter: 41,
        deviceType: 'singleDevice',
        backedUp: false,
        transports: ['internal', 'hybrid'],
        name: 'Legacy fingerprint',
      })
      .execute();
    legacyKey.userHandle = Buffer.from(legacyUuid, 'utf8').toString('base64url');

    const { res } = await passkeyLogin(legacyKey);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('carol');
    const row = await e2e.db
      .selectFrom('passkeys')
      .select('counter')
      .where('id', '=', legacyKey.id)
      .executeTakeFirstOrThrow();
    expect(Number(row.counter)).toBe(42);
  });
});

describe('deleting passkeys', () => {
  it('owner deletes own passkey, which ends the sessions opened with it', async () => {
    const { c } = await passkeyLogin(device);
    const { closed } = await c.openSocket();
    expect((await new Client(e2e, c.ip).delete(`/auth/passkeys/${device.id}`)).status).toBe(401);
    expect((await root.delete(`/auth/passkeys/${device.id}`)).status).toBe(404); // not root's
    expect((await alice.delete(`/auth/passkeys/${device.id}`)).status).toBe(204);
    expect((await closed).code).toBe(4001);
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await alice.get('/auth/me')).status).toBe(200); // password session stays
    expect((await passkeyLogin(device)).res.status).toBe(401);
  });

  it("other users' passkeys need users.manage (superuser); executives get 403", async () => {
    await createUser(root, { username: 'pk-exec', password: 'PkExec-Pass-12', role: 'executive' });
    const exec = await loginAs(e2e, 'pk-exec', 'PkExec-Pass-12');
    const key = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await register(alice, key, 'Phone')).status).toBe(201);

    expect((await exec.get(`/users/${aliceId}/passkeys`)).status).toBe(403);
    expect((await exec.delete(`/users/${aliceId}/passkeys/${key.id}`)).status).toBe(403);
    expect((await alice.get(`/users/${aliceId}/passkeys`)).status).toBe(403);

    const list = await root.get(`/users/${aliceId}/passkeys`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([key.id]);
    expect((await root.get('/users/1/passkeys')).status).toBe(403); // own passkeys go through the profile
    expect((await root.delete(`/users/${aliceId}/passkeys/${key.id}`)).status).toBe(204);
    expect((await root.delete(`/users/${aliceId}/passkeys/${key.id}`)).status).toBe(404);
    expect(await auditActions(e2e.db, `user:${aliceId}`)).toContain('passkeys.delete_by_admin');
  });

  it('caps the number of passkeys per account', async () => {
    const daveId = await createUser(root, { username: 'dave', password: 'Dave-Pass-12345', extension: '108' });
    for (let i = 0; i < 10; i++) {
      await e2e.db
        .insertInto('passkeys')
        .values({ id: `cap-${i}`, userId: daveId, publicKey: Buffer.from([i]), name: `k${i}` })
        .execute();
    }
    const dave = await loginAs(e2e, 'dave', 'Dave-Pass-12345');
    expect(
      (await dave.post('/auth/passkeys/registration/options', { password: 'Dave-Pass-12345', name: 'one more' }))
        .status,
    ).toBe(400);
  });
});

describe('legacy migration (users + passkeys mappers)', () => {
  it('imports a legacy user with a passkey; both the password and the passkey sign in', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cc-e2e-legacy-'));
    const file = path.join(dir, 'callcenter.db');
    const schema = readFileSync(
      path.join(import.meta.dirname, '../src/scripts/migrate-legacy/__fixtures__/legacy-schema.sql'),
      'utf8',
    );
    const handle = randomUUID();
    const salt = randomBytes(16).toString('hex');
    const key = new SoftAuthenticator(RP_ID, ORIGIN);
    key.counter = 5;
    key.userHandle = Buffer.from(handle, 'utf8').toString('base64url');

    const legacyDb = new DatabaseSync(file);
    legacyDb.exec(schema);
    const userId = legacyDb
      .prepare(
        `INSERT INTO auth_users (username, password_hash, salt, role, operator_id, email, webauthn_user_id)
         VALUES ('zangiota230', ?, ?, 'operator', '230', NULL, ?)`,
      )
      .run(scryptSync('Legacy-Pa55', salt, 64).toString('hex'), salt, handle).lastInsertRowid;
    legacyDb
      .prepare(
        `INSERT INTO auth_passkeys (id, user_id, webauthn_user_id, username, public_key, counter, device_type, backed_up,
           transports, device_name) VALUES (?, ?, ?, 'zangiota230', ?, 5, 'singleDevice', 0, '["internal"]', 'Legacy phone')`,
      )
      .run(key.id, userId, handle, key.cosePublicKey());
    legacyDb.close();

    const legacy = openLegacySources({ sqlitePath: file });
    try {
      const ctx = { legacy, db: e2e.db, dryRun: false, logger: { info: () => undefined, warn: () => undefined } };
      expect(await usersMapper.run(ctx)).toMatchObject({ status: 'ok', inserted: 1, errors: [] });
      expect(await passkeysMapper.run(ctx)).toMatchObject({ status: 'ok', inserted: 1, errors: [], skipped: [] });
      // re-running is a no-op
      expect(await passkeysMapper.run(ctx)).toMatchObject({ inserted: 0, unchanged: 1 });
    } finally {
      legacy.close();
      rmSync(dir, { recursive: true, force: true });
    }

    const byPassword = await new Client(e2e).login('zangiota230', 'Legacy-Pa55');
    expect(byPassword.status).toBe(200);
    expect(byPassword.body.user).toMatchObject({ role: 'operator', extension: '230' });
    expect(byPassword.body.user.permissions).not.toContain('contacts.view'); // legacy "200 group" -> Zangiota

    const { c, res } = await passkeyLogin(key);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('zangiota230');
    expect((await c.get('/auth/passkeys')).body.items[0]).toMatchObject({ id: key.id, name: 'Legacy phone' });
  });
});
