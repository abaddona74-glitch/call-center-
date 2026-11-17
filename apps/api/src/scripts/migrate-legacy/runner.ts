import type { Kysely } from 'kysely';
import type { DB } from '../../database/db.js';
import type { LegacySources } from './legacy-sources.js';
import { emptyReport, errorMessage, type Mapper, type MapperReport, type MigrationLogger } from './mapper.js';

/** One transaction per mapper. */
export interface UnitOfWork {
  db: Kysely<DB>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export type BeginUnitOfWork = (opts: { readOnly: boolean }) => Promise<UnitOfWork>;

/** Dry-run transactions are READ ONLY, so Postgres itself rejects any accidental write. */
export function kyselyUnitOfWork(db: Kysely<DB>): BeginUnitOfWork {
  return async ({ readOnly }) => {
    const trx = await db
      .startTransaction()
      .setAccessMode(readOnly ? 'read only' : 'read write')
      .execute();
    return { db: trx, commit: () => trx.commit().execute(), rollback: () => trx.rollback().execute() };
  };
}

/** Audit trail entry for a mapper run that changed rows (CONVENTIONS: user changes are audited). */
export async function recordMigrationAudit(db: Kysely<DB>, report: MapperReport): Promise<void> {
  await db
    .insertInto('auditLog')
    .values({
      actorUserId: null,
      actorLabel: 'migrate-legacy',
      action: `migration.legacy.${report.name}`,
      target: null,
      details: JSON.stringify({
        read: report.read,
        inserted: report.inserted,
        updated: report.updated,
        unchanged: report.unchanged,
        skipped: report.skipped.length,
        warnings: report.warnings.length,
      }),
      ip: null,
      requestId: null,
    })
    .execute();
}

export interface RunOptions {
  legacy: LegacySources;
  begin: BeginUnitOfWork;
  dryRun: boolean;
  logger: MigrationLogger;
  /** Runs inside the mapper's transaction after a real run that inserted or updated rows. */
  audit?: (db: Kysely<DB>, report: MapperReport) => Promise<void>;
}

/** Keeps the run order of `all`; `only` comes from `--only` (already validated). */
export function selectMappers(all: readonly Mapper[], only?: readonly string[]): Mapper[] {
  return only ? all.filter((m) => only.includes(m.name)) : [...all];
}

/**
 * Runs mappers one by one, each in its own transaction. A mapper that throws or reports errors is
 * rolled back as a whole (status `failed`); the others still run. Dry-run always rolls back.
 */
export async function runMappers(mappers: readonly Mapper[], opts: RunOptions): Promise<MapperReport[]> {
  const reports: MapperReport[] = [];
  for (const mapper of mappers) {
    opts.logger.info(`… ${mapper.name}`);
    const uow = await opts.begin({ readOnly: opts.dryRun });
    let report: MapperReport;
    try {
      report = await mapper.run({ legacy: opts.legacy, db: uow.db, dryRun: opts.dryRun, logger: opts.logger });
      if (!opts.dryRun && report.errors.length === 0 && report.inserted + report.updated > 0) {
        await opts.audit?.(uow.db, report);
      }
    } catch (err) {
      report = { ...emptyReport(mapper, 'failed'), errors: [{ key: mapper.name, reason: errorMessage(err) }] };
    }

    if (report.errors.length > 0) report.status = 'failed';
    if (opts.dryRun || report.errors.length > 0) {
      try {
        await uow.rollback();
      } catch (err) {
        report.errors.push({ key: mapper.name, reason: `rollback failed: ${errorMessage(err)}` });
      }
      if (!opts.dryRun) report.notes.push('transaction rolled back — nothing from this mapper was written');
    } else {
      try {
        await uow.commit();
      } catch (err) {
        report.status = 'failed';
        report.errors.push({ key: mapper.name, reason: `commit failed: ${errorMessage(err)}` });
      }
    }
    reports.push(report);
  }
  return reports;
}

/** 0 = clean (skips, warnings and not-implemented stubs are not failures), 1 = something failed. */
export function exitCodeFor(reports: readonly MapperReport[]): number {
  return reports.some((r) => r.status === 'failed' || r.errors.length > 0) ? 1 : 0;
}
