import { ExtensionSchema, type Role, RoleSchema, UsernameSchema } from '@cc/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import { fromLegacy } from '../../../modules/auth/password-hasher.js';
import type { SqliteRow } from '../legacy-sources.js';
import { emptyReport, type Mapper, type RowIssue } from '../mapper.js';
import { parseLegacyLocalTime } from '../time.js';

/**
 * Legacy `auth_users` → `users` (docs/rewrite/legacy/data.md §1.1.8, §1.3, §5.1).
 *
 * Idempotency rule: insert-if-absent by username (case-insensitive, like the
 * `users_username_lower_uq` index). A user that already exists in the new system is never
 * modified — not its password, role, extension or email — and is counted as `unchanged`
 * (with a warning listing the fields that differ from legacy). See README.md.
 */

const HASH_RE = /^[0-9a-fA-F]{128}$/;
const SALT_RE = /^[0-9a-fA-F]{32}$/;
/** The check legacy authService used when an email was set; anything it accepted is kept. */
const LEGACY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Accounts created by legacy scripts/create_200.js, all with one shared password. */
const SHARED_PASSWORD_USERNAME_RE = /^operator20[0-9]$/;
/** Legacy `webauthn_user_id` is `crypto.randomUUID()` text; the passkey user handle is its UTF-8 bytes. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Legacy "200 group" (Zangiota 42): operators with extension >= 200 (see the auth_accounts migration). */
export const RESTRICTED_GROUP_NAME = 'Zangiota';

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const LegacyUserRowSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  password_hash: z.string(),
  salt: z.string(),
  role: z.string().nullable(),
  /** Added by ALTER in later legacy versions — may be absent on old databases. */
  operator_id: optionalText,
  email: optionalText,
  created_at: optionalText,
  updated_at: optionalText,
  /** Added by webauthnService; the passkey user handle. Absent on databases that never had passkeys. */
  webauthn_user_id: optionalText,
});
export type LegacyUserRow = z.infer<typeof LegacyUserRowSchema>;

/** Insert values for `users` (a subset of `NewUser` from auth.tables.ts). */
export interface UserValues {
  username: string;
  passwordHash: string;
  role: Role;
  extension: string | null;
  email: string | null;
  /** Legacy passkey user handle (lowercase UUID text). Omitted = a new one is generated. */
  webauthnUserId?: string;
  /** Operator group; operators with extension >= 200 go to the "Zangiota" group like the legacy rule. */
  groupId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TransformOptions {
  /** operator_groups.id of "Zangiota" in the target, if it exists. */
  restrictedGroupId?: number | null;
}

export type TransformResult =
  | { ok: true; key: string; legacyId: number; values: UserValues; warnings: string[] }
  | { ok: false; key: string; legacyId: number | null; reason: string };

export interface ExistingUser {
  id: number;
  username: string;
  passwordHash: string;
  role: Role;
  extension: string | null;
  email: string | null;
  webauthnUserId: string;
}

export interface PlannedInsert {
  key: string;
  legacyId: number;
  values: UserValues;
}

export interface UsersPlan {
  inserts: PlannedInsert[];
  unchanged: number;
  skipped: RowIssue[];
  warnings: RowIssue[];
}

/** Target-side operations; Kysely in production, an in-memory fake in specs. */
export interface UsersRepository {
  listExisting(): Promise<ExistingUser[]>;
  /** operator_groups.id by name (case-insensitive), or null. */
  groupIdByName(name: string): Promise<number | null>;
  /** Inserts unless a unique key (username / email) is already taken; returns the new id or null. */
  insertIfAbsent(values: UserValues): Promise<number | null>;
}

export class KyselyUsersRepository implements UsersRepository {
  constructor(private readonly db: Kysely<DB>) {}

  listExisting(): Promise<ExistingUser[]> {
    return this.db
      .selectFrom('users')
      .select(['id', 'username', 'passwordHash', 'role', 'extension', 'email', 'webauthnUserId'])
      .orderBy('id')
      .execute();
  }

