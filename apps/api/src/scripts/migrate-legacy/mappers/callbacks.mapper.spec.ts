import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { DB } from '../../../database/db.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import { MapperReportSchema, type MigrationContext } from '../mapper.js';
import {
  type CallbackInsert,
  type CallbacksRepository,
  collapseWarnings,
  createCallbacksMapper,
  type ExistingCallbacks,
  extensionFromLabel,
  extensionFromTag,
  legacyHistoryEnd,
  planCallbacks,
  resolutionTypeFromTag,
  type TargetUser,
  transformLegacyCallback,
} from './callbacks.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

interface FakeCallback {
  phone: string;
  source?: string;
  callTime: string;
  attempts?: number;
  status?: string;
  dismissedAt?: string | null;
  dismissedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  outbound?: number;
  lastOutboundTime?: string | null;
  lastOutboundOperator?: string | null;
  lastOutboundCause?: string | null;
  resolutionType?: string | null;
}

/** Synthetic rows only: fake numbers 90 000 00xx, fake extensions and usernames. */
const ROWS: FakeCallback[] = [
  // #1 open, never called back
  { phone: '900000001', callTime: '2026-11-18 10:00:00', createdAt: '2026-11-18 09:00:00', attempts: 3 },
  // #2 open after hours, two failed call backs by ext 101
  {
    phone: '998900000002',
    source: 'ivr_non_working',
    callTime: '2026-11-17 22:00:00',
    outbound: 2,
    lastOutboundTime: '2026-11-18 08:30:00',
    lastOutboundOperator: 'Operator 101',
    lastOutboundCause: 'Javob bermadi',
  },
  // #3 resolved by an inbound conversation with ext 101
  {
    phone: '900000003',
    callTime: '2026-11-10 11:00:00',
    status: 'resolved',
    dismissedAt: '2026-11-10 11:20:00',
    dismissedBy: 'operator_101_inbound',
    lastOutboundOperator: 'Test Ism (101)',
    resolutionType: 'client_inbound',
  },
  // #4 resolved by the CDR sync: no tag extension, label carries it, no stored type
  {
    phone: '900000004',
    callTime: '2026-11-11 11:00:00',
    status: 'resolved',
    dismissedAt: '2026-11-11 12:00:00',
    dismissedBy: 'cdr_sync_answered',
    lastOutboundOperator: 'Test Ism (102)',
  },
  // #5 resolved with nothing to identify the operator
  {
    phone: '900000005',
    callTime: '2026-11-12 11:00:00',
    status: 'resolved',
    dismissedAt: '2026-11-12 11:30:00',
    dismissedBy: 'operator_NULL',
    lastOutboundOperator: 'NULL',
  },
  // #6 dismissed by a known user (different case)
  {
    phone: '900000006',
    callTime: '2026-11-13 11:00:00',
    status: 'dismissed',
    dismissedAt: '2026-11-13 18:00:00',
    dismissedBy: 'Test_Boss',
  },
  // #7 dismissed with legacy's default actor
  {
    phone: '900000007',
    callTime: '2026-11-14 11:00:00',
    status: 'dismissed',
    dismissedAt: '2026-11-14 18:00:00',
    dismissedBy: 'admin',
    resolutionType: 'client_inbound',
  },
  // #8 unusable phone
  { phone: '12345', callTime: '2026-11-15 11:00:00' },
  // #9 the call centre's own number
  { phone: '712020159', callTime: '2026-11-15 11:00:00' },
  // #10 a second open row of #1's phone (older call): merged into #1
  { phone: '998900000001', callTime: '2026-11-17 10:00:00', createdAt: '2026-11-17 10:00:00', attempts: 2 },
  // #11 unknown source
  { phone: '900000011', source: 'manual', callTime: '2026-11-15 11:00:00' },
  // #12 open, busy call back by a named operator without an extension
  {
    phone: '900000012',
    callTime: '2026-11-18 12:00:00',
    outbound: 1,
    lastOutboundTime: '2026-11-18 12:10:00',
    lastOutboundOperator: 'Faqat Ism',
    lastOutboundCause: 'Mijoz band',
  },
];

