import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './db.js';

// int8 (bigint, COUNT(*)) -> number. Our ids and counters stay far below 2^53.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));
// numeric -> number (averages, durations)
pg.types.setTypeParser(1700, (value) => Number.parseFloat(value));

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
  applicationName?: string;
}

export function createDb({ connectionString, max = 10, applicationName = 'cc-api' }: CreateDbOptions): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max, application_name: applicationName }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}
