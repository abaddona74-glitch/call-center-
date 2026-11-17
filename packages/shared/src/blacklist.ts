import { z } from 'zod';
import { UzPhoneInputSchema } from './callbacks.js';
import { ExtensionSchema } from './auth.js';

/**
 * Blocked caller numbers, applied to Asterisk AstDB through AMI (DBPut/DBDel):
 *  - `global`   → family `blacklist` (FreePBX blacklist: nobody receives the call);
 *  - `operator` → family `blacklist_<ext>` (the PBX dialplan skips that operator only, legacy `blacklist_114`).
 * The two scopes are independent: adding/removing one never touches the other.
 */

export const BLACKLIST_SCOPES = ['global', 'operator'] as const;
export const BlacklistScopeSchema = z.enum(BLACKLIST_SCOPES);
export type BlacklistScope = z.infer<typeof BlacklistScopeSchema>;

/** synced = AstDB matches; pending = waiting for AMI; error = last AMI attempt failed; removing = delete not yet applied. */
export const BLACKLIST_SYNC_STATES = ['synced', 'pending', 'error', 'removing'] as const;
export const BlacklistSyncStateSchema = z.enum(BLACKLIST_SYNC_STATES);
export type BlacklistSyncState = z.infer<typeof BlacklistSyncStateSchema>;

const IsoDateTime = z.iso.datetime({ offset: true });

export const BlockedNumberSchema = z.object({
  id: z.number().int(),
  /** Normalized national number. */
  number: z.string(),
  /** AstDB keys written for it (e.g. 901234567 and 998901234567). */
  variants: z.array(z.string()),
  scope: BlacklistScopeSchema,
  extension: z.string().nullable(),
  note: z.string(),
  syncState: BlacklistSyncStateSchema,
  syncError: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BlockedNumber = z.infer<typeof BlockedNumberSchema>;

export const BlacklistResponseSchema = z.object({
  items: z.array(BlockedNumberSchema),
  amiConnected: z.boolean(),
  /** Extensions that have a personal block list in the PBX dialplan (configured on the server). */
  operatorExtensions: z.array(z.string()),
});
export type BlacklistResponse = z.infer<typeof BlacklistResponseSchema>;

export const AddBlockedNumberRequestSchema = z
  .object({
    number: UzPhoneInputSchema,
    note: z
      .string()
      .trim()
      .max(200)
      .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), 'Control characters are not allowed')
      .default(''),
    scope: BlacklistScopeSchema.default('operator'),
    extension: ExtensionSchema.nullable().default(null),
  })
  .refine((b) => (b.scope === 'operator' ? b.extension !== null : b.extension === null), {
    message: 'extension is required for scope "operator" and not allowed for "global"',
    path: ['extension'],
  });
export type AddBlockedNumberRequest = z.input<typeof AddBlockedNumberRequestSchema>;
export type AddBlockedNumberRequestParsed = z.infer<typeof AddBlockedNumberRequestSchema>;

export const BlacklistSyncResultSchema = z.object({
  applied: z.number().int(),
  failed: z.number().int(),
  amiConnected: z.boolean(),
});
export type BlacklistSyncResult = z.infer<typeof BlacklistSyncResultSchema>;
