/**
 * E2E: the excluded operators setting (legacy `excluded_operators`) — API, permissions, validation, audit,
 * realtime, and the filters it drives: the live operators board, the per-operator statistics and the Excel
 * report. Totals stay as they are (legacy behaviour). The PBX is faked: CDR rows in memory, the live board
 * directory set on the store, the PBX directory of the settings screen stubbed on the repository.
 */
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { ExcludedOperatorsRepository } from '../src/modules/excluded-operators/excluded-operators.repository.js';
import '../src/modules/excluded-operators/excluded-operators.tables.js';
import { LiveService } from '../src/modules/live/live.service.js';
import { CdrRepository } from '../src/pbx/calls/cdr.repository.js';
import { inbound, outbound } from '../src/pbx/calls/testing/cdr-fixtures.js';
import { FakeCdrRepository } from './cdr/fake-cdr-repository.js';
import { Client, type E2eApp, ROOT, createE2eApp, createUser, loginAs } from './support/e2e-app.js';

// Mon 2026-11-16 and Tue 2026-11-17 (in the past for the test run).
const rows = [
  inbound({ at: '2026-11-16 09:00:00', caller: '998901234567', outcome: 'answered', answeredBy: '101', talk: 100 }),
  inbound({ at: '2026-11-16 09:30:00', caller: '935551122', outcome: 'answered', answeredBy: '118', talk: 30 }),
  outbound({ at: '2026-11-16 10:00:00', ext: '103', number: '935551122', disposition: 'ANSWERED', talk: 60 }),
  inbound({ at: '2026-11-17 10:00:00', caller: '901234567', outcome: 'answered', answeredBy: '103', talk: 50 }),
].flat();
const names = [
  { extension: '101', name: 'Aziza' },
  { extension: '103', name: 'Bobur' },
  { extension: '118', name: 'Rahbar' },
];
const RANGE = 'from=2026-11-16&to=2026-11-17';

let e2e: E2eApp;
let root: Client;
let executive: Client;
let observer: Client;
let operator: Client;

beforeAll(async () => {
  e2e = await createE2eApp((b) => b.overrideProvider(CdrRepository).useValue(new FakeCdrRepository(rows, names)));
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  for (const [username, role, extension] of [
    ['s11_exec', 'executive', null],
    ['s11_obs', 'observer', null],
    ['s11_op', 'operator', '101'],
  ] as const) {
    await createUser(root, { username, role, extension, password: 'Strong-Pass-123' });
  }
  executive = await loginAs(e2e, 's11_exec', 'Strong-Pass-123');
  observer = await loginAs(e2e, 's11_obs', 'Strong-Pass-123');
  operator = await loginAs(e2e, 's11_op', 'Strong-Pass-123');
  // The live board's operators: normally from asterisk.users and AMI peers.
  e2e.app.get(LiveService).store.setDirectory(
    [
      { extension: '101', name: 'Aziza' },
      { extension: '118', name: 'Rahbar' },
      { extension: '1111', name: 'Test' },
    ],
    Date.now(),
  );
}, 60_000);

afterAll(() => e2e?.close());

const put = (by: Client, extensions: unknown) => by.put('/excluded-operators', { extensions });
const boardOf = async (by: Client) =>
  ((await by.get('/live/snapshot').expect(200)).body.operators as { extension: string }[]).map((o) => o.extension);

