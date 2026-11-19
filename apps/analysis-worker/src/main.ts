import { setTimeout as sleep } from 'node:timers/promises';
import { HttpApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { HttpLlmClient } from './llm/llm-client.js';
import { log } from './log.js';
import { type JobOutcome, processJob } from './pipeline.js';
import { HttpSttClient } from './stt/stt-client.js';

/**
 * The analysis worker (docs/rewrite/CALL-ANALYSIS.md §Runbook): CC_WORKER_CONCURRENCY slots, each leases one job,
 * processes it and leases the next; an empty queue is polled every CC_WORKER_POLL_SEC (or ends the run with
 * CC_WORKER_ONCE=true). SIGINT/SIGTERM: no new leases, running jobs finish.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const api = new HttpApiClient(cfg.CC_API_URL, cfg.CC_API_TOKEN, cfg.CC_WORKER_ID);
  const stt = new HttpSttClient(cfg.CC_AI_STT_URL, cfg.CC_STT_TIMEOUT_SEC * 1000);
  const llm = new HttpLlmClient(
    cfg.CC_AI_LLM_URL,
    cfg.CC_AI_LLM_MODEL,
    cfg.CC_AI_LLM_API_KEY,
    cfg.CC_LLM_TIMEOUT_SEC * 1000,
  );

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info('stopping: finishing running jobs', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log.info('worker started', {
    workerId: cfg.CC_WORKER_ID,
    concurrency: cfg.CC_WORKER_CONCURRENCY,
    strategy: cfg.CC_STT_STRATEGY,
    thinking: cfg.CC_LLM_THINKING,
    once: cfg.CC_WORKER_ONCE,
  });

  const totals = { done: 0, skipped: 0, failed: 0 };
  const count = (o: JobOutcome) => totals[o.kind]++;

  const slot = async (n: number) => {
    while (!stopping) {
      let lease;
      try {
        lease = await api.lease(1, cfg.CC_WORKER_LEASE_SEC);
      } catch (err) {
        log.warn('lease failed', { slot: n, error: (err as Error).message });
        await sleep(cfg.CC_WORKER_POLL_SEC * 1000);
        continue;
      }
      const job = lease.jobs[0];
      if (!job) {
        if (cfg.CC_WORKER_ONCE) return;
        await sleep(cfg.CC_WORKER_POLL_SEC * 1000);
        continue;
      }
      log.info('job leased', {
        slot: n,
        callId: job.callId,
        mode: job.mode,
        attempt: job.attempts,
        talkSec: job.talkSec,
      });
      count(
        await processJob(
          job,
          lease.topics,
          { api, stt, llm },
          {
            workerId: cfg.CC_WORKER_ID,
            strategy: cfg.CC_STT_STRATEGY,
            turnConcurrency: cfg.CC_STT_TURN_CONCURRENCY,
            ruThreshold: cfg.CC_STT_RU_THRESHOLD,
            thinking: cfg.CC_LLM_THINKING,
            maxAudioSec: cfg.CC_WORKER_MAX_AUDIO_SEC,
          },
        ),
      );
    }
  };

  await Promise.all(Array.from({ length: cfg.CC_WORKER_CONCURRENCY }, (_, i) => slot(i + 1)));
  log.info('worker stopped', totals);
}

main().catch((err: unknown) => {
  log.error('worker crashed', { error: (err as Error).message });
  process.exit(1);
});
