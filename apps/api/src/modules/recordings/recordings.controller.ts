import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  type CallRecording,
  CallRecordingSchema,
  CallUniqueIdSchema,
  type CreateZipJobRequest,
  CreateZipJobRequestSchema,
  type RecordingDownloadQuery,
  RecordingDownloadQuerySchema,
  type RecordingFile,
  type RecordingStreamQuery,
  RecordingStreamQuerySchema,
  type RecordingTreeQuery,
  RecordingTreeQuerySchema,
  type RecordingTreeResponse,
  RecordingTreeResponseSchema,
  type RecordingsStatus,
  RecordingsStatusSchema,
  type SessionUser,
  type ZipJob,
  ZipJobIdSchema,
  type ZipJobListResponse,
  ZipJobListResponseSchema,
  ZipJobSchema,
} from '@cc/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { contentDisposition } from '../../common/http/content-disposition.js';
import { parseRangeHeader } from './domain/http-range.js';
import { type PreparedStream, RecordingsService } from './recordings.service.js';
import { ZipJobsService } from './zip-jobs.service.js';

/**
 * Call recordings. Browsing the monitor folder, streaming arbitrary files and ZIP export are
 * admin-only (legacy: staff only). `calls/:uniqueid*` is open to operators for their own calls.
 */
@Controller('recordings')
export class RecordingsController {
  constructor(
    private readonly recordings: RecordingsService,
    private readonly zipJobs: ZipJobsService,
  ) {}

  @Get('status')
  @RequirePermission('recordings.listen')
  @SerializeOptions({ schema: RecordingsStatusSchema })
  status(): RecordingsStatus {
    return this.recordings.status();
  }

  @Get('tree')
  @RequirePermission('recordings.listen')
  @SerializeOptions({ schema: RecordingTreeResponseSchema })
  tree(@Query({ schema: RecordingTreeQuerySchema }) query: RecordingTreeQuery): Promise<RecordingTreeResponse> {
    return this.recordings.tree(query.path);
  }

  @Get('stream')
  @RequirePermission('recordings.listen')
  async stream(
    @Query({ schema: RecordingStreamQuerySchema }) query: RecordingStreamQuery,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.recordings.file(query.path);
    await this.send(req, res, user, file, query.download);
  }

  @Get('calls/:uniqueid')
  @SerializeOptions({ schema: CallRecordingSchema })
  forCall(
    @Param('uniqueid', { schema: CallUniqueIdSchema }) uniqueid: string,
    @CurrentUser() user: SessionUser,
  ): Promise<CallRecording> {
    return this.recordings.forCall(uniqueid, user);
  }

  @Get('calls/:uniqueid/stream')
  async callStream(
    @Param('uniqueid', { schema: CallUniqueIdSchema }) uniqueid: string,
    @Query({ schema: RecordingDownloadQuerySchema }) query: RecordingDownloadQuery,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { file } = await this.recordings.forCall(uniqueid, user);
    await this.send(req, res, user, file, query.download, uniqueid);
  }

  @Post('zip-jobs')
  @RequirePermission('recordings.listen')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: ZipJobSchema })
  createZip(
    @Body({ schema: CreateZipJobRequestSchema }) body: CreateZipJobRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<ZipJob> {
    return this.zipJobs.create(body, user);
  }

  @Get('zip-jobs')
  @RequirePermission('recordings.listen')
  @SerializeOptions({ schema: ZipJobListResponseSchema })
  listZips(@CurrentUser() user: SessionUser): ZipJobListResponse {
    return { items: this.zipJobs.list(user) };
  }

  @Get('zip-jobs/:id')
  @RequirePermission('recordings.listen')
  @SerializeOptions({ schema: ZipJobSchema })
  getZip(@Param('id', { schema: ZipJobIdSchema }) id: string, @CurrentUser() user: SessionUser): ZipJob {
    return this.zipJobs.get(id, user);
  }

  @Post('zip-jobs/:id/cancel')
  @RequirePermission('recordings.listen')
  @HttpCode(200)
  @SerializeOptions({ schema: ZipJobSchema })
  cancelZip(@Param('id', { schema: ZipJobIdSchema }) id: string, @CurrentUser() user: SessionUser): Promise<ZipJob> {
    return this.zipJobs.cancel(id, user);
  }

  @Get('zip-jobs/:id/download')
  @RequirePermission('recordings.listen')
  async downloadZip(
    @Param('id', { schema: ZipJobIdSchema }) id: string,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { filePath, zipName, size } = await this.zipJobs.readyFile(id, user);
    const range = parseRangeHeader(req.headers.range, size);
    if (range.kind === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new HttpException('Requested range not satisfiable', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition('attachment', zipName));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    if (range.kind === 'partial') {
      const { start, end } = range.range;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      await pipeline(createReadStream(filePath, { start, end }), res).catch(() => undefined);
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(size));
      await pipeline(createReadStream(filePath), res).catch(() => undefined);
    }
  }

  private async send(
    req: Request,
    res: Response,
    user: SessionUser,
    file: RecordingFile,
    download: boolean,
    callId?: string,
  ): Promise<void> {
    let prepared: PreparedStream;
    try {
      prepared = await this.recordings.prepareStream(file, req.headers.range, download);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE) {
        res.setHeader('Content-Range', `bytes */${file.size}`);
      }
      throw err;
    }
    await this.recordings.auditAccess(user, file, download, callId);
    res.status(prepared.status);
    for (const [name, value] of Object.entries(prepared.headers)) res.setHeader(name, value);
    // Client aborts (seeking, closing the player) end up here; the SFTP stream is destroyed by pipeline.
    await pipeline(prepared.stream, res).catch(() => undefined);
  }
}
