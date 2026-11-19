/**
 * E2E: the "Mijoz bahosi" column of GET /api/stats/operators with the PBX survey installed
 * (FakeCdrRepository returns ratings). The survey-missing case is covered in cdr-stats.e2e-spec.ts.
 */
import request from 'supertest';
import { CdrRepository } from '../../src/pbx/calls/cdr.repository.js';
import { inbound, internal } from '../../src/pbx/calls/testing/cdr-fixtures.js';
import { createE2eApp, type E2eContext } from './e2e-app.js';
import { FakeCdrRepository } from './fake-cdr-repository.js';

const a = inbound({
  at: '2026-11-16 09:00:00',
  caller: '998901234567',
  outcome: 'answered',
  answeredBy: '101',
  talk: 100,
});
const b = inbound({ at: '2026-11-16 09:30:00', caller: '935551122', outcome: 'answered', answeredBy: '101', talk: 30 });
const c = inbound({
  at: '2026-11-16 10:00:00',
  caller: '901234567',
  outcome: 'answered',
  answeredBy: '103',
  talk: 50,
  transfers: [{ to: '120', talk: 40 }],
});
const test = internal({ at: '2026-11-16 11:00:00', from: '101', to: '103' });
const id = (rows: { linkedid: string }[]) => rows[0].linkedid;
const ratings = [
  { uniqueid: id(a), linkedid: id(a), operatorExt: '101', score: 5 },
  { uniqueid: id(b), linkedid: id(b), operatorExt: '101', score: 4 },
  { uniqueid: id(c), linkedid: id(c), operatorExt: '103', score: 2 }, // transferred: 120 talked last
  { uniqueid: id(test), linkedid: id(test), operatorExt: '103', score: 1 }, // internal test call: ignored
];
const names = [
  { extension: '101', name: 'Aziza' },
  { extension: '103', name: 'Bobur' },
  { extension: '120', name: 'Kamola' },
];

let ctx: E2eContext;
beforeAll(async () => {
  ctx = await createE2eApp((builder) =>
    builder
      .overrideProvider(CdrRepository)
      .useValue(new FakeCdrRepository([...a, ...b, ...c, ...test], names, ratings)),
  );
}, 60_000);
afterAll(() => ctx?.close());

it('shows the column and per-operator ratings', async () => {
  const res = await request(ctx.app.getHttpServer())
    .get('/api/stats/operators?from=2026-11-16&to=2026-11-16&scope=all')
    .set('Cookie', ctx.cookies.superuser)
    .expect(200);
  expect(res.body.surveyAvailable).toBe(true);
  const by = Object.fromEntries(res.body.operators.map((r: { ext: string }) => [r.ext, r]));
  expect(by['101']).toMatchObject({ surveyCount: 2, surveyAvg: 4.5 });
  expect(by['103']).toMatchObject({ surveyCount: 0, surveyAvg: null });
  expect(by['120']).toMatchObject({ surveyCount: 1, surveyAvg: 2 });
});
