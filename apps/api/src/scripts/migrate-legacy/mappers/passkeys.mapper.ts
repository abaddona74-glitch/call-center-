import { decodeCredentialPublicKey } from '@simplewebauthn/server/helpers';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import type { SqliteRow } from '../legacy-sources.js';
import { emptyReport, type Mapper, type RowIssue } from '../mapper.js';
import { parseLegacyLocalTime } from '../time.js';

/**
 * Legacy `auth_passkeys` → `passkeys` (docs/rewrite/legacy/data.md §1.1.14, §1.4, §5.1).
 *
 * A migrated passkey keeps working only if all of these stay byte-for-byte the same:
 *  - the credential id (base64url text) — it is the lookup key at login;
 *  - the COSE public key bytes and the signature counter;
 *  - the user handle: the UTF-8 of the legacy `webauthn_user_id` UUID *string*, which the users mapper
 *    copies into `users.webauthn_user_id` (the API checks `userHandle` against it at login);
 *  - `WEBAUTHN_RP_ID` (and origins) of the deployment — configuration, not data.
 *
 * Idempotency: insert-if-absent by credential id. Users are resolved by legacy `auth_users.username`
 * (case-insensitive), because legacy ids are not kept. If the target user exists but has a different
 * handle (e.g. the bootstrap superuser was created before the import) and has no passkeys yet, it adopts
 * the legacy handle (reported as a warning); otherwise the passkey is skipped with the reason.
 * Legacy passkey sessions are not migrated (users sign in again).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CREDENTIAL_ID_RE = /^[A-Za-z0-9_-]{1,1024}$/;
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const NAME_MAX = 60;

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const LegacyPasskeyRowSchema = z.object({
  id: z.string(),
  user_id: z.number().int(),
  webauthn_user_id: optionalText,
  public_key: z.instanceof(Uint8Array),
  counter: z.number().nullish(),
  device_type: optionalText,
  backed_up: z.number().nullish(),
  transports: optionalText,
  device_name: optionalText,
  created_at: optionalText,
  last_used_at: optionalText,
  /** From the join with auth_users (null when the owner row is gone). */
  owner_username: optionalText,
  owner_handle: optionalText,
});

export interface PasskeyValues {
  id: string;
  publicKey: Buffer;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[] | null;
  name: string;
  createdAt?: Date;
  lastUsedAt: Date | null;
}

export type PasskeyTransformResult =
  | { ok: true; key: string; username: string; handle: string; values: PasskeyValues; warnings: string[] }
  | { ok: false; key: string; reason: string };

export interface TargetUser {
  id: number;
  username: string;
  webauthnUserId: string;
}

export interface TargetPasskey {
  id: string;
  userId: number;
}

export interface PasskeysPlan {
  inserts: { key: string; values: PasskeyValues & { userId: number } }[];
  /** users.id → legacy handle to adopt (only users without passkeys in the target). */
  handleUpdates: Map<number, string>;
  unchanged: number;
  skipped: RowIssue[];
  warnings: RowIssue[];
}

export interface PasskeysRepository {
  listUsers(): Promise<TargetUser[]>;
  listPasskeys(): Promise<TargetPasskey[]>;
  /** Sets the handle only while the user still has no passkeys; returns whether it was set. */
  adoptHandle(userId: number, handle: string): Promise<boolean>;
  /** Inserts unless the credential id exists; returns whether it was inserted. */
  insertIfAbsent(values: PasskeyValues & { userId: number }): Promise<boolean>;
}

export class KyselyPasskeysRepository implements PasskeysRepository {
  constructor(private readonly db: Kysely<DB>) {}

  listUsers(): Promise<TargetUser[]> {
    return this.db.selectFrom('users').select(['id', 'username', 'webauthnUserId']).orderBy('id').execute();
  }

  listPasskeys(): Promise<TargetPasskey[]> {
    return this.db.selectFrom('passkeys').select(['id', 'userId']).execute();
  }

  async adoptHandle(userId: number, handle: string): Promise<boolean> {
    const res = await this.db
      .updateTable('users')
      .set({ webauthnUserId: handle, updatedAt: sql`now()` })
      .where('id', '=', userId)
      .where((eb) =>
        eb.not(eb.exists(eb.selectFrom('passkeys').select('id').whereRef('passkeys.userId', '=', 'users.id'))),
      )
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) > 0;
  }

  async insertIfAbsent(values: PasskeyValues & { userId: number }): Promise<boolean> {
    const row = await this.db
      .insertInto('passkeys')
      .values(values)
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return Boolean(row);
  }
}

