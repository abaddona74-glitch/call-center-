import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG_1PX } from '../../../../test/fixtures/files.js';
import type { DB } from '../../../database/db.js';
import { createDb } from '../../../database/kysely.js';
import { createMigrator } from '../../../database/migrator.js';
import { openLegacySources } from '../legacy-sources.js';
import type { MapperReport } from '../mapper.js';
import { createTicketsMapper } from './tickets.mapper.js';

// Ids >= 90000 so this file does not collide with tickets.e2e-spec.ts (same database, run in parallel).
const IDS = [90001, 90002];

describe('tickets mapper (e2e, real Postgres)', () => {
  let db: Kysely<DB>;
  let tmp: string;
  let uploadDir: string;
  let receiverId: number;

  beforeAll(async () => {
    const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('Set E2E_DATABASE_URL');
    db = createDb({ connectionString: url, max: 2 });
    await createMigrator(db).migrateToLatest();
    await db.deleteFrom('tickets').where('id', 'in', IDS).execute();

    const ext = String(150 + (randomBytes(1)[0] % 40));
    receiverId = (
      await db
        .insertInto('users')
        .values({
          username: `s5_mapper_${randomBytes(4).toString('hex')}`,
          passwordHash: 'x',
          role: 'operator',
          extension: ext,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    tmp = await mkdtemp(path.join(tmpdir(), 'cc-s5-mapper-'));
    uploadDir = path.join(tmp, 'store');
    await mkdir(path.join(tmp, 'ticket-uploads'));
    await writeFile(path.join(tmp, 'ticket-uploads', 'tk_1_a_shot.png'), PNG_1PX);
    await writeFile(
      path.join(tmp, 'ticket-uploads', 'tk_2_b_old.doc'),
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
    await writeFile(
      path.join(tmp, 'tickets.json'),
      JSON.stringify({
        lastCleanedMonday: null,
        tickets: [
          {
            id: 'TK-90001',
            creatorId: '201',
            creatorName: 'Operator 201',
            comment: 'Shartnoma nusxasi kerak',
            files: [
              { name: 'shot.png', fileName: 'tk_1_a_shot.png' },
              { name: 'old.doc', fileName: 'tk_2_b_old.doc' },
              { name: 'gone.png', fileName: 'tk_3_c_gone.png' },
            ],
            isUrgent: false,
            targetOperatorId: ext,
            targetOperatorName: 'Receiver',
            status: 'in_progress',
            acceptedBy: { id: ext, name: 'Receiver', at: 1763370100000 },
            createdAt: 1763370000000,
            updatedAt: 1763370100000,
            comments: [
              {
                id: 'cm_1',
                operatorId: ext,
                operatorName: 'Receiver',
                text: 'Ko‘ryapman',
                files: [],
                createdAt: 1763370200000,
              },
            ],
          },
          {
            id: 'TK-90002',
            creatorId: '201',
            comment: 'Rad etiladigan',
            targetOperatorId: 'all',
            status: 'rejected',
            rejectedBy: { id: ext, name: 'Receiver', at: 1763370300000, reason: 'Dublikat' },
            createdAt: 1763370000000,
            updatedAt: 1763370300000,
            comments: [
              {
                id: 'cm_2_sys',
                operatorId: ext,
                operatorName: 'Receiver',
                text: '🚫 Ticket rad etildi. Sabab: Dublikat',
                isSystem: true,
                createdAt: 1763370300000,
              },
            ],
          },
          { id: 'broken' },
        ],
      }),
    );
  });

  afterAll(async () => {
    await db?.deleteFrom('tickets').where('id', 'in', IDS).execute();
    await db?.deleteFrom('users').where('id', '=', receiverId).execute();
    await db?.destroy();
    await rm(tmp, { recursive: true, force: true });
  });

  async function run(dryRun: boolean, defaultRegion: string | null = null): Promise<MapperReport> {
    const legacy = openLegacySources({ dataDir: tmp });
    const mapper = createTicketsMapper({ uploadDir: () => uploadDir, defaultRegion: () => defaultRegion });
    const logger = { info: () => {}, warn: () => {} };
    try {
      return await db.transaction().execute(async (trx) => {
        const report = await mapper.run({ legacy, db: trx, dryRun, logger });
        if (dryRun) throw Object.assign(new Error('rollback'), { report });
        return report;
      });
    } catch (err) {
      const report = (err as { report?: MapperReport }).report;
      if (report) return report;
      throw err;
    } finally {
      legacy.close();
    }
  }

  it('dry-run plans without writing', async () => {
    const r = await run(true);
    expect(r).toMatchObject({ read: 3, inserted: 2, unchanged: 0 });
    expect(await db.selectFrom('tickets').select('id').where('id', 'in', IDS).execute()).toEqual([]);
  });

  it('refuses an unknown default region', async () => {
    const r = await run(true, 'atlantis');
    expect(r).toMatchObject({
      status: 'failed',
      errors: [expect.objectContaining({ key: 'LEGACY_TICKETS_DEFAULT_REGION' })],
    });
  });

  it('imports tickets with their numbers, people, comments, timeline and allowed files', async () => {
    const r = await run(false, 'samarqand');
    expect(r).toMatchObject({ status: 'ok', read: 3, inserted: 2, unchanged: 0 });
    expect(r.skipped).toEqual([expect.objectContaining({ key: 'broken' })]);
    expect(r.warnings.map((w) => w.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('old.doc'),
        expect.stringContaining('tk_3_c_gone.png not found'),
      ]),
    );

    const samarqand = await db
      .selectFrom('ticketRegions')
      .select('id')
      .where('code', '=', 'samarqand')
      .executeTakeFirstOrThrow();
    const t1 = await db.selectFrom('tickets').selectAll().where('id', '=', 90001).executeTakeFirstOrThrow();
    expect(t1).toMatchObject({
      status: 'in_progress',
      creatorExtension: '201',
      assigneeUserId: receiverId,
      regionId: samarqand.id,
      categoryId: null,
      dueAt: null,
    });
    expect(r.warnings.map((w) => w.reason)).toEqual(
      expect.arrayContaining([expect.stringContaining('routes by region only')]),
    );
    const files = await db.selectFrom('ticketAttachments').selectAll().where('ticketId', '=', 90001).execute();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ fileName: 'shot.png', kind: 'image', mimeType: 'image/png' });
    expect(await readdir(uploadDir)).toEqual([files[0].storageKey]);

    const t2 = await db.selectFrom('tickets').selectAll().where('id', '=', 90002).executeTakeFirstOrThrow();
    expect(t2).toMatchObject({
      status: 'closed',
      resolution: 'rejected',
      resolutionNote: 'Dublikat',
      resolvedByUserId: receiverId,
    });
    const e2 = await db
      .selectFrom('ticketEvents')
      .select(['kind', 'note'])
      .where('ticketId', '=', 90002)
      .orderBy('id')
      .execute();
    expect(e2.map((e) => e.kind)).toEqual(['created', 'rejected', 'closed']);
    const c2 = await db.selectFrom('ticketComments').selectAll().where('ticketId', '=', 90002).execute();
    expect(c2).toEqual([expect.objectContaining({ isSystem: true, body: 'Dublikat' })]);

    // New tickets continue after the legacy numbers.
    const seq = await sql<{ lastValue: number }>`select last_value from tickets_id_seq`.execute(db);
    expect(Number(seq.rows[0].lastValue)).toBeGreaterThanOrEqual(90002);
  });

  it('is idempotent', async () => {
    const r = await run(false);
    expect(r).toMatchObject({ inserted: 0, unchanged: 2 });
    expect(await db.selectFrom('ticketComments').select('id').where('ticketId', 'in', IDS).execute()).toHaveLength(2);
  });
});
