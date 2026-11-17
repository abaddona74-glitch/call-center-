import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Kysely } from 'kysely';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CallEndedEvent } from '../../src/common/events/domain-events.js';
import type { DB } from '../../src/database/db.js';
import { FakeAmi } from './fake-ami.js';

/**
 * End-to-end: the real AppModule (Postgres, sessions, audit, WS) wired to a fake AMI server that
 * replays events recorded from the simulator. DB: `<DATABASE_URL db>_telephony_e2e`, recreated per run.
 */

interface Fixture {
  peers: Record<string, string>[];
  queueStatus: Record<string, string>[];
  events: Array<{ t: number; e: Record<string, string> }>;
}
const FIXTURES = join(import.meta.dirname, '../../src/modules/live/domain/__fixtures__');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;

function baseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(import.meta.dirname, '../../.env.local'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL is not set (env or apps/api/.env.local)');
  return line.slice('DATABASE_URL='.length).trim();
}

async function recreateDatabase(url: URL): Promise<void> {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('unexpected test database name');
  await client.query(`drop database if exists ${name} with (force)`);
  await client.query(`create database ${name}`);
  await client.end();
}

async function eventually<T>(fn: () => Promise<T> | T, ms = 5_000): Promise<T> {
  const start = Date.now();
  let last: unknown;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (Date.now() - start > ms) throw last;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

const ami = new FakeAmi({
  username: 'e2e',
  secret: 'e2e-ami-secret',
  lists: {
    sippeers: () => fixture('queue-answered-client-hangup').peers,
    queuestatus: () => fixture('queue-answered-client-hangup').queueStatus,
    coreshowchannels: () => [],
  },
});

let app: INestApplication;
let db: Kysely<DB>;
let baseUrl: string;
const cookies: Record<string, string> = {};
const ended: CallEndedEvent[] = [];
const http = () => request(app.getHttpServer());

async function login(username: string, password: string): Promise<string> {
  const res = await http().post('/api/auth/login').send({ username, password }).expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  return set.map((c) => c.split(';')[0]).join('; ');
}

const as = (who: string) => ({
  get: (path: string) => http().get(path).set('Cookie', cookies[who]),
  post: (path: string, body: object) => http().post(path).set('Cookie', cookies[who]).send(body),
});

async function audit(action: string) {
  return db.selectFrom('auditLog').selectAll().where('action', '=', action).orderBy('id', 'desc').execute();
}

beforeAll(async () => {
  const testUrl = new URL(baseDatabaseUrl());
  testUrl.pathname = `${testUrl.pathname}_telephony_e2e`;
  await recreateDatabase(testUrl);
  const port = await ami.start();

  const superPassword = randomBytes(12).toString('base64url');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: testUrl.toString(),
    DB_MIGRATE_ON_START: 'true',
    COOKIE_SECURE: 'false',
    PBX_DB_HOST: '',
    AMI_HOST: '127.0.0.1',
    AMI_PORT: String(port),
    AMI_USER: 'e2e',
    AMI_PASSWORD: 'e2e-ami-secret',
    AMI_POLL_INTERVAL_SEC: '600',
    BOOTSTRAP_SUPERUSER_USERNAME: 'superuser',
    BOOTSTRAP_SUPERUSER_PASSWORD: superPassword,
  });

  // AppModule reads the environment when it is imported.
  const { AppModule } = await import('../../src/app.module.js');
  const { KYSELY } = await import('../../src/database/database.module.js');
  const { hashPassword } = await import('../../src/modules/auth/password-hasher.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0, '127.0.0.1');
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  db = app.get<Kysely<DB>>(KYSELY);
  const opPassword = 'operator-pass-123';
  const hash = await hashPassword(opPassword);
  await db
    .insertInto('users')
    .values([
      { username: 'op101', passwordHash: hash, role: 'operator', extension: '101' },
      { username: 'op103', passwordHash: hash, role: 'operator', extension: '103' },
      { username: 'admin1', passwordHash: hash, role: 'admin', extension: null },
    ])
    .execute();
  cookies.super = await login('superuser', superPassword);
  cookies.op101 = await login('op101', opPassword);
  cookies.op103 = await login('op103', opPassword);
  cookies.admin = await login('admin1', opPassword);

  app.get(EventEmitter2).on('call.ended', (e: CallEndedEvent) => ended.push(e));
  await eventually(async () => {
    const res = await as('admin').get('/api/ami/status').expect(200);
    expect(res.body.state).toBe('connected');
    expect(ami.lastAction('CoreShowChannels')).toBeDefined();
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await ami.stop();
});

/** Push recorded events; `until` stops before the first event of that type (exclusive). */
function replay(name: string, from = 0, until?: (e: Record<string, string>) => boolean): number {
  const events = fixture(name).events;
  let i = from;
  for (; i < events.length; i++) {
    if (until?.(events[i].e)) break;
    ami.push(events[i].e);
  }
  return i;
}

describe('live snapshot', () => {
  it('requires a session', async () => {
    await http().get('/api/live/snapshot').expect(401);
    await http().post('/api/telephony/pause').send({ paused: true }).expect(401);
  });

  it('builds the board from the AMI resync on connect', async () => {
    const res = await as('admin').get('/api/live/snapshot').expect(200);
    const ops = Object.fromEntries(
      res.body.operators.map((o: { extension: string; presence: string }) => [o.extension, o.presence]),
    );
    expect(ops).toMatchObject({ '101': 'idle', '103': 'idle', '119': 'paused', '120': 'offline', '201': 'offline' });
    expect(res.body.queues.map((q: { name: string }) => q.name)).toEqual(['2020142', '2020159']);
    expect(res.body.counters).toMatchObject({ inbound: 0, answered: 0 });
    expect(res.body.ami).toMatchObject({ enabled: true, state: 'connected' });

    const asOperator = await as('op101').get('/api/live/snapshot').expect(200);
    expect(asOperator.body.counters).toBeNull();
  });
});

describe('a live queue call', () => {
  const callId = '1794891600.1';
  let cursor = 0;

  it('shows the call; operators see only their own numbers', async () => {
    cursor = replay('queue-answered-client-hangup', 0, (e) => e.Event === 'HangupRequest');
    const admin = await eventually(async () => {
      const res = await as('admin').get('/api/live/snapshot').expect(200);
      expect(res.body.calls).toHaveLength(1);
      expect(res.body.calls[0]).toMatchObject({ id: callId, state: 'talking', extension: '101', phone: '901234567' });
      return res.body;
    });
    expect(admin.operators.find((o: { extension: string }) => o.extension === '101')).toMatchObject({
      presence: 'talking',
      call: { callId, phone: '901234567', state: 'talking' },
    });
    expect(admin.counters).toMatchObject({ inbound: 1, answered: 1 });

    const own = (await as('op101').get('/api/live/snapshot').expect(200)).body;
    expect(own.calls[0].phone).toBe('901234567');
    const other = (await as('op103').get('/api/live/snapshot').expect(200)).body;
    expect(other.calls[0].phone).toBe('90 ••• •• 67');
    expect(other.operators.find((o: { extension: string }) => o.extension === '101').call.phone).toBe('90 ••• •• 67');
  });

  it('operators cannot control other operators’ calls', async () => {
    await as('op103').post('/api/telephony/hangup', { callId }).expect(403);
    await as('op103').post('/api/telephony/transfer', { callId, target: '106' }).expect(403);
    expect(ami.lastAction('Hangup')).toBeUndefined();
    expect(await audit('telephony.hangup')).toHaveLength(0);
  });

  it('validates input and unknown calls', async () => {
    await as('admin').post('/api/telephony/transfer', { callId: 'abc', target: '106' }).expect(400);
    await as('admin').post('/api/telephony/transfer', { callId: '1.1', target: '106' }).expect(404);
    await as('admin').post('/api/telephony/transfer', { callId, target: '901234567' }).expect(400);
    await as('admin').post('/api/telephony/transfer', { callId, target: '101' }).expect(400);
  });

  it('the operator on the call transfers it with AMI Redirect of the citizen leg (audited)', async () => {
    await as('op101').post('/api/telephony/transfer', { callId, target: '106' }).expect(200, { ok: true });
    expect(ami.lastAction('Redirect')).toMatchObject({
      channel: 'SIP/712020159-00000020',
      exten: '106',
      context: 'from-internal',
      priority: '1',
    });
    const rows = await audit('telephony.transfer');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorLabel: 'op101', target: `call:${callId}` });
    expect(rows[0].details).toMatchObject({ from: '101', to: '106' });
  });

  it('an admin hangs up the call; the call ends exactly once', async () => {
    await as('admin').post('/api/telephony/hangup', { callId }).expect(200);
    expect(ami.lastAction('Hangup')).toMatchObject({ channel: 'SIP/712020159-00000020', cause: '16' });
    expect(await audit('telephony.hangup')).toHaveLength(1);

    replay('queue-answered-client-hangup', cursor);
    await eventually(() => expect(ended.filter((e) => e.callId === callId)).toHaveLength(1));
    expect(ended.find((e) => e.callId === callId)).toMatchObject({
      answered: true,
      extension: '101',
      phone: '901234567',
      hangupParty: 'operator',
    });
    const res = await as('admin').get('/api/live/snapshot').expect(200);
    expect(res.body.calls).toEqual([]);
    expect(res.body.counters).toMatchObject({ inbound: 1, answered: 1, operatorHangups: 1 });
  });
});

