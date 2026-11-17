import { hasRoleAtLeast, type Role } from './auth.js';

/**
 * Everything the call history / statistics / export features require — in ONE place, by capability name.
 *
 * Today each capability maps to a minimum role, with legacy parity: operators could read call lists and the
 * per-operator table (viewer → /api/calls/details, /api/operators) but never recordings, history/statistics
 * screens or the Excel export. Owner decision 2026-11-17: roles become superuser / executive / observer / operator
 * with permission-based checks — when that lands, change only `CDR_ACCESS` / `canAccessCdr` (API guards use
 * `CDR_ACCESS[...]`, the web uses `canAccessCdr`).
 */
export const CDR_ACCESS = {
  /** GET /api/cdr/calls, /api/cdr/calls/:id */
  'calls.read': 'operator',
  /** Recording file names in call lists. */
  'calls.recordings': 'admin',
  /** The History screen. */
  'history.page': 'admin',
  /** Summary, hourly/daily series, top clients; the Statistics screen. */
  'stats.read': 'admin',
  /** Per-operator table (GET /api/stats/operators). */
  'stats.operators': 'operator',
  /** GET /api/export/excel */
  'reports.export': 'admin',
} as const satisfies Record<string, Role>;

export type CdrCapability = keyof typeof CDR_ACCESS;

export function canAccessCdr(user: { role: Role }, capability: CdrCapability): boolean {
  return hasRoleAtLeast(user.role, CDR_ACCESS[capability]);
}
