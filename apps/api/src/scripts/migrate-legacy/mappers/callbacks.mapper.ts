import {
  type CallbackEventKind,
  type CallbackResolutionType,
  type CallbackSource,
  type CallbackStatus,
  type OutboundFailureCause,
  normalizeUzPhone,
} from '@cc/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../../database/db.js';
import type { SqliteRow } from '../legacy-sources.js';
import { emptyReport, type Mapper, type RowIssue } from '../mapper.js';
import { parseLegacyLocalTime } from '../time.js';

/**
 * Legacy `pending_callbacks` (all statuses) → `callbacks` + `callback_events`
 * (docs/rewrite/legacy/data.md §1.1.6, §5.1; owner S4). Owner decision 2026-11-18: everything is migrated
 * with its history — open callbacks stay open, resolved and dismissed ones keep who, when and how closed them.
 *
 * Row mapping:
 * - `phone` → `normalizeUzPhone`. Unusable numbers and the call centre's own numbers (`PBX_SERVICE_NUMBERS`,
 *   which legacy deleted at startup) are skipped.
 * - `source`: `abandoned` → abandoned, `ivr_non_working` → after_hours (legacy stored but never listed them).
 * - `call_time` (the latest missed call) → `last_missed_at`; `first_missed_at` = the earlier of `created_at` and
 *   `call_time` (legacy kept no first-call time); `attempts_count` → `missed_count`; `outbound_attempts`,
 *   `last_outbound_time`, `last_outbound_cause` (Uzbek label → enum) and the extension in
 *   `last_outbound_operator` → `outbound_attempts`, `last_outbound_*`. Operator names are not kept.
 * - resolved → `close_method = conversation` (legacy only resolved on a call), the extension from the
 *   `dismissed_by` tag (`operator_101_inbound`, `3cx_answered_101`, …) or from `last_outbound_operator`
 *   → `resolved_extension`, `closed_by_label = "ext 101"` (or "system"), `resolution_type` as legacy stored or
 *   derived from the tag the way legacy did.
 * - dismissed → `close_method = manual`, `closed_by_label` = the legacy actor (username, or `admin` for
 *   legacy's default), no resolution type.
 * - `dismissed_at` (set for both closed statuses) → `closed_at`. Every time is Asia/Tashkent wall-clock text.
 * - Users are found like the tickets mapper does: an extension → the user with that extension (active users
 *   first, then the oldest account); a dismissing username → that user (case-insensitive). Unknown → label only.
 * - Timeline: a `missed` event at `last_missed_at`, an `outbound_failed` event at `last_outbound_time` when
 *   there were failed attempts, and the `resolved` / `dismissed` event at `closed_at`.
 * - Dropped: `caller_name`, `notes` (never written), `today_attempts` (recomputed from events).
 *
 * Idempotency: `callbacks.legacy_id` = legacy id; insert-if-absent. An imported callback is never modified.
 * One open callback per phone: legacy pending rows that normalise to one phone are merged into the latest one;
 * a legacy pending row whose phone already has an open callback in the new system is skipped.
 *
 * Reconciliation with the PBX CDR (callbacks.reconciler.ts): the reconciler keys calls by Asterisk linkedid
 * (`callback_events.call_id`), and legacy kept no linkedid or uniqueid. So the mapper sets
 * `callback_settings.legacy_imported_until` to the latest legacy timestamp (only ever moving it forward), and
 * the reconciler skips calls at or before it — legacy already counted, called back or closed them.
 */

// --- legacy shapes ------------------------------------------------------------------------

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));
const optionalInt = z.number().int().nullish();

export const LegacyCallbackRowSchema = z.object({
  id: z.number().int(),
  phone: optionalText,
  source: optionalText,
  call_time: optionalText,
  attempts_count: optionalInt,
  status: optionalText,
  dismissed_at: optionalText,
  dismissed_by: optionalText,
  created_at: optionalText,
  updated_at: optionalText,
  outbound_attempts: optionalInt,
  last_outbound_time: optionalText,
  last_outbound_operator: optionalText,
  last_outbound_cause: optionalText,
  resolution_type: optionalText,
});

