import { CdrRepository } from '../src/pbx/calls/cdr.repository.js';
import { inbound, outbound } from '../src/pbx/calls/testing/cdr-fixtures.js';
import { FakeCdrRepository } from './cdr/fake-cdr-repository.js';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT } from './support/e2e-app.js';

/**
 * The overview dashboard (owner, 19.11.2026): observers see ONLY it (no other page or API), the superuser
 * sees it too, executives and operators do not. Figures over tickets seeded straight into Postgres and fixture
 * CDR rows (FakeCdrRepository); the calls block must equal /api/stats for the same period.
 *   E2E_DATABASE_URL=postgres://callcenter:callcenter@127.0.0.1:54320/callcenter_ov_test pnpm --filter @cc/api test:e2e overview
 */
let e2e: E2eApp;
let root: Client;
let observer: Client;
let executive: Client;
let operator: Client;
let anon: Client;
const ids: Record<string, number> = {};

// 2026-11-16 (Monday), working hours.
const cdr = [
  inbound({ at: '2026-11-16 09:00:00', caller: '998901234567', outcome: 'answered', answeredBy: '101', talk: 100 }),
  inbound({ at: '2026-11-16 09:30:00', caller: '935551122', outcome: 'abandoned', rung: ['101'] }),
  inbound({ at: '2026-11-16 10:30:00', caller: 'anonymous', outcome: 'ivr' }),
  outbound({ at: '2026-11-16 11:00:00', ext: '101', number: '935551122', disposition: 'ANSWERED', talk: 60 }),
].flat();

const PERIOD = 'from=2026-11-01&to=2026-11-10';
/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`${wall}+05:00`);

beforeAll(async () => {
  e2e = await createE2eApp((b) =>
    b.overrideProvider(CdrRepository).useValue(new FakeCdrRepository(cdr, [{ extension: '101', name: 'Aziza' }])),
  );
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  anon = new Client(e2e);
  ids.observer = await createUser(root, { username: 'kuzatuvchi', password: 'Watch-Pass-123', role: 'observer' });
  ids.e1 = await createUser(root, { username: 'masul_toshkent', password: 'Exec-Pass-1234', role: 'executive' });
  ids.e2 = await createUser(root, { username: 'masul_samarqand', password: 'Exec-Pass-1234', role: 'executive' });
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
      { userId: ids.e1, regionId: ids.tash },
      { userId: ids.e2, regionId: ids.sam },
    ])
    .execute();

  const created = tk('2026-11-03T10:00:00');
  const due = tk('2026-11-06T10:00:00');
  const insert = async (v: Record<string, unknown>) =>
    (
      await e2e.db
        .insertInto('tickets')
        .values({ creatorLabel: 'Aziza', createdAt: created, dueAt: due, ...v })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  // Toshkent shahri: closed in time; held after the due date.
  ids.closed = await insert({
    status: 'closed',
    regionId: ids.tash,
    assigneeUserId: ids.e1,
    assigneeLabel: 'Masul Toshkent',
    resolvedByUserId: ids.e1,
    resolvedByLabel: 'Masul Toshkent',
    resolution: 'done',
    resolvedAt: tk('2026-11-04T10:00:00'),
    callbackDueAt: tk('2026-11-05T10:00:00'),
    closedAt: tk('2026-11-04T22:00:00'),
  });
  ids.held = await insert({
    status: 'in_progress',
    regionId: ids.tash,
    assigneeUserId: ids.e1,
    assigneeLabel: 'Masul Toshkent',
  });
  // Samarqand: rejected late, the callback is overdue too.
  ids.rejected = await insert({
    status: 'callback_pending',
    regionId: ids.sam,
    resolvedByUserId: ids.e2,
    resolvedByLabel: 'Masul Samarqand',
    resolution: 'rejected',
    resolvedAt: tk('2026-11-07T10:00:00'),
    callbackDueAt: tk('2026-11-09T10:00:00'),
  });
  // Without a region ("Hududsiz"), never taken.
  ids.noRegion = await insert({ status: 'new', regionId: null });
  // Created before the period: only "now" counts it.
  ids.older = await insert({
    status: 'new',
    regionId: ids.sam,
    createdAt: tk('2026-10-20T10:00:00'),
    dueAt: tk('2026-10-23T10:00:00'),
  });
  await e2e.db
    .insertInto('ticketEvents')
    .values([
      { ticketId: ids.closed, kind: 'assigned', actorUserId: ids.e1 },
      { ticketId: ids.held, kind: 'assigned', actorUserId: ids.e1 },
      { ticketId: ids.rejected, kind: 'assigned', actorUserId: ids.e2 },
    ])
    .execute();
});
afterAll(async () => {
  await e2e?.close();
});

