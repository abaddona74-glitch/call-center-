import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { Kysely } from 'kysely';
import type { DB } from '../../../database/db.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import { MapperReportSchema, type MigrationContext } from '../mapper.js';
import {
  createPasskeysMapper,
  type PasskeyValues,
  type PasskeysRepository,
  planPasskeys,
  type TargetPasskey,
  type TargetUser,
  transformLegacyPasskey,
} from './passkeys.mapper.js';
import { pickUsernameWinners, transformLegacyUser } from './users.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

/** A real ES256 COSE public key, like @simplewebauthn stores it. */
function coseKey(): Uint8Array {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
    ]),
  );
}

const credId = () => randomBytes(16).toString('base64url');

const USERS = {
  op101: randomUUID(),
  op205: randomUUID(),
  boss: randomUUID(),
  gone: randomUUID(),
  /** Differs from op101 only by case and was changed earlier, so the users mapper keeps op101. */
  Op101: randomUUID(),
};

interface LegacyPasskey {
  id: string;
  user: keyof typeof USERS;
  handle?: string;
  publicKey?: Uint8Array;
  counter?: number;
  backedUp?: number;
  transports?: string | null;
  name?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
}

const PK = {
  laptop: credId(),
  phone: credId(),
  bossKey: credId(),
  orphan: credId(),
  mismatched: credId(),
  broken: credId(),
  dupe: credId(),
};

const PASSKEYS: LegacyPasskey[] = [
  {
    id: PK.laptop,
    user: 'op101',
    counter: 41,
    backedUp: 1,
    transports: '["internal","hybrid","weird"]',
    name: 'Ish kompyuteri',
    createdAt: '2026-01-05 09:30:00',
    lastUsedAt: '2026-02-01 18:00:00',
  },
  { id: PK.phone, user: 'op205', transports: null, name: '  ' },
  { id: PK.bossKey, user: 'boss', name: 'Boss phone' },
  { id: PK.orphan, user: 'gone' },
  { id: PK.mismatched, user: 'op101', handle: randomUUID() },
  { id: PK.broken, user: 'op205', publicKey: new Uint8Array([1, 2, 3]) },
  { id: PK.dupe, user: 'Op101', name: 'Old account key' },
];