const SOURCES: Record<string, CallbackSource> = { abandoned: 'abandoned', ivr_non_working: 'after_hours' };
const STATUSES = new Set<CallbackStatus>(['pending', 'resolved', 'dismissed']);
/** Legacy Uzbek labels (amiService / issabelDbService) → cause enum. */
const CAUSES: Record<string, OutboundFailureCause> = {
  'mijoz band': 'busy',
  'javob bermadi': 'no_answer',
  'rad etildi': 'rejected',
  'aloqa doirasidan tashqarida': 'unavailable',
};
const RESOLUTION_TYPES = new Set<CallbackResolutionType>(['client_inbound', 'operator_outbound']);
const JUNK = new Set(['', 'null', '\\n', 'undefined']);
/** Legacy defaults when the actor is unknown (`dismissCallback(id, dismissedBy = 'admin')`, `getActorName`). */
const ANONYMOUS_ACTORS = new Set(['admin', 'unknown']);

export const DEFAULT_SERVICE_NUMBERS = ['2020159', '712020159'];

// --- values -------------------------------------------------------------------------------

export interface CloseInfo {
  closedAt: Date;
  method: 'conversation' | 'manual';
  /** Resolved: the operator extension; dismissed: null. */
  extension: string | null;
  /** Dismissed: the legacy actor (username, `admin`, `viewer:<name>`, …); resolved: null. */
  actor: string | null;
  resolutionType: CallbackResolutionType | null;
}

export interface CallbackValues {
  legacyId: number;
  phone: string;
  status: CallbackStatus;
  source: CallbackSource;
  firstMissedAt: Date;
  lastMissedAt: Date;
  missedCount: number;
  outboundAttempts: number;
  lastOutboundAt: Date | null;
  lastOutboundExtension: string | null;
  lastOutboundCause: OutboundFailureCause | null;
  close: CloseInfo | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CallbackTransformResult =
  | { ok: true; key: string; values: CallbackValues; warnings: string[] }
  | { ok: false; key: string; legacyId: number | null; reason: string };

export interface TargetUser {
  id: number;
  username: string;
  extension: string | null;
  isActive: boolean;
}

export interface ExistingCallbacks {
  legacyIds: ReadonlySet<number>;
  /** phone → callbacks.id of its open callback in the new system. */
  openByPhone: ReadonlyMap<string, number>;
}

export interface NewCallbackEvent {
  kind: CallbackEventKind;
  at: Date;
  source: CallbackSource | null;
  extension: string | null;
  cause: OutboundFailureCause | null;
  actorUserId: number | null;
  actorLabel: string;
}

export interface CallbackInsert {
  key: string;
  row: {
    legacyId: number;
    phone: string;
    status: CallbackStatus;
    source: CallbackSource;
    sources: CallbackSource[];
    firstMissedAt: Date;
    lastMissedAt: Date;
    missedCount: number;
    outboundAttempts: number;
    lastOutboundAt: Date | null;
    lastOutboundExtension: string | null;
    lastOutboundCause: OutboundFailureCause | null;
    closedAt: Date | null;
    closedByUserId: number | null;
    closedByLabel: string | null;
    closeMethod: 'conversation' | 'manual' | null;
    resolutionType: CallbackResolutionType | null;
    resolvedExtension: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  events: NewCallbackEvent[];
}

export interface CallbacksPlan {
  inserts: CallbackInsert[];
  unchanged: number;
  skipped: RowIssue[];
  warnings: RowIssue[];
  notes: string[];
}

// --- pure helpers -------------------------------------------------------------------------

function clean(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return JUNK.has(text.toLowerCase()) ? null : text;
}

/** Extension in a legacy resolve tag: `operator_101_inbound`, `operator_101`, `3cx_answered_101`. */
export function extensionFromTag(tag: string | null): string | null {
  return /(?:^|_)(\d{2,6})(?:_|$)/.exec(tag ?? '')?.[1] ?? null;
}

/** Extension in a legacy operator label: `Ism (101)`, `Operator 101`, `101`; a bare name has none. */
export function extensionFromLabel(label: string | null): string | null {
  const text = clean(label) ?? '';
  return (
    (/\((\d{2,6})\)\s*$/.exec(text) ?? /^Operator\s+(\d{2,6})$/i.exec(text) ?? /^(\d{2,6})$/.exec(text))?.[1] ?? null
  );
}

/** How legacy `resolveCallback` derived the type when the caller did not pass one. */
export function resolutionTypeFromTag(tag: string | null): CallbackResolutionType | null {
  if (!tag) return null;
  if (tag.includes('outbound') || tag === 'realtime_outbound_bridge') return 'operator_outbound';
  if (tag.includes('inbound') || tag === 'realtime_agent_connect') return 'client_inbound';
  return null;
}

export interface CallbackTransformOptions {
  /** Digits of the call centre's own numbers (`PBX_SERVICE_NUMBERS`). */
  serviceNumbers?: readonly string[];
}

/** Pure: one legacy row → values or a skip reason. Never throws; never puts the phone into a reason. */
export function transformLegacyCallback(raw: SqliteRow, opts: CallbackTransformOptions = {}): CallbackTransformResult {
  const legacyId = typeof raw.id === 'number' ? raw.id : null;
  const key = `#${legacyId ?? '?'}`;
  const parsed = LegacyCallbackRowSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, key, legacyId, reason: `unreadable legacy row (${issues})` };
  }
  const row = parsed.data;
  const skip = (reason: string): CallbackTransformResult => ({ ok: false, key, legacyId: row.id, reason });
  const warnings: string[] = [];

