import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** Comma-separated list with a default value. */
const csvOf = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

/**
 * Every environment variable the API reads. The app refuses to start when
 * something required is missing or malformed. Keep `.env.example` in sync.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Our database (PostgreSQL) ---
  DATABASE_URL: z.url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_MIGRATE_ON_START: z.stringbool().default(false),

  // --- HTTP / security ---
  /** Express "trust proxy": IPs/CIDRs of reverse proxies in front of the API (Caddy, Kerio). */
  TRUSTED_PROXIES: csv,
  COOKIE_SECURE: z.stringbool().default(true),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  /** Created on startup only when no superuser exists yet. Min 12 chars. */
  BOOTSTRAP_SUPERUSER_USERNAME: z.string().default('superuser'),
  BOOTSTRAP_SUPERUSER_PASSWORD: z.string().min(12).optional(),

  // --- PBX MariaDB (read-only user, direct network access, no SSH) ---
  PBX_DB_HOST: z.string().optional(),
  PBX_DB_PORT: z.coerce.number().int().positive().default(3306),
  PBX_DB_USER: z.string().optional(),
  PBX_DB_PASSWORD: z.string().optional(),
  PBX_DB_NAME: z.string().default('asteriskcdrdb'),

  // --- PBX dialplan conventions (Issabel/FreePBX), used to read CDR rows. See docs/rewrite/METRICS.md ---
  /** SIP trunk peer names: inbound calls arrive on `SIP/<peer>-…`. */
  PBX_TRUNK_PEERS: csvOf('712020159'),
  /** DID / queue numbers that are never a client phone (excluded from client numbers and operator answers). */
  PBX_SERVICE_NUMBERS: csvOf('2020159,712020159'),
  /** dcontext values of an external inbound call (DID routing, IVR, queue). */
  PBX_INBOUND_CONTEXTS: csvOf('ext-queues,from-trunk,ivr-4'),
  /** dcontext values meaning "the caller entered a queue". */
  PBX_QUEUE_CONTEXTS: csvOf('ext-queues'),
  /** `lastdata` fragments meaning the IVR played the "outside working hours" announcement. */
  PBX_OFF_HOURS_MARKERS: csvOf('working-time,music-working-time'),
  /** What an operator extension looks like (regex source). */
  PBX_EXTENSION_PATTERN: z
    .string()
    .default('^[0-9]{2,4}$')
    .refine((v) => {
      try {
        new RegExp(v);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid regular expression'),
  /** One-digit outside-line prefixes operators may dial before a 9-digit number. */
  PBX_DIAL_PREFIXES: csvOf('0,9'),
  /** Set false if the PBX cdr table has no `linkedid` column (then legs are grouped by uniqueid). */
  PBX_CDR_HAS_LINKEDID: z.stringbool().default(true),
  /** Longest date range for the call history and for stats/export requests. */
  CDR_HISTORY_MAX_DAYS: z.coerce.number().int().min(1).max(366).default(93),
  STATS_MAX_DAYS: z.coerce.number().int().min(1).max(1100).default(366),

  // --- Working calendar (Asia/Tashkent). Half-open: START <= t < END ---
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  WORKING_DAYS: csvOf('1,2,3,4,5').pipe(
    z
      .array(
        z
          .string()
          .regex(/^[1-7]$/)
          .transform(Number),
      )
      .min(1),
  ),
  WORKING_HOURS_START: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('08:00'),
  WORKING_HOURS_END: z
    .string()
    .regex(/^([01]\d|2[0-4]):[0-5]\d$/)
    .default('21:00'),
  /** Operator groups by extension range until the groups model exists, e.g. "main:100-199;secondary:200-299". */
  OPERATOR_GROUPS: z
    .string()
    .default('main:100-199;secondary:200-299')
    .transform((v, ctx) => {
      const groups: { id: string; from: number; to: number }[] = [];
      for (const part of v
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const m = /^([a-z0-9_-]+):(\d+)-(\d+)$/i.exec(part);
        if (!m) {
          ctx.addIssue({ code: 'custom', message: `Bad OPERATOR_GROUPS entry "${part}" (expected name:from-to)` });
          return z.NEVER;
        }
        groups.push({ id: m[1], from: Number(m[2]), to: Number(m[3]) });
      }
      return groups;
    }),

  // --- Asterisk AMI ---
  AMI_HOST: z.string().optional(),
  AMI_PORT: z.coerce.number().int().positive().default(5038),
  AMI_USER: z.string().optional(),
  AMI_PASSWORD: z.string().optional(),

  // --- Call recordings over SFTP (read-only user, key auth) ---
  SFTP_HOST: z.string().optional(),
  SFTP_PORT: z.coerce.number().int().positive().default(22),
  SFTP_USER: z.string().optional(),
  SFTP_PRIVATE_KEY_PATH: z.string().optional(),
  SFTP_MONITOR_PATH: z.string().default('/var/spool/asterisk/monitor'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
