import { z } from 'zod';
import { ExtensionSchema } from './auth.js';
import { IsoDateSchema } from './common.js';

/**
 * 3CX desktop agent (agent.exe on operator PCs). The ingest paths and payloads are the legacy ones
 * (`/api/agent/heartbeat`, `call-event`, `sync-batch`, `update-log`, `version`) so deployed agents keep
 * working; every field is validated and sanitized here. Agent data is stored separately and never
 * overrides PBX statistics.
 */

const IsoDateTime = z.iso.datetime({ offset: true });

/** Removes characters outside `allowed` and truncates. Numbers are accepted and stringified. */
const cleanText = (allowed: RegExp, max: number) =>
  z.union([z.string(), z.number()]).transform((v) => String(v).replace(allowed, '').trim().slice(0, max));

const OperatorIdSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^[0-9]{2,6}$/, 'operatorId must be 2-6 digits'));

export const AgentEventTypeRawSchema = cleanText(/[^A-Za-z0-9_]/g, 20)
  .transform((v) => v.toUpperCase())
  .pipe(z.string().min(1, 'eventType is required'));

/** Caller number as the agent shows it: digits and dial symbols, or a label like "Yashirin raqam". */
const CallerIdSchema = cleanText(/[^\p{L}\p{N} +()*#.\-]/gu, 40);
const TimeTextSchema = cleanText(/[^0-9 :/.\-TZ+]/g, 40);
const HostnameSchema = cleanText(/[^\p{L}\p{N} ._\-]/gu, 64);
const DetailsSchema = cleanText(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, 500);
const VersionSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z.+\-]{1,32}$/, 'Invalid version');
const DurationSchema = z.coerce.number().finite().min(0).max(86_400).transform(Math.round);

export const AgentHeartbeatRequestSchema = z.object({
  operatorId: OperatorIdSchema,
  hostname: HostnameSchema.optional(),
  appVersion: VersionSchema.optional().catch(undefined),
  version: VersionSchema.optional().catch(undefined),
});
export type AgentHeartbeatRequest = z.infer<typeof AgentHeartbeatRequestSchema>;

export const AgentHeartbeatResponseSchema = z.object({
  success: z.literal(true),
  timestamp: z.number().int(),
  latestVersion: z.string(),
  updateUrl: z.string(),
});
export type AgentHeartbeatResponse = z.infer<typeof AgentHeartbeatResponseSchema>;

const AgentCallFieldsSchema = z.object({
  eventType: AgentEventTypeRawSchema,
  callerId: CallerIdSchema.optional().default(''),
  durationSec: DurationSchema.optional().default(0),
  startTime: TimeTextSchema.optional(),
  endTime: TimeTextSchema.optional(),
  details: DetailsSchema.optional().default(''),
});

export const AgentCallEventRequestSchema = AgentCallFieldsSchema.extend({
  operatorId: OperatorIdSchema,
  hostname: HostnameSchema.optional(),
});
export type AgentCallEventRequest = z.infer<typeof AgentCallEventRequestSchema>;

export const AGENT_SYNC_BATCH_MAX = 20_000;

/** Items are validated one by one on the server; invalid ones are skipped and counted. */
export const AgentSyncBatchRequestSchema = z.object({
  operatorId: OperatorIdSchema,
  hostname: HostnameSchema.optional(),
  calls: z.array(z.unknown()).max(AGENT_SYNC_BATCH_MAX),
});
export const AgentSyncBatchItemSchema = AgentCallFieldsSchema;
export type AgentSyncBatchItem = z.infer<typeof AgentSyncBatchItemSchema>;

export const AgentOkResponseSchema = z.object({ success: z.literal(true) });
export const AgentSyncBatchResponseSchema = z.object({
  success: z.literal(true),
  count: z.number().int(),
  skipped: z.number().int(),
});

export const AGENT_UPDATE_STEPS = ['DOWNLOADING', 'DOWNLOADED', 'INSTALLING', 'SUCCESS', 'ERROR', 'INFO'] as const;
export const AgentUpdateStepSchema = z.enum(AGENT_UPDATE_STEPS);
export type AgentUpdateStep = z.infer<typeof AgentUpdateStepSchema>;

export const AgentUpdateLogRequestSchema = z.object({
  operatorId: OperatorIdSchema,
  hostname: HostnameSchema.optional(),
  version: VersionSchema.optional().catch(undefined),
  targetVersion: VersionSchema.optional().catch(undefined),
  step: cleanText(/[^A-Za-z_]/g, 20)
    .transform((v) => v.toUpperCase())
    .pipe(AgentUpdateStepSchema.catch('INFO'))
    .optional()
    .default('INFO'),
  message: DetailsSchema.optional().default(''),
});
export type AgentUpdateLogRequest = z.infer<typeof AgentUpdateLogRequestSchema>;

export const AgentVersionResponseSchema = z.object({
  success: z.literal(true),
  latestVersion: z.string(),
  updateUrl: z.string(),
  releaseNotes: z.string(),
  minVersion: z.string().nullable(),
  lastReleaseTime: IsoDateTime.nullable(),
});
export type AgentVersionResponse = z.infer<typeof AgentVersionResponseSchema>;

// ---------------------------------------------------------------- admin API

