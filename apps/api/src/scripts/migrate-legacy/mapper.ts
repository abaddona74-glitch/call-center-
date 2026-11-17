import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../database/db.js';
import type { LegacySources } from './legacy-sources.js';

/** Where the CLI sends progress messages (console in main.ts, a fake in tests). */
export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface MigrationContext {
  legacy: LegacySources;
  /**
   * A transaction owned by the runner: committed when the mapper finishes without errors,
   * rolled back otherwise. In dry-run it is a READ ONLY transaction that is always rolled back.
   */
  db: Kysely<DB>;
  /** When true the mapper must not write — only read and plan. */
  dryRun: boolean;
  logger: MigrationLogger;
}

export const MAPPER_STATUSES = ['ok', 'not-implemented', 'source-missing', 'failed'] as const;
export type MapperStatus = (typeof MAPPER_STATUSES)[number];

/** `key` identifies the legacy row (e.g. `#7 op101`); never put secrets or emails into it. */
export const RowIssueSchema = z.object({ key: z.string(), reason: z.string() });
export type RowIssue = z.infer<typeof RowIssueSchema>;

export const MapperReportSchema = z.object({
  name: z.string(),
  owner: z.string(),
  status: z.enum(MAPPER_STATUSES),
  /** Legacy rows read from the source. */
  read: z.number().int().nonnegative(),
  /** Rows inserted (dry-run: would insert). */
  inserted: z.number().int().nonnegative(),
  /** Rows updated (dry-run: would update). */
  updated: z.number().int().nonnegative(),
  /** Rows already present in the new database and left as they are (idempotent re-run). */
  unchanged: z.number().int().nonnegative(),
  /** Rows deliberately not migrated, with the reason. */
  skipped: z.array(RowIssueSchema),
  /** Rows migrated with an adjustment someone should know about (e.g. email dropped as duplicate). */
  warnings: z.array(RowIssueSchema),
  /** Failures. Any error makes the runner roll back this mapper's transaction and exit non-zero. */
  errors: z.array(RowIssueSchema),
  /** Free-form notes: unmapped legacy columns, source row counts, rollbacks. */
  notes: z.array(z.string()),
});
export type MapperReport = z.infer<typeof MapperReportSchema>;

export interface Mapper {
  /** Used by `--only`; kebab-case. */
  name: string;
  /** Session that owns the target tables (see docs/rewrite/ROADMAP.md). */
  owner: string;
  run(ctx: MigrationContext): Promise<MapperReport>;
}

export function emptyReport(mapper: Pick<Mapper, 'name' | 'owner'>, status: MapperStatus = 'ok'): MapperReport {
  return {
    name: mapper.name,
    owner: mapper.owner,
    status,
    read: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    warnings: [],
    errors: [],
    notes: [],
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
