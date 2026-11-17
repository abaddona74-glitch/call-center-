/**
 * E2E against the real (mock) PBX MariaDB from PBX_DB_* — checks that every CDR query is valid SQL for
 * MariaDB, runs as the read-only user, and that the seeded history assembles into calls.
 * Skipped when PBX_DB_HOST is not set. Seed: `pnpm dev:pbx:seed`.
 */
import request from 'supertest';
import { todayInZone } from '../../src/common/time/business-time.js';
import { CdrRepository } from '../../src/pbx/calls/cdr.repository.js';
import { createE2eApp, type E2eContext, prepareEnv } from './e2e-app.js';

await prepareEnv();
const enabled = Boolean(process.env.PBX_DB_HOST);

describe.runIf(enabled)('PBX MariaDB (read-only user)', () => {
  let ctx: E2eContext;
  let repo: CdrRepository;
  const today = todayInZone();

  beforeAll(async () => {
    ctx = await createE2eApp();
    repo = ctx.app.get(CdrRepository);
  }, 60_000);
  afterAll(() => ctx?.close());

  it('reads typed rows, operator names and number lookups', async () => {
    const rows = await repo.rowsBetween(`${today} 00:00:00`, `${today} 23:59:59`);
    for (const r of rows.slice(0, 50)) {
      expect(typeof r.calldate).toBe('string');
      expect(r.calldate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(typeof r.billsec).toBe('number');
    }
    const names = await repo.operatorNames();
    expect(names.length).toBeGreaterThan(0);
    const days = await repo.daysWithNumbers(['901234567', '998901234567'], 5);
    expect(Array.isArray(days)).toBe(true);
    if (rows[0]) {
      expect((await repo.callRows(rows[0].linkedid, `${today} 00:00:00`, `${today} 23:59:59`)).length).toBeGreaterThan(
        0,
      );
      expect(await repo.calldateOf(rows[0].uniqueid)).toBe(rows[0].calldate);
    }
  });

  it('serves history and stats from the seeded PBX', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/cdr/calls?pageSize=5`)
      .set('Cookie', ctx.cookies.admin)
      .expect(200);
    expect(res.body.range.to).toBe(today);
    const summary = await request(ctx.app.getHttpServer())
      .get(`/api/stats/summary?from=${today}&to=${today}&scope=all`)
      .set('Cookie', ctx.cookies.admin)
      .expect(200);
    expect(summary.body.inbound.offered).toBeGreaterThanOrEqual(summary.body.inbound.answered);
  });
});