function createLegacyDb(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-passkeys-'));
  const file = path.join(dir, 'callcenter.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const user = db.prepare(
    `INSERT INTO auth_users (username, password_hash, salt, role, operator_id, webauthn_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const ids: Record<string, number> = {};
  for (const [name, handle] of Object.entries(USERS)) {
    const res = user.run(name, 'a'.repeat(128), 'b'.repeat(32), 'operator', '101', handle);
    ids[name] = Number(res.lastInsertRowid);
  }
  const insert = db.prepare(
    `INSERT INTO auth_passkeys (id, user_id, webauthn_user_id, username, public_key, counter, device_type, backed_up,
       transports, device_name, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, 'multiDevice', ?, ?, ?, ?, ?)`,
  );
  for (const p of PASSKEYS) {
    insert.run(
      p.id,
      ids[p.user],
      p.handle ?? USERS[p.user],
      p.user,
      p.publicKey ?? coseKey(),
      p.counter ?? 0,
      p.backedUp ?? 0,
      p.transports === undefined ? '["internal"]' : p.transports,
      p.name ?? 'Device',
      p.createdAt ?? '2026-01-05 09:30:00',
      p.lastUsedAt ?? null,
    );
  }
  db.prepare(`UPDATE auth_users SET updated_at = '2026-11-12 10:00:00' WHERE username = 'op101'`).run();
  db.prepare(`UPDATE auth_users SET updated_at = '2026-10-19 10:00:00' WHERE username = 'Op101'`).run();
  // the owner of the orphan passkey disappears without the cascade (as on old legacy databases)
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('DELETE FROM auth_users WHERE username = ?').run('gone');
  db.close();
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

class InMemoryPasskeysRepository implements PasskeysRepository {
  readonly passkeys: (PasskeyValues & { userId: number })[] = [];
  constructor(readonly users: TargetUser[]) {}
  async listUsers() {
    return this.users.map((u) => ({ ...u }));
  }
  async listPasskeys(): Promise<TargetPasskey[]> {
    return this.passkeys.map((p) => ({ id: p.id, userId: p.userId }));
  }
  async adoptHandle(userId: number, handle: string) {
    if (this.passkeys.some((p) => p.userId === userId)) return false;
    this.users.find((u) => u.id === userId)!.webauthnUserId = handle;
    return true;
  }
  async insertIfAbsent(values: PasskeyValues & { userId: number }) {
    if (this.passkeys.some((p) => p.id === values.id)) return false;
    this.passkeys.push(values);
    return true;
  }
}

/** Target as the users mapper leaves it: op101/op205 imported with their handles; boss pre-existing. */
const targetUsers = (): TargetUser[] => [
  { id: 1, username: 'Boss', webauthnUserId: randomUUID() },
  { id: 2, username: 'op101', webauthnUserId: USERS.op101 },
  { id: 3, username: 'OP205', webauthnUserId: USERS.op205 },
];

describe('passkeys mapper', () => {
  let legacyDb: { file: string; cleanup: () => void };
  let legacy: LegacySources;

  beforeAll(() => {
    legacyDb = createLegacyDb();
    legacy = openLegacySources({ sqlitePath: legacyDb.file });
  });
  afterAll(() => {
    legacy.close();
    legacyDb.cleanup();
  });

  const ctx = (dryRun: boolean): MigrationContext => ({
    legacy,
    db: {} as Kysely<DB>,
    dryRun,
    logger: { info: () => undefined, warn: () => undefined },
  });
  const rows = () =>
    legacy.sqlite!.all(
      `SELECT p.*, u.username AS owner_username, u.webauthn_user_id AS owner_handle
       FROM auth_passkeys p LEFT JOIN auth_users u ON u.id = p.user_id`,
    );
  const byId = (id: string) => transformLegacyPasskey(rows().find((r) => r.id === id)!);

  describe('transformLegacyPasskey', () => {
    it('keeps id, key bytes, counter, handle; maps flags, transports, name and dates', () => {
      const r = byId(PK.laptop);
      if (!r.ok) throw new Error(r.reason);
      const raw = rows().find((x) => x.id === PK.laptop)!;
      expect(r.values.id).toBe(PK.laptop);
      expect(Buffer.compare(r.values.publicKey, Buffer.from(raw.public_key as Uint8Array))).toBe(0);
      expect(r.values).toMatchObject({
        counter: 41,
        backedUp: true,
        deviceType: 'multiDevice',
        name: 'Ish kompyuteri',
      });
      expect(r.values.transports).toEqual(['internal', 'hybrid']);
      expect(r.warnings).toContain('unknown transports dropped');
      expect(r.handle).toBe(USERS.op101);
      expect(r.values.createdAt?.toISOString()).toBe('2026-01-05T04:30:00.000Z');
      expect(r.values.lastUsedAt?.toISOString()).toBe('2026-02-01T13:00:00.000Z');
    });

    it('names unnamed passkeys and allows missing transports', () => {
      const r = byId(PK.phone);
      expect(r.ok && r.values.name).toBe('Passkey');
      expect(r.ok && r.values.transports).toBeNull();
    });

    it('skips rows that could never sign in', () => {
      expect(byId(PK.orphan)).toMatchObject({ ok: false, reason: expect.stringContaining('not found in legacy') });
      expect(byId(PK.mismatched)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('differs from its owner'),
      });
      expect(byId(PK.broken)).toMatchObject({ ok: false, reason: 'public_key is not a COSE key' });
    });
  });

  describe('planPasskeys', () => {
    it('resolves owners case-insensitively and adopts the handle of a user without passkeys', () => {
      const plan = planPasskeys(rows().map(transformLegacyPasskey), targetUsers(), []);
      expect(plan.inserts.map((i) => [i.values.id, i.values.userId]).sort()).toEqual(
        [
          [PK.laptop, 2],
          [PK.phone, 3],
          [PK.bossKey, 1],
        ].sort(),
      );
      expect(plan.handleUpdates).toEqual(new Map([[1, USERS.boss]]));
      expect(plan.skipped).toHaveLength(4);
    });

    it('skips the passkey of a legacy account that lost a case-insensitive username clash', () => {
      const winners = pickUsernameWinners(
        legacy.sqlite!.all('SELECT * FROM auth_users ORDER BY id').map(transformLegacyUser),
      );
      expect(winners.get('op101')?.key).toBe('#1 op101');
      const plan = planPasskeys(rows().map(transformLegacyPasskey), targetUsers(), [], winners);
      expect(plan.inserts.map((i) => i.values.id)).not.toContain(PK.dupe);
      expect(plan.skipped).toContainEqual({
        key: expect.stringContaining('Op101'),
        reason:
          'owner legacy user #5 is not migrated (its username clashes with legacy user #1 op101, which is kept); ' +
          'the user registers this passkey again',
      });
    });

    it('never changes the handle of a user who already has passkeys in the new system', () => {
      const plan = planPasskeys(rows().map(transformLegacyPasskey), targetUsers(), [{ id: 'new-key', userId: 1 }]);
      expect(plan.handleUpdates.size).toBe(0);
      expect(plan.skipped.some((s) => s.reason.includes('already uses another passkey handle'))).toBe(true);
    });

    it('does not move a credential that belongs to someone else', () => {
      const plan = planPasskeys([byId(PK.laptop)], targetUsers(), [{ id: PK.laptop, userId: 3 }]);
      expect(plan.inserts).toHaveLength(0);
      expect(plan.skipped[0].reason).toBe('credential id is already registered to users.id 3');
    });
  });

  describe('run', () => {
    it('dry-run plans without writing', async () => {
      const repo = new InMemoryPasskeysRepository(targetUsers());
      const report = await createPasskeysMapper(() => repo).run(ctx(true));
      expect(MapperReportSchema.parse(report)).toEqual(report);
      expect(report).toMatchObject({ name: 'passkeys', owner: 'S1', status: 'ok', read: 7, inserted: 3, updated: 1 });
      expect(report.skipped.find((s) => s.key.includes('Op101'))?.reason).toContain('registers this passkey again');
      expect(repo.passkeys).toHaveLength(0);
      expect(JSON.stringify(report)).not.toContain(USERS.op101); // handles are never printed
    });

    it('migrates, then a re-run changes nothing', async () => {
      const repo = new InMemoryPasskeysRepository(targetUsers());
      const first = await createPasskeysMapper(() => repo).run(ctx(false));
      expect(first).toMatchObject({ inserted: 3, updated: 1, unchanged: 0 });
      expect(repo.users.find((u) => u.id === 1)!.webauthnUserId).toBe(USERS.boss);

      const second = await createPasskeysMapper(() => repo).run(ctx(false));
      expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 3 });
      expect(repo.passkeys).toHaveLength(3);
    });

    it('reports a missing source', async () => {
      const report = await createPasskeysMapper(() => new InMemoryPasskeysRepository([])).run({
        ...ctx(true),
        legacy: { ...legacy, sqlite: null },
      });
      expect(report.status).toBe('source-missing');
    });
  });
});