/** `#<credential id prefix> <owner>` — the public key and handle are never printed. */
function rowKey(id: unknown, username: unknown): string {
  const cred = typeof id === 'string' ? `${id.slice(0, 12)}${id.length > 12 ? '…' : ''}` : '?';
  const name = typeof username === 'string' ? username.trim().slice(0, 40) : '?';
  return `#${cred} ${name}`;
}

/** Pure: one legacy row (joined with its owner) → insert values or a skip reason. Never throws. */
export function transformLegacyPasskey(raw: SqliteRow): PasskeyTransformResult {
  const parsed = LegacyPasskeyRowSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return {
      ok: false,
      key: rowKey(raw.id, raw.owner_username ?? raw.username),
      reason: `unreadable legacy row (${issues})`,
    };
  }
  const row = parsed.data;
  const key = rowKey(row.id, row.owner_username);
  const skip = (reason: string): PasskeyTransformResult => ({ ok: false, key, reason });
  const warnings: string[] = [];

  if (!CREDENTIAL_ID_RE.test(row.id)) return skip('credential id is not base64url text');
  if (!row.owner_username) return skip(`owner auth_users.id ${row.user_id} not found in legacy`);

  // Legacy login required: passkey.webauthn_user_id == auth_users.webauthn_user_id == userHandle.
  const handle = row.owner_handle?.trim().toLowerCase() ?? '';
  if (!UUID_RE.test(handle)) return skip("owner's webauthn_user_id is missing or not a UUID");
  if (row.webauthn_user_id && row.webauthn_user_id.trim().toLowerCase() !== handle) {
    return skip("passkey's webauthn_user_id differs from its owner's (it could not sign in on legacy either)");
  }

  if (row.public_key.length === 0) return skip('public_key is empty');
  // A COSE key is a CBOR map with at least kty (1) and alg (3); anything else could never verify a signature.
  let cose: unknown;
  try {
    cose = decodeCredentialPublicKey(new Uint8Array(row.public_key));
  } catch {
    cose = null;
  }
  if (!(cose instanceof Map) || !cose.has(1) || !cose.has(3)) return skip('public_key is not a COSE key');

  let counter = row.counter ?? 0;
  if (!Number.isSafeInteger(counter) || counter < 0) {
    warnings.push(`counter ${String(row.counter)} is invalid; set to 0`);
    counter = 0;
  }

  let transports: string[] | null = null;
  if (row.transports) {
    try {
      const list = JSON.parse(row.transports) as unknown;
      if (!Array.isArray(list)) throw new Error('not an array');
      const known = list.filter((t): t is string => typeof t === 'string' && TRANSPORTS.has(t));
      if (known.length !== list.length) warnings.push('unknown transports dropped');
      transports = known.length ? known : null;
    } catch {
      warnings.push('transports is not a JSON array; dropped');
    }
  }

  let name = (row.device_name ?? '').trim();
  if (!name) {
    warnings.push('device_name is empty; named "Passkey"');
    name = 'Passkey';
  } else if (name.length > NAME_MAX) {
    warnings.push(`device_name longer than ${NAME_MAX} chars; truncated`);
    name = name.slice(0, NAME_MAX);
  }

  const values: PasskeyValues = {
    id: row.id,
    publicKey: Buffer.from(row.public_key),
    counter,
    deviceType: row.device_type?.trim() || null,
    backedUp: row.backed_up === 1,
    transports,
    name,
    lastUsedAt: parseLegacyLocalTime(row.last_used_at),
  };
  const createdAt = parseLegacyLocalTime(row.created_at);
  if (createdAt) values.createdAt = createdAt;
  else if (row.created_at?.trim()) warnings.push('created_at is not a recognised timestamp; set to now');
  if (row.last_used_at?.trim() && !values.lastUsedAt)
    warnings.push('last_used_at is not a recognised timestamp; dropped');

  return { ok: true, key, username: row.owner_username.trim(), handle, values, warnings };
}

