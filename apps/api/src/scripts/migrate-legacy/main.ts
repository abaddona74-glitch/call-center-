/**
 * Legacy data migration CLI (runs from the compiled dist, no Nest bootstrap). See README.md.
 *   node dist/scripts/migrate-legacy/main.js --sqlite <callcenter.db> --data-dir <dir> [--dry-run] [--only users]
 * Exit codes: 0 ok, 1 a mapper failed (its transaction was rolled back), 2 bad arguments / environment.
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { createDb } from '../../database/kysely.js';
import { parseCliArgs, USAGE } from './args.js';
import { type LegacySources, openLegacySources } from './legacy-sources.js';
import { errorMessage, type MigrationLogger } from './mapper.js';
import { ALL_MAPPERS } from './mappers/index.js';
import { formatReport } from './report.js';
import { exitCodeFor, kyselyUnitOfWork, recordMigrationAudit, runMappers, selectMappers } from './runner.js';

async function main(argv: readonly string[]): Promise<number> {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const names = ALL_MAPPERS.map((m) => m.name) as [string, ...string[]];
  const parsed = parseCliArgs(argv, names);
  if (!parsed.ok) {
    if (parsed.error) console.error(`${parsed.error}\n`);
    console.error(`${USAGE}\n\nMappers: ${names.join(', ')}`);
    return parsed.help ? 0 : 2;
  }
  const { args } = parsed;

  const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
  if (!url.success) {
    console.error('DATABASE_URL is not set or is not a postgres:// URL');
    return 2;
  }
  const target = new URL(url.data);
  const logger: MigrationLogger = { info: (m) => console.log(m), warn: (m) => console.warn(m) };
  logger.info(
    `Target ${target.hostname}:${target.port || '5432'}${target.pathname}${args.dryRun ? ' (dry run)' : ''}; ` +
      `sqlite ${args.sqlite ?? '-'}; data dir ${args.dataDir ?? '-'}`,
  );

  let legacy: LegacySources;
  try {
    legacy = openLegacySources({ sqlitePath: args.sqlite, dataDir: args.dataDir });
  } catch (err) {
    console.error(`Cannot open the legacy sources: ${errorMessage(err)}`);
    return 2;
  }

  const db = createDb({ connectionString: url.data, max: 1, applicationName: 'cc-migrate-legacy' });
  try {
    const reports = await runMappers(selectMappers(ALL_MAPPERS, args.only), {
      legacy,
      begin: kyselyUnitOfWork(db),
      dryRun: args.dryRun,
      logger,
      audit: recordMigrationAudit,
    });
    const code = exitCodeFor(reports);
    console.log(`\n${formatReport(reports, { dryRun: args.dryRun })} — exit code ${code}`);
    return code;
  } catch (err) {
    console.error(`Migration aborted: ${errorMessage(err)}`);
    return 1;
  } finally {
    legacy.close();
    await db.destroy();
  }
}

process.exitCode = await main(process.argv.slice(2));
