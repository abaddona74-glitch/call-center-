import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { FakeAmi } from './telephony/fake-ami.js';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT } from './support/e2e-app.js';

/**
 * The live situation board «Hozirgi holat» (owner, 19.11.2026): observers and the superuser only, read-only, citizen
 * numbers in full. The real AppModule with a fake AMI replaying a recorded simulator call, tickets seeded straight
 * into Postgres.
 *   E2E_DATABASE_URL=postgres://callcenter:callcenter@127.0.0.1:54320/callcenter_sit_test pnpm --filter @cc/api test:e2e situation
 */

interface Fixture {
  peers: Record<string, string>[];
  queueStatus: Record<string, string>[];
  events: Array<{ t: number; e: Record<string, string> }>;
}
const FIXTURES = join(import.meta.dirname, '../src/modules/live/domain/__fixtures__');
const call = JSON.parse(readFileSync(join(FIXTURES, 'queue-answered-client-hangup.json'), 'utf8')) as Fixture;
const PHONE = '901234567';

const ami = new FakeAmi({
  username: 'e2e',
  secret: 'e2e-ami-secret',
  lists: { sippeers: () => call.peers, queuestatus: () => call.queueStatus, coreshowchannels: () => [] },
});

/** Push the recorded events with `from <= t < to` (ms after the call started). */
function replay(from: number, to = Number.POSITIVE_INFINITY): void {
  for (const { t, e } of call.events) if (t >= from && t < to) ami.push(e);
}

async function eventually<T>(fn: () => Promise<T> | T, ms = 8_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() - start > ms) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

interface Frame {
  type: string;
  data: never;
  at: number;
}

/** A WS connection recording every frame it gets. */
async function listen(c: Client): Promise<{ ws: WebSocket; frames: Frame[] }> {
  const { ws } = await c.openSocket();
  const frames: Frame[] = [];
  ws.on('message', (raw) => frames.push({ ...(JSON.parse(raw.toString()) as Omit<Frame, 'at'>), at: Date.now() }));
  return { ws, frames };
}
const ofType = (frames: Frame[], type: string) => frames.filter((f) => f.type === type);

let e2e: E2eApp;
let root: Client;
let observer: Client;
let executive: Client;
let operator: Client;
let anon: Client;
const ids: Record<string, number> = {};
const tk = (wall: string) => new Date(`${wall}+05:00`);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

