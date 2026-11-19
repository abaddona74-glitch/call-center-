import { pipeline } from 'node:stream/promises';
import {
  CdrCallIdSchema,
  type WorkerAck,
  WorkerAckSchema,
  type WorkerFailRequest,
  WorkerFailRequestSchema,
  WorkerIdSchema,
  type WorkerLeaseRequest,
  WorkerLeaseRequestSchema,
  type WorkerLeaseResponse,
  WorkerLeaseResponseSchema,
  WorkerResultSchema,
  type WorkerSkipRequest,
  WorkerSkipRequestSchema,
} from '@cc/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { CallAnalysisQueueService } from './call-analysis-queue.service.js';
import { WorkerTokenGuard } from './worker-token.guard.js';

/** Results of long calls exceed the global 100 KB JSON limit: the worker posts them as this type, read here. */
export const WORKER_RESULT_CONTENT_TYPE = 'application/vnd.cc.analysis-result+json';
const RESULT_MAX_BYTES = 4 * 1024 * 1024;

const WorkerQuerySchema = z.object({ workerId: WorkerIdSchema });

async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body as object).length > 0) return req.body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new PayloadTooLargeException('Result is too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequestException('Body is not valid JSON');
  }
}

/**
 * The analysis worker's API (pull model, docs/rewrite/CALL-ANALYSIS.md): lease jobs, download the recording of a
 * leased job, post the result or the failure. Service token instead of a session; nothing here is reachable for users.
 */
@Controller('call-analysis/worker')
@Public()
@UseGuards(WorkerTokenGuard)
export class CallAnalysisWorkerController {
  constructor(
    private readonly queue: CallAnalysisQueueService,
    private readonly recordings: RecordingsService,
    private readonly audit: AuditService,
  ) {}

  @Post('lease')
  @HttpCode(200)
  @SerializeOptions({ schema: WorkerLeaseResponseSchema })
  lease(@Body({ schema: WorkerLeaseRequestSchema }) body: WorkerLeaseRequest): Promise<WorkerLeaseResponse> {
    return this.queue.lease(body);
  }

  /** The WAV of a job this worker holds (whole file; recordings are a few MB). */
  @Get('jobs/:callId/recording')
  async recording(
    @Param('callId', { schema: CdrCallIdSchema }) callId: string,
    @Query({ schema: WorkerQuerySchema }) q: { workerId: string },
    @Res() res: Response,
  ): Promise<void> {
    await this.queue.assertLease(callId, q.workerId);
    const { file } = await this.recordings.forCallTrusted(callId);
    const prepared = await this.recordings.prepareStream(file, undefined, true);
    await this.audit.record('callAnalysis.recordingFetch', {
      target: `call:${callId}`,
      details: { path: file.path, size: file.size },
      actorLabel: `worker:${q.workerId}`,
    });
    res.status(prepared.status);
    for (const [name, value] of Object.entries(prepared.headers)) res.setHeader(name, value);
    await pipeline(prepared.stream, res).catch(() => undefined);
  }

  @Post('jobs/:callId/result')
  @HttpCode(200)
  @SerializeOptions({ schema: WorkerAckSchema })
  async result(@Param('callId', { schema: CdrCallIdSchema }) callId: string, @Req() req: Request): Promise<WorkerAck> {
    const parsed = WorkerResultSchema.safeParse(await readJson(req, RESULT_MAX_BYTES));
    if (!parsed.success) {
      throw new BadRequestException({
        message: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return this.queue.submit(callId, parsed.data);
  }

  @Post('jobs/:callId/fail')
  @HttpCode(200)
  @SerializeOptions({ schema: WorkerAckSchema })
  fail(
    @Param('callId', { schema: CdrCallIdSchema }) callId: string,
    @Body({ schema: WorkerFailRequestSchema }) body: WorkerFailRequest,
  ): Promise<WorkerAck> {
    return this.queue.fail(callId, body);
  }

  @Post('jobs/:callId/skip')
  @HttpCode(200)
  @SerializeOptions({ schema: WorkerAckSchema })
  skip(
    @Param('callId', { schema: CdrCallIdSchema }) callId: string,
    @Body({ schema: WorkerSkipRequestSchema }) body: WorkerSkipRequest,
  ): Promise<WorkerAck> {
    return this.queue.skip(callId, body);
  }
}
