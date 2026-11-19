import {
  type CallAnalysisBackfillRequest,
  type CallAnalysisJobStatus,
  type LocalizedText,
  type SkipReason,
  type TicketStatus,
  type WorkerResult,
  topicKey,
} from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import '../tickets/tickets.tables.js';
import './call-analysis.tables.js';
import type { CallAnalysisJobRow, CallAnalysisRow, CallTranscriptRow } from './call-analysis.tables.js';
import type { AnalysisFacts } from './domain/aggregate.js';
import type { NewJob } from './domain/job-policy.js';

export interface QueueCounts {
  status: CallAnalysisJobStatus;
  count: number;
}

/** Postgres access of the call analysis module (parameterized Kysely / sql`` only). */
@Injectable()
export class CallAnalysisRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- topics ---

  /**
   * The most frequent topics written with this prompt version (last 90 days), each in its latest wording: hints for the
   * model so it reuses wording instead of inventing a variant. Not a list it must pick from.
   */
  async topicHints(promptVersion: string, limit: number): Promise<LocalizedText[]> {
    const { rows } = await sql<{ topic: LocalizedText }>`
      select (array_agg(topic order by updated_at desc))[1] as topic
        from call_analyses
       where prompt_version = ${promptVersion} and updated_at > now() - interval '90 days'
       group by topic_key
       order by count(*) desc, max(updated_at) desc
       limit ${limit}`.execute(this.db);
    return rows.map((r) => r.topic);
  }

  // --- queue ---

  /** Inserts the jobs that do not exist yet; returns the inserted call ids. */
  async enqueue(jobs: readonly NewJob[], source: 'auto' | 'manual'): Promise<string[]> {
    if (jobs.length === 0) return [];
    const inserted: string[] = [];
    for (let i = 0; i < jobs.length; i += 500) {
      const rows = await this.db
        .insertInto('callAnalysisJobs')
        .values(
          jobs.slice(i, i + 500).map((j) => ({
            callId: j.callId,
            callStartedAt: new Date(j.callStartedAt),
            callDate: j.callDate,
            direction: j.direction,
            operatorExt: j.operatorExt,
            talkSec: j.talkSec,
            recordingFile: j.recordingFile,
            source,
          })),
        )
        .onConflict((oc) => oc.column('callId').doNothing())
        .returning('callId')
        .execute();
      for (const r of rows) inserted.push(r.callId);
    }
    return inserted;
  }

  /** Leases whose time ran out after the last allowed attempt: failed. */
  async failExhausted(maxAttempts: number): Promise<number> {
    const res = await this.db
      .updateTable('callAnalysisJobs')
      .set({
        status: 'failed',
        lastError: sql<string>`coalesce(last_error, 'lease expired')`,
        leaseOwner: null,
        leaseUntil: null,
        finishedAt: sql<Date>`now()`,
        updatedAt: sql<Date>`now()`,
      })
      .where('status', '=', 'processing')
      .where('leaseUntil', '<', sql<Date>`now()`)
      .where('attempts', '>=', maxAttempts)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  /**
   * Newest open jobs first: queued ones whose retry delay passed, and processing ones whose lease expired
   * (the worker died). Concurrent workers never get the same job (FOR UPDATE SKIP LOCKED).
   */
  async lease(workerId: string, limit: number, leaseSec: number, maxAttempts: number): Promise<CallAnalysisJobRow[]> {
    const { rows } = await sql<CallAnalysisJobRow>`
      with picked as (
        select call_id from call_analysis_jobs
        where (status = 'queued' and (not_before is null or not_before <= now()))
           or (status = 'processing' and lease_until < now() and attempts < ${maxAttempts})
        order by call_started_at desc
        limit ${limit}
        for update skip locked
      )
      update call_analysis_jobs j
         set status = 'processing', lease_owner = ${workerId}, leased_at = now(),
             lease_until = now() + make_interval(secs => ${leaseSec}), attempts = j.attempts + 1,
             not_before = null, updated_at = now()
        from picked
       where j.call_id = picked.call_id
      returning j.*`.execute(this.db);
    return [...rows].sort((a, b) => b.callStartedAt.getTime() - a.callStartedAt.getTime());
  }

  async touchWorker(workerId: string): Promise<void> {
    await this.db
      .insertInto('callAnalysisWorkers')
      .values({ workerId })
      .onConflict((oc) => oc.column('workerId').doUpdateSet({ lastSeenAt: sql<Date>`now()` }))
      .execute();
  }

  /** The job, locked, when this worker holds its lease. */
  leasedJob(callId: string, workerId: string): Promise<CallAnalysisJobRow | undefined> {
    return this.db
      .selectFrom('callAnalysisJobs')
      .selectAll()
      .where('callId', '=', callId)
      .where('status', '=', 'processing')
      .where('leaseOwner', '=', workerId)
      .forUpdate()
      .executeTakeFirst();
  }

  job(callId: string): Promise<CallAnalysisJobRow | undefined> {
    return this.db.selectFrom('callAnalysisJobs').selectAll().where('callId', '=', callId).executeTakeFirst();
  }

  async finishJob(
    callId: string,
    patch: {
      status: 'done' | 'failed' | 'skipped' | 'queued';
      lastError?: string | null;
      skipReason?: SkipReason;
      delaySec?: number;
    },
  ): Promise<void> {
    const terminal = patch.status !== 'queued';
    await this.db
      .updateTable('callAnalysisJobs')
      .set({
        status: patch.status,
        leaseOwner: null,
        leaseUntil: null,
        lastError: patch.lastError === undefined ? null : patch.lastError,
        skipReason: patch.skipReason ?? null,
        notBefore: patch.delaySec ? sql<Date>`now() + make_interval(secs => ${patch.delaySec})` : null,
        finishedAt: terminal ? sql<Date>`now()` : null,
        updatedAt: sql<Date>`now()`,
      })
      .where('callId', '=', callId)
      .execute();
  }

  async saveResult(callId: string, r: WorkerResult): Promise<void> {
    const t = r.transcript;
    const transcript = {
      language: t.language,
      segments: JSON.stringify(t.segments),
      audioSec: t.audioSec,
      sttStrategy: r.meta.sttStrategy,
      sttModel: r.meta.sttModel,
      sttMs: r.meta.sttMs,
      sttRerun: r.meta.sttRerun,
    };
    await this.db
      .insertInto('callTranscripts')
      .values({ callId, ...transcript })
      .onConflict((oc) => oc.column('callId').doUpdateSet({ ...transcript, updatedAt: sql<Date>`now()` }))
      .execute();

    const a = r.analysis;
    const analysis = {
      promptVersion: r.meta.promptVersion,
      llmModel: r.meta.llmModel,
      thinking: r.meta.thinking,
      llmMs: r.meta.llmMs,
      llmAttempts: r.meta.llmAttempts,
      topic: JSON.stringify(a.topic),
      topicKey: topicKey(a.topic),
      greetingPhrase: a.greetingPhrase,
      subtopic: JSON.stringify(a.subtopic),
      problem: JSON.stringify(a.problem),
      summary: JSON.stringify(a.summary),
      recommendation: JSON.stringify(a.recommendation),
      outcome: a.outcome,
      scoreGreeting: a.scores.greeting,
      scorePoliteness: a.scores.politeness,
      scoreUnderstanding: a.scores.understanding,
      scoreSolution: a.scores.solution,
      scoreClosing: a.scores.closing,
      overall: a.overall,
      redFlags: JSON.stringify(a.redFlags),
      redFlagCodes: [...new Set(a.redFlags.map((f) => f.code))],
      sentimentStart: a.sentimentStart,
      sentimentEnd: a.sentimentEnd,
      language: a.language,
    };
    await this.db
      .insertInto('callAnalyses')
      .values({ callId, ...analysis })
      .onConflict((oc) => oc.column('callId').doUpdateSet({ ...analysis, updatedAt: sql<Date>`now()` }))
      .execute();
  }

  /**
   * Analysed calls (done, with a transcript) of a period or exact ids go back to the queue as `llm_only`: the worker
   * re-runs only the LLM with the current prompt version.
   */
  async requeueForReanalysis(req: CallAnalysisBackfillRequest): Promise<number> {
    let q = this.db
      .updateTable('callAnalysisJobs')
      .set({
        status: 'queued',
        mode: 'llm_only',
        attempts: 0,
        notBefore: null,
        lastError: null,
        finishedAt: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('status', '=', 'done')
      .where((eb) =>
        eb.exists(
          eb.selectFrom('callTranscripts as t').select('t.callId').whereRef('t.callId', '=', 'callAnalysisJobs.callId'),
        ),
      );
    q =
      'callIds' in req
        ? q.where('callId', 'in', req.callIds)
        : q.where('callDate', '>=', sql<Date>`${req.from}::date`).where('callDate', '<=', sql<Date>`${req.to}::date`);
    const res = await q.executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  async retryFailed(): Promise<number> {
    const res = await this.db
      .updateTable('callAnalysisJobs')
      .set({
        status: 'queued',
        attempts: 0,
        notBefore: null,
        lastError: null,
        finishedAt: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('status', '=', 'failed')
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  // --- reads ---

  transcript(callId: string): Promise<CallTranscriptRow | undefined> {
    return this.db.selectFrom('callTranscripts').selectAll().where('callId', '=', callId).executeTakeFirst();
  }

  analysis(callId: string): Promise<CallAnalysisRow | undefined> {
    return this.db.selectFrom('callAnalyses').selectAll().where('callId', '=', callId).executeTakeFirst();
  }

  /**
   * Tickets really opened from / for these calls — the ground truth next to the model's outcome. Read-only lookup of
   * the tickets module's tables (origin call of the ticket, or a call recorded on the ticket).
   */
  async ticketsForCalls(callIds: readonly string[]): Promise<Map<string, Array<{ id: number; status: TicketStatus }>>> {
    const out = new Map<string, Array<{ id: number; status: TicketStatus }>>();
    if (callIds.length === 0) return out;
    const rows = await this.db
      .selectFrom('tickets')
      .select(['tickets.id', 'tickets.status', 'tickets.originCallId as callId'])
      .where('tickets.originCallId', 'in', callIds)
      .unionAll(
        this.db
          .selectFrom('ticketCalls')
          .innerJoin('tickets', 'tickets.id', 'ticketCalls.ticketId')
          .select(['tickets.id', 'tickets.status', 'ticketCalls.callId as callId'])
          .where('ticketCalls.callId', 'in', callIds),
      )
      .execute();
    for (const r of rows) {
      if (!r.callId) continue;
      const list = out.get(r.callId) ?? [];
      if (!list.some((t) => t.id === r.id)) list.push({ id: r.id, status: r.status });
      out.set(r.callId, list);
    }
    return out;
  }

  async statusOf(callIds: readonly string[]) {
    if (callIds.length === 0) return [];
    return this.db
      .selectFrom('callAnalysisJobs as j')
      .leftJoin('callAnalyses as a', 'a.callId', 'j.callId')
      .select(['j.callId', 'j.status', 'a.overall', 'a.topic', 'a.redFlagCodes'])
      .where('j.callId', 'in', callIds)
      .execute();
  }

  /** Prompt versions of the analysed calls of a period (and operator), most calls first. */
  async versionsInRange(
    from: string,
    to: string,
    operator?: string,
  ): Promise<Array<{ version: string; count: number }>> {
    let q = this.db
      .selectFrom('callAnalyses as a')
      .innerJoin('callAnalysisJobs as j', 'j.callId', 'a.callId')
      .select(['a.promptVersion as version', (eb) => eb.fn.countAll<number>().as('count')])
      .where('j.callDate', '>=', sql<Date>`${from}::date`)
      .where('j.callDate', '<=', sql<Date>`${to}::date`)
      .groupBy('a.promptVersion')
      .orderBy('count', 'desc');
    if (operator) q = q.where('j.operatorExt', '=', operator);
    return (await q.execute()).map((r) => ({ version: r.version, count: Number(r.count) }));
  }

  /** Analysed calls of a period (Asia/Tashkent dates) made with one prompt version, optionally of one operator. */
  async analysesInRange(
    from: string,
    to: string,
    promptVersion: string,
    operator?: string,
  ): Promise<Omit<AnalysisFacts, 'hasTicket'>[]> {
    let q = this.db
      .selectFrom('callAnalyses as a')
      .innerJoin('callAnalysisJobs as j', 'j.callId', 'a.callId')
      .select([
        'a.callId',
        'j.callStartedAt',
        'j.operatorExt',
        'a.topic',
        'a.topicKey',
        'a.subtopic',
        'a.problem',
        'a.summary',
        'a.outcome',
        'a.scoreGreeting',
        'a.scorePoliteness',
        'a.scoreUnderstanding',
        'a.scoreSolution',
        'a.scoreClosing',
        'a.overall',
        'a.redFlagCodes',
        'a.sentimentStart',
        'a.sentimentEnd',
      ])
      .where('j.callDate', '>=', sql<Date>`${from}::date`)
      .where('j.callDate', '<=', sql<Date>`${to}::date`)
      .where('a.promptVersion', '=', promptVersion);
    if (operator) q = q.where('j.operatorExt', '=', operator);
    const rows = await q.execute();
    return rows.map((r) => ({
      callId: r.callId,
      startedAt: r.callStartedAt.toISOString(),
      operatorExt: r.operatorExt,
      topic: r.topic,
      topicKey: r.topicKey,
      subtopic: r.subtopic,
      problem: r.problem,
      summary: r.summary,
      outcome: r.outcome,
      scores: {
        greeting: r.scoreGreeting,
        politeness: r.scorePoliteness,
        understanding: r.scoreUnderstanding,
        solution: r.scoreSolution,
        closing: r.scoreClosing,
      },
      overall: r.overall,
      redFlagCodes: r.redFlagCodes,
      sentimentStart: r.sentimentStart,
      sentimentEnd: r.sentimentEnd,
    }));
  }

  /** Of these calls, the ones with a real ticket. */
  async callsWithTickets(callIds: readonly string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < callIds.length; i += 1000) {
      const chunk = callIds.slice(i, i + 1000);
      const found = await this.ticketsForCalls(chunk);
      for (const id of found.keys()) out.add(id);
    }
    return out;
  }

  // --- queue progress ---

  async queueCounts(): Promise<QueueCounts[]> {
    const rows = await this.db
      .selectFrom('callAnalysisJobs')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .execute();
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async queueTimes() {
    const { rows } = await sql<{
      oldestQueued: Date | null;
      lastDone: Date | null;
      doneLastHour: number;
      avgProcessingSec: number | null;
    }>`
      select
        (select min(call_started_at) from call_analysis_jobs where status = 'queued') as oldest_queued,
        (select max(finished_at) from call_analysis_jobs where status = 'done') as last_done,
        (select count(*) from call_analysis_jobs where status = 'done' and finished_at > now() - interval '1 hour')
          as done_last_hour,
        (select round(avg(extract(epoch from finished_at - leased_at))::numeric, 1) from call_analysis_jobs
          where status = 'done' and finished_at > now() - interval '24 hours') as avg_processing_sec`.execute(this.db);
    return rows[0];
  }

  async workers() {
    return this.db
      .selectFrom('callAnalysisWorkers as w')
      .select([
        'w.workerId',
        'w.lastSeenAt',
        (eb) =>
          eb
            .selectFrom('callAnalysisJobs as j')
            .select((e) => e.fn.countAll<number>().as('n'))
            .whereRef('j.leaseOwner', '=', 'w.workerId')
            .where('j.status', '=', 'processing')
            .as('processing'),
      ])
      .where('w.lastSeenAt', '>', sql<Date>`now() - interval '7 days'`)
      .orderBy('w.lastSeenAt', 'desc')
      .execute();
  }

  recentFailures(limit: number) {
    return this.db
      .selectFrom('callAnalysisJobs')
      .select(['callId', 'attempts', 'lastError', 'updatedAt'])
      .where((eb) =>
        eb.or([eb('status', '=', 'failed'), eb.and([eb('status', '=', 'queued'), eb('lastError', 'is not', null)])]),
      )
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .execute();
  }
}
