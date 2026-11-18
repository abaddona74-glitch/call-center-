import { ExtensionSchema, normalizeExtensions } from '@cc/shared';
import { sql } from 'kysely';
import '../../../modules/excluded-operators/excluded-operators.tables.js';
import { emptyReport, errorMessage, type Mapper, type RowIssue } from '../mapper.js';

/**
 * Legacy `system_settings.excluded_operators` (JSON array of extensions, prod: ["118","1111"]) → the
 * `excluded_operators` row of the new system (owner: S11; owner decision 2026-11-18).
 *
 * Idempotency: legacy extensions are added to the list, nothing is removed. Once someone has saved the list
 * in the new system (`updated_by_user_id` is set) the mapper leaves it alone and warns about the legacy
 * numbers it did not add. A running API picks the new list up when the settings screen is opened or on restart.
 */

const KEY = 'excluded_operators';

export interface LegacyExcluded {
  /** Valid extensions in legacy order (may repeat). */
  extensions: string[];
  /** Entries that are not 2–6 digit extensions. */
  skipped: RowIssue[];
  /** Number of entries in the legacy array. */
  read: number;
}

/** Parses the legacy value like authService.getExcludedOperators (String(x).trim()); throws on bad JSON. */
export function parseLegacyExcluded(raw: string): LegacyExcluded {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error(`${KEY} is not a JSON array`);
  const result: LegacyExcluded = { extensions: [], skipped: [], read: value.length };
  value.forEach((item, i) => {
    const text = typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '';
    const parsed = ExtensionSchema.safeParse(text);
    if (parsed.success) result.extensions.push(parsed.data);
    else result.skipped.push({ key: `${KEY}[${i}]`, reason: 'not a 2–6 digit extension' });
  });
  return result;
}

export interface ExcludedPlan {
  /** The list to store, or null when nothing changes. */
  next: string[] | null;
  added: string[];
  /** Legacy extensions already in the list. */
  present: string[];
  /** Legacy extensions left out because the list was edited in the new system. */
  notAdded: string[];
}

export function planExcluded(
  current: { extensions: readonly string[]; editedInNewSystem: boolean },
  legacy: readonly string[],
): ExcludedPlan {
  const have = new Set(current.extensions);
  const wanted = normalizeExtensions(legacy);
  const present = wanted.filter((e) => have.has(e));
  const missing = wanted.filter((e) => !have.has(e));
  if (current.editedInNewSystem || missing.length === 0) {
    return { next: null, added: [], present, notAdded: current.editedInNewSystem ? missing : [] };
  }
  return { next: normalizeExtensions([...current.extensions, ...missing]), added: missing, present, notAdded: [] };
}

export function createExcludedOperatorsMapper(): Mapper {
  const meta = { name: 'excluded-operators', owner: 'S11' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('system_settings')) {
        report.status = 'source-missing';
        report.notes.push(sqlite ? 'legacy table system_settings not found' : '--sqlite not given');
        return report;
      }

      const row = sqlite.all('SELECT value FROM system_settings WHERE key = ?', KEY)[0];
      const raw = row?.value == null ? '' : String(row.value).trim();
      if (!raw) {
        report.notes.push(`system_settings.${KEY} is not set: nothing to migrate`);
        return report;
      }
      let legacy: LegacyExcluded;
      try {
        legacy = parseLegacyExcluded(raw);
      } catch (err) {
        report.status = 'failed';
        report.errors.push({ key: KEY, reason: `unreadable value: ${errorMessage(err)}` });
        return report;
      }
      report.read = legacy.read;
      report.skipped = legacy.skipped;

      const current = await ctx.db
        .selectFrom('excludedOperators')
        .select(['extensions', 'updatedByUserId'])
        .where('id', '=', 1)
        .executeTakeFirst();
      if (!current) {
        report.status = 'failed';
        report.errors.push({ key: KEY, reason: 'excluded_operators row is missing: run the database migrations' });
        return report;
      }
      const plan = planExcluded(
        { extensions: current.extensions, editedInNewSystem: current.updatedByUserId !== null },
        legacy.extensions,
      );
      report.unchanged = plan.present.length;
      for (const ext of plan.notAdded) {
        report.warnings.push({ key: ext, reason: 'the list was already edited in the new system; not added' });
      }
      if (plan.next) {
        report.inserted = plan.added.length;
        if (!ctx.dryRun) {
          await ctx.db
            .updateTable('excludedOperators')
            .set({ extensions: sql<string[]>`${sql.val(plan.next)}::text[]`, updatedAt: sql<Date>`now()` })
            .where('id', '=', 1)
            .execute();
        }
        report.notes.push(`${ctx.dryRun ? 'would add' : 'added'}: ${plan.added.join(', ')}`);
      }
      report.notes.push('restart the API (or open Settings → Statistika & Exclude List) to apply a changed list');
      return report;
    },
  };
}

export const excludedOperatorsMapper = createExcludedOperatorsMapper();
