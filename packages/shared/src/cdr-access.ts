import type { Role } from './auth.js';
import { type Permission, hasPermission } from './permissions.js';

/**
 * Everything the call history / statistics / export features require — in ONE place, by capability name,
 * mapped to a permission (role → permission lives in ROLE_PERMISSIONS, permissions.ts).
 * Legacy parity: operators could read call lists and the per-operator table but never recordings,
 * history/statistics screens or the Excel export.
 * API: `@RequirePermission(CDR_ACCESS['stats.read'])`; web: `canAccessCdr(user, 'stats.read')`.
 */
export const CDR_ACCESS = {
  /** GET /api/cdr/calls, /api/cdr/calls/:id */
  'calls.read': 'monitor.view',
  /** Recording file names in call lists. */
  'calls.recordings': 'recordings.listen',
  /** The History screen. */
  'history.page': 'reports.view',
  /** Summary, hourly/daily series, top clients; the Statistics screen. */
  'stats.read': 'reports.view',
  /** Per-operator table (GET /api/stats/operators). */
  'stats.operators': 'monitor.view',
  /** GET /api/export/excel */
  'reports.export': 'reports.view',
} as const satisfies Record<string, Permission>;

export type CdrCapability = keyof typeof CDR_ACCESS;

export function canAccessCdr(
  user: { role: Role; permissions?: readonly Permission[] | null },
  capability: CdrCapability,
): boolean {
  return hasPermission(user, CDR_ACCESS[capability]);
}
