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

const csvWithDefault = (fallback: string) =>
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

  // --- Callbacks / contacts / blacklist / desktop agent ---
  /** Missed calls are re-read from the PBX CDR this often (catches calls missed while the API was down). 0 = off. */
  CALLBACKS_RECONCILE_INTERVAL_SEC: z.coerce.number().int().min(0).default(300),
  CALLBACKS_RECONCILE_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(744).default(48),
  /** Operator extensions that may not see the phonebook until operator groups carry permissions (legacy "200 group"). */
  CONTACTS_DENIED_EXTENSION_RANGES: csvWithDefault('200-999').pipe(
    z.array(z.string().regex(/^\d{2,6}(-\d{2,6})?$/, 'Expected "200-299" or "205"')),
  ),
  /** Extensions with a personal AstDB block list `blacklist_<ext>` read by the PBX dialplan (legacy: 114). */
  BLACKLIST_OPERATOR_EXTENSIONS: csvWithDefault('114').pipe(z.array(z.string().regex(/^\d{2,6}$/))),
  /** Temporarily accept legacy desktop agents without an API key — only from AGENT_COMPAT_ALLOWED_CIDRS. */
  AGENT_COMPAT_MODE: z.stringbool().default(false),
  AGENT_COMPAT_ALLOWED_CIDRS: csvWithDefault('10.0.0.0/8,172.16.0.0/12,192.168.0.0/16').pipe(
    z.array(z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'Expected IPv4 CIDR like 192.168.0.0/16')),
  ),
  /** Shown to agents until an admin publishes a release. */
  AGENT_DEFAULT_VERSION: z
    .string()
    .regex(/^[0-9A-Za-z.+-]{1,32}$/)
    .default('1.0.4'),
  AGENT_DEFAULT_UPDATE_URL: z.string().default('/downloads/agent.exe'),
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
    const details = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