  const digits = (row.phone ?? '').replace(/\D/g, '');
  const phone = normalizeUzPhone(row.phone);
  if (!phone) return skip(`phone is not a usable number (${digits.length} digits)`);
  const service = (opts.serviceNumbers ?? DEFAULT_SERVICE_NUMBERS).filter((n) => n.length >= 5);
  if (service.some((n) => digits.includes(n))) {
    return skip("the call centre's own number (legacy deleted these at startup)");
  }

  const status = (row.status?.trim().toLowerCase() || 'pending') as CallbackStatus;
  if (!STATUSES.has(status)) return skip(`unknown status ${JSON.stringify(row.status?.slice(0, 20))}`);
  const source = SOURCES[row.source?.trim().toLowerCase() ?? ''];
  if (!source) return skip(`unknown source ${JSON.stringify(row.source?.slice(0, 20) ?? null)}`);

  const lastMissedAt = parseLegacyLocalTime(row.call_time);
  if (!lastMissedAt) return skip('call_time is not a recognised timestamp');
  const createdAt = parseLegacyLocalTime(row.created_at);
  const updatedAt = parseLegacyLocalTime(row.updated_at) ?? createdAt ?? lastMissedAt;
  const firstMissedAt = createdAt && createdAt < lastMissedAt ? createdAt : lastMissedAt;

