/**
 * E2E harness for the callbacks / contacts / blacklist / agent modules (session S4).
 * Each spec file gets its own fresh PostgreSQL database (migrated from scratch), the real AppModule,
 * an in-memory AMI (AstDB) and a scripted CDR reader instead of the PBX MariaDB.
 *
 * DB server: E2E_DATABASE_URL, else DATABASE_URL, else the dev compose Postgres (127.0.0.1:54320).
 */
import { Global, type INestApplication, Module, StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { AMI_COMMANDS } from '../../src/common/ports/ami-commands.port.js';
import { InMemoryAmiCommands } from '../../src/modules/blacklist/testing/in-memory-ami-commands.js';
import type { CdrLeg } from '../../src/modules/callbacks/domain/cdr-calls.js';

export interface E2eUser {
  id: number;
  username: string;
  /** `Authorization` header value for supertest. */
  auth: string;
}

export interface E2eContext {
  app: INestApplication;
  ami: InMemoryAmiCommands;
  cdr: { legs: CdrLeg[] };
  users: { superuser: E2eUser; admin: E2eUser; op101: E2eUser; op205: E2eUser };
  db: pg.Pool;
  close(): Promise<void>;
}

function serverUrl(): URL {
  const raw =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://callcenter:callcenter@127.0.0.1:54320/callcenter';
  return new URL(raw);
}

async function freshDatabase(name: string): Promise<string> {
  const admin = serverUrl();
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
  const url = serverUrl();
  url.pathname = `/${name}`;
  return url.toString();
}

export async function createE2eApp(suite: string, env: Record<string, string> = {}): Promise<E2eContext> {
  const dbName = `${serverUrl().pathname.slice(1) || 'callcenter'}_s4_e2e_${suite}`;
  const databaseUrl = await freshDatabase(dbName);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: databaseUrl,
    DB_MIGRATE_ON_START: 'true',
    COOKIE_SECURE: 'false',
    BOOTSTRAP_SUPERUSER_USERNAME: 'superuser',
    BOOTSTRAP_SUPERUSER_PASSWORD: 'e2e-superuser-password',
    PBX_DB_HOST: '',
    PBX_DB_USER: '',
    AMI_HOST: '',
    CALLBACKS_RECONCILE_INTERVAL_SEC: '0',
    CONTACTS_DENIED_EXTENSION_RANGES: '200-999',
    BLACKLIST_OPERATOR_EXTENSIONS: '114',
    AGENT_COMPAT_MODE: 'false',
    AGENT_COMPAT_ALLOWED_CIDRS: '10.0.0.0/8',
    ...env,
  });

  // Imported after the environment is set: ConfigModule validates it at import time.
  const { AppModule } = await import('../../src/app.module.js');
  const { CdrLegsReader } = await import('../../src/modules/callbacks/callbacks.reconciler.js');
  const { SessionsService } = await import('../../src/modules/auth/sessions.service.js');

  const ami = new InMemoryAmiCommands();
  const cdr = { legs: [] as CdrLeg[] };

  @Global()
  @Module({ providers: [{ provide: AMI_COMMANDS, useValue: ami }], exports: [AMI_COMMANDS] })
  class FakeAmiModule {}

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, FakeAmiModule] })
    .overrideProvider(CdrLegsReader)
    .useValue({
      available: true,
      read: async (from: string, to: string) => cdr.legs.filter((l) => l.calldate >= from && l.calldate < to),
    })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  app.set('trust proxy', 'loopback'); // lets tests choose the client IP with X-Forwarded-For
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const sessions = app.get(SessionsService);

  async function user(username: string, role: string, extension: string | null): Promise<E2eUser> {
    const existing = await db.query<{ id: string }>('select id from users where username = $1', [username]);
    const id = existing.rows[0]
      ? Number(existing.rows[0].id)
      : Number(
          (
            await db.query<{ id: string }>(
              `insert into users (username, password_hash, role, extension) values ($1, 'x', $2, $3) returning id`,
              [username, role, extension],
            )
          ).rows[0].id,
        );
    const { token } = await sessions.create(id, {});
    return { id, username, auth: `Bearer ${token}` };
  }

  const users = {
    superuser: await user('superuser', 'superuser', null),
    admin: await user('admin1', 'admin', null),
    op101: await user('op101', 'operator', '101'),
    op205: await user('op205', 'operator', '205'),
  };

  return {
    app,
    ami,
    cdr,
    users,
    db,
    async close() {
      await db.end();
      await app.close();
    },
  };
}

/** Rows of the audit log for an action prefix, oldest first. */
export async function auditRows(
  db: pg.Pool,
  prefix: string,
): Promise<Array<{ action: string; target: string; actor_label: string; details: any }>> {
  const res = await db.query(
    'select action, target, actor_label, details from audit_log where action like $1 order by id',
    [`${prefix}%`],
  );
  return res.rows;
}
