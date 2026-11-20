import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type TicketStatus, normalizeUzPhone } from '@cc/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import { detectAttachmentType, safeAttachmentName } from '../../../modules/tickets/domain/attachment-type.js';
import { emptyReport, errorMessage, type Mapper, type RowIssue } from '../mapper.js';
import { countArray } from './not-implemented.js';

/**
 * Legacy `viewer/data/tickets.json` → `tickets`, `ticket_comments`, `ticket_attachments`, `ticket_events`
 * in the new workflow model (docs/rewrite/TICKETS.md; owner S7, originally S5).
 *
 * Sources: `<data-dir>/tickets.json` and the attachment files copied flat into
 * `<data-dir>/ticket-uploads/` (legacy `viewer/public/uploads/tickets/*`).
 *
 * - Ticket numbers are kept: `TK-1042` → `tickets.id = 1042` (`OVERRIDING SYSTEM VALUE`), then the
 *   identity sequence is moved past the highest id so new tickets never reuse a legacy number.
 * - Idempotency: a ticket whose id already exists is `unchanged` (its comments/files are not touched).
 * - Status: pending → new, in_progress → in_progress, completed → closed (resolution done),
 *   rejected → closed (resolution rejected, the reason is the resolution note). Legacy tickets were already
 *   answered by the old process, so nothing goes to the callback queue.
 * - Region: legacy tickets have none. `LEGACY_TICKETS_DEFAULT_REGION=<region code>` puts them all into that
 *   region; unset, they stay without a region and the superuser routes open ones from the "triage" view
 *   (forward to a region). No category (shown as "not set"); no SLA due date (never counted as overdue).
 * - Dropped legacy fields: urgency (kept as a "[Shoshilinch]" prefix of the description), the addressed
 *   operator (warning), the creator group.
 * - People are legacy extensions (`creatorId`, `acceptedBy.id`, …): they are linked to the user with that
 *   extension when one exists; the legacy name is kept as the label either way.
 * - Attachments are re-checked by content (images, PDF, DOCX only) and copied to TICKETS_UPLOAD_DIR under
 *   random names. Legacy `.doc`, `.txt`, `.svg`, … are not migrated (warning). Files are copied before the
 *   transaction commits; if it rolls back, the API's daily orphan sweep deletes them.
 * - Legacy system comments "🚫 Ticket rad etildi. Sabab: X" become system comments with body "X".
 * - The timeline gets "created", "done"/"rejected" and "closed" events with the legacy times.
 */

const URGENT_PREFIX = '[Shoshilinch] ';

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

const STATUS: Record<string, { status: TicketStatus; resolution: 'done' | 'rejected' | null }> = {
  pending: { status: 'new', resolution: null },
  in_progress: { status: 'in_progress', resolution: null },
  completed: { status: 'closed', resolution: 'done' },
  rejected: { status: 'closed', resolution: 'rejected' },
};

export interface PersonValue {
  extension: string | null;
  label: string;
}

export interface TicketValues {
  id: number;
  status: TicketStatus;
  description: string;
  /** normalizeUzPhone form, or null when the legacy number is missing/unusable. */
  customerPhone: string | null;
  creator: PersonValue;
  assignee: PersonValue | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  resolution: 'done' | 'rejected' | null;
  resolutionNote: string | null;
  resolvedBy: PersonValue | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  files: LegacyFile[];
  comments: Array<{ author: PersonValue; body: string; isSystem: boolean; createdAt: Date; files: LegacyFile[] }>;
}