  let missedCount = row.attempts_count ?? 1;
  if (missedCount < 1) {
    warnings.push(`attempts_count ${missedCount} is not positive; set to 1`);
    missedCount = 1;
  }
  let outboundAttempts = row.outbound_attempts ?? 0;
  if (outboundAttempts < 0) {
    warnings.push(`outbound_attempts ${outboundAttempts} is negative; set to 0`);
    outboundAttempts = 0;
  }
  const lastOutboundAt = parseLegacyLocalTime(row.last_outbound_time);
  if (clean(row.last_outbound_time) && !lastOutboundAt) warnings.push('last_outbound_time is not a timestamp; dropped');
  const causeLabel = clean(row.last_outbound_cause);
  const lastOutboundCause = causeLabel ? (CAUSES[causeLabel.toLowerCase()] ?? null) : null;
  if (causeLabel && !lastOutboundCause) {
    warnings.push(`last_outbound_cause ${JSON.stringify(causeLabel.slice(0, 40))} is unknown; dropped`);
  }
  const tag = clean(row.dismissed_by);
  // On resolve legacy overwrote last_outbound_operator with the resolving operator, so for resolved rows it
  // no longer names the last failed attempt.
  const labelExtension = extensionFromLabel(row.last_outbound_operator);
  const lastOutboundExtension = status === 'resolved' ? null : labelExtension;
  if (status !== 'resolved' && outboundAttempts > 0 && clean(row.last_outbound_operator) && !labelExtension) {
    warnings.push('last_outbound_operator names no operator extension (a name, or the trunk number); kept without it');
  }

  let close: CloseInfo | null = null;
  if (status !== 'pending') {
    let closedAt = parseLegacyLocalTime(row.dismissed_at);
    if (!closedAt) {
      closedAt = parseLegacyLocalTime(row.updated_at) ?? lastMissedAt;
      warnings.push('dismissed_at missing or invalid; closed at updated_at');
    }
    if (status === 'resolved') {
      const stored = row.resolution_type?.trim() as CallbackResolutionType | undefined;
      close = {
        closedAt,
        method: 'conversation',
        extension: extensionFromTag(tag) ?? labelExtension,
        actor: null,
        resolutionType: stored && RESOLUTION_TYPES.has(stored) ? stored : resolutionTypeFromTag(tag),
      };
    } else {
      close = { closedAt, method: 'manual', extension: null, actor: tag?.slice(0, 64) ?? null, resolutionType: null };
    }
  }

  return {
    ok: true,
    key,
    warnings,
    values: {
      legacyId: row.id,
      phone,
      status,
      source,
      firstMissedAt,
      lastMissedAt,
      missedCount,
      outboundAttempts,
      lastOutboundAt,
      lastOutboundExtension,
      lastOutboundCause,
      close,
      createdAt: createdAt ?? firstMissedAt,
      updatedAt,
    },
  };
}

/** The same warning on more than `max` rows becomes one line: `<n> rows, e.g. #1, #2, #3`. */
export function collapseWarnings(list: readonly RowIssue[], max = 3): RowIssue[] {
  const byReason = new Map<string, string[]>();
  for (const w of list) byReason.set(w.reason, [...(byReason.get(w.reason) ?? []), w.key]);
  return [...byReason].flatMap(([reason, keys]) =>
    keys.length > max
      ? [{ key: `${keys.length} rows, e.g. ${keys.slice(0, 3).join(', ')}`, reason }]
      : keys.map((key) => ({ key, reason })),
  );
}

/** extension → users.id: active users first, then the oldest account (same rule as the tickets mapper). */
function usersByExtension(users: readonly TargetUser[]): Map<string, number> {
  const map = new Map<string, number>();
  const sorted = [...users].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.id - b.id);
  for (const u of sorted) if (u.extension && !map.has(u.extension)) map.set(u.extension, u.id);
  return map;
}

/**
 * Pure: insert / unchanged / skip / merge for every legacy row, given what the target already has, plus the
 * rows (callback, its events) to insert.
 */
