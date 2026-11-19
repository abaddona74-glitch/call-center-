/**
 * E2E: call history, stats and Excel export over HTTP (guards, validation, serialization) with deterministic
 * fixture CDR rows (FakeCdrRepository). Needs Postgres from DATABASE_URL (uses `<db>_e2e`).
 */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { CdrRepository } from '../../src/pbx/calls/cdr.repository.js';
import { PBX_DB } from '../../src/pbx/pbx-db.module.js';
import { inbound, internal, outbound } from '../../src/pbx/calls/testing/cdr-fixtures.js';
import { createE2eApp, type E2eContext } from './e2e-app.js';
import { FakeCdrRepository } from './fake-cdr-repository.js';

// Mon 2026-11-16 and Tue 2026-11-17 (both in the past for the test run).
const rows = [
  inbound({ at: '2026-11-16 09:00:00', caller: '998901234567', outcome: 'answered', answeredBy: '101', talk: 100 }),
  inbound({ at: '2026-11-16 09:30:00', caller: '935551122', outcome: 'abandoned', rung: ['101'] }),
  outbound({ at: '2026-11-16 10:00:00', ext: '103', number: '935551122', disposition: 'ANSWERED', talk: 60 }),
  inbound({
    at: '2026-11-17 10:00:00',
    caller: '901234567',
    outcome: 'answered',
    answeredBy: '103',
    talk: 50,
    transfers: [{ to: '101', talk: 40 }],
  }),
  inbound({ at: '2026-11-17 10:30:00', caller: 'anonymous', outcome: 'ivr' }),
  outbound({ at: '2026-11-17 11:00:00', ext: '101', number: '0977778899', disposition: 'BUSY' }),
  internal({ at: '2026-11-17 11:30:00', from: '101', to: '103' }),
  inbound({ at: '2026-11-17 22:00:00', caller: '977778899', outcome: 'after_hours' }),
].flat();
const names = [
  { extension: '101', name: 'Aziza' },
  { extension: '103', name: 'Bobur' },
  { extension: '120', name: 'Kamola' },
  { extension: '205', name: 'Zangiota 205' },
];

let ctx: E2eContext;
// The superuser reads everything here: observers see only the overview dashboard, "Mas'ul" only tickets (19.11.2026).
const get = (path: string, role: keyof E2eContext['cookies'] | null = 'superuser') => {
  const req = request(ctx.app.getHttpServer()).get(path);
  return role ? req.set('Cookie', ctx.cookies[role]) : req;
};

beforeAll(async () => {
  ctx = await createE2eApp((b) => b.overrideProvider(CdrRepository).useValue(new FakeCdrRepository(rows, names)));
}, 60_000);
afterAll(() => ctx?.close());

describe('access by role', () => {
  it('requires a session everywhere', async () => {
    for (const path of [
      '/api/cdr/calls',
      '/api/stats/summary?from=2026-11-16&to=2026-11-17',
      '/api/export/excel?from=2026-11-16&to=2026-11-17',
    ]) {
      await get(path, null).expect(401);
    }
  });

  it('operators: call lists and the per-operator table (as legacy viewer allowed), no recordings', async () => {
    const list = await get('/api/cdr/calls?from=2026-11-16&to=2026-11-17', 'operator').expect(200);
    expect(list.body.total).toBe(8);
    expect(list.body.items.every((c: { recordingFile: string | null }) => c.recordingFile === null)).toBe(true);
    expect(list.body.items.some((c: { hasRecording: boolean }) => c.hasRecording)).toBe(true);
    await get('/api/stats/operators?from=2026-11-16&to=2026-11-17', 'operator').expect(200);
    await get('/api/working-calendar', 'operator').expect(200);
  });

  it('operators: no summary, series, top clients or export (legacy: S-staff only)', async () => {
    for (const path of [
      '/api/stats/summary?from=2026-11-16&to=2026-11-17',
      '/api/stats/series?from=2026-11-16&to=2026-11-17',
      '/api/stats/top-clients?from=2026-11-16&to=2026-11-17',
      '/api/export/excel?from=2026-11-16&to=2026-11-17',
    ]) {
      await get(path, 'operator').expect(403);
    }
  });

  it('the superuser sees recordings', async () => {
    const res = await get('/api/cdr/calls?from=2026-11-16&to=2026-11-16&status=answered&direction=inbound').expect(200);
    expect(res.body.items[0].recordingFile).toMatch(/\.wav$/);
  });

  it('observers (overview dashboard only) and "Mas’ul" (tickets only): no history, statistics or export', async () => {
    for (const role of ['observer', 'executive'] as const) {
      for (const path of [
        '/api/cdr/calls?from=2026-11-16&to=2026-11-17',
        '/api/stats/summary?from=2026-11-16&to=2026-11-17',
        '/api/stats/operators?from=2026-11-16&to=2026-11-17',
        '/api/export/excel?from=2026-11-16&to=2026-11-17',
      ]) {
        await get(path, role).expect(403);
      }
    }
  });
});