function createLegacyDb(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-callbacks-'));
  const file = path.join(dir, 'callcenter.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO pending_callbacks (phone, caller_name, source, call_time, attempts_count, today_attempts, status,
       dismissed_at, dismissed_by, created_at, updated_at, outbound_attempts, last_outbound_time,
       last_outbound_operator, last_outbound_cause, resolution_type)
     VALUES (?, '', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of ROWS) {
    insert.run(
      r.phone,
      r.source ?? 'abandoned',
      r.callTime,
      r.attempts ?? 1,
      r.status ?? 'pending',
      r.dismissedAt ?? null,
      r.dismissedBy ?? null,
      r.createdAt ?? r.callTime,
      r.updatedAt ?? r.dismissedAt ?? r.lastOutboundTime ?? r.callTime,
      r.outbound ?? 0,
      r.lastOutboundTime ?? null,
      r.lastOutboundOperator ?? null,
      r.lastOutboundCause ?? null,
      r.resolutionType ?? null,
    );
  }
  db.close();
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const USERS: TargetUser[] = [
  { id: 1, username: 'test_boss', extension: null, isActive: true },
  { id: 2, username: 'old101', extension: '101', isActive: false },
  { id: 3, username: 'op101', extension: '101', isActive: true },
  { id: 4, username: 'op102', extension: '102', isActive: true },
];

class InMemoryCallbacksRepository implements CallbacksRepository {
  readonly inserted: CallbackInsert[] = [];
  until: Date | null = null;
  constructor(private readonly openByPhone = new Map<string, number>()) {}
  async existing(): Promise<ExistingCallbacks> {
    const open = new Map(this.openByPhone);
    for (const [i, c] of this.inserted.entries()) if (c.row.status === 'pending') open.set(c.row.phone, 1000 + i);
    return { legacyIds: new Set(this.inserted.map((c) => c.row.legacyId)), openByPhone: open };
  }
  async listUsers() {
    return USERS;
  }
  async insertIfAbsent(item: CallbackInsert) {
    if (this.inserted.some((c) => c.row.legacyId === item.row.legacyId)) return false;
    this.inserted.push(item);
    return true;
  }
  async legacyImportedUntil() {
    return this.until;
  }
  async setLegacyImportedUntil(until: Date) {
    this.until = until;
  }
}

const tz = (local: string) => new Date(`${local.replace(' ', 'T')}+05:00`);
const NOW = tz('2026-11-18 16:40:00');

describe('callbacks mapper', () => {
  let legacyDb: { file: string; cleanup: () => void };
  let legacy: LegacySources;

  beforeAll(() => {
    legacyDb = createLegacyDb();
    legacy = openLegacySources({ sqlitePath: legacyDb.file });
  });
  afterAll(() => {
    legacy.close();
    legacyDb.cleanup();
  });

  const rows = () => legacy.sqlite!.all('SELECT * FROM pending_callbacks ORDER BY id');
  const transform = (id: number) => transformLegacyCallback(rows().find((r) => r.id === id)!);
  const plan = (existing: ExistingCallbacks = { legacyIds: new Set(), openByPhone: new Map() }) =>
    planCallbacks(
      rows().map((r) => transformLegacyCallback(r)),
      existing,
      USERS,
    );
  const insertOf = (p: ReturnType<typeof plan>, key: string) => p.inserts.find((i) => i.key === key)!;
  const ctx = (dryRun: boolean): MigrationContext => ({
    legacy,
    db: {} as Kysely<DB>,
    dryRun,
    logger: { info: () => undefined, warn: () => undefined },
  });
  const mapper = (repo: CallbacksRepository) =>
    createCallbacksMapper({
      repositoryFor: () => repo,
      serviceNumbers: () => ['2020159', '712020159'],
      now: () => NOW,
    });

  describe('helpers', () => {
    it('reads extensions from legacy resolve tags and operator labels', () => {
      expect(extensionFromTag('operator_101_inbound')).toBe('101');
      expect(extensionFromTag('operator_120')).toBe('120');
      expect(extensionFromTag('3cx_answered_105')).toBe('105');
      expect(extensionFromTag('operator_NULL')).toBeNull();
      expect(extensionFromTag('cdr_sync_answered')).toBeNull();
      expect(extensionFromLabel('Test Ism (103)')).toBe('103');
      expect(extensionFromLabel('Operator 111')).toBe('111');
      expect(extensionFromLabel('119')).toBe('119');
      expect(extensionFromLabel('Faqat Ism')).toBeNull();
      expect(extensionFromLabel('null')).toBeNull();
    });

    it('derives the resolution type the way legacy did', () => {
      expect(resolutionTypeFromTag('operator_101_outbound')).toBe('operator_outbound');
      expect(resolutionTypeFromTag('realtime_outbound_bridge')).toBe('operator_outbound');
      expect(resolutionTypeFromTag('operator_101_inbound')).toBe('client_inbound');
      expect(resolutionTypeFromTag('realtime_agent_connect')).toBe('client_inbound');
      expect(resolutionTypeFromTag('cdr_sync_answered')).toBeNull();
    });

    it('finds where the legacy history ends, ignoring future timestamps', () => {
      const end = legacyHistoryEnd(rows(), NOW);
      expect(end).toEqual({ until: tz('2026-11-18 12:10:00'), future: 0 });
      expect(legacyHistoryEnd(rows(), tz('2026-11-18 11:00:00')).future).toBeGreaterThan(0);
    });
  });

  describe('transformLegacyCallback', () => {
    it('keeps an open callback open with its counters and Tashkent times', () => {
      const r = transform(1);
      if (!r.ok) throw new Error(r.reason);
      expect(r.values).toMatchObject({ legacyId: 1, phone: '900000001', status: 'pending', source: 'abandoned' });
      expect(r.values.lastMissedAt).toEqual(tz('2026-11-18 10:00:00'));
      expect(r.values.firstMissedAt).toEqual(tz('2026-11-18 09:00:00'));
      expect(r.values.missedCount).toBe(3);
      expect(r.values.close).toBeNull();
    });

    it('maps ivr_non_working to after_hours and keeps who failed to call back and why', () => {
      const r = transform(2);
      expect(r.ok && r.values).toMatchObject({
        phone: '900000002',
        source: 'after_hours',
        outboundAttempts: 2,
        lastOutboundExtension: '101',
        lastOutboundCause: 'no_answer',
        lastOutboundAt: tz('2026-11-18 08:30:00'),
      });
    });

    it('closes resolved rows as conversations with the extension and resolution type', () => {
      expect(transform(3)).toMatchObject({
        ok: true,
        values: {
          status: 'resolved',
          lastOutboundExtension: null,
          close: {
            closedAt: tz('2026-11-10 11:20:00'),
            method: 'conversation',
            extension: '101',
            resolutionType: 'client_inbound',
          },
        },
      });
      expect(transform(4)).toMatchObject({ ok: true, values: { close: { extension: '102', resolutionType: null } } });
      expect(transform(5)).toMatchObject({ ok: true, values: { close: { extension: null } } });
    });

    it('closes dismissed rows manually with the legacy actor and no resolution type', () => {
      expect(transform(7)).toMatchObject({
        ok: true,
        values: { status: 'dismissed', close: { method: 'manual', actor: 'admin', resolutionType: null } },
      });
    });

    it('skips unusable phones, the call centre number and unknown sources without printing the phone', () => {
      expect(transform(8)).toEqual({
        ok: false,
        key: '#8',
        legacyId: 8,
        reason: 'phone is not a usable number (5 digits)',
      });
      expect(transform(9)).toMatchObject({
        ok: false,
        reason: "the call centre's own number (legacy deleted these at startup)",
      });
      expect(transform(11)).toMatchObject({ ok: false, reason: 'unknown source "manual"' });
    });

    it('warns when the last call back operator has no extension', () => {
      const r = transform(12);
      expect(r.ok && r.values.lastOutboundExtension).toBeNull();
      expect(r.ok && r.values.lastOutboundCause).toBe('busy');
      expect(r.ok && r.warnings).toEqual([
        'last_outbound_operator names no operator extension (a name, or the trunk number); kept without it',
      ]);
    });
  });

  describe('planCallbacks', () => {
    it('finds users like the tickets mapper: an active user by extension, a dismisser by username', () => {
      const p = plan();
      expect(insertOf(p, '#3').row).toMatchObject({
        closedByUserId: 3, // active op101 wins over the inactive old101 with the same extension
        closedByLabel: 'ext 101',
        closeMethod: 'conversation',
        resolutionType: 'client_inbound',
        resolvedExtension: '101',
      });
      expect(insertOf(p, '#5').row).toMatchObject({ closedByUserId: null, closedByLabel: 'system' });
      expect(insertOf(p, '#6').row).toMatchObject({
        status: 'dismissed',
        closedByUserId: 1,
        closedByLabel: 'Test_Boss',
        closeMethod: 'manual',
        closedAt: tz('2026-11-13 18:00:00'),
      });
      expect(insertOf(p, '#7').row).toMatchObject({
        closedByUserId: null,
        closedByLabel: 'admin',
        resolutionType: null,
      });
      expect(p.notes).toContain('dismissed by "admin" (no such user in the new system): 1, kept as a label');
    });

    it('builds the timeline: missed, failed call back, close', () => {
      const p = plan();
      expect(insertOf(p, '#2').events.map((e) => [e.kind, e.at, e.cause])).toEqual([
        ['missed', tz('2026-11-17 22:00:00'), null],
        ['outbound_failed', tz('2026-11-18 08:30:00'), 'no_answer'],
      ]);
      expect(insertOf(p, '#6').events.map((e) => [e.kind, e.actorUserId, e.actorLabel])).toEqual([
        ['missed', null, 'system'],
        ['dismissed', 1, 'Test_Boss'],
      ]);
    });

    it('merges open rows of one phone into the latest one (one open callback per phone)', () => {
      const p = plan();
      expect(p.skipped).toContainEqual({
        key: '#10',
        reason: 'open callback of the same phone; merged into legacy #1',
      });
      expect(insertOf(p, '#1').row).toMatchObject({ missedCount: 5, firstMissedAt: tz('2026-11-17 10:00:00') });
      expect(p.inserts.map((i) => i.key)).toEqual(['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#12']);
    });

    it('leaves a phone to the open callback the new system already has; imported rows are unchanged', () => {
      const p = plan({ legacyIds: new Set([3, 6]), openByPhone: new Map([['900000002', 77]]) });
      expect(p.unchanged).toBe(2);
      expect(p.inserts.map((i) => i.key)).toEqual(['#1', '#4', '#5', '#7', '#12']);
      expect(p.skipped).toContainEqual({
        key: '#2',
        reason: 'the phone already has an open callback in the new system (callbacks.id 77); left to it',
      });
    });
  });

  it('collapses a warning repeated on many rows into one line', () => {
    const w = (key: string, reason = 'same') => ({ key, reason });
    expect(collapseWarnings([w('#1'), w('#2'), w('#3'), w('#4'), w('#5', 'other')])).toEqual([
      { key: '4 rows, e.g. #1, #2, #3', reason: 'same' },
      { key: '#5', reason: 'other' },
    ]);
    expect(collapseWarnings([w('#1'), w('#2')])).toEqual([w('#1'), w('#2')]);
  });

  describe('run', () => {
    it('dry-run plans without writing; no phones in the report', async () => {
      const repo = new InMemoryCallbacksRepository();
      const report = await mapper(repo).run(ctx(true));
      expect(MapperReportSchema.parse(report)).toEqual(report);
      expect(report).toMatchObject({ name: 'callbacks', owner: 'S4', status: 'ok', read: 12, inserted: 8, updated: 1 });
      expect(report.skipped.map((s) => s.key)).toEqual(['#8', '#9', '#10', '#11']);
      expect(repo.inserted).toHaveLength(0);
      expect(repo.until).toBeNull();
      expect(JSON.stringify(report)).not.toMatch(/90000000\d|712020159|12345/);
    });

    it('migrates, moves legacy_imported_until forward, and a re-run changes nothing', async () => {
      const repo = new InMemoryCallbacksRepository();
      const first = await mapper(repo).run(ctx(false));
      expect(first).toMatchObject({ inserted: 8, updated: 1, unchanged: 0, errors: [] });
      expect(repo.until).toEqual(tz('2026-11-18 12:10:00'));
      expect(first.notes).toContain('new: 3 open, 3 resolved, 2 dismissed');

      const second = await mapper(repo).run(ctx(false));
      expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 8 });
      expect(second.skipped).toEqual(first.skipped);
      expect(repo.inserted).toHaveLength(8);
    });

    it('never moves legacy_imported_until back', async () => {
      const repo = new InMemoryCallbacksRepository();
      repo.until = tz('2026-11-18 16:00:00');
      const report = await mapper(repo).run(ctx(false));
      expect(report.updated).toBe(0);
      expect(repo.until).toEqual(tz('2026-11-18 16:00:00'));
    });

    it('reports a missing source', async () => {
      const report = await mapper(new InMemoryCallbacksRepository()).run({
        ...ctx(true),
        legacy: { ...legacy, sqlite: null },
      });
      expect(report.status).toBe('source-missing');
    });
  });
});
