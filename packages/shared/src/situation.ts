import { z } from 'zod';
import {
  AmiStatusSchema,
  LiveCallSchema,
  LiveCountersSchema,
  LiveOperatorSchema,
  LiveQueueSchema,
} from './telephony.js';
import { IsoDateSchema } from './common.js';
import { TicketStatusSchema } from './tickets.js';

/**
 * The live situation board «Hozirgi holat» (permission `situation.view`: observers and the superuser, owner decision
 * 19.11.2026): who is on the line, who is waiting, calls in progress, today's counters, open tickets and who works on
 * them — read-only, no telephony actions. Definitions: docs/rewrite/METRICS.md §10.
 *
 * Initial state: GET /api/situation; afterwards the WS events `situation.telephony` (coalesced, at most one a second)
 * and `situation.tickets` (on every ticket change and every 30 s) replace the parts.
 *
 * Citizen numbers are sent IN FULL (owner, 19.11.2026): waiting callers and calls in progress.
 */

const count = z.number().int().nonnegative();

/** Today's working window from the shared working calendar (Asia/Tashkent). */
export const SituationWorkdaySchema = z.object({
  date: IsoDateSchema,
  /** Today is a working day (weekday, not a holiday). */
  working: z.boolean(),
  /** "HH:mm" — the working hours of the calendar. */
  start: z.string(),
  end: z.string(),
});
export type SituationWorkday = z.infer<typeof SituationWorkdaySchema>;

/**
 * Telephony now — the live store's projections (same shapes as the live snapshot, so the live widgets render it), for
 * a privileged viewer: every number unmasked. Operator PC/phone addresses are left out (`ip` is always null).
 */
export const SituationTelephonySchema = z.object({
  operators: z.array(LiveOperatorSchema),
  calls: z.array(LiveCallSchema),
  queues: z.array(LiveQueueSchema),
  counters: LiveCountersSchema,
  ami: AmiStatusSchema,
  workday: SituationWorkdaySchema,
  serverTime: z.string(),
});
export type SituationTelephony = z.infer<typeof SituationTelephonySchema>;

export const SituationRegionRefSchema = z.object({
  /** `ticket_regions.code`; null = tickets without a region ("Hududsiz"). */
  code: z.string().nullable(),
  nameUz: z.string(),
  nameRu: z.string(),
});
export type SituationRegionRef = z.infer<typeof SituationRegionRefSchema>;

/** New tickets of one region waiting to be taken by its executives. */
export const SituationRegionQueueSchema = SituationRegionRefSchema.extend({
  waiting: count,
  /** Of them already past `due_at`. */
  overdue: count,
  /** The longest-waiting one entered the region's queue at (created, forwarded here or released back). */
  oldestSince: z.string(),
  /** Active executives assigned to the region; 0 = nobody can take them. */
  executives: count,
});
export type SituationRegionQueue = z.infer<typeof SituationRegionQueueSchema>;

/** One ticket an executive holds right now (no contents: code and times only). */
export const SituationHeldTicketSchema = z.object({
  id: z.number().int(),
  /** "TK-123" */
  code: z.string(),
  status: TicketStatusSchema,
  /** Taken at (`assigned_at`; the creation time for migrated rows without it). */
  since: z.string(),
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
});
export type SituationHeldTicket = z.infer<typeof SituationHeldTicketSchema>;

/** Most held tickets listed per executive; `holding` always has the full number. */
export const SITUATION_HELD_TICKETS_MAX = 10;

/** An executive ("Mas’ul") — or anyone else — holding tickets right now. */
export const SituationWorkerSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  /** Regions the user is assigned to (`ticket_executive_regions`), directory order. */
  regions: z.array(SituationRegionRefSchema),
  /** Tickets with this user now (`assigned` + `in_progress`). */
  holding: count,
  assigned: count,
  inProgress: count,
  /** Of the held ones, past `due_at`. */
  overdue: count,
  /** Tickets this user finished (done / rejected) today. */
  resolvedToday: count,
  /** Held tickets, oldest first (at most SITUATION_HELD_TICKETS_MAX). */
  tickets: z.array(SituationHeldTicketSchema),
});
export type SituationWorker = z.infer<typeof SituationWorkerSchema>;

export const SituationTicketsSchema = z.object({
  /** Not closed yet, by status (`done` / `rejected` turn into `callback_pending` at once). */
  open: z.object({
    total: count,
    new: count,
    assigned: count,
    inProgress: count,
    callbackPending: count,
  }),
  /** Still with the region (new / assigned / in_progress) after `due_at` (tickets SLA, `isOverdue`). */
  overdue: count,
  /** With the region, not overdue yet, due before the end of today (Tashkent). */
  dueToday: count,
  /** Waiting for the callback after `callback_due_at` (`isCallbackOverdue`). */
  callbackOverdue: count,
  /** Today (Tashkent): created, finished by executives (done / rejected), closed after the callback. */
  today: z.object({ opened: count, resolved: count, closed: count }),
  /**
   * Not tickets: today's callbacks (citizens to call back, the callbacks list's «Bugun»), read in the same database
   * pass so they ride this part's pushes. `total` = `pending` (still to call back, unreachable ones too) + `resolved`
   * (called back today); dismissed ones are left out.
   */
  callbacks: z.object({ total: count, pending: count, resolved: count }),
  /** Regions with new tickets, the longest-waiting first. */
  waiting: z.array(SituationRegionQueueSchema),
  /** Executives (every active one assigned to a region) and anyone else holding tickets, busiest first. */
  workers: z.array(SituationWorkerSchema),
  slaWorkingDays: z.number().int(),
  callbackSlaWorkingDays: z.number().int(),
  generatedAt: z.string(),
});
export type SituationTickets = z.infer<typeof SituationTicketsSchema>;

export const SituationSnapshotSchema = z.object({
  telephony: SituationTelephonySchema,
  tickets: SituationTicketsSchema,
});
export type SituationSnapshot = z.infer<typeof SituationSnapshotSchema>;
