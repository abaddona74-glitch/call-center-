import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Role } from '@cc/shared';
import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Kysely } from 'kysely';
import { KYSELY } from '../src/database/database.module.js';
import type { DB } from '../src/database/db.js';
import { hashPassword } from '../src/modules/auth/password-hasher.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';

/**
 * E2E harness for the recordings and tickets modules: the real AppModule on a real Postgres
 * (E2E_DATABASE_URL, else DATABASE_URL), no SFTP/PBX/AMI, temp dirs for uploads and ZIPs.
 * Users get sessions directly (Bearer token), so tests don't hit the login rate limit.
 */
export interface TestUser {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
  /** `Bearer <token>` for the Authorization header. */
  auth: string;
}

export interface S5TestApp {
  app: INestApplication;
  db: Kysely<DB>;
  tmp: string;
  createUser(role: Role, extension: string | null): Promise<TestUser>;
  close(): Promise<void>;
}

export async function createS5TestApp(customize?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<S5TestApp> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set E2E_DATABASE_URL (or DATABASE_URL) to a disposable Postgres database');
  const tmp = await mkdtemp(path.join(tmpdir(), 'cc-s5-e2e-'));

  // Real environment variables win over .env.local.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: url,
    DB_MIGRATE_ON_START: 'true',
    COOKIE_SECURE: 'false',
    PBX_DB_HOST: '',
    AMI_HOST: '',
    SFTP_HOST: '',
    TICKETS_UPLOAD_DIR: path.join(tmp, 'uploads'),
    TICKETS_MAX_FILE_MB: '1',
    RECORDINGS_ZIP_DIR: path.join(tmp, 'zips'),
  });

  // Imported only now: ConfigModule snapshots process.env when app.module is first evaluated.
  const { AppModule } = await import('../src/app.module.js');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  const db = app.get<Kysely<DB>>(KYSELY);
  const sessions = app.get(SessionsService);
  const passwordHash = await hashPassword(randomBytes(12).toString('hex'));

  return {
    app,
    db,
    tmp,
    async createUser(role, extension) {
      const username = `s5_${role}_${extension ?? 'x'}_${randomBytes(4).toString('hex')}`;
      const row = await db
        .insertInto('users')
        .values({ username, passwordHash, role, extension })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { token } = await sessions.create(row.id, {});
      return { id: row.id, username, role, extension, auth: `Bearer ${token}` };
    },
    async close() {
      await app.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
}