export function planCallbacks(
  results: readonly CallbackTransformResult[],
  existing: ExistingCallbacks,
  users: readonly TargetUser[],
): CallbacksPlan {
  const plan: CallbacksPlan = { inserts: [], unchanged: 0, skipped: [], warnings: [], notes: [] };
  const byExtension = usersByExtension(users);
  const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));
  const unknownActors = new Map<string, number>();
  const unknownExtensions = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const rowWarnings: RowIssue[] = [];

  // One open callback per phone: merge legacy pending rows of one phone into the one with the latest call.
  const ok = results.filter((r): r is Extract<CallbackTransformResult, { ok: true }> => r.ok);
  const openGroups = new Map<string, Extract<CallbackTransformResult, { ok: true }>[]>();
  for (const r of ok) {
    // Independent of the target, so a re-run reports the same merges.
    if (r.values.status !== 'pending') continue;
    const group = openGroups.get(r.values.phone) ?? [];
    group.push(r);
    openGroups.set(r.values.phone, group);
  }
  const mergedInto = new Map<number, string>();
  const merged = new Map<number, CallbackValues>();
  for (const group of openGroups.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        b.values.lastMissedAt.getTime() - a.values.lastMissedAt.getTime() || b.values.legacyId - a.values.legacyId,
    );
    const [keep, ...rest] = group;
    const values = { ...keep.values };
    for (const r of rest) {
      values.missedCount += r.values.missedCount;
      if (r.values.firstMissedAt < values.firstMissedAt) values.firstMissedAt = r.values.firstMissedAt;
      if (r.values.createdAt < values.createdAt) values.createdAt = r.values.createdAt;
      mergedInto.set(r.values.legacyId, keep.key);
    }
    merged.set(keep.values.legacyId, values);
  }

  for (const r of results) {
    if (!r.ok) {
      plan.skipped.push({ key: r.key, reason: r.reason });
      continue;
    }
    if (existing.legacyIds.has(r.values.legacyId)) {
      plan.unchanged++;
      continue;
    }
    const into = mergedInto.get(r.values.legacyId);
    if (into) {
      plan.skipped.push({ key: r.key, reason: `open callback of the same phone; merged into legacy ${into}` });
      continue;
    }
    const v = merged.get(r.values.legacyId) ?? r.values;
    if (v.status === 'pending') {
      const open = existing.openByPhone.get(v.phone);
      if (open !== undefined) {
        plan.skipped.push({
          key: r.key,
          reason: `the phone already has an open callback in the new system (callbacks.id ${open}); left to it`,
        });
        continue;
      }
    }
    for (const w of r.warnings) rowWarnings.push({ key: r.key, reason: w });

    let closedByUserId: number | null = null;
    let closedByLabel: string | null = null;
    if (v.close?.method === 'conversation') {
      const ext = v.close.extension;
      closedByUserId = ext ? (byExtension.get(ext) ?? null) : null;
      closedByLabel = ext ? `ext ${ext}` : 'system';
      if (ext && closedByUserId === null) bump(unknownExtensions, ext);
    } else if (v.close) {
      const actor = v.close.actor ?? 'unknown';
      const name = actor.replace(/^viewer:/, '').toLowerCase();
      closedByUserId = ANONYMOUS_ACTORS.has(name) ? null : (byUsername.get(name) ?? null);
      closedByLabel = actor;
      if (closedByUserId === null) bump(unknownActors, actor);
    }

    const events: NewCallbackEvent[] = [
      {
        kind: 'missed',
        at: v.lastMissedAt,
        source: v.source,
        extension: null,
        cause: null,
        actorUserId: null,
        actorLabel: 'system',
      },
    ];
    if (v.outboundAttempts > 0 && v.lastOutboundAt) {
      events.push({
        kind: 'outbound_failed',
        at: v.lastOutboundAt,
        source: null,
        extension: v.lastOutboundExtension,
        cause: v.lastOutboundCause,
        actorUserId: null,
        actorLabel: 'system',
      });
    }
    if (v.close) {
      events.push({
        kind: v.status === 'resolved' ? 'resolved' : 'dismissed',
        at: v.close.closedAt,
        source: null,
        extension: v.close.extension,
        cause: null,
        actorUserId: closedByUserId,
        actorLabel: closedByLabel ?? 'system',
      });
    }

    plan.inserts.push({
      key: r.key,
      row: {
        legacyId: v.legacyId,
        phone: v.phone,
        status: v.status,
        source: v.source,
        sources: [v.source],
        firstMissedAt: v.firstMissedAt,
        lastMissedAt: v.lastMissedAt,
        missedCount: v.missedCount,
        outboundAttempts: v.outboundAttempts,
        lastOutboundAt: v.lastOutboundAt,
        lastOutboundExtension: v.lastOutboundExtension,
        lastOutboundCause: v.lastOutboundCause,
        closedAt: v.close?.closedAt ?? null,
        closedByUserId,
        closedByLabel,
        closeMethod: v.close?.method ?? null,
        resolutionType: v.close?.resolutionType ?? null,
        resolvedExtension: v.close?.method === 'conversation' ? v.close.extension : null,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      },
      events,
    });
  }

  plan.warnings = collapseWarnings(rowWarnings);
  for (const [actor, n] of unknownActors) {
    plan.notes.push(`dismissed by "${actor.slice(0, 40)}" (no such user in the new system): ${n}, kept as a label`);
  }
  for (const [ext, n] of unknownExtensions) {
    plan.notes.push(`resolved by extension ${ext} (no user has it): ${n}, kept as a label`);
  }
  return plan;
}

