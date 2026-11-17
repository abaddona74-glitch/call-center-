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

  // --- Asterisk AMI ---
  AMI_HOST: z.string().optional(),
  AMI_PORT: z.coerce.number().int().positive().default(5038),
  AMI_USER: z.string().optional(),
  AMI_PASSWORD: z.string().optional(),
  /**
   * Optional second AMI user only for AstDB (DBPut/DBDel/DBGet — they need write=system), so the
   * main user never holds `system` together with `originate`. Unset: AstDB goes through AMI_USER.
   */
  AMI_ASTDB_USER: z.string().optional(),
  AMI_ASTDB_PASSWORD: z.string().optional(),
  AMI_PING_INTERVAL_SEC: z.coerce.number().int().min(5).max(300).default(20),
  /** Resync period (QueueStatus + SIPpeers; CoreShowChannels every 4th tick). */
  AMI_POLL_INTERVAL_SEC: z.coerce.number().int().min(5).max(600).default(15),
  /** Operator phone channel technology: "SIP" (chan_sip, Issabel default) or "PJSIP". */
  AMI_CHANNEL_TECH: z.enum(['SIP', 'PJSIP']).default('SIP'),
  /** Dialplan context for click-to-call and transfers. */
  AMI_DIAL_CONTEXT: z.string().regex(/^[A-Za-z0-9_-]+$/).default('from-internal'),
  /** Queue member interface used for pause/unpause; {ext} is replaced. */
  AMI_QUEUE_MEMBER_INTERFACE: z
    .string()
    .regex(/^[A-Za-z0-9_@/{}.-]+$/)
    .refine((v) => v.includes('{ext}'), 'must contain {ext}')
    .default('Local/{ext}@from-queue/n'),
  /** Which SIP peers are operator phones (regex on the peer name / extension). */
  LIVE_OPERATOR_EXTENSION_PATTERN: z.string().default('^[0-9]{2,4}$'),
  /** Click-to-call: regexes (csv) the normalized national number must match. Default: 9-digit Uzbek numbers only. */
  ORIGINATE_ALLOWED_PATTERNS: z
    .string()
    .default('^(33|50|55|77|88|90|91|93|94|95|97|98|99|20|61|62|65|66|67|69|70|71|72|73|74|75|76|78|79)[0-9]{7}$')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // --- Call recordings over SFTP (read-only user, key auth) ---
  SFTP_HOST: z.string().optional(),
  SFTP_PORT: z.coerce.number().int().positive().default(22),
  SFTP_USER: z.string().optional(),
  SFTP_PRIVATE_KEY_PATH: z.string().optional(),
  SFTP_MONITOR_PATH: z.string().default('/var/spool/asterisk/monitor'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // `KEY=` in an env file means "not set": defaults apply and optional values stay undefined
  // (otherwise e.g. an empty BOOTSTRAP_SUPERUSER_PASSWORD fails min(12) and the API won't start).
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => !(typeof value === 'string' && value.trim() === '')),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
