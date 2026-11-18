import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import request from 'supertest';
import WebSocket from 'ws';
import type { DB } from '../../src/database/db.js';
import { createDb } from '../../src/database/kysely.js';
import type { MailMessage } from '../../src/modules/mail/mail.service.js';

/**
 * E2E harness: the real AppModule + real Postgres, mail captured in memory.
 *
 * Needs a dedicated database whose name ends with "_test" (it is wiped on every test file):
 *   E2E_DATABASE_URL=postgres://callcenter:callcenter@127.0.0.1:54320/callcenter_s1_test pnpm --filter @cc/api test:e2e
 * Requests pass a fake client IP in X-Forwarded-For (trust proxy = loopback), so per-IP
 * throttling and lockouts can be tested independently per test.
 */
export const ROOT = { username: 'root', password: 'Root-Password-123!' };
export const RP_ID = 'localhost';
export const ORIGIN = 'http://localhost:5174';

export class FakeMail {
  readonly sent: MailMessage[] = [];
  enabled = true;
  async send(message: MailMessage): Promise<boolean> {
    this.sent.push(message);
    return true;
  }
  /** The 6-digit code from the last message to `to`. */
  lastCode(to: string): string | null {
    const m = [...this.sent].reverse().find((x) => x.to === to);
    return m?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
  }
  clear(): void {
    this.sent.length = 0;
  }
}

export interface E2eApp {
  app: INestApplication;
  db: Kysely<DB>;
  mail: FakeMail;
  baseUrl: string;
  close(): Promise<void>;
}

function testDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set E2E_DATABASE_URL (a database whose name ends with _test)');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) throw new Error(`Refusing to wipe "${name}": e2e database name must end with _test`);
  return url;
}

async function resetSchema(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade; create schema public;');
  } finally {
    await client.end();
  }
}

/** `override`: replace providers before compiling (e.g. a fake CdrRepository for the PBX). */
export async function createE2eApp(
  override: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<E2eApp> {
  const url = testDatabaseUrl();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: url,
    DB_MIGRATE_ON_START: 'true',
    TRUSTED_PROXIES: 'loopback',
    COOKIE_SECURE: 'false',
    BOOTSTRAP_SUPERUSER_USERNAME: ROOT.username,
    BOOTSTRAP_SUPERUSER_PASSWORD: ROOT.password,
    WEBAUTHN_RP_ID: RP_ID,
    WEBAUTHN_ORIGINS: ORIGIN,
    PBX_DB_HOST: '',
    AMI_HOST: '',
    SMTP_HOST: '',
  });
  await resetSchema(url);

  const mail = new FakeMail();
  // Imported lazily so the environment above is in place before modules are evaluated.
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');
  const { MailService } = await import('../../src/modules/mail/mail.service.js');

  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail),
  ).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const db = createDb({ connectionString: url, max: 2, applicationName: 'cc-e2e' });

  return {
    app,
    db,
    mail,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await db.destroy();
      await app.close();
    },
  };
}

let ipCounter = 0;
/** A fresh fake client IP for each test (throttles/lockouts are per IP). */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** Thin client bound to one fake IP and (after login) one session cookie. */
export class Client {
  cookie: string | null = null;
  readonly ip: string;

  constructor(
    private readonly e2e: E2eApp,
    ip?: string,
  ) {
    this.ip = ip ?? nextIp();
  }

  private with(req: request.Test): request.Test {
    req.set('X-Forwarded-For', this.ip);
    if (this.cookie) req.set('Cookie', this.cookie);
    return req;
  }

  get(path: string) {
    return this.with(request(this.e2e.app.getHttpServer()).get(`/api${path}`));
  }
  post(path: string, body?: object) {
    const r = this.with(request(this.e2e.app.getHttpServer()).post(`/api${path}`));
    return body === undefined ? r : r.send(body);
  }
  put(path: string, body: object) {
    return this.with(request(this.e2e.app.getHttpServer()).put(`/api${path}`)).send(body);
  }
  patch(path: string, body: object) {
    return this.with(request(this.e2e.app.getHttpServer()).patch(`/api${path}`)).send(body);
  }
  delete(path: string) {
    return this.with(request(this.e2e.app.getHttpServer()).delete(`/api${path}`));
  }

  async login(username: string, password: string): Promise<request.Response> {
    const res = await this.post('/auth/login', { username, password });
    this.adoptCookie(res);
    return res;
  }

  adoptCookie(res: request.Response): void {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    const c = set?.find((s) => s.startsWith('cc_session='));
    if (c) this.cookie = c.split(';')[0];
  }

  /** Open an authenticated WebSocket; resolves after `session.ready`. */
  openSocket(): Promise<{ ws: WebSocket; closed: Promise<{ code: number; reason: string }> }> {
    const ws = new WebSocket(`${this.e2e.baseUrl.replace('http', 'ws')}/ws`, {
      headers: this.cookie ? { Cookie: this.cookie } : {},
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    return new Promise((resolve, reject) => {
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string };
        if (frame.type === 'session.ready') resolve({ ws, closed });
      });
      ws.on('error', reject);
      void closed.then(({ code }) => reject(new Error(`socket closed early: ${code}`)));
    });
  }
}

export async function loginAs(e2e: E2eApp, username: string, password: string): Promise<Client> {
  const c = new Client(e2e);
  const res = await c.login(username, password);
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export interface NewUser {
  username: string;
  password?: string;
  role?: 'operator' | 'observer' | 'executive' | 'superuser';
  mustChangePassword?: boolean;
  extension?: string | null;
  email?: string | null;
  groupId?: number | null;
}

/** Create a user through the API as `by` and return its id. */
export async function createUser(by: Client, u: NewUser): Promise<number> {
  const role = u.role ?? 'operator';
  const res = await by.post('/users', {
    username: u.username,
    password: u.password ?? 'Strong-Pass-123',
    role,
    extension: u.extension === undefined ? (role === 'operator' ? '101' : null) : u.extension,
    email: u.email ?? null,
    groupId: u.groupId ?? null,
    mustChangePassword: u.mustChangePassword ?? false,
  });
  if (res.status !== 201) throw new Error(`create ${u.username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

export async function auditActions(db: Kysely<DB>, target?: string): Promise<string[]> {
  let q = db.selectFrom('auditLog').select('action').orderBy('id');
  if (target) q = q.where('target', '=', target);
  return (await q.execute()).map((r) => r.action);
}

export { sql };