describe('access', () => {
  it('needs a session', async () => {
    expect((await anon.get(`/overview/tickets?${PERIOD}`)).status).toBe(401);
    expect((await anon.get(`/overview/calls?${PERIOD}`)).status).toBe(401);
  });

  it('observer and superuser see the overview; executives ("Mas\'ul shaxslar") and operators do not', async () => {
    for (const [name, c, status] of [
      ['observer', observer, 200],
      ['superuser', root, 200],
      ['executive', executive, 403],
      ['operator', operator, 403],
    ] as const) {
      expect((await c.get(`/overview/tickets?${PERIOD}`)).status, name).toBe(status);
      expect((await c.get('/overview/calls?from=2026-11-16&to=2026-11-16')).status, name).toBe(status);
    }
  });

  it('observer: the overview permission and nothing else', async () => {
    const me = (await observer.get('/auth/me')).body.user;
    expect(me.permissions).toEqual(['overview.view']);
  });

  it('observer: every other API answers 403 (or 404 for tickets it cannot see)', async () => {
    const forbidden = [
      '/live/snapshot',
      '/presence/online',
      '/callbacks',
      '/callbacks/1',
      '/cdr/calls?from=2026-11-16&to=2026-11-16',
      '/stats/summary?from=2026-11-16&to=2026-11-16',
      '/stats/operators?from=2026-11-16&to=2026-11-16',
      '/stats/series?from=2026-11-16&to=2026-11-16',
      '/export/excel?from=2026-11-16&to=2026-11-16',
      '/recordings/tree',
      '/tickets?view=all',
      '/tickets/reports?from=2026-11-01&to=2026-11-10',
      '/tickets/directories',
      '/contacts',
      '/blacklist',
      '/excluded-operators',
      '/tools/config',
      '/users',
      '/audit',
    ];
    for (const path of forbidden) expect((await observer.get(path)).status, path).toBe(403);
    expect((await observer.get(`/tickets/${ids.held}`)).status).toBe(404);
    expect((await observer.post('/telephony/originate', { to: '901234567' })).status).toBe(403);
    expect((await observer.post('/callbacks/1/notes', { text: 'salom' })).status).toBe(403);
  });

  it('the live snapshot and callbacks stay open to the roles that had them', async () => {
    expect((await operator.get('/live/snapshot')).status).toBe(200);
    expect((await executive.get('/live/snapshot')).status).toBe(200);
    expect((await operator.get('/callbacks')).status).toBe(200);
    expect((await executive.get('/callbacks')).status).toBe(200);
  });
});