/** Pure: decides insert / adopt handle / unchanged / skip for every legacy passkey. */
export function planPasskeys(
  results: readonly PasskeyTransformResult[],
  users: readonly TargetUser[],
  existing: readonly TargetPasskey[],
): PasskeysPlan {
  const plan: PasskeysPlan = { inserts: [], handleUpdates: new Map(), unchanged: 0, skipped: [], warnings: [] };
  const usersByName = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const handleOwner = new Map(users.map((u) => [u.webauthnUserId.toLowerCase(), u.id]));
  const ownerOfCredential = new Map(existing.map((p) => [p.id, p.userId]));
  const passkeyCount = new Map<number, number>();
  for (const p of existing) passkeyCount.set(p.userId, (passkeyCount.get(p.userId) ?? 0) + 1);

  for (const r of results) {
    if (!r.ok) {
      plan.skipped.push({ key: r.key, reason: r.reason });
      continue;
    }
    const user = usersByName.get(r.username.toLowerCase());
    if (!user) {
      plan.skipped.push({
        key: r.key,
        reason: `user "${r.username}" is not in the new database (skipped by the users mapper?)`,
      });
      continue;
    }

    const holder = ownerOfCredential.get(r.values.id);
    if (holder !== undefined) {
      if (holder === user.id) plan.unchanged++;
      else plan.skipped.push({ key: r.key, reason: `credential id is already registered to users.id ${holder}` });
      continue;
    }

    const current = plan.handleUpdates.get(user.id) ?? user.webauthnUserId.toLowerCase();
    if (current !== r.handle) {
      const otherOwner = handleOwner.get(r.handle);
      if (otherOwner !== undefined && otherOwner !== user.id) {
        plan.skipped.push({
          key: r.key,
          reason: `its user handle belongs to users.id ${otherOwner} in the new database`,
        });
        continue;
      }
      if ((passkeyCount.get(user.id) ?? 0) > 0 || plan.handleUpdates.has(user.id)) {
        plan.skipped.push({
          key: r.key,
          reason: `users.id ${user.id} already uses another passkey handle (it has passkeys in the new system)`,
        });
        continue;
      }
      plan.handleUpdates.set(user.id, r.handle);
      handleOwner.set(r.handle, user.id);
      plan.warnings.push({
        key: r.key,
        reason: `users.id ${user.id} adopts the legacy passkey handle (it had no passkeys in the new system)`,
      });
    }

    for (const w of r.warnings) plan.warnings.push({ key: r.key, reason: w });
    plan.inserts.push({ key: r.key, values: { ...r.values, userId: user.id } });
    ownerOfCredential.set(r.values.id, user.id);
    passkeyCount.set(user.id, (passkeyCount.get(user.id) ?? 0) + 1);
  }
  return plan;
}

export function createPasskeysMapper(
  repositoryFor: (db: Kysely<DB>) => PasskeysRepository = (db) => new KyselyPasskeysRepository(db),
): Mapper {
  const meta = { name: 'passkeys', owner: 'S1' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('auth_passkeys')) {
        report.status = 'source-missing';
        report.notes.push(
          sqlite ? 'legacy table auth_passkeys not found (passkeys were never enabled)' : '--sqlite not given',
        );
        return report;
      }
      const ownerHandle = sqlite.columns('auth_users').includes('webauthn_user_id') ? 'u.webauthn_user_id' : 'NULL';
      const rows = sqlite.all(
        `SELECT p.*, u.username AS owner_username, ${ownerHandle} AS owner_handle
         FROM auth_passkeys p LEFT JOIN auth_users u ON u.id = p.user_id
         ORDER BY p.created_at, p.rowid`,
      );
      report.read = rows.length;

      const repo = repositoryFor(ctx.db);
      const plan = planPasskeys(rows.map(transformLegacyPasskey), await repo.listUsers(), await repo.listPasskeys());
      report.skipped = plan.skipped;
      report.warnings = plan.warnings;
      report.unchanged = plan.unchanged;

      if (ctx.dryRun) {
        report.inserted = plan.inserts.length;
        report.updated = plan.handleUpdates.size;
      } else {
        for (const [userId, handle] of plan.handleUpdates) {
          if (await repo.adoptHandle(userId, handle)) report.updated++;
        }
        for (const item of plan.inserts) {
          if (await repo.insertIfAbsent(item.values)) report.inserted++;
          else {
            report.unchanged++;
            report.warnings.push({ key: item.key, reason: 'credential id appeared while migrating; left untouched' });
          }
        }
      }

      report.notes.push(
        '"updated" counts users that adopted their legacy passkey handle',
        'WEBAUTHN_RP_ID and WEBAUTHN_ORIGINS must match the legacy deployment, or migrated passkeys cannot sign in',
        'legacy passkey sessions are not migrated; users sign in again',
      );
      return report;
    },
  };
}

export const passkeysMapper = createPasskeysMapper();
