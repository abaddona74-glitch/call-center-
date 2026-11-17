import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TicketStatus } from '@cc/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import { detectAttachmentType, safeAttachmentName } from '../../../modules/tickets/domain/attachment-type.js';
import { emptyReport, errorMessage, type Mapper, type RowIssue } from '../mapper.js';
import { countArray } from './not-implemented.js';

/**
 * Legacy `viewer/data/tickets.json` → `tickets`, `ticket_comments`, `ticket_attachments` (S5).
 *
 * Sources: `<data-dir>/tickets.json` and the attachment files copied flat into
 * `<data-dir>/ticket-uploads/` (legacy `viewer/public/uploads/tickets/*`).
 *
 * - Ticket numbers are kept: `TK-1042` → `tickets.id = 1042` (`OVERRIDING SYSTEM VALUE`), then the
 *   identity sequence is moved past the highest id so new tickets never reuse a legacy number.
 * - Idempotency: a ticket whose id already exists is `unchanged` (its comments/files are not touched).
 * - Status: pending → open, in_progress → accepted, completed → completed, rejected → rejected.
 * - People are legacy extensions (`creatorId`, `targetOperatorId`, `acceptedBy.id`, …): they are linked to
 *   the user with that extension when one exists; the legacy name is kept as the label either way.
 *   `'admin'` / `'superuser'` ids (and anything not numeric) count as admins.
 * - Attachments are re-checked by content (images, PDF, DOCX only) and copied to TICKETS_UPLOAD_DIR under
 *   random names. Legacy `.doc`, `.txt`, `.svg`, … are not migrated (warning). Files are copied before the
 *   transaction commits; if it rolls back, the API's daily orphan sweep deletes them.
 * - Legacy system comments "🚫 Ticket rad etildi. Sabab: X" become system comments with body "X"
 *   (the UI renders the sentence).
 */

const CREATOR_EXTENSION_FROM = Number(process.env.TICKETS_CREATOR_EXTENSION_FROM ?? 200);

const idLike = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v).trim() || null));
const msTime = z.union([z.number(), z.string()]).nullish();
const PersonRefSchema = z
  .object({ id: idLike, name: z.string().nullish(), at: msTime, reason: z.string().nullish() })
  .nullish();
const LegacyFileSchema = z.object({
  name: z.string().nullish(),
  fileName: z.string().nullish(),
  url: z.string().nullish(),
  size: z.number().nullish(),
  mimeType: z.string().nullish(),
});
const LegacyCommentSchema = z.object({
  id: z.string().nullish(),
  operatorId: idLike,
  operatorName: z.string().nullish(),
  text: z.string().nullish(),
  isSystem: z.boolean().nullish(),
  files: z.array(LegacyFileSchema).nullish(),
  createdAt: msTime,
});
export const LegacyTicketSchema = z.object({
  id: z.string(),
  creatorId: idLike,
  creatorName: z.string().nullish(),
  customerPhone: z.string().nullish(),
  title: z.string().nullish(),
  comment: z.string().nullish(),
  files: z.array(LegacyFileSchema).nullish(),
  isUrgent: z.boolean().nullish(),
  targetOperatorId: idLike,
  targetOperatorName: z.string().nullish(),
  status: z.string(),
  acceptedBy: PersonRefSchema,
  completedBy: PersonRefSchema,
  rejectedBy: PersonRefSchema,
  createdAt: msTime,
  updatedAt: msTime,
  comments: z.array(LegacyCommentSchema).nullish(),
});
export type LegacyFile = z.infer<typeof LegacyFileSchema>;

const STATUS: Record<string, TicketStatus> = {
  pending: 'open',
  in_progress: 'accepted',
  completed: 'completed',
  rejected: 'rejected',
};

export interface PersonValue {
  extension: string | null;
  label: string;
}

export interface TicketValues {
  id: number;
  status: TicketStatus;
  body: string;
  customerPhone: string | null;
  isUrgent: boolean;
  creator: PersonValue;
  creatorParty: 'admin' | 'creator';
  /** null = addressed to every receiver */
  target: PersonValue | null;
  assignee: PersonValue | null;
  acceptedAt: Date | null;
  completedBy: PersonValue | null;
  completedAt: Date | null;
  rejectedBy: PersonValue | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  files: LegacyFile[];
  comments: Array<{ author: PersonValue; body: string; isSystem: boolean; createdAt: Date; files: LegacyFile[] }>;
}