describe('pause / unpause', () => {
  it('operators pause themselves through AMI QueuePause (no SSH)', async () => {
    await as('op101').post('/api/telephony/pause', { paused: true, reason: 'Tushlik' }).expect(200);
    expect(ami.lastAction('QueuePause')).toMatchObject({
      interface: 'Local/101@from-queue/n',
      paused: 'true',
      reason: 'Tushlik',
    });
    expect((await audit('telephony.pause'))[0]).toMatchObject({ actorLabel: 'op101', target: 'extension:101' });
  });

  it('operators cannot pause someone else; admins can', async () => {
    await as('op101').post('/api/telephony/pause', { extension: '103', paused: true }).expect(403);
    await as('admin').post('/api/telephony/pause', { extension: '103', paused: false }).expect(200);
    expect(ami.lastAction('QueuePause')).toMatchObject({ interface: 'Local/103@from-queue/n', paused: 'false' });
    expect((await audit('telephony.unpause'))[0]).toMatchObject({ actorLabel: 'admin1', target: 'extension:103' });
  });

  it('rejects header injection and reports AMI errors (audited as failed)', async () => {
    const before = ami.actions.length;
    await as('op101').post('/api/telephony/pause', { paused: true, reason: 'x\r\nAction: Originate' }).expect(400);
    expect(ami.actions.length).toBe(before);

    ami.failNext.set('queuepause', 'Interface not found');
    const res = await as('op101').post('/api/telephony/pause', { paused: true }).expect(502);
    expect(res.body.message).toContain('Interface not found');
    expect(await audit('telephony.pause.failed')).toHaveLength(1);
  });
});

