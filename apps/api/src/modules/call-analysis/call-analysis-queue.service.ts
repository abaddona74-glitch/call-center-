import {
  type CallAnalysisBackfillRequest,
  type CallAnalysisBackfillResponse,
  type CallAnalysisQueue,
  type CallAnalysisReanalyzeRequest,
  type WorkerTranscript,
  type WorkerAck,
  type WorkerFailRequest,
  type WorkerLeaseRequest,
  type WorkerLeaseResponse,
  type WorkerResult,
  type WorkerSkipRequest,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { wallToIso } from '../../common/time/business-time.js';
import { AppConfig } from '../../config/app-config.js';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CallAnalysisRepository } from './call-analysis.repository.js';
import { afterFailure, isAnalyzable, jobOf, sanitizeError } from './domain/job-policy.js';

/**
 * The analysis job queue: what gets queued (enqueuer, backfill), and the worker side (lease, result, failure).
 * A job belongs to one worker while its lease runs; an expired lease is leased again until the attempts run out.
 */
@Injectable()
export class CallAnalysisQueueService {
  private readonly logger = new Logger(CallAnalysisQueueService.name);

  constructor(
    private readonly repo: CallAnalysisRepository,
    private readonly calls: PbxCallsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private get maxAttempts(): number {
    return this.config.get('CALL_ANALYSIS_MAX_ATTEMPTS');
  }

  private get minTalkSec(): number {
    return this.config.get('CALL_ANALYSIS_MIN_TALK_SEC');
  }

  // --- what gets queued ---

  /** Queues the analysable calls among these; returns how many were new. */
  async enqueueCalls(calls: readonly AssembledCall[], source: 'auto' | 'manual'): Promise<{ eligible: number; enqueued: number }> {
    const eligible = calls.filter((c) => isAnalyzable(c, this.minTalkSec));
    const inserted = await this.repo.enqueue(
      eligible.map((c) => jobOf(c, wallToIso)),
      source,
    );
    return { eligible: eligible.length, enqueued: inserted.length };
  }

  /** Superuser: a date range (same limit as statistics) or exact call ids (the pilot). */
  async backfill(req: CallAnalysisBackfillRequest): Promise<CallAnalysisBackfillResponse> {
    let found: AssembledCall[];
    let requested: number;
    if ('callIds' in req) {
      const ids = [...new Set(req.callIds)];
      requested = ids.length;
      found = [];
      for (const id of ids) {
        const hit = await this.calls.findCall(id);
        if (hit) found.push(hit.call);
      }
    } else {
      this.calls.assertRange(req.from, req.to, this.calls.maxStatsDays);
      found = await this.calls.callsForRange(req.from, req.to);
      requested = found.length;
    }
    const { eligible, enqueued } = await this.enqueueCalls(found, 'manual');
    const result = {
      eligible,
      enqueued,
      existing: eligible - enqueued,
      rejected: 'callIds' in req ? requested - eligible : 0,
    };
    await this.audit.record('callAnalysis.backfill', {
      details: 'callIds' in req ? { callIds: requested, ...result } : { from: req.from, to: req.to, ...result },
    });
    return result;
  }

  /** Superuser: re-score analysed calls with the current prompt version (LLM only, on the stored transcripts). */
  async reanalyze(req: CallAnalysisReanalyzeRequest): Promise<{ requeued: number }> {
    if (!('callIds' in req)) this.calls.assertRange(req.from, req.to, this.calls.maxStatsDays);
    const requeued = await this.repo.requeueForReanalysis(req);
    await this.audit.record('callAnalysis.reanalyze', {
      details: 'callIds' in req ? { callIds: req.callIds.length, requeued } : { from: req.from, to: req.to, requeued },
    });
    return { requeued };
  }

  async retryFailed(): Promise<{ requeued: number }> {
    const requeued = await this.repo.retryFailed();
    await this.audit.record('callAnalysis.retryFailed', { details: { requeued } });
    return { requeued };
  }

  // --- worker side ---

  @Transactional()
  async lease(req: WorkerLeaseRequest): Promise<WorkerLeaseResponse> {
    await this.repo.touchWorker(req.workerId);
    await this.repo.failExhausted(this.maxAttempts);
    const rows = await this.repo.lease(req.workerId, req.limit, req.leaseSec, this.maxAttempts);
    const topics = rows.length ? await this.repo.topics(true) : [];
    if (rows.length) this.logger.log(`worker ${req.workerId} leased ${rows.length} job(s)`);
    return {
      jobs: rows.map((r) => ({
        callId: r.callId,
        mode: r.mode,
        startedAt: r.callStartedAt.toISOString(),
        direction: r.direction,
        operatorExt: r.operatorExt,
        talkSec: r.talkSec,
        attempts: r.attempts,
        leaseUntil: (r.leaseUntil ?? new Date()).toISOString(),
      })),
      topics: topics.map((t) => ({ code: t.code, nameUz: t.nameUz, nameRu: t.nameRu })),
    };
  }

  /** 409 unless this worker holds the job's lease (it expired and went to someone else, or was already finished). */
  async assertLease(callId: string, workerId: string): Promise<void> {
    const job = await this.repo.job(callId);
    if (!job || job.status !== 'processing' || job.leaseOwner !== workerId) {
      throw new ConflictException('This worker does not hold the lease of the job');
    }
  }

  /** The stored transcript of a leased job (llm_only re-analysis). */
  async storedTranscript(callId: string, workerId: string): Promise<WorkerTranscript> {
    await this.assertLease(callId, workerId);
    const t = await this.repo.transcript(callId);
    if (!t) throw new NotFoundException('This call has no stored transcript');
    return {
      language: t.language,
      audioSec: t.audioSec,
      segments: t.segments,
      sttStrategy: t.sttStrategy,
      sttModel: t.sttModel,
      sttMs: t.sttMs,
      sttRerun: t.sttRerun,
    };
  }

  @Transactional()
  async submit(callId: string, result: WorkerResult): Promise<WorkerAck> {
    const job = await this.repo.leasedJob(callId, result.workerId);
    if (!job) throw new ConflictException('This worker does not hold the lease of the job');
    const topics = new Set((await this.repo.topics(false)).map((t) => t.code));
    if (!topics.has(result.analysis.topicCode)) {
      throw new UnprocessableEntityException(`Unknown topic "${result.analysis.topicCode}"`);
    }
    await this.repo.saveResult(callId, result);
    await this.repo.finishJob(callId, { status: 'done' });
    await this.repo.touchWorker(result.workerId);
    return { ok: true, status: 'done' };
  }

  @Transactional()
  async fail(callId: string, req: WorkerFailRequest): Promise<WorkerAck> {
    const job = await this.repo.leasedJob(callId, req.workerId);
    if (!job) throw new ConflictException('This worker does not hold the lease of the job');
    const next = afterFailure({ attempts: job.attempts, maxAttempts: this.maxAttempts, retryable: req.retryable });
    const lastError = sanitizeError(req.error);
    if (next.status === 'queued') await this.repo.finishJob(callId, { status: 'queued', lastError, delaySec: next.delaySec });
    else await this.repo.finishJob(callId, { status: 'failed', lastError });
    this.logger.warn(`call ${callId}: worker ${req.workerId} failed (attempt ${job.attempts}) → ${next.status}`);
    return { ok: true, status: next.status };
  }

  @Transactional()
  async skip(callId: string, req: WorkerSkipRequest): Promise<WorkerAck> {
    const job = await this.repo.leasedJob(callId, req.workerId);
    if (!job) throw new ConflictException('This worker does not hold the lease of the job');
    await this.repo.finishJob(callId, { status: 'skipped', skipReason: req.reason });
    return { ok: true, status: 'skipped' };
  }

  // --- progress ---

  async progress(): Promise<CallAnalysisQueue> {
    const [counts, times, workers, failures] = await Promise.all([
      this.repo.queueCounts(),
      this.repo.queueTimes(),
      this.repo.workers(),
      this.repo.recentFailures(10),
    ]);
    const count = (s: string) => counts.find((c) => c.status === s)?.count ?? 0;
    return {
      autoEnqueue: this.config.get('CALL_ANALYSIS_ENABLED'),
      workerConfigured: Boolean(this.config.get('CALL_ANALYSIS_WORKER_TOKEN_SHA256')),
      counts: {
        queued: count('queued'),
        processing: count('processing'),
        done: count('done'),
        failed: count('failed'),
        skipped: count('skipped'),
      },
      oldestQueuedCallAt: times?.oldestQueued?.toISOString() ?? null,
      lastDoneAt: times?.lastDone?.toISOString() ?? null,
      doneLastHour: Number(times?.doneLastHour ?? 0),
      avgProcessingSec: times?.avgProcessingSec ?? null,
      workers: workers.map((w) => ({
        workerId: w.workerId,
        lastSeenAt: w.lastSeenAt.toISOString(),
        processing: Number(w.processing ?? 0),
      })),
      recentFailures: failures.map((f) => ({
        callId: f.callId,
        attempts: f.attempts,
        lastError: f.lastError,
        updatedAt: f.updatedAt.toISOString(),
      })),
    };
  }
}
