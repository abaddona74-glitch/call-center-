import { z } from 'zod';
import { RoleSchema } from './auth.js';

/**
 * "Who is online" (legacy header presence widget; owner decision: keep the list, drop the cursors).
 * One entry per user (several tabs/devices are merged). Visible to roles with telephonyAccess().seeAll.
 */
export const OnlineUserSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  role: RoleSchema,
  extension: z.string().nullable(),
  /** Page path of the most recently active tab, e.g. "/operators" (from the client's `presence.ping`). */
  tab: z.string().nullable(),
  /** At least one of the user's tabs is in the foreground. */
  visible: z.boolean(),
  connections: z.number().int(),
  connectedAt: z.string(),
  lastActiveAt: z.string(),
});
export type OnlineUser = z.infer<typeof OnlineUserSchema>;

export const OnlineUsersSchema = z.array(OnlineUserSchema);
