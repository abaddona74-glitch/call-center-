import { hostname } from 'node:os';
import { STT_STRATEGIES, WorkerIdSchema } from '@cc/shared';
import { z } from 'zod';

const url = z
  .url({ protocol: /^https?$/ })
  .transform((v) => v.replace(/\/+$/, ''));

/**
 * Worker settings, all from the environment (docs/rewrite/CALL-ANALYSIS.md §Runbook). On the Mac:
 *   ~/.config/cc-analysis/worker.env      — CC_AI_* (AI servers; never committed, never printed)
 *   ~/.config/cc-analysis/worker-api.env  — CC_API_URL, CC_API_TOKEN
 */
export const WorkerEnvSchema = z.object({
  /** Call-center API base, e.g. http://localhost:3000 or https://uniconsoft.ddns.net (without /api). */
  CC_API_URL: url,
  /** Service token; the API keeps only its SHA-256 (CALL_ANALYSIS_WORKER_TOKEN_SHA256). */
  CC_API_TOKEN: z.string().regex(/^[A-Za-z0-9._~+/=-]{16,512}$/, 'CC_API_TOKEN: 16–512 token characters'),
  CC_WORKER_ID: WorkerIdSchema.default(
    hostname()
      .replace(/[^A-Za-z0-9._:-]/g, '-')
      .slice(0, 64) || 'worker',
  ),

  CC_AI_STT_URL: url,
  CC_AI_LLM_URL: url,
  CC_AI_LLM_MODEL: z.string().min(1),
  CC_AI_LLM_API_KEY: z.string().min(1),

  /** Calls processed at the same time (the GPU is shared with TTS: keep it low). */
  CC_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Parallel STT requests inside one call (turn strategy). */
  CC_STT_TURN_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  CC_STT_STRATEGY: z.enum(STT_STRATEGIES).default('turns'),
  /** Re-run STT in Russian when at least this share of the recognised words looks Russian (0..1, 1 = never). */
  CC_STT_RU_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),
  CC_LLM_THINKING: z.stringbool().default(false),
  CC_LLM_TIMEOUT_SEC: z.coerce.number().int().min(10).max(1800).default(300),
  CC_STT_TIMEOUT_SEC: z.coerce.number().int().min(10).max(3600).default(900),
  /** Wait between polls when the queue is empty. */
  CC_WORKER_POLL_SEC: z.coerce.number().int().min(1).max(3600).default(30),
  CC_WORKER_LEASE_SEC: z.coerce.number().int().min(60).max(3600).default(1200),
  /** Exit when the queue is empty (pilot / cron runs). */
  CC_WORKER_ONCE: z.stringbool().default(false),
  CC_WORKER_MAX_AUDIO_SEC: z.coerce.number().int().min(60).max(1800).default(1800),
});
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = WorkerEnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // names and messages only — never the values (the key and token are secrets)
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker configuration:\n${issues}`);
  }
  return parsed.data;
}
