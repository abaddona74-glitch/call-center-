import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { DB } from '../../../database/db.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import { MapperReportSchema, type MigrationContext } from '../mapper.js';
import {
  type ContactValues,
  type ContactsRepository,
  createContactsMapper,
  type ExistingContact,
  planContacts,
  transformLegacyContact,
} from './contacts.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

/** Synthetic rows only (fake numbers in the 90 000 00xx range). */
const CONTACTS: Array<
  [phone: string, name: string, org: string | null, notes: string | null, lang: string, tg: string]
> = [
  ['900000001', 'Test Fuqaro', 'Test MChJ', 'eslatma', 'uz', '123456789'], // #1 clean
  ['998900000002', '', 'Faqat tashkilot', null, 'RU', ''], // #2 12-digit phone, language upper-case
  ['900000003', 'Kimdir', null, null, "o'zbek", 'test_user'], // #3 free-text language, bare username
  ['12345', 'Qisqa raqam', null, null, '', ''], // #4 unusable phone
  ['900000005', 'X'.repeat(130), null, 'a\u0007b', '', 'not a handle!'], // #5 long name, control char, bad tg
  ['900000002', 'Yangi nom', null, null, '', ''], // #6 same phone as #2 after normalising, changed later
  ['900000007', '', '', null, '', ''], // #7 nothing but the phone
];

function createLegacyDb(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-contacts-'));
  const file = path.join(dir, 'callcenter.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO client_contacts (phone, name, organization, notes, language, telegram_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-10-02 12:00:00', ?)`,
  );
  CONTACTS.forEach(([phone, name, org, notes, lang, tg], i) =>
    insert.run(phone, name, org, notes, lang, tg, i === 5 ? '2026-11-05 15:00:00' : '2026-10-03 09:30:00'),
  );
  db.close();
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

class InMemoryContactsRepository implements ContactsRepository {
  constructor(readonly rows: ContactValues[] = []) {}
  async listExisting(): Promise<ExistingContact[]> {
    return this.rows.map(({ createdAt: _c, updatedAt: _u, ...c }) => ({ ...c }));
  }
  async insertIfAbsent(values: ContactValues): Promise<boolean> {
    if (this.rows.some((r) => r.phone === values.phone)) return false;
    this.rows.push(values);
    return true;
  }
}

describe('contacts mapper', () => {
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

  const rows = () => legacy.sqlite!.all('SELECT rowid, * FROM client_contacts ORDER BY rowid');
  const byRow = (rowid: number) => transformLegacyContact(rows().find((r) => r.rowid === rowid)!);
  const ctx = (dryRun: boolean): MigrationContext => ({
    legacy,
    db: {} as Kysely<DB>,
    dryRun,
    logger: { info: () => undefined, warn: () => undefined },
  });

  describe('transformLegacyContact', () => {
    it('normalises the phone and copies name, organization, note, language, Telegram and dates', () => {
      const r = byRow(1);
      if (!r.ok) throw new Error(r.reason);
      expect(r.values).toMatchObject({
        phone: '900000001',
        name: 'Test Fuqaro',
        organization: 'Test MChJ',
        note: 'eslatma',
        language: 'uz',
        telegram: '123456789',
      });
      expect(r.values.createdAt?.toISOString()).toBe('2026-10-02T07:00:00.000Z');
      expect(r.values.updatedAt?.toISOString()).toBe('2026-10-03T04:30:00.000Z');
      expect(r.warnings).toEqual([]);
    });

    it('accepts a 12-digit phone, an empty name and an upper-case language', () => {
      const r = byRow(2);
      expect(r.ok && r.values).toMatchObject({ phone: '900000002', name: '', organization: 'Faqat tashkilot' });
      expect(r.ok && r.values.language).toBe('ru');
      expect(r.ok && r.values.telegram).toBeNull();
    });

    it('maps a free-text language to "other" and prefixes a bare Telegram username', () => {
      const r = byRow(3);
      expect(r.ok && r.values.language).toBe('other');
      expect(r.ok && r.values.telegram).toBe('@test_user');
      expect(r.ok && r.warnings).toEqual(['language "o\'zbek" is not uz/ru/en; set to "other"']);
    });

    it('skips an unusable phone without printing it', () => {
      expect(byRow(4)).toEqual({ ok: false, key: '#4', reason: 'phone is not a usable number (5 digits)' });
    });

    it('cuts long text, removes control characters and drops an invalid Telegram handle', () => {
      const r = byRow(5);
      if (!r.ok) throw new Error(r.reason);
      expect(r.values.name).toHaveLength(120);
      expect(r.values.note).toBe('ab');
      expect(r.values.telegram).toBeNull();
      expect(r.warnings).toEqual([
        'name longer than 120 chars; truncated',
        'note had control characters; removed',
        'telegram_user_id is not a numeric id or @username; dropped',
      ]);
    });
  });

  describe('planContacts', () => {
    it('keeps the row changed later when two legacy phones normalise to one', () => {
      const plan = planContacts(rows().map(transformLegacyContact), []);
      expect(plan.inserts.map((i) => i.key)).toEqual(['#1', '#3', '#5', '#6', '#7']);
      expect(plan.skipped).toEqual([
        {
          key: '#2',
          reason: 'same phone as legacy contact #6 after normalising; that one (changed later) is migrated',
        },
        { key: '#4', reason: 'phone is not a usable number (5 digits)' },
      ]);
      expect(plan.warnings).toContainEqual({
        key: '#7',
        reason: 'no name, organization or Telegram (the API would ask for one when it is edited)',
      });
    });

    it('never touches a contact that already exists and says what differs', () => {
      const plan = planContacts(rows().map(transformLegacyContact), [
        {
          phone: '900000001',
          name: 'Edited',
          organization: 'Test MChJ',
          language: 'uz',
          note: 'eslatma',
          telegram: null,
        },
      ]);
      expect(plan.unchanged).toBe(1);
      expect(plan.inserts.map((i) => i.key)).not.toContain('#1');
      expect(plan.warnings).toContainEqual({
        key: '#1',
        reason: 'already exists; left untouched (differs: name, telegram)',
      });
    });
  });

  describe('run', () => {
    it('dry-run plans without writing; the report has no phones or names', async () => {
      const repo = new InMemoryContactsRepository();
      const report = await createContactsMapper(() => repo).run(ctx(true));
      expect(MapperReportSchema.parse(report)).toEqual(report);
      expect(report).toMatchObject({ name: 'contacts', owner: 'S4', status: 'ok', read: 7, inserted: 5 });
      expect(repo.rows).toHaveLength(0);
      const text = JSON.stringify(report);
      for (const secret of ['900000001', 'Test Fuqaro', 'Kimdir']) expect(text).not.toContain(secret);
    });

    it('migrates, then a re-run reports every contact as unchanged', async () => {
      const repo = new InMemoryContactsRepository();
      const first = await createContactsMapper(() => repo).run(ctx(false));
      expect(first).toMatchObject({ inserted: 5, unchanged: 0 });
      const second = await createContactsMapper(() => repo).run(ctx(false));
      expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 5 });
      expect(second.skipped).toHaveLength(2);
      expect(repo.rows).toHaveLength(5);
    });

    it('reports a missing source', async () => {
      const report = await createContactsMapper(() => new InMemoryContactsRepository()).run({
        ...ctx(true),
        legacy: { ...legacy, sqlite: null },
      });
      expect(report.status).toBe('source-missing');
    });
  });
});