describe('tickets', () => {
  it('the period: tickets created in it, in their current state (ticket-report SLA rules)', async () => {
    const r = await observer.get(`/overview/tickets?${PERIOD}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      range: { from: '2026-11-01', to: '2026-11-10' },
      region: null,
      slaWorkingDays: 3,
      callbackSlaWorkingDays: 1,
      totals: {
        received: 4,
        taken: 3,
        done: 1,
        rejected: 1,
        closed: 1,
        open: 3,
        overdue: 3,
        overdueOpen: 2,
        overdueLate: 1,
        callbackOverdue: 1,
        avgResolutionHours: 60, // (24 + 96) / 2
        avgCloseHours: 36,
      },
    });
    expect(r.body.byStatus).toContainEqual({ status: 'closed', count: 1 });
    expect(r.body.byStatus).toContainEqual({ status: 'callback_pending', count: 1 });
  });

  it('now: overdue and callback-overdue whatever the creation date, oldest first, no citizen data', async () => {
    const { now } = (await observer.get(`/overview/tickets?${PERIOD}`)).body;
    expect(now.overdue).toBe(3);
    expect(now.callbackOverdue).toBe(1);
    expect(now.oldestOverdue.map((t: { id: number }) => t.id)).toEqual([ids.older, ids.held, ids.noRegion]);
    expect(now.oldestOverdue[1]).toEqual({
      id: ids.held,
      code: `TK-${ids.held}`,
      regionCode: 'toshkent-shahri',
      regionNameUz: 'Toshkent shahri',
      regionNameRu: 'г. Ташкент',
      status: 'in_progress',
      dueAt: '2026-11-06T05:00:00.000Z',
      executive: 'Masul Toshkent',
    });
  });

  it('regions for the map: all 14, "Hududsiz" last; executives with their regions', async () => {
    const body = (await observer.get(`/overview/tickets?${PERIOD}`)).body;
    expect(body.regions).toHaveLength(15);
    const row = (code: string | null) => body.regions.find((x: { code: string | null }) => x.code === code);
    expect(row('toshkent-shahri')).toMatchObject({ received: 2, closed: 1, overdue: 1, overdueNow: 1, executives: 1 });
    expect(row('samarqand')).toMatchObject({ received: 1, overdue: 1, callbackOverdue: 1, overdueNow: 1 });
    expect(row('andijon')).toMatchObject({ received: 0, overdueNow: 0, executives: 0 });
    expect(body.regions.at(-1)).toMatchObject({ code: null, nameUz: 'Hududsiz', received: 1, overdueNow: 1 });

    expect(body.executives).toEqual([
      {
        userId: ids.e1,
        name: 'Masul Toshkent',
        regions: ['toshkent-shahri'],
        taken: 2,
        done: 1,
        rejected: 0,
        overdue: 1,
        avgResolutionHours: 24,
        holdingNow: 1,
        overdueNow: 1,
      },
      {
        userId: ids.e2,
        name: 'Masul Samarqand',
        regions: ['samarqand'],
        taken: 1,
        done: 0,
        rejected: 1,
        overdue: 1,
        avgResolutionHours: 96,
        holdingNow: 0,
        overdueNow: 0,
      },
    ]);
  });

  it('a region filter narrows everything but the map rows; "none" = without a region', async () => {
    const sam = (await observer.get(`/overview/tickets?${PERIOD}&region=samarqand`)).body;
    expect(sam.region).toBe('samarqand');
    expect(sam.totals.received).toBe(1);
    expect(sam.now.overdue).toBe(1);
    expect(sam.executives.map((e: { userId: number }) => e.userId)).toEqual([ids.e2]);
    expect(sam.regions).toHaveLength(15);

    const none = (await observer.get(`/overview/tickets?${PERIOD}&region=none`)).body;
    expect(none.totals.received).toBe(1);
    expect(none.executives).toEqual([]);
  });

  it('validates the query', async () => {
    expect((await observer.get(`/overview/tickets?${PERIOD}&region=atlantida`)).status).toBe(400);
    expect((await observer.get(`/overview/tickets?${PERIOD}&region=DROP%20TABLE`)).status).toBe(400);
    expect((await observer.get('/overview/tickets?from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect((await observer.get('/overview/tickets?from=2025-01-01&to=2026-11-10')).status).toBe(400);
    expect((await observer.get('/overview/tickets?from=yesterday&to=2026-11-10')).status).toBe(400);
  });
});

describe('calls', () => {
  it('the same numbers as the statistics page for the period and scope', async () => {
    const q = 'from=2026-11-16&to=2026-11-16';
    const overview = (await observer.get(`/overview/calls?${q}`)).body;
    const summary = (await root.get(`/stats/summary?${q}`)).body;
    const series = (await root.get(`/stats/series?${q}`)).body;
    expect(overview.summary).toEqual(summary);
    expect(overview.hourly).toEqual(series.hourly);
    expect(overview.daily).toEqual(series.daily);
    expect(overview.summary.inbound).toMatchObject({ offered: 3, answered: 1, abandoned: 1, ivr: 1 });
    expect(overview.summary.outbound.connected).toBe(1);

    const all = (await observer.get(`/overview/calls?${q}&scope=all`)).body;
    expect(all.summary.range.scope).toBe('all');
    expect(all.hourly).toHaveLength(24);
  });
});
