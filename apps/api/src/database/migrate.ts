/**
 * Migration CLI (runs from the compiled dist):
 *   node dist/database/migrate.js latest   # apply all pending
 *   node dist/database/migrate.js down     # roll back the last one
 *   node dist/database/migrate.js status
 */
import { existsSync } from 'node:fs';
import { createDb } from './kysely.js';
import { assertMigrationsOk, createMigrator } from './migrator.js';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const db = createDb({ connectionString: url, max: 1, applicationName: 'cc-migrate' });
const migrator = createMigrator(db);
const command = process.argv[2] ?? 'latest';

try {
  if (command === 'latest') {
    assertMigrationsOk(await migrator.migrateToLatest(), console.log);
  } else if (command === 'down') {
    assertMigrationsOk(await migrator.migrateDown(), console.log);
  } else if (command === 'status') {
    for (const m of await migrator.getMigrations()) {
      console.log(`${m.executedAt ? m.executedAt.toISOString() : 'pending'.padEnd(24)}  ${m.name}`);
    }
  } else {
    console.error(`Unknown command "${command}". Use: latest | down | status`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