/** `key` = per-device API key; `legacy` = unauthenticated agent accepted in compatibility mode. */
export const AGENT_AUTH_MODES = ['key', 'legacy'] as const;
export const AgentAuthModeSchema = z.enum(AGENT_AUTH_MODES);
export type AgentAuthMode = z.infer<typeof AgentAuthModeSchema>;

export const AgentDeviceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  extension: z.string(),
  /** First characters of the key, to recognize it (the key itself is never stored). */
  keyPrefix: z.string(),
  createdAt: IsoDateTime,
  createdBy: z.string().nullable(),
  revokedAt: IsoDateTime.nullable(),
  revokedBy: z.string().nullable(),
  lastSeenAt: IsoDateTime.nullable(),
  lastIp: z.string().nullable(),
  hostname: z.string().nullable(),
  appVersion: z.string().nullable(),
  online: z.boolean(),
});
export type AgentDevice = z.infer<typeof AgentDeviceSchema>;

export const AgentDeviceListResponseSchema = z.object({
  items: z.array(AgentDeviceSchema),
  /** Server setting: legacy unauthenticated agents are accepted from private networks. */
  compatMode: z.boolean(),
});
export type AgentDeviceListResponse = z.infer<typeof AgentDeviceListResponseSchema>;

export const CreateAgentDeviceRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), 'Control characters are not allowed'),
  extension: ExtensionSchema,
});
export type CreateAgentDeviceRequest = z.infer<typeof CreateAgentDeviceRequestSchema>;

/** The plaintext key is returned exactly once, at creation. */
export const CreateAgentDeviceResponseSchema = z.object({
  device: AgentDeviceSchema,
  apiKey: z.string(),
});
export type CreateAgentDeviceResponse = z.infer<typeof CreateAgentDeviceResponseSchema>;

export const AgentStatusSchema = z.object({
  extension: z.string(),
  deviceId: z.number().int().nullable(),
  deviceName: z.string().nullable(),
  authMode: AgentAuthModeSchema,
  hostname: z.string().nullable(),
  appVersion: z.string().nullable(),
  ip: z.string().nullable(),
  lastSeenAt: IsoDateTime,
  online: z.boolean(),
  isLatest: z.boolean(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentStatusListResponseSchema = z.object({
  items: z.array(AgentStatusSchema),
  latestVersion: z.string(),
});
export type AgentStatusListResponse = z.infer<typeof AgentStatusListResponseSchema>;

export const AgentReleaseSchema = z.object({
  id: z.number().int(),
  version: z.string(),
  releaseNotes: z.string(),
  minVersion: z.string().nullable(),
  updateUrl: z.string(),
  createdAt: IsoDateTime,
  createdBy: z.string().nullable(),
});
export type AgentRelease = z.infer<typeof AgentReleaseSchema>;

export const AgentReleaseListResponseSchema = z.object({ items: z.array(AgentReleaseSchema) });

/** Relative download path on this server (e.g. /downloads/agent.exe) or an https URL. */
const UpdateUrlSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^(\/[A-Za-z0-9._~\-/]+|https:\/\/[^\s"'<>]+)$/, 'Relative path or https URL');

export const CreateAgentReleaseRequestSchema = z.object({
  version: VersionSchema,
  releaseNotes: z.string().trim().max(2000).default(''),
  minVersion: VersionSchema.nullable().default(null),
  updateUrl: UpdateUrlSchema.optional(),
});
export type CreateAgentReleaseRequest = z.input<typeof CreateAgentReleaseRequestSchema>;

export const AgentUpdateLogSchema = z.object({
  id: z.number().int(),
  at: IsoDateTime,
  extension: z.string(),
  hostname: z.string().nullable(),
  version: z.string().nullable(),
  targetVersion: z.string().nullable(),
  step: AgentUpdateStepSchema,
  message: z.string(),
});
export type AgentUpdateLog = z.infer<typeof AgentUpdateLogSchema>;

export const AgentUpdateLogListResponseSchema = z.object({ items: z.array(AgentUpdateLogSchema) });

export const AGENT_EVENT_TYPES = [
  'RINGING',
  'ANSWERED',
  'ENDED',
  'MISSED',
  'DIALLED',
  'OUTBOUND',
  'INCOMING',
  'REJECT',
  'INFO',
  'UNKNOWN',
] as const;
export const AgentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentCallEventSchema = z.object({
  id: z.number().int(),
  extension: z.string(),
  eventType: AgentEventTypeSchema,
  rawEventType: z.string(),
  callerId: z.string(),
  /** Normalized number, null for hidden/internal callers. */
  phone: z.string().nullable(),
  durationSec: z.number().int(),
  startedAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
  hostname: z.string().nullable(),
  details: z.string(),
  authMode: AgentAuthModeSchema,
  receivedAt: IsoDateTime,
});
export type AgentCallEvent = z.infer<typeof AgentCallEventSchema>;

export const AgentEventsQuerySchema = z.object({
  date: z.union([z.literal('today'), IsoDateSchema]).default('today'),
  extension: ExtensionSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(500).default(100),
});
export type AgentEventsQuery = z.infer<typeof AgentEventsQuerySchema>;

export const AgentEventsResponseSchema = z.object({
  items: z.array(AgentCallEventSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AgentEventsResponse = z.infer<typeof AgentEventsResponseSchema>;