/**
 * Pure: the latest legacy timestamp of the rows (any column), i.e. how far the legacy history goes.
 * Times later than `now` are ignored (they would make the reconciler skip real calls).
 */
export function legacyHistoryEnd(rows: readonly SqliteRow[], now: Date): { until: Date | null; future: number } {
  let until: Date | null = null;
  let future = 0;
  for (const row of rows) {
    for (const col of ['call_time', 'dismissed_at', 'created_at', 'updated_at', 'last_outbound_time']) {
      const value = row[col];
      const at = typeof value === 'string' ? parseLegacyLocalTime(value) : null;
      if (!at) continue;
      if (at > now) future++;
      else if (!until || at > until) until = at;
    }
  }
  return { until, future };
}

// --- target -------------------------------------------------------------------------------

export interface CallbacksRepository {
  existing(): Promise<ExistingCallbacks>;
  listUsers(): Promise<TargetUser[]>;
  /** Inserts the callback with its events unless its legacy id exists; returns whether it was inserted. */
  insertIfAbsent(item: CallbackInsert): Promise<boolean>;
  legacyImportedUntil(): Promise<Date | null>;
  setLegacyImportedUntil(until: Date): Promise<void>;
}

export class KyselyCallbacksRepository implements CallbacksRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async existing(): Promise<ExistingCallbacks> {
    const legacy = await this.db.selectFrom('callbacks').select('legacyId').where('legacyId', 'is not', null).execute();
    const open = await this.db
      .selectFrom('callbacks')
      .select(['id', 'phone'])
      .where('status', '=', 'pending')
      .execute();
    return {
      legacyIds: new Set(legacy.map((r) => Number(r.legacyId))),
      openByPhone: new Map(open.map((r) => [r.phone, r.id])),
    };
  }

  listUsers(): Promise<TargetUser[]> {
    return this.db.selectFrom('users').select(['id', 'username', 'extension', 'isActive']).execute();
  }

  async insertIfAbsent(item: CallbackInsert): Promise<boolean> {
    const { sources, ...row } = item.row;
    const inserted = await this.db
      .insertInto('callbacks')
      .values({ ...row, sources: sql<CallbackSource[]>`${sql.val(sources)}::text[]` })
      .onConflict((oc) => oc.column('legacyId').where('legacyId', 'is not', null).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return false;
    await this.db
      .insertInto('callbackEvents')
      .values(item.events.map((e) => ({ ...e, callbackId: inserted.id, callId: null, talkSeconds: null, text: null })))
      .execute();
    return true;
  }

  async legacyImportedUntil(): Promise<Date | null> {
    const row = await this.db
      .selectFrom('callbackSettings')
      .select('legacyImportedUntil')
      .where('id', '=', 1)
      .executeTakeFirst();
    return row?.legacyImportedUntil ?? null;
  }

  async setLegacyImportedUntil(until: Date): Promise<void> {
    await this.db
      .updateTable('callbackSettings')
      .set({ legacyImportedUntil: until, updatedAt: sql<Date>`now()` })
      .where('id', '=', 1)
      .execute();
  }
}

