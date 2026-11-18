import { type ContactLanguage, ContactLanguageSchema, TelegramHandleSchema, normalizeUzPhone } from '@cc/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import type { SqliteRow } from '../legacy-sources.js';
import { emptyReport, type Mapper, type RowIssue } from '../mapper.js';
import { parseLegacyLocalTime } from '../time.js';

/**
 * Legacy `client_contacts` → `contacts` (docs/rewrite/legacy/data.md §1.1.7, §5.1; owner S4).
 *
 * - `phone` → `normalizeUzPhone` (the new primary key). A phone it rejects is skipped. Two legacy rows that
 *   normalise to the same phone (`998901234567` and `901234567`): the one changed later is migrated.
 * - `name`, `organization`, `notes` → `name`, `organization`, `note` (trimmed, control characters removed,
 *   cut to the API limits 120 / 200 / 1000 with a warning).
 * - `language` (free text, '' = not set) → `uz` / `ru` / `en`; anything else becomes `other` (warning).
 * - `telegram_user_id` → `telegram` when it is a numeric id or an @username (a bare username gets the `@`);
 *   anything else is dropped with a warning.
 * - `created_at`, `updated_at`: server-local text → Asia/Tashkent.
 *
 * Idempotency: insert-if-absent by normalised phone. An existing contact is never modified (a contact edited
 * in the new system wins); a warning names the fields that differ from legacy.
 * Rows are identified by the legacy rowid (`#<rowid>`); phones and names are never printed.
 */

const LIMITS = { name: 120, organization: 200, note: 1000 } as const;
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_ALL = new RegExp(CONTROL.source, 'g');
const BARE_TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const LegacyContactRowSchema = z.object({
  rowid: z.number().int(),
  phone: optionalText,
  name: optionalText,
  organization: optionalText,
  notes: optionalText,
  language: optionalText,
  telegram_user_id: optionalText,
  created_at: optionalText,
  updated_at: optionalText,
});

export interface ContactValues {
  phone: string;
  name: string;
  organization: string;
  language: ContactLanguage | null;
  note: string;
  telegram: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ContactTransformResult =
  { ok: true; key: string; values: ContactValues; warnings: string[] } | { ok: false; key: string; reason: string };

export type ExistingContact = Omit<ContactValues, 'createdAt' | 'updatedAt'>;

export interface ContactsPlan {
  inserts: { key: string; values: ContactValues }[];
  unchanged: number;
  skipped: RowIssue[];
  warnings: RowIssue[];
}

export interface ContactsRepository {
  listExisting(): Promise<ExistingContact[]>;
  /** Inserts unless the phone exists; returns whether it was inserted. */
  insertIfAbsent(values: ContactValues): Promise<boolean>;
}

export class KyselyContactsRepository implements ContactsRepository {
  constructor(private readonly db: Kysely<DB>) {}

  listExisting(): Promise<ExistingContact[]> {
    return this.db
      .selectFrom('contacts')
      .select(['phone', 'name', 'organization', 'language', 'note', 'telegram'])
      .execute();
  }

  async insertIfAbsent(values: ContactValues): Promise<boolean> {
    const row = await this.db
      .insertInto('contacts')
      .values(values)
      .onConflict((oc) => oc.column('phone').doNothing())
      .returning('phone')
      .executeTakeFirst();
    return Boolean(row);
  }
}

function cleanText(value: string | null, field: keyof typeof LIMITS, warnings: string[]): string {
  let text = (value ?? '').trim();
  if (CONTROL.test(text)) {
    text = text.replace(CONTROL_ALL, '').trim();
    warnings.push(`${field} had control characters; removed`);
  }
  if (text.length > LIMITS[field]) {
    text = text.slice(0, LIMITS[field]);
    warnings.push(`${field} longer than ${LIMITS[field]} chars; truncated`);
  }
  return text;
}

function mapLanguage(value: string | null, warnings: string[]): ContactLanguage | null {
  const lang = (value ?? '').trim().toLowerCase();
  if (!lang) return null;
  const known = ContactLanguageSchema.safeParse(lang);
  if (known.success) return known.data;
  warnings.push(`language ${JSON.stringify(lang.slice(0, 16))} is not uz/ru/en; set to "other"`);
  return 'other';
}

function mapTelegram(value: string | null, warnings: string[]): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const candidate = BARE_TELEGRAM_USERNAME.test(text) ? `@${text}` : text;
  const parsed = TelegramHandleSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  warnings.push('telegram_user_id is not a numeric id or @username; dropped');
  return null;
}