describe('GET /api/cdr/calls', () => {
  it('paginates newest first within the date range', async () => {
    const res = await get('/api/cdr/calls?from=2026-11-16&to=2026-11-17&page=2&pageSize=3').expect(200);
    expect(res.body).toMatchObject({
      page: 2,
      pageSize: 3,
      total: 8,
      range: { from: '2026-11-16', to: '2026-11-17', allDays: false },
    });
    expect(res.body.items.map((c: { time: string }) => c.time)).toEqual(['10:30:00', '10:00:00', '10:00:00']);
  });

  it('filters by direction, status, operator and scope', async () => {
    const q = (s: string) => get(`/api/cdr/calls?from=2026-11-16&to=2026-11-17&${s}`).expect(200);
    expect((await q('direction=transfer')).body.total).toBe(1);
    expect((await q('direction=internal')).body.total).toBe(1);
    expect((await q('status=missed')).body.items.map((c: { status: string }) => c.status).sort()).toEqual([
      'abandoned',
      'after_hours',
      'busy',
      'ivr',
    ]);
    expect((await q('status=missed&scope=working')).body.total).toBe(3);
    expect((await q('operator=103')).body.total).toBe(3); // outbound, answered+transferred, internal
  });

  it('a holiday set in the shared working calendar applies at once (cached days are recomputed)', async () => {
    const q = () => get('/api/cdr/calls?from=2026-11-16&to=2026-11-17&scope=working').expect(200);
    const put = (holidays: string[]) =>
      request(ctx.app.getHttpServer())
        .put('/api/working-calendar')
        .set('Cookie', ctx.cookies.superuser)
        .send({ days: [1, 2, 3, 4, 5], start: '08:00', end: '21:00', holidays });
    const before = (await q()).body.total;
    expect(before).toBeGreaterThan(0);
    await put(['11-16', '2026-11-17']).expect(200); // yearly + one-off
    expect((await q()).body.total).toBe(0);
    await put([]).expect(200);
    expect((await q()).body.total).toBe(before);
  });

  it('smart search: phone in any format, extension, operator name', async () => {
    const q = (s: string) =>
      get(`/api/cdr/calls?from=2026-11-16&to=2026-11-17&search=${encodeURIComponent(s)}`).expect(200);
    expect((await q('+998 (90) 123-45-67')).body.total).toBe(2);
    expect((await q('93 555 11 22')).body.total).toBe(2);
    expect((await q('bobur')).body.total).toBe(3);
  });

  it('phone search without dates searches all days', async () => {
    const res = await get(`/api/cdr/calls?search=${encodeURIComponent('998935551122')}`).expect(200);
    expect(res.body.range).toEqual({ from: '2026-11-16', to: '2026-11-16', allDays: true });
    expect(res.body.total).toBe(2);
  });

  it('validates the query', async () => {
    await get('/api/cdr/calls?from=2026-11-17&to=2026-11-01').expect(400);
    await get('/api/cdr/calls?from=17.11.2026').expect(400);
    await get('/api/cdr/calls?status=bogus').expect(400);
    await get('/api/cdr/calls?pageSize=1000').expect(400);
    const tooLong = await get('/api/cdr/calls?from=2026-01-01&to=2026-11-17').expect(400);
    expect(tooLong.body.message).toMatch(/limited to/);
  });
});

describe('GET /api/cdr/calls/:id', () => {
  it('returns the call and its raw legs', async () => {
    const list = await get('/api/cdr/calls?from=2026-11-17&to=2026-11-17&direction=transfer').expect(200);
    const id = list.body.items[0].id;
    const res = await get(`/api/cdr/calls/${id}`, 'operator').expect(200);
    expect(res.body.call).toMatchObject({
      id,
      operator: { ext: '101', name: 'Aziza' },
      operators: [
        { ext: '103', name: 'Bobur' },
        { ext: '101', name: 'Aziza' },
      ],
      transfers: [expect.objectContaining({ from: '103', to: '101', answered: true })],
      talkSec: 90,
      recordingFile: null,
    });
    expect(res.body.legs.length).toBeGreaterThanOrEqual(4);
    expect(res.body.legs[0]).toHaveProperty('dcontext');
  });

  it('404 for an unknown call, 400 for a malformed id', async () => {
    await get('/api/cdr/calls/1763400000.999').expect(404);
    await get(`/api/cdr/calls/${encodeURIComponent("1' or 1=1")}`).expect(400);
  });
});