describe('click-to-call', () => {
  it('rings the operator’s own phone first (async Originate)', async () => {
    await as('op101').post('/api/telephony/originate', { to: '+998 (90) 765-43-21' }).expect(200);
    expect(ami.lastAction('Originate')).toMatchObject({
      channel: 'SIP/101',
      exten: '907654321',
      context: 'from-internal',
      async: 'true',
    });
    expect((await audit('telephony.originate'))[0]).toMatchObject({ actorLabel: 'op101', target: 'extension:101' });
  });

  it('rejects international numbers, other extensions and missing extensions', async () => {
    await as('op101').post('/api/telephony/originate', { to: '+7 495 123 45 67' }).expect(400);
    await as('op101').post('/api/telephony/originate', { to: '901234567', from: '103' }).expect(403);
    await as('admin').post('/api/telephony/originate', { to: '901234567' }).expect(400);
    await as('admin').post('/api/telephony/originate', { to: '901234567', from: '120' }).expect(409); // offline
  });
});

describe('websocket', () => {
  it('pushes role-filtered telephony events', async () => {
    const frames: Array<{ type: string; data: unknown }> = [];
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws`, { headers: { cookie: cookies.op103 } });
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await eventually(() => expect(frames.some((f) => f.type === 'session.ready')).toBe(true));

    replay('outbound-answered', 0, (e) => e.Event === 'HangupRequest');
    const calls = await eventually(() => {
      const last = frames.filter((f) => f.type === 'telephony.calls').at(-1)?.data as
        Array<{ phone: string; state: string }> | undefined;
      expect(last?.[0]?.state).toBe('talking');
      return last;
    });
    expect(calls![0].phone).toBe('991234567'); // operator 103's own outbound call: full number
    ws.close();
    expect(frames.some((f) => f.type === 'telephony.counters')).toBe(false);
    replay(
      'outbound-answered',
      fixture('outbound-answered').events.findIndex((x) => x.e.Event === 'HangupRequest'),
    );
  });
});

describe('AMI connection loss', () => {
  it('actions answer 503 while disconnected and the client reconnects', async () => {
    ami.dropClients();
    await eventually(async () => {
      const res = await as('admin').get('/api/ami/status').expect(200);
      expect(res.body.state).not.toBe('connected');
    });
    await as('op101').post('/api/telephony/pause', { paused: false }).expect(503);
    await eventually(async () => {
      const res = await as('admin').get('/api/ami/status').expect(200);
      expect(res.body.state).toBe('connected');
    }, 10_000);
  });
});
