/**
 * Excluded operators: pure rules (no Nest, no DB). What legacy did with `excluded_operators`
 * (docs/rewrite/legacy/telephony.md, data.md §1.1.11):
 *  - the operators board skipped them (amiService.ensureOperatorExists / getOperatorList, dashboard.js);
 *  - the per-operator statistics rows skipped them (issabelDbService.fetchOperatorStats / syncAllData),
 *    and so did the Excel report (exportService);
 *  - totals (KPI, hourly charts, call history) were NOT filtered — their calls still count there.
 */
import { type ExcludedOperatorChoice, compareExtensions } from '@cc/shared';

/** Rows whose extension is not excluded (same order). */
export function withoutExcluded<T>(rows: readonly T[], excluded: ReadonlySet<string>, ext: (row: T) => string): T[] {
  if (excluded.size === 0) return [...rows];
  return rows.filter((r) => !excluded.has(ext(r)));
}

/** Directory entries worth offering: digits only (legacy `extension REGEXP '^[0-9]+$'`). */
const DIRECTORY_EXTENSION = /^[0-9]{2,6}$/;

/**
 * Checkboxes of the settings screen (legacy GET /api/settings/exclude-list): every PBX extension with its
 * name, plus excluded extensions the PBX does not know (legacy example: 118), sorted by number.
 */
export function buildChoices(
  directory: ReadonlyArray<{ extension: string; name: string | null }>,
  excluded: readonly string[],
): ExcludedOperatorChoice[] {
  const excludedSet = new Set(excluded);
  const byExt = new Map<string, ExcludedOperatorChoice>();
  for (const entry of directory) {
    const extension = entry.extension.trim();
    if (!DIRECTORY_EXTENSION.test(extension) || byExt.has(extension)) continue;
    const name = entry.name?.trim() || null;
    byExt.set(extension, { extension, name, excluded: excludedSet.has(extension) });
  }
  for (const extension of excluded) {
    if (!byExt.has(extension)) byExt.set(extension, { extension, name: null, excluded: true });
  }
  return [...byExt.values()].sort((a, b) => compareExtensions(a.extension, b.extension));
}

/** What changed, for the audit log. */
export function diffExtensions(before: readonly string[], after: readonly string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter((e) => !was.has(e)),
    removed: before.filter((e) => !now.has(e)),
  };
}
