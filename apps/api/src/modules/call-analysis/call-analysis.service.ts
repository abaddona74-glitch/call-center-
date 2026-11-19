import type {
  CallAnalysisDetails,
  CallAnalysisStats,
  CallAnalysisStatsQuery,
  CallAnalysisStatusResponse,
  CallTopicList,
} from '@cc/shared';
import { CALL_ANALYSIS_MAX_DAYS } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { CallAnalysisRepository } from './call-analysis.repository.js';
import { aggregateAnalyses } from './domain/aggregate.js';

/** Reads: one call's transcript and analysis, statuses for a history page, the aggregates of the "Tahlil" page. */
@Injectable()
export class CallAnalysisService {
  private readonly logger = new Logger(CallAnalysisService.name);

  constructor(
    private readonly repo: CallAnalysisRepository,
    private readonly calls: PbxCallsService,
  ) {}

  async topics(): Promise<CallTopicList> {
    return { items: await this.repo.topics(false) };
  }

  async details(callId: string): Promise<CallAnalysisDetails> {
    const [job, transcript, analysis, tickets, topics] = await Promise.all([
      this.repo.job(callId),
      this.repo.transcript(callId),
      this.repo.analysis(callId),
      this.repo.ticketsForCalls([callId]),
      this.repo.topics(false),
    ]);
    const topic = analysis ? topics.find((t) => t.code === analysis.topicCode) : undefined;
    return {
      callId,
      job: job
        ? {
            status: job.status,
            attempts: job.attempts,
            lastError: job.status === 'skipped' ? job.skipReason : job.lastError,
            updatedAt: job.updatedAt.toISOString(),
          }
        : null,
      transcript: transcript
        ? {
            language: transcript.language,
            segments: transcript.segments,
            audioSec: transcript.audioSec,
            sttStrategy: transcript.sttStrategy,
            createdAt: transcript.createdAt.toISOString(),
          }
        : null,
      analysis: analysis
        ? {
            topicCode: analysis.topicCode,
            topicName: { uz: topic?.nameUz ?? analysis.topicCode, ru: topic?.nameRu ?? analysis.topicCode },
            subtopic: analysis.subtopic,
            problem: analysis.problem,
            summary: analysis.summary,
            recommendation: analysis.recommendation,
            outcome: analysis.outcome,
            scores: {
              greeting: analysis.scoreGreeting,
              politeness: analysis.scorePoliteness,
              understanding: analysis.scoreUnderstanding,
              solution: analysis.scoreSolution,
              closing: analysis.scoreClosing,
            },
            overall: analysis.overall,
            redFlags: analysis.redFlags,
            sentimentStart: analysis.sentimentStart,
            sentimentEnd: analysis.sentimentEnd,
            language: analysis.language,
            promptVersion: analysis.promptVersion,
            llmModel: analysis.llmModel,
            createdAt: analysis.createdAt.toISOString(),
          }
        : null,
      tickets: tickets.get(callId) ?? [],
    };
  }

  async status(ids: readonly string[]): Promise<CallAnalysisStatusResponse> {
    const rows = await this.repo.statusOf(ids);
    return {
      items: rows.map((r) => ({
        callId: r.callId,
        status: r.status,
        overall: r.overall ?? null,
        topicCode: r.topicCode ?? null,
        redFlags: r.redFlagCodes?.length ?? 0,
      })),
    };
  }

  async stats(q: CallAnalysisStatsQuery): Promise<CallAnalysisStats> {
    this.calls.assertRange(q.from, q.to, CALL_ANALYSIS_MAX_DAYS);
    const [rows, topics, names] = await Promise.all([
      this.repo.analysesInRange(q.from, q.to, q.operator),
      this.repo.topics(false),
      this.operatorNames(),
    ]);
    const withTicket = await this.repo.callsWithTickets(rows.map((r) => r.callId));
    return {
      range: { from: q.from, to: q.to },
      ...aggregateAnalyses(
        rows.map((r) => ({ ...r, hasTicket: withTicket.has(r.callId) })),
        { topics, names, topicFilter: q.topic },
      ),
    };
  }

  /** Names from asterisk.users; the aggregates still work (extensions only) while the PBX is unreachable. */
  private async operatorNames(): Promise<Map<string, string>> {
    if (!this.calls.enabled) return new Map();
    try {
      return await this.calls.operatorNames();
    } catch (err) {
      this.logger.warn(`operator names unavailable: ${(err as Error).message}`);
      return new Map();
    }
  }
}