  async groupIdByName(name: string): Promise<number | null> {
    const row = await this.db
      .selectFrom('operatorGroups')
      .select('id')
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async insertIfAbsent(values: UserValues): Promise<number | null> {
    const row = await this.db
      .insertInto('users')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? null;
  }
}

function rowKey(id: unknown, username: unknown): string {
  const name = typeof username === 'string' ? username.trim().slice(0, 40) : '?';
  return `#${typeof id === 'number' ? id : '?'} ${name}`;
}

/** Pure: one legacy row → insert values or a skip reason. Never throws. */
export function transformLegacyUser(raw: SqliteRow): TransformResult {
  return transformLegacyUserWith(raw, {});
}

export function transformLegacyUserWith(raw: SqliteRow, opts: TransformOptions): TransformResult {
  const parsed = LegacyUserRowSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const legacyId = typeof raw.id === 'number' ? raw.id : null;
    return { ok: false, key: rowKey(raw.id, raw.username), legacyId, reason: `unreadable legacy row (${issues})` };
  }
  const row = parsed.data;
  const key = rowKey(row.id, row.username);
  const skip = (reason: string): TransformResult => ({ ok: false, key, legacyId: row.id, reason });
  const warnings: string[] = [];

  const username = row.username.trim();
  if (!username) return skip('empty username');
  if (username !== row.username) warnings.push('username had surrounding whitespace; trimmed');
  if (!UsernameSchema.safeParse(username).success) {
    warnings.push('username does not match the new username rules (3-32 chars of [a-zA-Z0-9_.-]); kept as is');
  }

  const role = RoleSchema.safeParse(row.role?.trim().toLowerCase());
  if (!role.success) {
    return skip(`unknown role ${JSON.stringify(row.role?.slice(0, 32) ?? null)}`);
  }

  if (!HASH_RE.test(row.password_hash)) {
    return skip(`password_hash is not 128 hex chars (length ${row.password_hash.length})`);
  }
  // The salt is used as the text it is stored as (never decoded or re-cased), see password-hasher.ts.
  if (!SALT_RE.test(row.salt)) {
    return skip(`salt is not 32 hex chars (length ${row.salt.length})`);
  }
  const passwordHash = fromLegacy(row.salt, row.password_hash.toLowerCase());

  let email = row.email?.trim().toLowerCase() || null;
  if (email && !LEGACY_EMAIL_RE.test(email)) {
    warnings.push('email is not a valid address; imported without email');
    email = null;
  }

  let extension = row.operator_id?.trim() || null;
  if (extension && !ExtensionSchema.safeParse(extension).success) {
    warnings.push(
      `operator_id ${JSON.stringify(extension.slice(0, 16))} is not a 2-6 digit extension; imported without extension`,
    );
    extension = null;
  }
  if (role.data === 'operator' && !extension) warnings.push('operator has no extension');

  if (SHARED_PASSWORD_USERNAME_RE.test(username)) {
    warnings.push('created by legacy scripts/create_200.js with a shared password; force a password reset at cutover');
  }

  const values: UserValues = { username, passwordHash, role: role.data, extension, email };

  const handle = row.webauthn_user_id?.trim().toLowerCase();
  if (handle && UUID_RE.test(handle)) values.webauthnUserId = handle;
  else if (handle) {
    warnings.push("webauthn_user_id is not a UUID; a new one is generated, so this user's passkeys cannot be migrated");
  }

  if (role.data === 'operator' && extension && Number(extension) >= 200 && opts.restrictedGroupId) {
    values.groupId = opts.restrictedGroupId;
  }
  const createdAt = parseLegacyLocalTime(row.created_at);
  const updatedAt = parseLegacyLocalTime(row.updated_at);
  if (createdAt) values.createdAt = createdAt;
  else if (row.created_at?.trim()) warnings.push('created_at is not a recognised timestamp; set to now');
  if (updatedAt) values.updatedAt = updatedAt;