export type TicketTransform =
  | { ok: true; key: string; values: TicketValues; warnings: string[] }
  | { ok: false; key: string; reason: string };

function toDate(v: number | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(Number.isFinite(Number(v)) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extensionOf(id: string | null): string | null {
  return id && /^\d{2,6}$/.test(id) ? id : null;
}

function person(id: string | null, name: string | null | undefined): PersonValue {
  const extension = extensionOf(id);
  const label = name?.trim() || (extension ? `Operator ${extension}` : id || 'Operator');
  return { extension, label: label.slice(0, 120) };
}

const SYSTEM_REJECT = /^🚫\s*Ticket rad etildi\.?\s*(?:Sabab:\s*([\s\S]*))?$/u;

/** Pure: one legacy ticket → insert values or a skip reason. Never throws. */
export function transformLegacyTicket(raw: unknown, now = new Date()): TicketTransform {
  const parsed = LegacyTicketSchema.safeParse(raw);
  const rawId = (raw as { id?: unknown } | null)?.id;
  const key = typeof rawId === 'string' ? rawId.slice(0, 20) : '?';
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, key, reason: `unreadable legacy ticket (${issues.slice(0, 200)})` };
  }
  const t = parsed.data;
  const m = /^TK-(\d{1,9})$/.exec(t.id.trim());
  if (!m) return { ok: false, key, reason: `id ${JSON.stringify(t.id.slice(0, 20))} is not TK-<number>` };
  const status = STATUS[t.status];
  if (!status) return { ok: false, key, reason: `unknown status ${JSON.stringify(t.status.slice(0, 20))}` };

  const warnings: string[] = [];
  const createdAt = toDate(t.createdAt) ?? now;
  if (!toDate(t.createdAt)) warnings.push('createdAt missing or invalid; set to now');
  const updatedAt = toDate(t.updatedAt) ?? createdAt;

  const creator = person(t.creatorId, t.creatorName);
  const creatorNum = creator.extension ? Number(creator.extension) : null;
  const creatorParty = creatorNum !== null && creatorNum >= CREATOR_EXTENSION_FROM ? 'creator' : 'admin';
  if (creatorNum !== null && creatorNum < CREATOR_EXTENSION_FROM) {
    warnings.push(`creator ${creator.extension} is not in the creators group; imported as an admin-created ticket`);
  }

  const targetId = t.targetOperatorId;
  const target = !targetId || targetId === 'all' ? null : person(targetId, t.targetOperatorName);

  const body = (t.comment ?? '').trim() || (t.title ?? '').trim();
  const rejectReason = t.rejectedBy?.reason?.trim() || null;

  return {
    ok: true,
    key: t.id,
    warnings,
    values: {
      id: Number(m[1]),
      status,
      body: body.slice(0, 4000),
      customerPhone: t.customerPhone?.trim().slice(0, 32) || null,
      isUrgent: Boolean(t.isUrgent),
      creator,
      creatorParty,
      target,
      assignee: t.acceptedBy ? person(t.acceptedBy.id, t.acceptedBy.name) : null,
      acceptedAt: toDate(t.acceptedBy?.at),
      completedBy: t.completedBy ? person(t.completedBy.id, t.completedBy.name) : null,
      completedAt: toDate(t.completedBy?.at),
      rejectedBy: t.rejectedBy ? person(t.rejectedBy.id, t.rejectedBy.name) : null,
      rejectedAt: toDate(t.rejectedBy?.at),
      rejectReason,
      createdAt,
      updatedAt,
      files: t.files ?? [],
      comments: (t.comments ?? []).map((c) => {
        const text = (c.text ?? '').trim();
        const sys = SYSTEM_REJECT.exec(text);
        const isSystem = Boolean(c.isSystem) || sys !== null;
        return {
          author: person(c.operatorId, c.operatorName),
          body: (isSystem && sys ? (sys[1] ?? '').trim() : text).slice(0, 4000),
          isSystem,
          createdAt: toDate(c.createdAt) ?? updatedAt,
          files: c.files ?? [],
        };
      }),
    },
  };
}