// --- mapper -------------------------------------------------------------------------------

export interface CallbacksMapperDeps {
  repositoryFor: (db: Kysely<DB>) => CallbacksRepository;
  serviceNumbers: () => readonly string[];
  now: () => Date;
}

export function createCallbacksMapper(deps: Partial<CallbacksMapperDeps> = {}): Mapper {
  const repositoryFor = deps.repositoryFor ?? ((db) => new KyselyCallbacksRepository(db));
  const serviceNumbers =
    deps.serviceNumbers ??
    (() => {
      const env = process.env.PBX_SERVICE_NUMBERS?.split(',').map((s) => s.trim().replace(/\D/g, ''));
      return env?.some(Boolean) ? env.filter(Boolean) : DEFAULT_SERVICE_NUMBERS;
    });
  const now = deps.now ?? (() => new Date());
  const meta = { name: 'callbacks', owner: 'S4' };

  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);
      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('pending_callbacks')) {
        report.status = 'source-missing';
        report.notes.push(sqlite ? 'legacy table pending_callbacks not found' : '--sqlite not given');
        return report;
      }
      const rows = sqlite.all('SELECT * FROM pending_callbacks ORDER BY id');
      report.read = rows.length;
      const repo = repositoryFor(ctx.db);
      const opts = { serviceNumbers: serviceNumbers() };
      const plan = planCallbacks(
        rows.map((r) => transformLegacyCallback(r, opts)),
        await repo.existing(),
        await repo.listUsers(),
      );
      report.skipped = plan.skipped;
      report.warnings = plan.warnings;
      report.unchanged = plan.unchanged;

      const end = legacyHistoryEnd(rows, now());
      if (end.future > 0) {
        report.warnings.push({
          key: 'pending_callbacks',
          reason: `${end.future} timestamp(s) later than now ignored for legacy_imported_until`,
        });
      }
      const current = await repo.legacyImportedUntil();
      const moveCutoff = end.until !== null && (!current || end.until > current);

      if (ctx.dryRun) {
        report.inserted = plan.inserts.length;
        if (moveCutoff) report.updated++;
      } else {
        for (const item of plan.inserts) {
          if (await repo.insertIfAbsent(item)) report.inserted++;
          else report.unchanged++;
        }
        if (moveCutoff && end.until) {
          await repo.setLegacyImportedUntil(end.until);
          report.updated++;
        }
      }

      const byStatus = (s: CallbackStatus) => plan.inserts.filter((i) => i.row.status === s).length;
      report.notes.push(
        `new: ${byStatus('pending')} open, ${byStatus('resolved')} resolved, ` + `${byStatus('dismissed')} dismissed`,
      );
      const afterHoursOpen = plan.inserts.filter((i) => i.row.status === 'pending' && i.row.source === 'after_hours');
      if (afterHoursOpen.length > 0) {
        report.notes.push(
          `${afterHoursOpen.length} open after-hours callbacks (legacy ivr_non_working, never listed by legacy) ` +
            'become visible in the new list',
        );
      }
      report.notes.push(...plan.notes);
      const shown = (d: Date | null) => (d ? d.toISOString() : 'not set');
      report.notes.push(
        moveCutoff
          ? `legacy_imported_until ${ctx.dryRun ? 'would move' : 'moved'} ${shown(current)} → ${shown(end.until)}: ` +
              'the CDR reconciliation skips calls up to then ("updated" counts this)'
          : `legacy_imported_until stays ${shown(current)}`,
      );
      report.notes.push('rows are keyed by the legacy id; phones are not printed');
      return report;
    },
  };
}

export const callbacksMapper = createCallbacksMapper();
