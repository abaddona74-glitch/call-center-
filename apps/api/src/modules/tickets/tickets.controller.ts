import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  type AddTicketCommentFieldsParsed,
  AddTicketCommentFieldsSchema,
  type CallbackOutcomeRequest,
  CallbackOutcomeRequestSchema,
  type CreateTicketFieldsParsed,
  CreateTicketFieldsSchema,
  type ForceCloseTicketRequest,
  ForceCloseTicketRequestSchema,
  type ForwardTicketRequest,
  ForwardTicketRequestSchema,
  type RejectTicketRequest,
  RejectTicketRequestSchema,
  type ResolveTicketRequest,
  ResolveTicketRequestSchema,
  type SessionUser,
  TICKET_MAX_FILES_PER_UPLOAD,
  TicketAttachmentIdSchema,
  type TicketCallPrefill,
  TicketCallPrefillQuerySchema,
  TicketCallPrefillSchema,
  TicketCallRowIdSchema,
  type TicketContext,
  TicketContextSchema,
  type TicketDetail,
  TicketDetailSchema,
  type TicketDocPreview,
  TicketDocPreviewSchema,
  TicketIdSchema,
  type TicketListQueryParsed,
  TicketListQuerySchema,
  type TicketListResponse,
  TicketListResponseSchema,
  type TicketReport,
  type TicketReportQuery,
  TicketReportQuerySchema,
  TicketReportSchema,
  type TicketUnread,
  TicketUnreadSchema,
} from '@cc/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { contentDisposition } from '../../common/http/content-disposition.js';
import { TicketCallbacksService } from './ticket-callbacks.service.js';
import { TicketRecordingsService } from './ticket-recordings.service.js';
import { TicketReportsService } from './ticket-reports.service.js';
import { type IncomingFile, TicketsService } from './tickets.service.js';

const DownloadQuerySchema = z.object({ download: z.enum(['0', '1']).optional() });

/**
 * Tickets for every role; what each user may see/do is decided in the services from the session user
 * (domain/ticket-workflow.ts). Uploads are multipart/form-data (`files`), limits from MulterModule config.
 */
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly callbacks: TicketCallbacksService,
    private readonly recordings: TicketRecordingsService,
    private readonly reports: TicketReportsService,
  ) {}

  @Get('context')
  @SerializeOptions({ schema: TicketContextSchema })
  context(@CurrentUser() user: SessionUser): Promise<TicketContext> {
    return this.tickets.context(user);
  }

  @Get('unread')
  @SerializeOptions({ schema: TicketUnreadSchema })
  async unread(@CurrentUser() user: SessionUser): Promise<TicketUnread> {
    return { count: await this.tickets.unread(user) };
  }

  @Get('call-prefill')
  @SerializeOptions({ schema: TicketCallPrefillSchema })
  callPrefill(@Query({ schema: TicketCallPrefillQuerySchema }) q: { callId: string }, @CurrentUser() user: SessionUser): Promise<TicketCallPrefill> {
    return this.tickets.callPrefill(user, q.callId);
  }

  @Get('reports')
  @SerializeOptions({ schema: TicketReportSchema })
  report(@Query({ schema: TicketReportQuerySchema }) q: TicketReportQuery, @CurrentUser() user: SessionUser): Promise<TicketReport> {
    return this.reports.report(user, q);
  }

  @Get()
  @SerializeOptions({ schema: TicketListResponseSchema })
  list(@Query({ schema: TicketListQuerySchema }) query: TicketListQueryParsed, @CurrentUser() user: SessionUser): Promise<TicketListResponse> {
    return this.tickets.list(user, query);
  }

  @Get(':id')
  @SerializeOptions({ schema: TicketDetailSchema })
  get(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.tickets.get(user, id);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('files', TICKET_MAX_FILES_PER_UPLOAD))
  @SerializeOptions({ schema: TicketDetailSchema })
  create(
    @Body({ schema: CreateTicketFieldsSchema }) fields: CreateTicketFieldsParsed,
    @UploadedFiles() files: IncomingFile[] | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.create(user, fields, files ?? []);
  }

  // --- regional workflow ---------------------------------------------------------------------------

  @Post(':id/assign')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  assign(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.tickets.act(user, id, 'assign');
  }

  @Post(':id/start')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  start(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.tickets.act(user, id, 'start');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  resolve(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: ResolveTicketRequestSchema }) body: ResolveTicketRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.act(user, id, 'resolve', { note: body.note });
  }

  @Post(':id/reject')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  reject(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: RejectTicketRequestSchema }) body: RejectTicketRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.act(user, id, 'reject', { note: body.note });
  }

  @Post(':id/forward')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  forward(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: ForwardTicketRequestSchema }) body: ForwardTicketRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.act(user, id, 'forward', { regionId: body.regionId, note: body.note });
  }

  // --- callback step ---------------------------------------------------------------------------------

  @Post(':id/callback/call')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: TicketDetailSchema })
  call(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.callbacks.call(user, id);
  }

  @Post(':id/callback/outcome')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  outcome(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: CallbackOutcomeRequestSchema }) body: CallbackOutcomeRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.callbacks.recordOutcome(user, id, body.outcome, body.note);
  }

  @Post(':id/close')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  forceClose(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: ForceCloseTicketRequestSchema }) body: ForceCloseTicketRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.callbacks.forceClose(user, id, body.note);
  }

  // --- chat, files, recordings -----------------------------------------------------------------------

  @Post(':id/comments')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('files', TICKET_MAX_FILES_PER_UPLOAD))
  @SerializeOptions({ schema: TicketDetailSchema })
  comment(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: AddTicketCommentFieldsSchema }) fields: AddTicketCommentFieldsParsed,
    @UploadedFiles() files: IncomingFile[] | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.comment(user, id, fields, files ?? []);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<void> {
    await this.tickets.remove(user, id);
  }

  /** Always a download (Content-Disposition: attachment, nosniff, sandbox CSP) — never rendered same-origin. */
  @Get(':id/attachments/:attachmentId')
  async attachment(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Param('attachmentId', { schema: TicketAttachmentIdSchema }) attachmentId: number,
    @CurrentUser() user: SessionUser,
    @Res() res: Response,
  ): Promise<void> {
    const { row, path } = await this.tickets.attachment(user, id, attachmentId);
    res.status(200);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition('attachment', row.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    await pipeline(createReadStream(path), res).catch(() => undefined);
  }

  @Get(':id/attachments/:attachmentId/preview')
  @SerializeOptions({ schema: TicketDocPreviewSchema })
  preview(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Param('attachmentId', { schema: TicketAttachmentIdSchema }) attachmentId: number,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDocPreview> {
    return this.tickets.docPreview(user, id, attachmentId);
  }

  /** Recording of the ticket's call or a callback call (HTTP Range), only for users who see the ticket. */
  @Get(':id/calls/:callRowId/recording')
  async recording(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Param('callRowId', { schema: TicketCallRowIdSchema }) callRowId: number,
    @Query({ schema: DownloadQuerySchema }) q: { download?: '0' | '1' },
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.recordings.stream(user, id, callRowId, req.headers.range, q.download === '1');
    res.status(prepared.status);
    for (const [k, v] of Object.entries(prepared.headers)) res.setHeader(k, v);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(prepared.stream, res).catch(() => undefined);
  }
}
