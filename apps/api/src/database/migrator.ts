import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { FileMigrationProvider, type MigrationResultSet, Migrator } from 'kysely/migration';

/**
 * Migrations live in `src/database/migrations/`.
 * File name: `YYYYMMDDHHmm_<module>_<what>.ts` (UTC timestamp) — sorting is by name,
 * timestamps keep files from parallel branches from colliding.
 * Each file exports `up(db: Kysely<any>)` and `down(db: Kysely<any>)`.
 * Never edit a migration that already ran on production — add a new one.
 */
export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dirname, 'migrations'),
    }),
    migrationTableName: 'kysely_migration',
    migrationLockTableName: 'kysely_migration_lock',
  });
}

export function assertMigrationsOk({ error, results }: MigrationResultSet, log: (msg: string) => void): void {
  for (const r of results ?? []) {
    log(`migration ${r.direction} ${r.migrationName}: ${r.status}`);
  }
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
