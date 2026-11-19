import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  type CallAnalysisDetails,
  CallAnalysisDetailsSchema,
  type CallDetailsResponse,
  CallDetailsResponseSchema,
  type CallHistoryResponse,
  CallHistoryResponseSchema,
  type CallRecording,
  CallRecordingSchema,
  CdrCallIdSchema,
  type OverviewCallListQuery,
  OverviewCallListQuerySchema,
  type OverviewCalls,
  type OverviewCallsQuery,
  OverviewCallsQuerySchema,
  OverviewCallsSchema,
  type OverviewQuality,
  type OverviewQualityListQuery,
  OverviewQualityListQuerySchema,
  type OverviewQualityQuery,
  OverviewQualityQuerySchema,
  OverviewQualitySchema,
  type OverviewTicketList,
  type OverviewTicketListQuery,
  OverviewTicketListQuerySchema,
  OverviewTicketListSchema,
  type OverviewTickets,
  type OverviewTicketsQuery,
  OverviewTicketsQuerySchema,
  OverviewTicketsSchema,
  type RecordingDownloadQuery,
  RecordingDownloadQuerySchema,
  type SessionUser,
  TicketAttachmentIdSchema,
  TicketCallRowIdSchema,
  type TicketDetail,
  TicketDetailSchema,
  type TicketDocPreview,
  TicketDocPreviewSchema,
  TicketIdSchema,
} from '@cc/shared';
import { Controller, Get, HttpException, HttpStatus, Param, Query, Req, Res, SerializeOptions } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { contentDisposition } from '../../common/http/content-disposition.js';
import { type PreparedStream, RecordingsService } from '../recordings/recordings.service.js';
import { OverviewService } from './overview.service.js';

/**
 * The overview dashboard (owner, 19.11.2026): observers see only this; the superuser sees it too. Every endpoint needs
 * `overview.view`. Aggregates (docs/rewrite/METRICS.md §9), the records behind each number, and read-only cards of a
 * ticket and of a call (its analysis and recording) — without giving observers the history, tickets or recordings
 * pages' permissions. Playing or downloading a recording is audited like everywhere else.
 */
@Controller('overview')
@RequirePermission('overview.view')
export class OverviewController {
  constructor(
    private readonly overview: OverviewService,
    private readonly recordings: RecordingsService,
  ) {}

  // --- tickets -------------------------------------------------------------------------------

  @Get('tickets')
  @SerializeOptions({ schema: OverviewTicketsSchema })
  tickets(@Query({ schema: OverviewTicketsQuerySchema }) q: OverviewTicketsQuery): Promise<OverviewTickets> {
    return this.overview.tickets(q);
  }

  /** The tickets behind one number (declared before `tickets/:id`). */
  @Get('tickets/list')
  @SerializeOptions({ schema: OverviewTicketListSchema })
  ticketList(
    @Query({ schema: OverviewTicketListQuerySchema }) q: OverviewTicketListQuery,
  ): Promise<OverviewTicketList> {
    return this.overview.ticketList(q);
  }

  @Get('tickets/:id')
  @SerializeOptions({ schema: TicketDetailSchema })
  ticket(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.overview.ticketDetail(user, id);
  }

  @Get('tickets/:id/attachments/:attachmentId')
  async ticketAttachment(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Param('attachmentId', { schema: TicketAttachmentIdSchema }) attachmentId: number,
    @CurrentUser() user: SessionUser,
    @Res() res: Response,
  ): Promise<void> {
    const { row, path } = await this.overview.ticketAttachment(user, id, attachmentId);
    res.status(200);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition('attachment', row.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    await pipeline(createReadStream(path), res).catch(() => undefined);
  }

  @Get('tickets/:id/attachments/:attachmentId/preview')
  @SerializeOptions({ schema: TicketDocPreviewSchema })
  ticketAttachmentPreview(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Param('attachmentId', { schema: TicketAttachmentIdSchema }) attachmentId: number,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDocPreview> {
    return this.overview.ticketDocPreview(user, id, attachmentId);
  }

  @Get('tickets/:id/calls/:callRowId/recording')
  async ticketRecording(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Param('callRowId', { schema: TicketCallRowIdSchema }) callRowId: number,
    @Query({ schema: RecordingDownloadQuerySchema }) q: RecordingDownloadQuery,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.overview.ticketRecording(user, id, callRowId, req.headers.range, q.download);
    res.status(prepared.status);
    for (const [k, v] of Object.entries(prepared.headers)) res.setHeader(k, v);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(prepared.stream, res).catch(() => undefined);
  }

  // --- calls ---------------------------------------------------------------------------------

  @Get('calls')
  @SerializeOptions({ schema: OverviewCallsSchema })
  calls(@Query({ schema: OverviewCallsQuerySchema }) q: OverviewCallsQuery): Promise<OverviewCalls> {
    return this.overview.calls(q);
  }

  /** The calls behind one call number (declared before `calls/:id`). */
  @Get('calls/list')
  @SerializeOptions({ schema: CallHistoryResponseSchema })
  callList(@Query({ schema: OverviewCallListQuerySchema }) q: OverviewCallListQuery): Promise<CallHistoryResponse> {
    return this.overview.callList(q);
  }

  @Get('calls/:id')
  @SerializeOptions({ schema: CallDetailsResponseSchema })
  call(
    @Param('id', { schema: CdrCallIdSchema }) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<CallDetailsResponse> {
    return this.overview.callDetails(id, user);
  }

  @Get('calls/:id/analysis')
  @SerializeOptions({ schema: CallAnalysisDetailsSchema })
  callAnalysis(@Param('id', { schema: CdrCallIdSchema }) id: string): Promise<CallAnalysisDetails> {
    return this.overview.callAnalysis(id);
  }

  @Get('calls/:id/recording')
  @SerializeOptions({ schema: CallRecordingSchema })
  callRecording(@Param('id', { schema: CdrCallIdSchema }) id: string): Promise<CallRecording> {
    return this.overview.callRecording(id);
  }

  /** The call's audio (HTTP Range); every play / download is audited (`recordings.play` / `.download`, call id). */
  @Get('calls/:id/recording/stream')
  async callRecordingStream(
    @Param('id', { schema: CdrCallIdSchema }) id: string,
    @Query({ schema: RecordingDownloadQuerySchema }) q: RecordingDownloadQuery,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { file } = await this.overview.callRecording(id);
    let prepared: PreparedStream;
    try {
      prepared = await this.recordings.prepareStream(file, req.headers.range, q.download);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE) {
        res.setHeader('Content-Range', `bytes */${file.size}`);
      }
      throw err;
    }
    await this.recordings.auditAccess(user, file, q.download, id);
    res.status(prepared.status);
    for (const [name, value] of Object.entries(prepared.headers)) res.setHeader(name, value);
    await pipeline(prepared.stream, res).catch(() => undefined);
  }

  // --- call quality --------------------------------------------------------------------------

  /** AI call quality of the period (current prompt version, aggregates only). Calls have no region: no region filter. */
  @Get('quality')
  @SerializeOptions({ schema: OverviewQualitySchema })
  quality(@Query({ schema: OverviewQualityQuerySchema }) q: OverviewQualityQuery): Promise<OverviewQuality> {
    return this.overview.quality(q);
  }

  /** The analysed calls behind one quality number. */
  @Get('quality/list')
  @SerializeOptions({ schema: CallHistoryResponseSchema })
  qualityList(
    @Query({ schema: OverviewQualityListQuerySchema }) q: OverviewQualityListQuery,
  ): Promise<CallHistoryResponse> {
    return this.overview.qualityList(q);
  }
}
