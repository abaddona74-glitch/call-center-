import { z } from 'zod';
import { IsoDateSchema } from './common.js';

/**
 * Login protection settings and lockouts (/api/security), audit log viewer (/api/audit).
 *
 * Login protection (see apps/api/src/modules/auth/domain/login-throttle.ts):
 *  - username+IP: after `maxAttempts` failures that pair is locked for `lockoutMinutes`,
 *    doubling on every repeated lockout up to 24 h;
 *  - IP: after `ipMaxAttempts` failures (any usernames) the IP is locked the same way;
 *  - username alone (any IP): never locked, only slowed down (a few seconds between attempts),
 *    so nobody can lock a user out from other addresses.
 */
export const LockoutSettingsSchema = z.object({
  maxAttempts: z.number().int().min(3).max(10),
  lockoutMinutes: z.number().int().min(1).max(1440),
  ipMaxAttempts: z.number().int().min(5).max(500),
});
export type LockoutSettings = z.infer<typeof LockoutSettingsSchema>;

export const DEFAULT_LOCKOUT_SETTINGS: LockoutSettings = { maxAttempts: 5, lockoutMinutes: 15, ipMaxAttempts: 30 };

export const LockoutKindSchema = z.enum(['user_ip', 'ip', 'user']);
export type LockoutKind = z.infer<typeof LockoutKindSchema>;

export const LockoutEntrySchema = z.object({
  id: z.number().int(),
  kind: LockoutKindSchema,
  username: z.string().nullable(),
  ip: z.string().nullable(),
  failures: z.number().int(),
  lockedUntil: z.iso.datetime(),
  lastFailureAt: z.iso.datetime(),
});
export type LockoutEntry = z.infer<typeof LockoutEntrySchema>;

export const LockoutListSchema = z.object({ items: z.array(LockoutEntrySchema) });
export type LockoutList = z.infer<typeof LockoutListSchema>;

export const UnlockResultSchema = z.object({ unlocked: z.number().int() });
export type UnlockResult = z.infer<typeof UnlockResultSchema>;

// --- Audit log ------------------------------------------------------------------------

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  at: z.iso.datetime(),
  actorUserId: z.number().int().nullable(),
  actorLabel: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  details: z.unknown().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z.object({
  /** Exact action, or a prefix ending with "." / "*" (e.g. "auth." or "users.*"). */
  action: z.string().trim().max(100).optional(),
  /** Actor username (case-insensitive substring). */
  actor: z.string().trim().max(64).optional(),
  /** Free-text search in target. */
  target: z.string().trim().max(100).optional(),
  /** Calendar dates in Asia/Tashkent, inclusive. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof AuditQuerySchema>;

export const AuditPageSchema = z.object({
  items: z.array(AuditEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type AuditPage = z.infer<typeof AuditPageSchema>;

export const AuditActionsSchema = z.object({ items: z.array(z.string()) });
export type AuditActions = z.infer<typeof AuditActionsSchema>;
