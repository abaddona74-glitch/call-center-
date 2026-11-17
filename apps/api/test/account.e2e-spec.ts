import { sql } from 'kysely';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT, auditActions } from './support/e2e-app.js';

let e2e: E2eApp;
let root: Client;

beforeAll(async () => {
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
});
afterAll(() => e2e?.close());

/** Codes have a 60 s resend cooldown; tests move earlier codes into the past instead of waiting. */
async function ageCodes(userId: number): Promise<void> {
  await sql`update auth_codes set created_at = created_at - interval '2 minutes' where user_id = ${userId}`.execute(e2e.db);
}

describe('password reset by email', () => {
  let userId: number;
  beforeAll(async () => {
    userId = await createUser(root, { username: 'forgetful', password: 'Forgot-Pass-123', email: 'forgetful@example.uz' });
  });

  it('sends a code only to the bound email and never reveals whether the account exists', async () => {
    const anon = new Client(e2e);
    e2e.mail.clear();
    const known = await anon.post('/auth/password-reset/request', { identifier: 'forgetful' });
    const unknown = await anon.post('/auth/password-reset/request', { identifier: 'nobody-here' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(e2e.mail.sent.map((m) => m.to)).toEqual(['forgetful@example.uz']);
    expect(JSON.stringify(known.body)).not.toContain('example.uz');
  });

  it('ignores an email supplied by the caller (legacy account-takeover bug)', async () => {
    await createUser(root, { username: 'no-email-user', password: 'NoMail-Pass-123' });
    e2e.mail.clear();
    const res = await new Client(e2e).post('/auth/password-reset/request', {
      identifier: 'no-email-user',
      email: 'attacker@evil.example',
    });
    expect(res.status).toBe(200);
    expect(e2e.mail.sent).toHaveLength(0);
    const row = await e2e.db.selectFrom('users').select('email').where('username', '=', 'no-email-user').executeTakeFirstOrThrow();
    expect(row.email).toBeNull();
  });

  it('accepts the bound email as identifier', async () => {
    await ageCodes(userId);
    e2e.mail.clear();
    await new Client(e2e).post('/auth/password-reset/request', { identifier: 'FORGETFUL@example.uz' });
    expect(e2e.mail.sent).toHaveLength(1);
  });

  it('limits wrong codes and stores only hashes', async () => {
    const code = e2e.mail.lastCode('forgetful@example.uz')!;
    const stored = await e2e.db.selectFrom('authCodes').select('codeHash').where('userId', '=', userId).execute();
    expect(JSON.stringify(stored)).not.toContain(code);

    const anon = new Client(e2e);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await anon.post('/auth/password-reset/verify', { identifier: 'forgetful', code: wrong })).status).toBe(400);
    }
    // the code is burned after 5 wrong attempts, even the right one fails now
    expect((await anon.post('/auth/password-reset/verify', { identifier: 'forgetful', code })).status).toBe(400);
  });

  it('resets the password, ends sessions and passkeys, and the token works once', async () => {
    const session = await loginAs(e2e, 'forgetful', 'Forgot-Pass-123');
    await e2e.db
      .insertInto('passkeys')
      .values({ id: 'legacy-pk-1', userId, publicKey: Buffer.from([1, 2, 3]), name: 'Old phone' })
      .execute();
    await ageCodes(userId);
    e2e.mail.clear();

    const anon = new Client(e2e);
    await anon.post('/auth/password-reset/request', { identifier: 'forgetful' });
    const code = e2e.mail.lastCode('forgetful@example.uz')!;
    const verified = await anon.post('/auth/password-reset/verify', { identifier: 'forgetful', code: ` ${code.slice(0, 3)} ${code.slice(3)} ` });
    expect(verified.status).toBe(200);
    const { resetToken } = verified.body;
    expect((await anon.post('/auth/password-reset/verify', { identifier: 'forgetful', code })).status).toBe(400); // used

    expect((await anon.post('/auth/password-reset/complete', { resetToken, newPassword: 'short' })).status).toBe(400);
    expect((await anon.post('/auth/password-reset/complete', { resetToken, newPassword: 'Brand-New-Pass-1' })).status).toBe(204);
    expect((await anon.post('/auth/password-reset/complete', { resetToken, newPassword: 'Another-Pass-12' })).status).toBe(400);

    expect((await session.get('/auth/me')).status).toBe(401);
    expect(await e2e.db.selectFrom('passkeys').select('id').where('userId', '=', userId).execute()).toHaveLength(0);
    expect((await new Client(e2e).login('forgetful', 'Forgot-Pass-123')).status).toBe(401);
    expect((await new Client(e2e).login('forgetful', 'Brand-New-Pass-1')).status).toBe(200);
    expect(await auditActions(e2e.db, `user:${userId}`)).toEqual(
      expect.arrayContaining(['auth.password_reset.requested', 'auth.password_reset.completed']),
    );
  });

  it('rate-limits code requests per account (resend cooldown)', async () => {
    await ageCodes(userId);
    e2e.mail.clear();
    const anon = new Client(e2e);
    await anon.post('/auth/password-reset/request', { identifier: 'forgetful' });
    await anon.post('/auth/password-reset/request', { identifier: 'forgetful' });
    expect(e2e.mail.sent).toHaveLength(1);
  });

  it('rejects garbage tokens and codes', async () => {
    const anon = new Client(e2e);
    expect((await anon.post('/auth/password-reset/complete', { resetToken: 'x'.repeat(43), newPassword: 'Brand-New-Pass-1' })).status).toBe(400);
    expect((await anon.post('/auth/password-reset/verify', { identifier: 'forgetful', code: 'abcdef' })).status).toBe(400);
  });
});