  return { ok: true, key, legacyId: row.id, values, warnings };
}

function differingFields(values: UserValues, existing: ExistingUser): string[] {
  const fields: string[] = [];
  if (values.passwordHash !== existing.passwordHash) fields.push('password');
  if (values.role !== existing.role) fields.push('role');
  if (values.extension !== existing.extension) fields.push('extension');
  if ((values.email ?? null) !== (existing.email?.toLowerCase() ?? null)) fields.push('email');
  return fields;
}

/**
 * Pure: decides insert / unchanged / skip for every row, given what the new database already has.
 * Rows are processed in legacy id order, so on a case-insensitive username clash or a duplicate
 * email the oldest legacy account wins.
 */
export function planUsers(results: readonly TransformResult[], existing: readonly ExistingUser[]): UsersPlan {
  const plan: UsersPlan = { inserts: [], unchanged: 0, skipped: [], warnings: [] };
  const existingByUsername = new Map(existing.map((u) => [u.username.toLowerCase(), u]));
  /** lower(email) → who holds it (an existing user, or a legacy row planned for insert). */
  const emailOwners = new Map<string, { label: string; userId: number | null }>();
  for (const u of existing) {
    if (u.email) emailOwners.set(u.email.toLowerCase(), { label: `users.id ${u.id} (${u.username})`, userId: u.id });
  }
  const seenUsernames = new Map<string, string>();
  const handleOwners = new Map(
    existing.map((u) => [u.webauthnUserId.toLowerCase(), `users.id ${u.id} (${u.username})`]),
  );

  const order = (r: TransformResult) => r.legacyId ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...results].sort((a, b) => order(a) - order(b));
  for (const r of sorted) {
    if (!r.ok) {
      plan.skipped.push({ key: r.key, reason: r.reason });
      continue;
    }
    for (const w of r.warnings) plan.warnings.push({ key: r.key, reason: w });

    const lower = r.values.username.toLowerCase();
    const clash = seenUsernames.get(lower);
    if (clash) {
      plan.skipped.push({ key: r.key, reason: `username clashes case-insensitively with legacy user ${clash}` });
      continue;
    }
    seenUsernames.set(lower, r.key);

    const current = existingByUsername.get(lower);
    if (current) {
      plan.unchanged++;
      // An email held by another user would have been dropped on insert, so it is not a difference.
      const owner = r.values.email ? emailOwners.get(r.values.email) : undefined;
      const expected = owner && owner.userId !== current.id ? { ...r.values, email: null } : r.values;
      const diff = differingFields(expected, current);
      if (diff.length > 0) {
        plan.warnings.push({
          key: r.key,
          reason: `already exists as users.id ${current.id}; left untouched (differs: ${diff.join(', ')})`,
        });
      }
      continue;
    }

    const values = { ...r.values };
    if (values.webauthnUserId) {
      const owner = handleOwners.get(values.webauthnUserId);
      if (owner) {
        plan.warnings.push({
          key: r.key,
          reason: `webauthn_user_id already belongs to ${owner}; a new one is generated (passkeys of this user cannot be migrated)`,
        });
        delete values.webauthnUserId;
      } else {
        handleOwners.set(values.webauthnUserId, `legacy user ${r.key}`);
      }
    }
    if (values.email) {
      const owner = emailOwners.get(values.email);
      if (owner) {
        plan.warnings.push({ key: r.key, reason: `email already belongs to ${owner.label}; imported without email` });
        values.email = null;
      } else {
        emailOwners.set(values.email, { label: `legacy user ${r.key}`, userId: null });
      }
    }
    plan.inserts.push({ key: r.key, legacyId: r.legacyId, values });
  }
  return plan;
}

export function createUsersMapper(
  repositoryFor: (db: Kysely<DB>) => UsersRepository = (db) => new KyselyUsersRepository(db),
): Mapper {
  const meta = { name: 'users', owner: 'S1' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('auth_users')) {
        report.status = 'source-missing';
        report.notes.push(sqlite ? 'legacy table auth_users not found' : '--sqlite not given');
        return report;
      }

      const rows = sqlite.all('SELECT * FROM auth_users ORDER BY id');
      report.read = rows.length;
      const repo = repositoryFor(ctx.db);
      const restrictedGroupId = await repo.groupIdByName(RESTRICTED_GROUP_NAME);
      if (!restrictedGroupId) {
        report.notes.push(
          `operator group "${RESTRICTED_GROUP_NAME}" not found; operators 200+ are imported without a group`,
        );
      }
      const plan = planUsers(
        rows.map((row) => transformLegacyUserWith(row, { restrictedGroupId })),
        await repo.listExisting(),
      );
      report.skipped = plan.skipped;
      report.warnings = plan.warnings;
      report.unchanged = plan.unchanged;

      if (ctx.dryRun) {
        report.inserted = plan.inserts.length;
      } else {
        for (const item of plan.inserts) {
          const id = await repo.insertIfAbsent(item.values);
          if (id === null) {
            report.unchanged++;
            report.warnings.push({
              key: item.key,
              reason: 'username or email was taken while migrating; left untouched',
            });
          } else {
            report.inserted++;
          }
        }
      }

      report.notes.push(
        'legacy ids are not kept (users.id is an identity column); later mappers resolve users by username',
      );
      const withHandle = plan.inserts.filter((i) => i.values.webauthnUserId).length;
      report.notes.push(
        `${withHandle} of ${plan.inserts.length} inserted users keep their legacy passkey handle (webauthn_user_id)`,
      );
      const grouped = plan.inserts.filter((i) => i.values.groupId).length;
      if (grouped > 0)
        report.notes.push(`${grouped} operators with extension >= 200 put into "${RESTRICTED_GROUP_NAME}"`);
      return report;
    },
  };
}

export const usersMapper = createUsersMapper();