/** Frames of one socket, with a waiter. */
function frames(ws: WebSocket) {
  const seen: Array<{ type: string; data: unknown }> = [];
  ws.on('message', (raw) => seen.push(JSON.parse(raw.toString()) as { type: string; data: unknown }));
  return {
    seen,
    async next(type: string, match: (data: never) => boolean = () => true, ms = 3_000) {
      const start = Date.now();
      for (;;) {
        const f = seen.find((x) => x.type === type && match(x.data as never));
        if (f) return f.data;
        if (Date.now() - start > ms) throw new Error(`no ${type} frame`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
}

describe('access', () => {
  it('needs a session and settings.manage (superuser, executive)', async () => {
    const anonymous = new Client(e2e);
    await anonymous.get('/excluded-operators').expect(401);
    for (const c of [operator, observer]) {
      await c.get('/excluded-operators').expect(403);
      await put(c, ['118']).expect(403);
    }
    await executive.get('/excluded-operators').expect(200);
    expect(
      (await e2e.db.selectFrom('excludedOperators').select('extensions').executeTakeFirstOrThrow()).extensions,
    ).toEqual([]);
  });

  it('starts empty; without the PBX database only excluded numbers are offered', async () => {
    const res = await root.get('/excluded-operators').expect(200);
    expect(res.body).toMatchObject({ extensions: [], operators: [], directoryAvailable: false });
  });
});

describe('PUT /api/excluded-operators', () => {
  it('validates the list', async () => {
    for (const bad of [
      ['abc'],
      ['1'],
      ['1234567'],
      ['SIP/118'],
      '118',
      null,
      Array.from({ length: 201 }, (_, i) => String(1000 + i)),
    ]) {
      await put(root, bad).expect(400);
    }
    await root.put('/excluded-operators', {}).expect(400);
  });

  it('stores a sorted, distinct list, audits who changed what', async () => {
    const res = await put(root, ['1111', ' 118', '118']).expect(200);
    expect(res.body.extensions).toEqual(['118', '1111']);
    const rootId = (
      await e2e.db.selectFrom('users').select('id').where('username', '=', ROOT.username).executeTakeFirstOrThrow()
    ).id;
    expect(await e2e.db.selectFrom('excludedOperators').selectAll().executeTakeFirstOrThrow()).toMatchObject({
      extensions: ['118', '1111'],
      updatedByUserId: rootId,
    });
    const audit = await e2e.db
      .selectFrom('auditLog')
      .select(['action', 'actorLabel', 'target', 'details'])
      .where('action', '=', 'excludedOperators.update')
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorLabel: ROOT.username, target: 'excluded_operators' });
    expect(audit[0].details).toEqual({ before: [], after: ['118', '1111'], added: ['118', '1111'], removed: [] });
  });

  it('lists the PBX directory with the excluded flags, unknown excluded numbers last by number', async () => {
    const spy = vi.spyOn(e2e.app.get(ExcludedOperatorsRepository), 'pbxDirectory').mockResolvedValue([
      { extension: '118', name: 'Rahbar' },
      { extension: '101', name: 'Aziza' },
    ]);
    try {
      const res = await executive.get('/excluded-operators').expect(200);
      expect(res.body).toMatchObject({
        extensions: ['118', '1111'],
        directoryAvailable: true,
        operators: [
          { extension: '101', name: 'Aziza', excluded: false },
          { extension: '118', name: 'Rahbar', excluded: true },
          { extension: '1111', name: null, excluded: true },
        ],
      });
      expect(Date.parse(res.body.updatedAt)).not.toBeNaN();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('live operators board', () => {
  it('hides excluded operators from everyone and pushes the board again on every change', async () => {
    await put(root, []).expect(200);
    expect(await boardOf(executive)).toEqual(['101', '118', '1111']);

    const watcher = await executive.openSocket();
    const opSocket = await operator.openSocket();
    const exec = frames(watcher.ws);
    const op = frames(opSocket.ws);
    try {
      await put(root, ['118', '1111']).expect(200);
      expect(await boardOf(executive)).toEqual(['101']);
      expect(await boardOf(operator)).toEqual(['101']);
      const pushed = (await exec.next('telephony.operators')) as { extension: string }[];
      expect(pushed.map((o) => o.extension)).toEqual(['101']);
      // Every signed-in user is told to refetch per-operator statistics (no list in the event).
      expect(await op.next('excludedOperators.changed')).toEqual({ at: expect.any(String) });

      exec.seen.length = 0;
      await put(root, ['1111']).expect(200);
      expect(await boardOf(operator)).toEqual(['101', '118']);
      const again = (await exec.next('telephony.operators')) as { extension: string }[];
      expect(again.map((o) => o.extension)).toEqual(['101', '118']);
    } finally {
      watcher.ws.close();
      opSocket.ws.close();
    }
  });

  it('picks up a list changed outside the API (migrate-legacy) when the settings screen reads it', async () => {
    await e2e.db
      .updateTable('excludedOperators')
      .set({ extensions: sql<string[]>`${sql.val(['101'])}::text[]` })
      .where('id', '=', 1)
      .execute();
    expect(await boardOf(executive)).toEqual(['101', '118']); // still the list in memory
    expect((await root.get('/excluded-operators').expect(200)).body.extensions).toEqual(['101']);
    expect(await boardOf(executive)).toEqual(['118', '1111']);
  });
});

describe('statistics and the Excel report', () => {
  const statsRows = async () =>
    ((await executive.get(`/stats/operators?${RANGE}`).expect(200)).body.operators as { ext: string }[]).map(
      (r) => r.ext,
    );

  async function excelHeader(): Promise<unknown[]> {
    const res = await executive
      .get(`/export/excel?${RANGE}&group=main&lang=uz`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
    return (wb.worksheets[0].getRow(2).values as unknown[]).filter(Boolean);
  }

  it('excluded operators get no row and no report column; totals still count their calls', async () => {
    await put(root, []).expect(200);
    expect(await statsRows()).toEqual(['101', '103', '118']);
    expect(await excelHeader()).toEqual(expect.arrayContaining(['Aziza', 'Bobur', 'Rahbar']));
    const before = (await executive.get(`/stats/summary?${RANGE}`).expect(200)).body;

    await put(executive, ['118']).expect(200);
    expect(await statsRows()).toEqual(['101', '103']);
    expect(await excelHeader()).not.toContain('Rahbar');
    expect((await executive.get(`/stats/summary?${RANGE}`).expect(200)).body).toEqual(before);
    // the call history is not filtered either (legacy)
    const history = await executive.get(`/cdr/calls?${RANGE}&operator=118`).expect(200);
    expect(history.body.total).toBe(1);

    await put(executive, []).expect(200);
    expect(await statsRows()).toEqual(['101', '103', '118']);
  });
});