/** Legacy stored files as `tk_<ms>_<rand>_<safe>.<ext>`; anything else (or a path) is refused. */
export function legacyFileName(f: LegacyFile): string | null {
  const name = (f.fileName ?? f.url?.split('/').pop() ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name) ? name : null;
}

interface StoredFile {
  key: string;
  fileName: string;
  mimeType: string;
  kind: 'image' | 'pdf' | 'docx';
  size: number;
}

export interface TicketsMapperDeps {
  uploadDir: () => string;
}

export function createTicketsMapper(
  deps: TicketsMapperDeps = { uploadDir: () => path.resolve(process.env.TICKETS_UPLOAD_DIR ?? '.data/ticket-uploads') },
): Mapper {
  const meta = { name: 'tickets', owner: 'S5' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const src = ctx.legacy.readJson('tickets.json');
      if (src.status !== 'ok') {
        report.status = 'source-missing';
        report.notes.push(
          src.status === 'invalid'
            ? `tickets.json: not valid JSON (${src.error})`
            : `tickets.json: ${src.path ? 'not found in --data-dir' : '--data-dir not given'}`,
        );
        return report;
      }
      const list = Array.isArray(src.data) ? src.data : (src.data as { tickets?: unknown })?.tickets;
      if (!Array.isArray(list)) {
        report.status = 'failed';
        report.errors.push({ key: 'tickets.json', reason: 'expected an array or { tickets: [] }' });
        return report;
      }
      report.read = countArray()(list);
      const uploadsSrc = ctx.legacy.dataDir ? path.join(ctx.legacy.dataDir, 'ticket-uploads') : null;
      if (!uploadsSrc || !existsSync(uploadsSrc)) {
        report.notes.push('ticket-uploads/ not found in --data-dir: tickets are migrated without their files');
      }

      const db = ctx.db as Kysely<DB>;
      // extension → user id; active users win, then the oldest account.
      const users = await db
        .selectFrom('users')
        .select(['id', 'extension'])
        .where('extension', 'is not', null)
        .orderBy('isActive', 'desc')
        .orderBy('id')
        .execute();
      const userByExt = new Map<string, number>();
      for (const u of users) if (u.extension && !userByExt.has(u.extension)) userByExt.set(u.extension, u.id);
      const uid = (p: PersonValue | null) => (p?.extension ? (userByExt.get(p.extension) ?? null) : null);

      const transforms = list.map((raw) => transformLegacyTicket(raw));
      const ids = transforms.flatMap((t) => (t.ok ? [t.values.id] : []));
      const existing = new Set(
        ids.length ? (await db.selectFrom('tickets').select('id').where('id', 'in', ids).execute()).map((r) => r.id) : [],
      );
      const seen = new Set<number>();
      let fileCount = 0;

      const storeFile = (f: LegacyFile, key: string): StoredFile | null => {
        const name = legacyFileName(f);
        const warn = (reason: string) => report.warnings.push({ key, reason });
        if (!name) {
          warn('attachment with an unusable file name; skipped');
          return null;
        }
        if (!uploadsSrc) return null;
        const source = path.join(uploadsSrc, name);
        if (!existsSync(source)) {
          warn(`attachment ${name} not found in ticket-uploads/; skipped`);
          return null;
        }
        const data = readFileSync(source);
        const type = detectAttachmentType(data);
        if (!type) {
          warn(`attachment ${name} is not an image, PDF or DOCX; not migrated`);
          return null;
        }
        fileCount++;
        if (ctx.dryRun) return { key: 'dry-run', fileName: '', mimeType: type.mime, kind: type.kind, size: data.length };
        const dir = deps.uploadDir();
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const storageKey = randomUUID();
        writeFileSync(path.join(dir, storageKey), data, { mode: 0o600, flag: 'wx' });
        return {
          key: storageKey,
          fileName: safeAttachmentName(f.name || name, type),
          mimeType: type.mime,
          kind: type.kind,
          size: data.length,
        };
      };

      for (const t of transforms) {
        if (!t.ok) {
          report.skipped.push({ key: t.key, reason: t.reason });
          continue;
        }
        const v = t.values;
        if (seen.has(v.id)) {
          report.skipped.push({ key: t.key, reason: 'duplicate ticket id in tickets.json' });
          continue;
        }
        seen.add(v.id);
        if (existing.has(v.id)) {
          report.unchanged++;
          continue;
        }
        for (const w of t.warnings) report.warnings.push({ key: t.key, reason: w });
        const issues: RowIssue[] = [];
        for (const p of [v.creator, v.target, v.assignee].filter((x): x is PersonValue => Boolean(x?.extension))) {
          if (uid(p) === null) issues.push({ key: t.key, reason: `no user with extension ${p.extension}; kept as label only` });
        }
        report.warnings.push(...issues);

        if (ctx.dryRun) {
          for (const f of [...v.files, ...v.comments.flatMap((c) => c.files)]) storeFile(f, t.key);
          report.inserted++;
          continue;
        }

        try {
          await sql`
            insert into tickets (
              id, status, body, customer_phone, is_urgent,
              creator_user_id, creator_label, creator_extension, creator_party,
              target_all, target_user_id, target_label, target_extension,
              assignee_user_id, assignee_label, assignee_extension, accepted_at,
              completed_by_user_id, completed_by_label, completed_by_extension, completed_at,
              rejected_by_user_id, rejected_by_label, rejected_by_extension, rejected_at, reject_reason,
              created_at, updated_at
            ) overriding system value values (
              ${v.id}, ${v.status}, ${v.body}, ${v.customerPhone}, ${v.isUrgent},
              ${uid(v.creator)}, ${v.creator.label}, ${v.creator.extension}, ${v.creatorParty},
              ${v.target === null}, ${uid(v.target)}, ${v.target?.label ?? null}, ${v.target?.extension ?? null},
              ${uid(v.assignee)}, ${v.assignee?.label ?? null}, ${v.assignee?.extension ?? null}, ${v.acceptedAt},
              ${uid(v.completedBy)}, ${v.completedBy?.label ?? null}, ${v.completedBy?.extension ?? null}, ${v.completedAt},
              ${uid(v.rejectedBy)}, ${v.rejectedBy?.label ?? null}, ${v.rejectedBy?.extension ?? null}, ${v.rejectedAt},
              ${v.rejectReason}, ${v.createdAt}, ${v.updatedAt}
            )`.execute(db);

          const attach = async (files: LegacyFile[], commentId: number | null) => {
            for (const f of files) {
              const stored = storeFile(f, t.key);
              if (!stored) continue;
              await db
                .insertInto('ticketAttachments')
                .values({
                  ticketId: v.id,
                  commentId,
                  storageKey: stored.key,
                  fileName: stored.fileName,
                  mimeType: stored.mimeType,
                  kind: stored.kind,
                  sizeBytes: stored.size,
                  uploadedByUserId: null,
                })
                .execute();
            }
          };
          await attach(v.files, null);
          for (const c of v.comments) {
            const row = await db
              .insertInto('ticketComments')
              .values({
                ticketId: v.id,
                authorUserId: uid(c.author),
                authorLabel: c.author.label,
                authorExtension: c.author.extension,
                body: c.body,
                isSystem: c.isSystem,
                createdAt: c.createdAt,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await attach(c.files, row.id);
          }
          report.inserted++;
        } catch (err) {
          // The transaction is aborted now; the runner rolls this mapper back as a whole.
          throw new Error(`${t.key}: ${errorMessage(err)}`);
        }
      }

      if (!ctx.dryRun && report.inserted > 0) {
        // New tickets continue after the highest legacy number (never reusing one).
        await sql`select setval(pg_get_serial_sequence('tickets', 'id'), (select greatest(coalesce(max(id), 0), 1000) from tickets))`.execute(
          db,
        );
      }
      report.notes.push(`${fileCount} attachment file(s) ${ctx.dryRun ? 'would be' : 'were'} copied`);
      report.notes.push('completed tickets are migrated too; the daily purge (TICKETS_PURGE_COMPLETED_AFTER_DAYS) removes old ones');
      return report;
    },
  };
}

export const ticketsMapper = createTicketsMapper();
