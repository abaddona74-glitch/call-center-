/**
 * E2E harness for the CDR / stats / export modules (S2): the real AppModule on its own Postgres database
 * (`<DATABASE_URL db>_e2e`), with users of every role. The PBX is either the dev mock MariaDB or an in-memory
 * fake CdrRepository fed with fixture rows, so assertions are deterministic.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Role } from '@cc/shared';
import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import type { Kysely } from 'kysely';
import pg from 'pg';
import request from 'supertest';

export interface E2eContext {
  app: INestApplication;
  /** Cookie header per role. */
  cookies: Record<Role, string>;
  close(): Promise<void>;
}

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount === 0) {
      await client.query(`create database "${name.replace(/"/g, '')}"`).catch((err: { code?: string }) => {
        if (err.code !== '42P04' && err.code !== '23505') throw err; // created concurrently
      });
    }
  } finally {
    await client.end();
  }
}

/** Point the app at `<db>_e2e` before AppModule (and its ConfigModule) is imported. */
export async function prepareEnv(): Promise<void> {
  const envFile = path.resolve(import.meta.dirname, '../../.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL (or E2E_DATABASE_URL) is required for e2e tests');
  const url = new URL(base);
  if (!process.env.E2E_DATABASE_URL && !url.pathname.endsWith('_e2e')) url.pathname = `${url.pathname}_e2e`;
  process.env.DATABASE_URL = url.toString();
  process.env.DB_MIGRATE_ON_START = 'true';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.COOKIE_SECURE = 'false';
  await ensureDatabase(process.env.DATABASE_URL);
}

export async function createE2eApp(
  override?: (b: ReturnType<typeof Test.createTestingModule>) => ReturnType<typeof Test.createTestingModule>,
): Promise<E2eContext> {
  await prepareEnv();
  const { AppModule } = await import('../../src/app.module.js');
  const { KYSELY } = await import('../../src/database/database.module.js');
  const { hashPassword } = await import('../../src/modules/auth/password-hasher.js');

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) builder = override(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = app.get<Kysely<any>>(KYSELY);
  const users: { role: Role; extension: string | null }[] = [
    { role: 'operator', extension: '101' },
    { role: 'executive', extension: null },
    { role: 'superuser', extension: null },
  ];
  const cookies = {} as Record<Role, string>;
  for (const u of users) {
    const username = `e2e_s2_${u.role}`;
    const password = randomBytes(18).toString('base64url');
    await db.deleteFrom('users').where('username', '=', username).execute();
    await db
      .insertInto('users')
      .values({ username, passwordHash: await hashPassword(password), role: u.role, extension: u.extension })
      .execute();
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username, password }).expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    cookies[u.role] = setCookie.map((c) => c.split(';')[0]).join('; ');
  }

  return { app, cookies, close: () => app.close() };
}
