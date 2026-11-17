import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { DB } from '../../../database/db.js';
import { verifyPassword } from '../../../modules/auth/password-hasher.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import { type MapperReport, MapperReportSchema, type MigrationContext } from '../mapper.js';
import {
  createUsersMapper,
  type ExistingUser,
  planUsers,
  transformLegacyUser,
  transformLegacyUserWith,
  type UserValues,
  type UsersRepository,
} from './users.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

interface FakeLegacyUser {
  username: string;
  password?: string;
  role?: string | null;
  operatorId?: string | null;
  email?: string | null;
  createdAt?: string;
  /** Overrides for broken rows. */
  passwordHash?: string;
  salt?: string;
}

/** Hashes exactly like legacy/services/authService.js (salt hex string used as text). */
function legacyHash(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

/** A temporary legacy callcenter.db built from the committed schema fixture. */
function createLegacyDb(users: FakeLegacyUser[]): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-legacy-'));
  const file = path.join(dir, 'callcenter.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO auth_users (username, password_hash, salt, role, operator_id, email, created_at, webauthn_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const u of users) {
    const salt = u.salt ?? randomBytes(16).toString('hex');
    insert.run(
      u.username,
      u.passwordHash ?? legacyHash(u.password ?? 'fake-password-1', salt),
      salt,
      u.role === undefined ? 'operator' : u.role,
      u.operatorId ?? null,
      u.email ?? null,
      u.createdAt ?? '2026-01-05 09:30:00',
      randomUUID(),
    );
  }
  db.close();
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Mirrors the unique indexes of `users`: lower(username), lower(email) where email is not null. */
class InMemoryUsersRepository implements UsersRepository {
  readonly rows: (ExistingUser & { createdAt?: Date })[] = [];
  inserts = 0;

  async listExisting(): Promise<ExistingUser[]> {
    return this.rows.map(({ createdAt: _c, ...u }) => ({ ...u }));
  }

  async groupIdByName(): Promise<number | null> {
    return null;
  }

  async insertIfAbsent(v: UserValues): Promise<number | null> {
    const taken = this.rows.some(
      (u) =>
        u.username.toLowerCase() === v.username.toLowerCase() ||
        (v.email !== null && u.email?.toLowerCase() === v.email.toLowerCase()),
    );
    if (taken) return null;
    const id = this.rows.length + 1;
    this.rows.push({ id, ...v, webauthnUserId: v.webauthnUserId ?? randomUUID() });
    this.inserts++;
    return id;
  }
}

const FAKE_USERS: FakeLegacyUser[] = [
  { username: 'test_admin', password: 'fake-admin-pass', role: 'admin', email: ' Test.Admin@Example.TEST ' },
  { username: 'test_super', password: 'fake-super-pass', role: 'superuser' },
  { username: 'op101', password: 'fake-op-101', operatorId: '101', email: 'op101@example.test' },
  { username: 'op102', password: 'fake-op-102', operatorId: ' 102 ', email: '' },
  { username: 'OP101', password: 'fake-op-dup', operatorId: '111' }, // clashes with op101 case-insensitively
  { username: 'broken_hash', passwordHash: 'abc123', operatorId: '103' },
  { username: 'bad_salt', salt: 'not-a-hex-salt', operatorId: '105' },
  { username: 'mgr_unknown', role: 'manager' },
  { username: 'no_role', role: null },
  { username: 'op104', password: 'fake-op-104', operatorId: '104', email: 'OP101@example.test' }, // duplicate email
  { username: 'op_badext', password: 'fake-op-bad', operatorId: 'ext-1', email: 'not-an-email' },
  { username: 'operator205', password: 'fake-op-205', operatorId: '205' },
];

describe('users mapper', () => {
  let legacyDb: { file: string; cleanup: () => void };
  let legacy: LegacySources;

  // The legacy database is opened read-only, so one copy serves every test.
  beforeAll(() => {
    legacyDb = createLegacyDb(FAKE_USERS);
    legacy = openLegacySources({ sqlitePath: legacyDb.file });
  });

  afterAll(() => {
    legacy.close();
    legacyDb.cleanup();
  });

  const rows = () => legacy.sqlite!.all('SELECT * FROM auth_users ORDER BY id');
  const byName = (name: string) => transformLegacyUser(rows().find((r) => r.username === name)!);

  describe('transformLegacyUser', () => {
    it('maps roles and rejects unknown ones', () => {
      const admin = byName('test_admin');
      const superuser = byName('test_super');
      const operator = byName('op101');
      expect(admin.ok && admin.values.role).toBe('admin');
      expect(superuser.ok && superuser.values.role).toBe('superuser');
      expect(operator.ok && operator.values.role).toBe('operator');
      expect(byName('mgr_unknown')).toEqual({
        ok: false,
        key: '#8 mgr_unknown',
        legacyId: 8,
        reason: 'unknown role "manager"',
      });
      expect(byName('no_role')).toMatchObject({ ok: false, reason: 'unknown role null' });
    });

    it('accepts a differently cased role', () => {
      const r = transformLegacyUser({ ...rows()[0], role: ' Admin ' });
      expect(r.ok && r.values.role).toBe('admin');
    });

    it('keeps legacy passwords verifiable by the new password hasher', async () => {
      for (const [name, password] of [
        ['test_admin', 'fake-admin-pass'],
        ['op101', 'fake-op-101'],
        ['op104', 'fake-op-104'],
      ] as const) {
        const r = byName(name);
        if (!r.ok) throw new Error(`${name} was skipped: ${r.reason}`);
        expect(r.values.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
        expect(await verifyPassword(password, r.values.passwordHash)).toBe(true);
        expect(await verifyPassword(`${password}x`, r.values.passwordHash)).toBe(false);
      }
    });

    it('skips malformed hashes and salts', () => {
      expect(byName('broken_hash')).toMatchObject({
        ok: false,
        reason: 'password_hash is not 128 hex chars (length 6)',
      });
      expect(byName('bad_salt')).toMatchObject({ ok: false, reason: 'salt is not 32 hex chars (length 14)' });
    });

    it('normalises emails: trim + lowercase, empty → null, invalid → null with a warning', () => {
      const admin = byName('test_admin');
      const op102 = byName('op102');
      const bad = byName('op_badext');
      expect(admin.ok && admin.values.email).toBe('test.admin@example.test');
      expect(op102.ok && op102.values.email).toBeNull();
      expect(bad.ok && bad.values.email).toBeNull();
      expect(bad.ok && bad.warnings).toContain('email is not a valid address; imported without email');
    });

    it('maps operator_id to extension, dropping values that are not extensions', () => {
      const op101 = byName('op101');
      const op102 = byName('op102');
      const admin = byName('test_admin');
      const bad = byName('op_badext');
      expect(op101.ok && op101.values.extension).toBe('101');
      expect(op102.ok && op102.values.extension).toBe('102');
      expect(admin.ok && admin.values.extension).toBeNull();
      expect(bad.ok && bad.values.extension).toBeNull();
      expect(bad.ok && bad.warnings).toEqual(
        expect.arrayContaining([
          'operator_id "ext-1" is not a 2-6 digit extension; imported without extension',
          'operator has no extension',
        ]),
      );
    });

    it('reads created_at as Asia/Tashkent wall-clock time', () => {
      const r = byName('op101');
      expect(r.ok && r.values.createdAt?.toISOString()).toBe('2026-01-05T04:30:00.000Z');
    });

    it('flags the shared-password accounts created by scripts/create_200.js', () => {
      const r = byName('operator205');
      expect(r.ok && r.warnings.some((w) => w.includes('create_200.js'))).toBe(true);
    });

    it('reports unreadable rows instead of throwing', () => {
      expect(
        transformLegacyUser({ id: 99, username: 'x', password_hash: null, salt: 'y', role: 'admin' }),
      ).toMatchObject({
        ok: false,
        key: '#99 x',
      });
    });
  });

  describe('planUsers', () => {
    it('skips case-insensitive username clashes and drops duplicate emails (oldest legacy id wins)', () => {
      const plan = planUsers(rows().map(transformLegacyUser), []);
      expect(plan.skipped).toEqual(
        expect.arrayContaining([
          { key: '#5 OP101', reason: 'username clashes case-insensitively with legacy user #3 op101' },
        ]),
      );
      const op104 = plan.inserts.find((i) => i.values.username === 'op104');
      expect(op104?.values.email).toBeNull();
      expect(plan.warnings).toContainEqual({
        key: '#10 op104',
        reason: 'email already belongs to legacy user #3 op101; imported without email',
      });
    });

    it('leaves users that already exist untouched and says which fields differ', () => {
      const existing: ExistingUser[] = [
        {
          id: 7,
          username: 'Test_Admin',
          passwordHash: 'scrypt$changed',
          role: 'admin',
          extension: null,
          email: null,
          webauthnUserId: randomUUID(),
        },
        {
          id: 8,
          username: 'someone',
          passwordHash: 'x',
          role: 'operator',
          extension: '150',
          email: 'op101@example.test',
          webauthnUserId: randomUUID(),
        },
      ];
      const plan = planUsers(rows().map(transformLegacyUser), existing);
      expect(plan.unchanged).toBe(1);
      expect(plan.inserts.map((i) => i.values.username)).not.toContain('test_admin');
      expect(plan.warnings).toContainEqual({
        key: '#1 test_admin',
        reason: 'already exists as users.id 7; left untouched (differs: password, email)',
      });
      expect(plan.warnings).toContainEqual({
        key: '#3 op101',
        reason: 'email already belongs to users.id 8 (someone); imported without email',
      });
    });
  });

  describe('run', () => {
    function ctx(dryRun: boolean): MigrationContext {
      return { legacy, db: {} as Kysely<DB>, dryRun, logger: { info: vi.fn(), warn: vi.fn() } };
    }
    const summary = (r: MapperReport) => ({
      read: r.read,
      inserted: r.inserted,
      updated: r.updated,
      unchanged: r.unchanged,
      skipped: r.skipped.length,
    });

    it('dry-run plans without writing and returns a well-formed report', async () => {
      const repo = new InMemoryUsersRepository();
      const report = await createUsersMapper(() => repo).run(ctx(true));

      expect(MapperReportSchema.parse(report)).toEqual(report);
      expect(report).toMatchObject({ name: 'users', owner: 'S1', status: 'ok', errors: [] });
      expect(summary(report)).toEqual({ read: 12, inserted: 7, updated: 0, unchanged: 0, skipped: 5 });
      expect(report.skipped.map((s) => s.key)).toEqual([
        '#5 OP101',
        '#6 broken_hash',
        '#7 bad_salt',
        '#8 mgr_unknown',
        '#9 no_role',
      ]);
      expect(report.notes).toContain('7 of 7 inserted users keep their legacy passkey handle (webauthn_user_id)');
      expect(repo.inserts).toBe(0);
    });

    it('keeps the legacy passkey handle and puts operators 200+ into the restricted group', () => {
      const legacyRow = rows().find((r) => r.username === 'operator205')!;
      const r = transformLegacyUserWith(legacyRow, { restrictedGroupId: 2 });
      expect(r.ok && r.values.webauthnUserId).toBe(String(legacyRow.webauthn_user_id));
      expect(r.ok && r.values.groupId).toBe(2);
      const op101 = transformLegacyUserWith(
        rows().find((x) => x.username === 'op101')!,
        { restrictedGroupId: 2 },
      );
      expect(op101.ok && op101.values.groupId).toBeUndefined();
      const bad = transformLegacyUser({ ...legacyRow, webauthn_user_id: 'not-a-uuid' });
      expect(bad.ok && bad.values.webauthnUserId).toBeUndefined();
      expect(bad.ok && bad.warnings.some((w) => w.startsWith('webauthn_user_id is not a UUID'))).toBe(true);
    });

    it('does not reuse a passkey handle another user already has', () => {
      const legacyRow = rows().find((r) => r.username === 'op101')!;
      const taken: ExistingUser = {
        id: 50,
        username: 'someone-else',
        passwordHash: 'x',
        role: 'operator',
        extension: '150',
        email: null,
        webauthnUserId: String(legacyRow.webauthn_user_id),
      };
      const plan = planUsers([transformLegacyUser(legacyRow)], [taken]);
      expect(plan.inserts[0].values.webauthnUserId).toBeUndefined();
      expect(plan.warnings.some((w) => w.reason.includes('webauthn_user_id already belongs to users.id 50'))).toBe(
        true,
      );
    });

    it('is idempotent: a second real run inserts nothing and reports the same rows as unchanged', async () => {
      const repo = new InMemoryUsersRepository();
      const mapper = createUsersMapper(() => repo);

      const first = await mapper.run(ctx(false));
      expect(summary(first)).toEqual({ read: 12, inserted: 7, updated: 0, unchanged: 0, skipped: 5 });
      expect(repo.rows.map((u) => u.username)).toEqual([
        'test_admin',
        'test_super',
        'op101',
        'op102',
        'op104',
        'op_badext',
        'operator205',
      ]);

      const second = await mapper.run(ctx(false));
      expect(summary(second)).toEqual({ read: 12, inserted: 0, updated: 0, unchanged: 7, skipped: 5 });
      expect(second.skipped).toEqual(first.skipped);
      expect(repo.rows).toHaveLength(7);
      // Nothing differs, so the unchanged rows produce no "differs" warnings.
      expect(second.warnings.filter((w) => w.reason.includes('already exists'))).toEqual([]);
    });

    it('never overwrites a password changed in the new system', async () => {
      const repo = new InMemoryUsersRepository();
      const mapper = createUsersMapper(() => repo);
      await mapper.run(ctx(false));
      const op101 = repo.rows.find((u) => u.username === 'op101')!;
      op101.passwordHash = 'scrypt$16384$8$1$newsalt$newhash';

      const again = await mapper.run(ctx(false));
      expect(op101.passwordHash).toBe('scrypt$16384$8$1$newsalt$newhash');
      expect(again.warnings).toContainEqual({
        key: '#3 op101',
        reason: 'already exists as users.id 3; left untouched (differs: password)',
      });
    });

    it('reports a missing source instead of failing', async () => {
      const report = await createUsersMapper(() => new InMemoryUsersRepository()).run({
        ...ctx(true),
        legacy: openLegacySources({}),
      });
      expect(report).toMatchObject({ status: 'source-missing', read: 0, errors: [], notes: ['--sqlite not given'] });
    });
  });
});
