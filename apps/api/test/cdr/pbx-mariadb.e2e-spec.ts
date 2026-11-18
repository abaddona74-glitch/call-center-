/**
 * E2E against the real (mock) PBX MariaDB from PBX_DB_* — checks that every CDR query is valid SQL for
 * MariaDB, runs as the read-only user, and that the seeded history assembles into calls.
 * Skipped when PBX_DB_HOST is not set. Seed: `pnpm dev:pbx:seed`.
 */
import { BUSINESS_TIMEZONE } from '@cc/shared';
import request from 'supertest';
import { todayInZone } from '../../src/common/time/business-time.js';
import { SEED_DAY_GUARD_MS, SEED_MAX_ROWS_PER_SLICE, SEED_SLICE_MS } from '../../src/modules/live/counter-seeder.js';
import { addCallsToSeed, dayStartMs, emptySeed } from '../../src/modules/live/domain/cdr-seed.js';
import { CdrRepository } from '../../src/pbx/calls/cdr.repository.js';
import { PbxCallsService } from '../../src/pbx/calls/pbx-calls.service.js';
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

  it('post-call survey: rows when operator_baho exists and is granted, otherwise null — never a 503', async () => {
    const ratings = await repo.surveyRatings(`${today} 00:00:00`, `${today} 23:59:59`);
    expect(ratings === null || Array.isArray(ratings)).toBe(true);
    for (const r of ratings ?? []) expect(r.score).toBeGreaterThanOrEqual(1);
    const ops = await request(ctx.app.getHttpServer())
      .get(`/api/stats/operators?from=${today}&to=${today}&scope=all`)
      .set('Cookie', ctx.cookies.executive)
      .expect(200);
    expect(ops.body.surveyAvailable).toBe(ratings !== null);
    // Ratings reach their calls both with and without the cdr.linkedid column (PBX_CDR_HAS_LINKEDID).
    if (ratings?.length) {
      const rated = ops.body.operators.reduce((s: number, r: { surveyCount: number }) => s + r.surveyCount, 0);
      expect(rated).toBeGreaterThan(0);
    }
  });

  it('the live counters seed reads today in capped slices and agrees with the statistics summary', async () => {
    const day = 86_400_000;
    const from = dayStartMs(today, BUSINESS_TIMEZONE);
    const read = await ctx.app
      .get(PbxCallsService)
      .callsFromSlices(from - SEED_DAY_GUARD_MS, from + day + SEED_DAY_GUARD_MS, {
        sliceMs: SEED_SLICE_MS,
        maxRowsPerSlice: SEED_MAX_ROWS_PER_SLICE,
      });
    expect(read.queries).toBe(28);
    // boundary at the end of the day: every call of today is on the CDR side
    const { seed } = addCallsToSeed(emptySeed(today, from, from + day), read.calls);
    const summary = await request(ctx.app.getHttpServer())
      .get(`/api/stats/summary?from=${today}&to=${today}&scope=all`)
      .set('Cookie', ctx.cookies.executive)
      .expect(200);
    const s = summary.body;
    expect(seed.counters).toMatchObject({
      inbound: s.inbound.offered,
      answered: s.inbound.answered,
      abandoned: s.inbound.abandoned,
      ivrOnly: s.inbound.ivr,
      unanswered: s.inbound.offered - s.inbound.answered,
      outbound: s.outbound.attempts,
      outboundAnswered: s.outbound.connected,
      talkSeconds: s.talk.totalSec,
    });
  });

  it('serves history and stats from the seeded PBX', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/cdr/calls?pageSize=5`)
      .set('Cookie', ctx.cookies.executive)
      .expect(200);
    expect(res.body.range.to).toBe(today);
    const summary = await request(ctx.app.getHttpServer())
      .get(`/api/stats/summary?from=${today}&to=${today}&scope=all`)
      .set('Cookie', ctx.cookies.executive)
      .expect(200);
    expect(summary.body.inbound.offered).toBeGreaterThanOrEqual(summary.body.inbound.answered);
  });
});
