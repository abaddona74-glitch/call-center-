import { normalizeUzPhone } from '@cc/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import { astdbKeys } from '../../../modules/blacklist/domain/astdb.js';
import type { SqliteRow } from '../legacy-sources.js';
import { emptyReport, type Mapper, type RowIssue } from '../mapper.js';
import { parseLegacyUtcTime } from '../time.js';

/**
 * Legacy `blacklist` → `blocked_numbers` (docs/rewrite/legacy/data.md §1.1.18, §4, §5.1; owner S4).
 *
 * Despite its name the legacy table is the personal block list of extension 114 (AstDB family
 * `blacklist_114`), so rows become `scope = operator, extension = 114`.
 * - `number` → `normalizeUzPhone`; `variants` are recomputed (`astdbKeys`, the same forms the module writes).
 * - `note` (≤ 200 chars, control characters removed); `created_at` / `updated_at` are SQLite UTC.
 * - `sync_state = pending`: the blacklist module writes the entries to AstDB through AMI (idempotent — legacy
 *   already put them there). This CLI never talks to the PBX.
 * Idempotency: insert-if-absent by (number, scope, extension). Rows are keyed by rowid; numbers are not printed.
 */

export const LEGACY_BLACKLIST_EXTENSION = '114';
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL = /[\u0000-\u001F\u007F]/g;

const LegacyBlacklistRowSchema = z.object({
  rowid: z.number().int(),
  number: z.union([z.string(), z.number()]).transform(String),
  note: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

export interface BlockedNumberValues {
  number: string;
  variants: string[];
  note: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BlacklistTransformResult =
  | { ok: true; key: string; values: BlockedNumberValues; warnings: string[] }
  | { ok: false; key: string; reason: string };

/** Pure: one legacy row (with its rowid) → insert values or a skip reason. */
export function transformLegacyBlocked(raw: SqliteRow): BlacklistTransformResult {
  const key = `#${typeof raw.rowid === 'number' ? raw.rowid : '?'}`;
  const parsed = LegacyBlacklistRowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, key, reason: 'unreadable legacy row' };
  const row = parsed.data;
  const number = normalizeUzPhone(row.number);
  if (!number)
    return { ok: false, key, reason: `number is not usable (${row.number.replace(/\D/g, '').length} digits)` };
  const warnings: string[] = [];
  let note = (row.note ?? '').replace(CONTROL, ' ').trim();
  if (note.length > 200) {
    note = note.slice(0, 200);
    warnings.push('note longer than 200 chars; truncated');
  }
  const values: BlockedNumberValues = { number, variants: astdbKeys(number), note };
  const createdAt = parseLegacyUtcTime(row.created_at);
  const updatedAt = parseLegacyUtcTime(row.updated_at);
  if (createdAt) values.createdAt = createdAt;
  if (updatedAt) values.updatedAt = updatedAt;
  return { ok: true, key, values, warnings };
}

export interface BlacklistRepository {
  /** Numbers already blocked for the extension. */
  existingNumbers(extension: string): Promise<Set<string>>;
  insertIfAbsent(values: BlockedNumberValues, extension: string): Promise<boolean>;
}

export class KyselyBlacklistRepository implements BlacklistRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async existingNumbers(extension: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('blockedNumbers')
      .select('number')
      .where('scope', '=', 'operator')
      .where('extension', '=', extension)
      .execute();
    return new Set(rows.map((r) => r.number));
  }

  async insertIfAbsent(values: BlockedNumberValues, extension: string): Promise<boolean> {
    const row = await this.db
      .insertInto('blockedNumbers')
      .values({
        ...values,
        variants: sql<string[]>`${sql.val(values.variants)}::text[]`,
        scope: 'operator',
        extension,
        createdByUserId: null,
        createdByLabel: 'legacy import',
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    return Boolean(row);
  }
}

export function createBlacklistMapper(
  repositoryFor: (db: Kysely<DB>) => BlacklistRepository = (db) => new KyselyBlacklistRepository(db),
): Mapper {
  const meta = { name: 'blacklist', owner: 'S4' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('blacklist')) {
        report.status = 'source-missing';
        report.notes.push(sqlite ? 'legacy table blacklist not found' : '--sqlite not given');
        return report;
      }
      const rows = sqlite.all('SELECT rowid, * FROM blacklist ORDER BY rowid');
      report.read = rows.length;
      const ext = LEGACY_BLACKLIST_EXTENSION;
      const repo = repositoryFor(ctx.db);
      const existing = await repo.existingNumbers(ext);
      const planned: { key: string; values: BlockedNumberValues }[] = [];
      const seen = new Map<string, string>();
      for (const r of rows.map(transformLegacyBlocked)) {
        if (!r.ok) {
          report.skipped.push({ key: r.key, reason: r.reason });
          continue;
        }
        const dup = seen.get(r.values.number);
        if (dup) {
          report.skipped.push({ key: r.key, reason: `same number as legacy row ${dup} after normalising` });
          continue;
        }
        seen.set(r.values.number, r.key);
        if (existing.has(r.values.number)) {
          report.unchanged++;
          continue;
        }
        report.warnings.push(...r.warnings.map((reason): RowIssue => ({ key: r.key, reason })));
        planned.push(r);
      }
      if (ctx.dryRun) report.inserted = planned.length;
      else {
        for (const p of planned) {
          if (await repo.insertIfAbsent(p.values, ext)) report.inserted++;
          else report.unchanged++;
        }
      }
      report.notes.push(
        `rows go to the personal block list of extension ${ext} (sync_state pending: the API writes them to AstDB)`,
      );
      return report;
    },
  };
}

export const blacklistMapper = createBlacklistMapper();