describe('email binding', () => {
  let user: Client;
  let userId: number;
  beforeAll(async () => {
    userId = await createUser(root, { username: 'binder', password: 'Binder-Pass-123' });
    user = await loginAs(e2e, 'binder', 'Binder-Pass-123');
  });

  it('binds a new email after confirming a code sent to it (password required)', async () => {
    expect((await user.post('/auth/email/start', { action: 'bind', email: 'binder@example.uz', password: 'wrong' })).status).toBe(400);
    e2e.mail.clear();
    const start = await user.post('/auth/email/start', { action: 'bind', email: 'Binder@Example.uz', password: 'Binder-Pass-123' });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ step: 'verify_new', sentTo: 'bi***r@example.uz' });
    expect((await user.get('/auth/email')).body.step).toBe('verify_new');

    const code = e2e.mail.lastCode('binder@example.uz')!;
    const done = await user.post('/auth/email/verify', { code });
    expect(done.body).toMatchObject({ step: 'done', email: 'binder@example.uz' });
    expect((await user.get('/auth/me')).body.user.email).toBe('binder@example.uz');
  });

  it('changing an email confirms the CURRENT address first, then the new one', async () => {
    await ageCodes(userId);
    e2e.mail.clear();
    const start = await user.post('/auth/email/start', { action: 'bind', email: 'binder2@example.uz', password: 'Binder-Pass-123' });
    expect(start.body.step).toBe('verify_current');
    expect(e2e.mail.sent.map((m) => m.to)).toEqual(['binder@example.uz']);

    const step2 = await user.post('/auth/email/verify', { code: e2e.mail.lastCode('binder@example.uz')! });
    expect(step2.body).toMatchObject({ step: 'verify_new', sentTo: 'bi***2@example.uz' });
    // still the old email until the new one is confirmed
    expect((await user.get('/auth/me')).body.user.email).toBe('binder@example.uz');

    const done = await user.post('/auth/email/verify', { code: e2e.mail.lastCode('binder2@example.uz')! });
    expect(done.body).toMatchObject({ step: 'done', email: 'binder2@example.uz' });
  });

  it('refuses emails used by another account and wrong codes', async () => {
    await createUser(root, { username: 'taken-owner', password: 'Taken-Pass-123', email: 'taken@example.uz' });
    await ageCodes(userId);
    expect((await user.post('/auth/email/start', { action: 'bind', email: 'taken@example.uz', password: 'Binder-Pass-123' })).status).toBe(409);

    e2e.mail.clear();
    await user.post('/auth/email/start', { action: 'unbind', password: 'Binder-Pass-123' });
    expect((await user.post('/auth/email/verify', { code: '000000' === e2e.mail.lastCode('binder2@example.uz') ? '111111' : '000000' })).status).toBe(400);
    expect((await user.delete('/auth/email/pending')).status).toBe(204);
    expect((await user.get('/auth/email')).body.step).toBe('done');
  });

  it('unbinds after confirming a code sent to the current address', async () => {
    await ageCodes(userId);
    e2e.mail.clear();
    const start = await user.post('/auth/email/start', { action: 'unbind', password: 'Binder-Pass-123' });
    expect(start.body.step).toBe('verify_current');
    const done = await user.post('/auth/email/verify', { code: e2e.mail.lastCode('binder2@example.uz')! });
    expect(done.body).toMatchObject({ step: 'done', email: null });
    expect((await user.get('/auth/me')).body.user.email).toBeNull();
    expect((await user.post('/auth/email/start', { action: 'unbind', password: 'Binder-Pass-123' })).status).toBe(400);
    expect(await auditActions(e2e.db, `user:${userId}`)).toEqual(expect.arrayContaining(['auth.email.bound', 'auth.email.unbound']));
  });

  it('requires a session', async () => {
    const anon = new Client(e2e);
    expect((await anon.get('/auth/email')).status).toBe(401);
    expect((await anon.post('/auth/email/start', { action: 'unbind', password: 'x' })).status).toBe(401);
    expect((await anon.post('/auth/email/verify', { code: '123456' })).status).toBe(401);
  });
});