describe('stats', () => {
  it('summary with one definition per number', async () => {
    const res = await get('/api/stats/summary?from=2026-11-16&to=2026-11-17').expect(200);
    expect(res.body).toMatchObject({
      range: { from: '2026-11-16', to: '2026-11-17', scope: 'working' },
      totalCalls: 5, // 4 inbound offered (working time) + 1 connected outbound
      inbound: { offered: 4, answered: 2, abandoned: 1, ivr: 1, afterHours: 0, answerRate: 50, hiddenNumbers: 1 },
      outbound: { attempts: 2, connected: 1, notConnected: 1 },
      internal: { calls: 1 },
      transfers: 1,
      talk: { totalSec: 100 + 90 + 60 },
    });
    const all = await get('/api/stats/summary?from=2026-11-16&to=2026-11-17&scope=all').expect(200);
    expect(all.body.inbound.afterHours).toBe(1);
  });

  it('per-operator totals reconcile with the summary', async () => {
    const [summary, ops] = await Promise.all([
      get('/api/stats/summary?from=2026-11-16&to=2026-11-17').expect(200),
      get('/api/stats/operators?from=2026-11-16&to=2026-11-17').expect(200),
    ]);
    const rowsByExt = Object.fromEntries(ops.body.operators.map((r: { ext: string }) => [r.ext, r]));
    expect(rowsByExt['101']).toMatchObject({
      name: 'Aziza',
      group: 'main',
      answered: 1,
      transferredIn: 1,
      missed: 1,
      missedNoAnswer: 1,
      missedRejected: 0,
      outboundAttempts: 1,
      outbound: 0,
    });
    expect(rowsByExt['103']).toMatchObject({ answered: 0, transferredOut: 1, outbound: 1, total: 1 });
    expect(rowsByExt['120']).toMatchObject({ total: 0 });
    // No survey table on this PBX: the column is hidden and the rows carry no ratings.
    expect(ops.body.surveyAvailable).toBe(false);
    expect(rowsByExt['101']).toMatchObject({ surveyCount: 0, surveyAvg: null });
    const credited = ops.body.operators.reduce(
      (s: number, r: { answered: number; transferredIn: number }) => s + r.answered + r.transferredIn,
      0,
    );
    expect(credited).toBe(summary.body.inbound.answered);
    const secondary = await get('/api/stats/operators?from=2026-11-16&to=2026-11-17&group=secondary').expect(200);
    expect(secondary.body.operators.map((r: { ext: string }) => r.ext)).toEqual(['205']);
  });

  it('hourly + daily series and top clients', async () => {
    const series = await get('/api/stats/series?from=2026-11-16&to=2026-11-17').expect(200);
    expect(series.body.hourly).toHaveLength(13);
    expect(series.body.hourly.find((p: { hour: number }) => p.hour === 9)).toEqual({
      hour: 9,
      inbound: 2,
      answered: 1,
      abandoned: 1,
      outbound: 0,
    });
    expect(series.body.daily.map((d: { date: string; inbound: number }) => [d.date, d.inbound])).toEqual([
      ['2026-11-16', 2],
      ['2026-11-17', 2],
    ]);
    const top = await get('/api/stats/top-clients?from=2026-11-16&to=2026-11-17&limit=2').expect(200);
    expect(top.body.clients[0]).toMatchObject({ number: '901234567', inbound: 2, answered: 2 });
  });

  it('rejects too long ranges', async () => {
    await get('/api/stats/summary?from=2024-01-01&to=2026-11-17').expect(400);
  });
});

describe('GET /api/export/excel', () => {
  it('downloads an xlsx with the legacy sheets', async () => {
    const res = await get('/api/export/excel?from=2026-11-16&to=2026-11-17&group=main&lang=uz')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('Call_Center_Export_2026-11-16_2026-11-17_Asosiy_UZ.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['16.11 - 17.11', 'Davr hisoboti']);
    const header = wb.worksheets[0].getRow(2).values as unknown[];
    expect(header.slice(1, 4)).toEqual(['Sana', 'Aziza', 'Bobur']);
    expect(header).not.toContain('Zangiota 205');
  });

  it('rejects an unknown group', async () => {
    await get('/api/export/excel?from=2026-11-16&to=2026-11-17&group=nope').expect(400);
  });
});

describe('PBX not configured', () => {
  let off: E2eContext;
  beforeAll(async () => {
    off = await createE2eApp((b) => b.overrideProvider(PBX_DB).useValue(null));
  }, 60_000);
  afterAll(() => off?.close());

  it('returns 503 "PBX unavailable"', async () => {
    const res = await request(off.app.getHttpServer())
      .get('/api/cdr/calls')
      .set('Cookie', off.cookies.superuser)
      .expect(503);
    expect(res.body.message).toMatch(/PBX/);
    await request(off.app.getHttpServer())
      .get('/api/stats/summary?from=2026-11-16&to=2026-11-17')
      .set('Cookie', off.cookies.superuser)
      .expect(503);
  });
});