export type TicketTransform =
  { ok: true; key: string; values: TicketValues; warnings: string[] } | { ok: false; key: string; reason: string };

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
  const mapped = STATUS[t.status];
  if (!mapped) return { ok: false, key, reason: `unknown status ${JSON.stringify(t.status.slice(0, 20))}` };

  const warnings: string[] = [];
  const createdAt = toDate(t.createdAt) ?? now;
  if (!toDate(t.createdAt)) warnings.push('createdAt missing or invalid; set to now');
  const updatedAt = toDate(t.updatedAt) ?? createdAt;

  const targetId = t.targetOperatorId;
  if (targetId && targetId !== 'all') {
    warnings.push(`was addressed to operator ${targetId.slice(0, 20)}; the new workflow routes by region only`);
  }
  const rawPhone = t.customerPhone?.trim() || null;
  const customerPhone = normalizeUzPhone(rawPhone);
  if (rawPhone && !customerPhone) warnings.push('customer phone is not a usable number; dropped');

  const text = (t.comment ?? '').trim() || (t.title ?? '').trim();
  const description = `${t.isUrgent ? URGENT_PREFIX : ''}${text}`.slice(0, 4000);
  const assignee = t.acceptedBy ? person(t.acceptedBy.id, t.acceptedBy.name) : null;
  const assignedAt = toDate(t.acceptedBy?.at);
  const resolver =
    mapped.resolution === 'done' ? t.completedBy : mapped.resolution === 'rejected' ? t.rejectedBy : null;
  const resolvedAt = mapped.resolution ? (toDate(resolver?.at) ?? updatedAt) : null;

  return {
    ok: true,
    key: t.id,
    warnings,
    values: {
      id: Number(m[1]),
      status: mapped.status,
      description,
      customerPhone,
      creator: person(t.creatorId, t.creatorName),
      assignee,
      assignedAt,
      startedAt: mapped.status === 'new' ? null : assignedAt,
      resolution: mapped.resolution,
      resolutionNote: mapped.resolution === 'rejected' ? t.rejectedBy?.reason?.trim() || null : null,
      resolvedBy: resolver ? person(resolver.id, resolver.name) : null,
      resolvedAt,
      closedAt: mapped.status === 'closed' ? resolvedAt : null,
      createdAt,
      updatedAt,
      files: t.files ?? [],
      comments: (t.comments ?? []).map((c) => {
        const body = (c.text ?? '').trim();
        const sys = SYSTEM_REJECT.exec(body);
        const isSystem = Boolean(c.isSystem) || sys !== null;
        return {
          author: person(c.operatorId, c.operatorName),
          body: (isSystem && sys ? (sys[1] ?? '').trim() : body).slice(0, 4000),
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
  /** Region code for imported tickets (LEGACY_TICKETS_DEFAULT_REGION); null = superuser triage. */
  defaultRegion: () => string | null;
}

export function createTicketsMapper(
  deps: TicketsMapperDeps = {
    uploadDir: () => path.resolve(process.env.TICKETS_UPLOAD_DIR ?? '.data/ticket-uploads'),
    defaultRegion: () => process.env.LEGACY_TICKETS_DEFAULT_REGION?.trim() || null,
  },
): Mapper {
  const meta = { name: 'tickets', owner: 'S7' };
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
      const regionCode = deps.defaultRegion();
      let regionId: number | null = null;
      if (regionCode) {
        const region = await db
          .selectFrom('ticketRegions')
          .select('id')
          .where('code', '=', regionCode)
          .executeTakeFirst();
        if (!region) {
          report.status = 'failed';
          report.errors.push({ key: 'LEGACY_TICKETS_DEFAULT_REGION', reason: `no region with code "${regionCode}"` });
          return report;
        }
        regionId = region.id;
        report.notes.push(`imported tickets are put into region "${regionCode}"`);
      } else {
        report.notes.push(
          'LEGACY_TICKETS_DEFAULT_REGION not set: open imported tickets wait in the superuser triage view',
        );
      }
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
        ids.length
          ? (await db.selectFrom('tickets').select('id').where('id', 'in', ids).execute()).map((r) => r.id)
          : [],
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
        if (ctx.dryRun)
          return { key: 'dry-run', fileName: '', mimeType: type.mime, kind: type.kind, size: data.length };
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
        for (const p of [v.creator, v.assignee, v.resolvedBy].filter((x): x is PersonValue => Boolean(x?.extension))) {
          if (uid(p) === null)
            issues.push({ key: t.key, reason: `no user with extension ${p.extension}; kept as label only` });
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
              id, status, description, customer_phone, region_id, region_changed_at,
              creator_user_id, creator_label, creator_extension,
              assignee_user_id, assignee_label, assignee_extension, assigned_at, started_at,
              resolution, resolution_note, resolved_by_user_id, resolved_by_label, resolved_by_extension, resolved_at,
              closed_at, created_at, updated_at
            ) overriding system value values (
              ${v.id}, ${v.status}, ${v.description}, ${v.customerPhone}, ${regionId}, ${v.createdAt},
              ${uid(v.creator)}, ${v.creator.label}, ${v.creator.extension},
              ${uid(v.assignee)}, ${v.assignee?.label ?? null}, ${v.assignee?.extension ?? null}, ${v.assignedAt}, ${v.startedAt},
              ${v.resolution}, ${v.resolutionNote}, ${uid(v.resolvedBy)}, ${v.resolvedBy?.label ?? null},
              ${v.resolvedBy?.extension ?? null}, ${v.resolvedAt},
              ${v.closedAt}, ${v.createdAt}, ${v.updatedAt}
            )`.execute(db);

          const event = (
            kind: 'created' | 'done' | 'rejected' | 'closed',
            at: Date,
            who: PersonValue | null,
            extra: object = {},
          ) => ({
            ticketId: v.id,
            kind,
            actorUserId: uid(who),
            actorLabel: who?.label ?? null,
            actorExtension: who?.extension ?? null,
            createdAt: at,
            ...extra,
          });
          const events = [event('created', v.createdAt, v.creator, { toStatus: 'new' as const, toRegionId: regionId })];
          if (v.resolution && v.resolvedAt) {
            events.push(
              event(v.resolution, v.resolvedAt, v.resolvedBy, { toStatus: v.resolution, note: v.resolutionNote }),
            );
          }
          if (v.closedAt)
            events.push(event('closed', v.closedAt, null, { toStatus: 'closed' as const, note: 'legacy import' }));
          await db.insertInto('ticketEvents').values(events).execute();

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
        await sql`select setval(pg_get_serial_sequence('tickets', 'id'), max(id)) from tickets`.execute(db);
      }
      report.notes.push(`${fileCount} attachment file(s) ${ctx.dryRun ? 'would be' : 'were'} copied`);
      report.notes.push('completed/rejected legacy tickets are imported as closed (kept for history and reports)');
      return report;
    },
  };
}

export const ticketsMapper = createTicketsMapper();
