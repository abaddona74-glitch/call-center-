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

  // --- Call recordings over SFTP (read-only user, key auth) ---
  SFTP_HOST: z.string().optional(),
  SFTP_PORT: z.coerce.number().int().positive().default(22),
  SFTP_USER: z.string().optional(),
  SFTP_PRIVATE_KEY_PATH: z.string().optional(),
  SFTP_MONITOR_PATH: z.string().default('/var/spool/asterisk/monitor'),
  /** Pinned host key, `SHA256:<base64>` as printed by `ssh-keygen -lf`. Strongly recommended in production. */
  SFTP_HOST_FINGERPRINT: z
    .string()
    .regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/, 'Expected SHA256:<base64> (ssh-keygen -lf)')
    .optional(),

  // --- Recordings ZIP export (temp files outside the web root, deleted after the TTL) ---
  RECORDINGS_ZIP_DIR: z.string().optional(),
  RECORDINGS_ZIP_MAX_FILES: z.coerce.number().int().positive().max(5000).default(2000),
  RECORDINGS_ZIP_MAX_MB: z.coerce.number().int().positive().default(2048),
  RECORDINGS_ZIP_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  RECORDINGS_ZIP_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),

  // --- Tickets ---
  /** Attachments live here (a volume outside the web root); served only through the API. */
  TICKETS_UPLOAD_DIR: z.string().default('.data/ticket-uploads'),
  TICKETS_MAX_FILE_MB: z.coerce.number().int().positive().max(50).default(10),
  /** Operators with extension >= this number create tickets ("200" group); others receive them. */
  TICKETS_CREATOR_EXTENSION_FROM: z.coerce.number().int().positive().default(200),
  /** Completed tickets (and files) older than N days are deleted daily; 0 = keep forever. */
  TICKETS_PURGE_COMPLETED_AFTER_DAYS: z.coerce.number().int().min(0).default(7),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