beforeAll(async () => {
  const port = await ami.start();
  e2e = await createE2eApp((b) => b, {
    AMI_HOST: '127.0.0.1',
    AMI_PORT: String(port),
    AMI_USER: 'e2e',
    AMI_PASSWORD: 'e2e-ami-secret',
    AMI_POLL_INTERVAL_SEC: '600',
  });
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  anon = new Client(e2e);
  ids.observer = await createUser(root, { username: 'kuzatuvchi', password: 'Watch-Pass-123', role: 'observer' });
  ids.exec = await createUser(root, { username: 'masul_toshkent', password: 'Exec-Pass-1234', role: 'executive' });
  ids.idle = await createUser(root, { username: 'masul_samarqand', password: 'Exec-Pass-1234', role: 'executive' });
  await createUser(root, { username: 'op101', password: 'Oper-Pass-1234', extension: '101' });
  observer = await loginAs(e2e, 'kuzatuvchi', 'Watch-Pass-123');
  executive = await loginAs(e2e, 'masul_toshkent', 'Exec-Pass-1234');
  operator = await loginAs(e2e, 'op101', 'Oper-Pass-1234');

  const regions = await e2e.db.selectFrom('ticketRegions').select(['id', 'code']).execute();
  const region = (code: string) => regions.find((r) => r.code === code)!.id;
  ids.tash = region('toshkent-shahri');
  ids.sam = region('samarqand');
  await e2e.db
    .insertInto('ticketExecutiveRegions')
    .values([
      { userId: ids.exec, regionId: ids.tash },
      { userId: ids.idle, regionId: ids.sam },
    ])
    .execute();

  const insert = async (v: Record<string, unknown>) =>
    (
      await e2e.db
        .insertInto('tickets')
        .values({ creatorLabel: 'Aziza', createdAt: hoursAgo(0.1), dueAt: new Date(Date.now() + 72 * 3_600_000), ...v })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  // Waiting in Toshkent shahri (the executive takes it in the WS test) and in Samarqand (overdue).
  ids.waiting = await insert({ status: 'new', regionId: ids.tash, regionChangedAt: hoursAgo(0.1) });
  ids.lateNew = await insert({
    status: 'new',
    regionId: ids.sam,
    createdAt: tk('2026-11-01T10:00:00'),
    dueAt: tk('2026-11-04T10:00:00'),
    regionChangedAt: tk('2026-11-01T10:00:00'),
  });
  // Held by the executive past its deadline.
  ids.held = await insert({
    status: 'in_progress',
    regionId: ids.tash,
    assigneeUserId: ids.exec,
    assigneeLabel: 'masul_toshkent',
    assignedAt: tk('2026-11-02T10:00:00'),
    createdAt: tk('2026-11-02T09:00:00'),
    dueAt: tk('2026-11-05T09:00:00'),
  });
  // Finished, the callback is overdue.
  ids.callback = await insert({
    status: 'callback_pending',
    regionId: ids.tash,
    resolution: 'done',
    resolvedByUserId: ids.exec,
    resolvedByLabel: 'masul_toshkent',
    resolvedAt: tk('2026-11-06T10:00:00'),
    callbackDueAt: tk('2026-11-07T10:00:00'),
  });
  // Closed long ago: not open, not today.
  await insert({
    status: 'closed',
    regionId: ids.tash,
    createdAt: tk('2026-11-01T10:00:00'),
    closedAt: tk('2026-11-03T10:00:00'),
  });

  await eventually(async () => {
    expect((await root.get('/ami/status')).body.state).toBe('connected');
    expect(ami.lastAction('CoreShowChannels')).toBeDefined();
  });
}, 60_000);

afterAll(async () => {
  await e2e?.close();
  await ami.stop();
});

describe('access', () => {
  it('needs a session', async () => {
    expect((await anon.get('/situation')).status).toBe(401);
  });

  it('observer and superuser see the board; operators and executives ("Mas’ul") do not', async () => {
    for (const [name, c, status] of [
      ['observer', observer, 200],
      ['superuser', root, 200],
      ['operator', operator, 403],
      ['executive', executive, 403],
    ] as const)
      expect((await c.get('/situation')).status, name).toBe(status);
  });

  it('read-only: the observer still has no live monitor and no telephony actions', async () => {
    expect((await observer.get('/live/snapshot')).status).toBe(403);
    expect((await observer.get('/presence/online')).status).toBe(403);
    for (const [path, body] of [
      ['/telephony/pause', { extension: '101', paused: true }],
      ['/telephony/transfer', { callId: '1794891600.1', target: '103' }],
      ['/telephony/hangup', { callId: '1794891600.1' }],
      ['/telephony/originate', { to: '901234567' }],
    ] as const)
      expect((await observer.post(path, body)).status, path).toBe(403);
  });
});

describe('the snapshot', () => {
  it('tickets now: open by status, deadlines, waiting per region, who works on them', async () => {
    const { tickets } = (await observer.get('/situation').expect(200)).body;
    expect(tickets.open).toEqual({ total: 4, new: 2, assigned: 0, inProgress: 1, callbackPending: 1 });
    expect(tickets).toMatchObject({ overdue: 2, callbackOverdue: 1, slaWorkingDays: 3, callbackSlaWorkingDays: 1 });
    expect(tickets.today).toMatchObject({ opened: 2 }); // the two created a few minutes ago
    expect(
      tickets.waiting.map((w: { code: string; waiting: number; overdue: number }) => [w.code, w.waiting, w.overdue]),
    ).toEqual([
      ['samarqand', 1, 1], // waiting since 1 November
      ['toshkent-shahri', 1, 0],
    ]);
    expect(tickets.workers.map((w: { username: string; holding: number }) => [w.username, w.holding])).toEqual([
      ['masul_toshkent', 1],
      ['masul_samarqand', 0],
    ]);
    expect(tickets.workers[0]).toMatchObject({
      overdue: 1,
      regions: [{ code: 'toshkent-shahri' }],
      tickets: [{ id: ids.held, code: `TK-${ids.held}`, status: 'in_progress', overdue: true }],
    });
    // no ticket contents on the board
    expect(JSON.stringify(tickets)).not.toMatch(/description|customerPhone|organization/);
  });

  it('telephony now: the operators from the PBX, counters with the average wait, the working day', async () => {
    const { telephony } = (await observer.get('/situation').expect(200)).body;
    const presence = Object.fromEntries(
      telephony.operators.map((o: { extension: string; presence: string }) => [o.extension, o.presence]),
    );
    expect(presence).toMatchObject({ '101': 'idle', '119': 'paused', '120': 'offline' });
    for (const o of telephony.operators) expect(o.ip).toBeNull();
    expect(telephony.counters).toMatchObject({ inbound: expect.any(Number), avgWaitSec: expect.any(Number) });
    expect(telephony.ami).toMatchObject({ enabled: true, state: 'connected', lastError: null });
    expect(telephony.workday).toMatchObject({ start: '08:00', end: '21:00' });
    expect(Date.parse(telephony.serverTime)).toBeGreaterThan(0);
  });
});

describe('live over WebSocket', () => {
  it('pushes the board to observers and the superuser only, numbers in full, at most once a second', async () => {
    const watch = await listen(observer);
    const boss = await listen(root);
    const op = await listen(operator);
    const masul = await listen(executive);
    try {
      // The caller waits in the queue while 101 rings.
      replay(0, 7_799);
      const waiting = await eventually(() => {
        const last = ofType(watch.frames, 'situation.telephony').at(-1)?.data as
          { queues: Array<{ waiting: Array<{ phone: string; position: number }> }> } | undefined;
        const w = last?.queues.flatMap((q) => q.waiting) ?? [];
        expect(w).toHaveLength(1);
        return w[0];
      });
      expect(waiting).toMatchObject({ phone: PHONE, position: 1 });
      // the REST snapshot agrees; the operator's own monitor shows another operator's caller masked
      const rest = (await observer.get('/situation')).body.telephony;
      expect(rest.queues.flatMap((q: { waiting: unknown[] }) => q.waiting)).toEqual([
        expect.objectContaining({ phone: PHONE }),
      ]);

      // 101 picks up: a conversation with the full number.
      replay(7_799, 102_799);
      await eventually(() => {
        const last = ofType(boss.frames, 'situation.telephony').at(-1)?.data as
          { calls: Array<{ state: string; phone: string; extension: string }> } | undefined;
        expect(last?.calls).toEqual([expect.objectContaining({ state: 'talking', phone: PHONE, extension: '101' })]);
      });
      replay(102_799);
      await eventually(() => {
        const last = ofType(watch.frames, 'situation.telephony').at(-1)?.data as { calls: unknown[] } | undefined;
        expect(last?.calls).toEqual([]);
      });

      // Coalesced: a whole call replayed in a few milliseconds is a handful of pushes, a second apart.
      const pushes = ofType(watch.frames, 'situation.telephony');
      expect(pushes.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pushes.length; i++) expect(pushes[i].at - pushes[i - 1].at).toBeGreaterThanOrEqual(900);

      // The executive takes the waiting ticket: the tickets part follows.
      expect((await executive.post(`/tickets/${ids.waiting}/assign`)).status).toBe(200);
      const tickets = await eventually(() => {
        const last = ofType(watch.frames, 'situation.tickets').at(-1)?.data as
          | { open: { new: number; assigned: number }; workers: Array<{ username: string; holding: number }> }
          | undefined;
        expect(last?.open).toMatchObject({ new: 1, assigned: 1 });
        return last!;
      });
      expect(tickets.workers[0]).toMatchObject({ username: 'masul_toshkent', holding: 2 });
      await eventually(() => expect(ofType(boss.frames, 'situation.tickets').length).toBeGreaterThan(0));

      // Nobody else gets the board: the operator keeps its masked monitor, the executive gets no telephony at all.
      for (const f of [...op.frames, ...masul.frames]) expect(f.type.startsWith('situation.')).toBe(false);
      const opCalls = ofType(op.frames, 'telephony.queues').flatMap((f) =>
        (f.data as Array<{ waiting: Array<{ phone: string }> }>).flatMap((q) => q.waiting),
      );
      expect(opCalls.length).toBeGreaterThan(0);
      for (const w of opCalls) expect(w.phone).toBe('90 ••• •• 67');
      expect(masul.frames.filter((f) => f.type.startsWith('telephony.'))).toEqual([]);
      expect(watch.frames.filter((f) => f.type.startsWith('telephony.'))).toEqual([]);
    } finally {
      for (const s of [watch, boss, op, masul]) s.ws.close();
    }
  });
});