/** Pure: one legacy row (selected with its rowid) → insert values or a skip reason. Never throws. */
export function transformLegacyContact(raw: SqliteRow): ContactTransformResult {
  const key = `#${typeof raw.rowid === 'number' ? raw.rowid : '?'}`;
  const parsed = LegacyContactRowSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, key, reason: `unreadable legacy row (${issues})` };
  }
  const row = parsed.data;
  const phone = normalizeUzPhone(row.phone);
  if (!phone) {
    const digits = (row.phone ?? '').replace(/\D/g, '').length;
    return { ok: false, key, reason: `phone is not a usable number (${digits} digits)` };
  }

  const warnings: string[] = [];
  const values: ContactValues = {
    phone,
    name: cleanText(row.name, 'name', warnings),
    organization: cleanText(row.organization, 'organization', warnings),
    language: mapLanguage(row.language, warnings),
    note: cleanText(row.notes, 'note', warnings),
    telegram: mapTelegram(row.telegram_user_id, warnings),
  };
  if (!values.name && !values.organization && !values.telegram) {
    warnings.push('no name, organization or Telegram (the API would ask for one when it is edited)');
  }
  const createdAt = parseLegacyLocalTime(row.created_at);
  const updatedAt = parseLegacyLocalTime(row.updated_at);
  if (createdAt) values.createdAt = createdAt;
  else if (row.created_at?.trim()) warnings.push('created_at is not a recognised timestamp; set to now');
  if (updatedAt) values.updatedAt = updatedAt;
  else if (createdAt) values.updatedAt = createdAt;
  return { ok: true, key, values, warnings };
}

function differingFields(values: ContactValues, existing: ExistingContact): string[] {
  const fields = ['name', 'organization', 'language', 'note', 'telegram'] as const;
  return fields.filter((f) => (values[f] ?? null) !== (existing[f] ?? null));
}

const recency = (v: ContactValues) => (v.updatedAt ?? v.createdAt)?.getTime() ?? Number.NEGATIVE_INFINITY;

/** Pure: insert / unchanged / skip for every legacy contact, given the contacts the target already has. */
export function planContacts(
  results: readonly ContactTransformResult[],
  existing: readonly ExistingContact[],
): ContactsPlan {
  const plan: ContactsPlan = { inserts: [], unchanged: 0, skipped: [], warnings: [] };
  const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

  // Legacy keyed contacts by its own cleaned phone; after normalising two rows may share one.
  const winners = new Map<string, Extract<ContactTransformResult, { ok: true }>>();
  for (const r of results) {
    if (!r.ok) continue;
    const current = winners.get(r.values.phone);
    if (!current || recency(r.values) > recency(current.values)) winners.set(r.values.phone, r);
  }

  for (const r of results) {
    if (!r.ok) {
      plan.skipped.push({ key: r.key, reason: r.reason });
      continue;
    }
    const winner = winners.get(r.values.phone);
    if (winner && winner !== r) {
      plan.skipped.push({
        key: r.key,
        reason: `same phone as legacy contact ${winner.key} after normalising; that one (changed later) is migrated`,
      });
      continue;
    }
    for (const w of r.warnings) plan.warnings.push({ key: r.key, reason: w });
    const current = existingByPhone.get(r.values.phone);
    if (current) {
      plan.unchanged++;
      const diff = differingFields(r.values, current);
      if (diff.length > 0) {
        plan.warnings.push({ key: r.key, reason: `already exists; left untouched (differs: ${diff.join(', ')})` });
      }
      continue;
    }
    plan.inserts.push({ key: r.key, values: r.values });
  }
  return plan;
}

export function createContactsMapper(
  repositoryFor: (db: Kysely<DB>) => ContactsRepository = (db) => new KyselyContactsRepository(db),
): Mapper {
  const meta = { name: 'contacts', owner: 'S4' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('client_contacts')) {
        report.status = 'source-missing';
        report.notes.push(sqlite ? 'legacy table client_contacts not found' : '--sqlite not given');
        return report;
      }
      const rows = sqlite.all('SELECT rowid, * FROM client_contacts ORDER BY rowid');
      report.read = rows.length;
      const repo = repositoryFor(ctx.db);
      const plan = planContacts(rows.map(transformLegacyContact), await repo.listExisting());
      report.skipped = plan.skipped;
      report.warnings = plan.warnings;
      report.unchanged = plan.unchanged;

      if (ctx.dryRun) {
        report.inserted = plan.inserts.length;
      } else {
        for (const item of plan.inserts) {
          if (await repo.insertIfAbsent(item.values)) report.inserted++;
          else {
            report.unchanged++;
            report.warnings.push({ key: item.key, reason: 'the phone appeared while migrating; left untouched' });
          }
        }
      }
      report.notes.push('rows are keyed by the legacy rowid; phones and names are not printed');
      return report;
    },
  };
}

export const contactsMapper = createContactsMapper();
