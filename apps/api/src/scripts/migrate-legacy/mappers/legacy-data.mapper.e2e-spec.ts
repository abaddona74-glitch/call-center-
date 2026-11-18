import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../../../database/db.js';
import { createDb } from '../../../database/kysely.js';
import { createMigrator } from '../../../database/migrator.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import type { MapperReport } from '../mapper.js';
import { kyselyUnitOfWork, recordMigrationAudit, runMappers } from '../runner.js';
import { createBlacklistMapper } from './blacklist.mapper.js';
import { createCallbacksMapper } from './callbacks.mapper.js';
import { createContactsMapper } from './contacts.mapper.js';
import { createSettingsMapper } from './settings.mapper.js';

/**
 * contacts, callbacks, settings and blacklist mappers against a real, migrated Postgres: constraints, the partial
 * unique indexes, and that a second run changes nothing. Synthetic data only. Shares the e2e database with other
 * files, so it uses its own legacy ids (≥ 990000), its own fake numbers, and restores the settings it touches.
 */

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');
const PHONES = { a: '933990001', b: '933990002', c: '933990003', d: '933990004' };
const BLOCKED = '933990009';

describe('contacts, callbacks, settings, blacklist mappers (e2e, real Postgres)', () => {
  let db: Kysely<DB>;
  let dir: string;
  let legacy: LegacySources;
  let savedLockout: unknown;
  let savedUntil: Date | null;
  let opId: number;

  const cleanTarget = async () => {
    await db.deleteFrom('callbacks').where('legacyId', '>=', 990000).execute();
    await db.deleteFrom('contacts').where('phone', 'in', Object.values(PHONES)).execute();
    await db.deleteFrom('blockedNumbers').where('number', '=', BLOCKED).execute();
  };

  beforeAll(async () => {
    const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('Set E2E_DATABASE_URL');
    db = createDb({ connectionString: url, max: 2 });
    await createMigrator(db).migrateToLatest();
    await cleanTarget();
    savedLockout = (await db.selectFrom('authSettings').select('value').where('key', '=', 'lockout').executeTakeFirst())
      ?.value;
    await db.deleteFrom('authSettings').where('key', '=', 'lockout').execute();
    savedUntil =
      (await db.selectFrom('callbackSettings').select('legacyImportedUntil').where('id', '=', 1).executeTakeFirst())
        ?.legacyImportedUntil ?? null;
    await db.updateTable('callbackSettings').set({ legacyImportedUntil: null }).where('id', '=', 1).execute();

    // The resolving operator: an extension no other user in this shared database has.
    const used = new Set(
      (await db.selectFrom('users').select('extension').where('extension', 'is not', null).execute()).map(
        (u) => u.extension,
      ),
    );
    const ext = Array.from({ length: 800 }, (_, i) => String(4100 + i)).find((e) => !used.has(e))!;
    opId = (
      await db
        .insertInto('users')
        .values({ username: `s10_e2e_${ext}`, passwordHash: 'x', role: 'operator', extension: ext })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    dir = mkdtempSync(path.join(tmpdir(), 'cc-s10-e2e-'));
    const file = path.join(dir, 'callcenter.db');
    const lite = new DatabaseSync(file);
    lite.exec(SCHEMA);
    lite
      .prepare(
        `INSERT INTO system_settings (key, value) VALUES ('auth_lockout_threshold', '5'), ('auth_lockout_duration_min', '60')`,
      )
      .run();
    const contact = lite.prepare(
      `INSERT INTO client_contacts (phone, name, organization, notes, language, telegram_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    contact.run(PHONES.a, 'Test Fuqaro', 'Test MChJ', 'eslatma', 'uz', '');
    contact.run(`998${PHONES.b}`, '', 'Faqat tashkilot', null, '', '123456789');
    const cb = lite.prepare(
      `INSERT INTO pending_callbacks (id, phone, source, call_time, attempts_count, status, dismissed_at, dismissed_by,
         created_at, updated_at, outbound_attempts, last_outbound_time, last_outbound_operator, last_outbound_cause,
         resolution_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const t = '2026-11-18 10:00:00';
    cb.run(
      990001,
      PHONES.a,
      'abandoned',
      t,
      2,
      'pending',
      null,
      null,
      t,
      t,
      1,
      '2026-11-18 10:30:00',
      `Operator ${ext}`,
      'Mijoz band',
      null,
    );
    cb.run(990002, PHONES.b, 'ivr_non_working', t, 1, 'pending', null, null, t, t, 0, null, null, null, null);
    cb.run(
      990003,
      PHONES.c,
      'abandoned',
      t,
      1,
      'resolved',
      '2026-11-18 11:00:00',
      `operator_${ext}_inbound`,
      t,
      '2026-11-18 11:00:00',
      0,
      null,
      null,
      null,
      'client_inbound',
    );
    cb.run(
      990004,
      PHONES.c,
      'abandoned',
      '2026-11-18 12:00:00',
      1,
      'dismissed',
      '2026-11-18 12:30:00',
      'admin',
      t,
      '2026-11-18 12:30:00',
      0,
      null,
      null,
      null,
      null,
    );
    cb.run(990005, PHONES.d, 'abandoned', t, 1, 'pending', null, null, t, t, 0, null, null, null, null);
    lite
      .prepare(`INSERT INTO blacklist (number, variants, note) VALUES (?, '[]', 'Asterisk 114')`)
      .run(`998${BLOCKED}`);
    lite.close();
    legacy = openLegacySources({ sqlitePath: file });
  });

  afterAll(async () => {
    legacy?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (db) {
      await cleanTarget();
      await db.deleteFrom('users').where('id', '=', opId).execute();
      await db.deleteFrom('authSettings').where('key', '=', 'lockout').execute();
      if (savedLockout !== undefined) {
        await db
          .insertInto('authSettings')
          .values({ key: 'lockout', value: JSON.stringify(savedLockout), updatedBy: null })
          .execute();
      }
      await db.updateTable('callbackSettings').set({ legacyImportedUntil: savedUntil }).where('id', '=', 1).execute();
      await db.destroy();
    }
  });

  const run = (dryRun: boolean): Promise<MapperReport[]> =>
    runMappers(
      [
        createSettingsMapper(),
        createContactsMapper(),
        createCallbacksMapper({ now: () => new Date('2026-11-18T12:00:00Z') }),
        createBlacklistMapper(),
      ],
      {
        legacy,
        begin: kyselyUnitOfWork(db),
        dryRun,
        logger: { info: () => undefined, warn: () => undefined },
        audit: recordMigrationAudit,
      },
    );
  const counts = (r: MapperReport) => [r.name, r.status, r.inserted, r.updated, r.unchanged, r.errors.length];

  it('dry-run writes nothing', async () => {
    const reports = await run(true);
    expect(reports.map(counts)).toEqual([
      ['settings', 'ok', 1, 0, 0, 0],
      ['contacts', 'ok', 2, 0, 0, 0],
      ['callbacks', 'ok', 5, 1, 0, 0],
      ['blacklist', 'ok', 1, 0, 0, 0],
    ]);
    expect(await db.selectFrom('callbacks').select('id').where('legacyId', '>=', 990000).execute()).toHaveLength(0);
  });

  it('migrates everything and keeps who/when/how for closed callbacks', async () => {
    const reports = await run(false);
    expect(reports.map(counts)).toEqual([
      ['settings', 'ok', 1, 0, 0, 0],
      ['contacts', 'ok', 2, 0, 0, 0],
      ['callbacks', 'ok', 5, 1, 0, 0],
      ['blacklist', 'ok', 1, 0, 0, 0],
    ]);

    const lockout = await db.selectFrom('authSettings').select('value').where('key', '=', 'lockout').executeTakeFirst();
    expect(lockout?.value).toEqual({ maxAttempts: 5, lockoutMinutes: 60, ipMaxAttempts: 30 });

    const contact = await db.selectFrom('contacts').selectAll().where('phone', '=', PHONES.b).executeTakeFirstOrThrow();
    expect(contact).toMatchObject({ organization: 'Faqat tashkilot', telegram: '123456789', language: null });

    const rows = await db
      .selectFrom('callbacks')
      .selectAll()
      .where('legacyId', '>=', 990000)
      .orderBy('legacyId')
      .execute();
    expect(rows.map((r) => [r.legacyId, r.status, r.source])).toEqual([
      [990001, 'pending', 'abandoned'],
      [990002, 'pending', 'after_hours'],
      [990003, 'resolved', 'abandoned'],
      [990004, 'dismissed', 'abandoned'],
      [990005, 'pending', 'abandoned'],
    ]);
    expect(rows[0]).toMatchObject({ missedCount: 2, outboundAttempts: 1, lastOutboundCause: 'busy', closedAt: null });
    expect(rows[2]).toMatchObject({
      closeMethod: 'conversation',
      closedByUserId: opId,
      resolutionType: 'client_inbound',
      closedAt: new Date('2026-11-18T06:00:00Z'),
    });
    expect(rows[3]).toMatchObject({ closeMethod: 'manual', closedByLabel: 'admin', closedByUserId: null });

    const events = await db
      .selectFrom('callbackEvents')
      .select(['callbackId', 'kind', 'callId'])
      .where(
        'callbackId',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('id')
      .execute();
    expect(events.filter((e) => e.callbackId === rows[0].id).map((e) => e.kind)).toEqual(['missed', 'outbound_failed']);
    expect(events.filter((e) => e.callbackId === rows[3].id).map((e) => e.kind)).toEqual(['missed', 'dismissed']);
    expect(events.every((e) => e.callId === null)).toBe(true);

    const until = await db
      .selectFrom('callbackSettings')
      .select('legacyImportedUntil')
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    expect(until.legacyImportedUntil).toEqual(new Date('2026-11-18T07:30:00Z'));

    const blocked = await db
      .selectFrom('blockedNumbers')
      .selectAll()
      .where('number', '=', BLOCKED)
      .executeTakeFirstOrThrow();
    expect(blocked).toMatchObject({ scope: 'operator', extension: '114', syncState: 'pending' });
    expect(blocked.variants).toEqual([BLOCKED, `998${BLOCKED}`]);

    const audits = await db
      .selectFrom('auditLog')
      .select('action')
      .where('action', 'in', ['migration.legacy.callbacks', 'migration.legacy.contacts'])
      .execute();
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('a second run changes nothing', async () => {
    const reports = await run(false);
    expect(reports.map(counts)).toEqual([
      ['settings', 'ok', 0, 0, 1, 0],
      ['contacts', 'ok', 0, 0, 2, 0],
      ['callbacks', 'ok', 0, 0, 5, 0],
      ['blacklist', 'ok', 0, 0, 1, 0],
    ]);
    const n = await db
      .selectFrom('callbacks')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('legacyId', '>=', 990000)
      .executeTakeFirstOrThrow();
    expect(n.n).toBe(5);
  });
});
