import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  type AddTicketCommentFields,
  AddTicketCommentFieldsSchema,
  type CreateTicketFields,
  CreateTicketFieldsSchema,
  type RejectTicketRequest,
  RejectTicketRequestSchema,
  type SessionUser,
  TICKET_MAX_FILES_PER_UPLOAD,
  TicketAttachmentIdSchema,
  type TicketCleanupResponse,
  TicketCleanupResponseSchema,
  type TicketContext,
  TicketContextSchema,
  type TicketDetail,
  TicketDetailSchema,
  type TicketDocPreview,
  TicketDocPreviewSchema,
  TicketIdSchema,
  type TicketListQuery,
  TicketListQuerySchema,
  type TicketListResponse,
  TicketListResponseSchema,
  type UpdateTicketRequest,
  UpdateTicketRequestSchema,
} from '@cc/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  SerializeOptions,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { contentDisposition } from '../../common/http/content-disposition.js';
import { type IncomingFile, TicketsService } from './tickets.service.js';

/**
 * Tickets for every role (operators included); what each user may see/do is decided in the service
 * from the session user. Uploads are multipart/form-data (`files`), limits from MulterModule config.
 */
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('context')
  @SerializeOptions({ schema: TicketContextSchema })
  context(@CurrentUser() user: SessionUser): Promise<TicketContext> {
    return this.tickets.context(user);
  }

  @Get()
  @SerializeOptions({ schema: TicketListResponseSchema })
  list(@Query({ schema: TicketListQuerySchema }) query: TicketListQuery, @CurrentUser() user: SessionUser): Promise<TicketListResponse> {
    return this.tickets.list(user, query.filter);
  }

  @Post('cleanup')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketCleanupResponseSchema })
  async cleanup(@CurrentUser() user: SessionUser): Promise<TicketCleanupResponse> {
    return { removed: await this.tickets.cleanup(user) };
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
    @Body({ schema: CreateTicketFieldsSchema }) fields: CreateTicketFields,
    @UploadedFiles() files: IncomingFile[] | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.create(user, fields, files ?? []);
  }

  @Patch(':id')
  @SerializeOptions({ schema: TicketDetailSchema })
  update(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: UpdateTicketRequestSchema }) body: UpdateTicketRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.update(user, id, body);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  accept(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.tickets.transition(user, id, 'accept');
  }

  @Post(':id/complete')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  complete(@Param('id', { schema: TicketIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<TicketDetail> {
    return this.tickets.transition(user, id, 'complete');
  }

  @Post(':id/reject')
  @HttpCode(200)
  @SerializeOptions({ schema: TicketDetailSchema })
  reject(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: RejectTicketRequestSchema }) body: RejectTicketRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketDetail> {
    return this.tickets.transition(user, id, 'reject', body.reason);
  }

  @Post(':id/comments')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('files', TICKET_MAX_FILES_PER_UPLOAD))
  @SerializeOptions({ schema: TicketDetailSchema })
  comment(
    @Param('id', { schema: TicketIdSchema }) id: number,
    @Body({ schema: AddTicketCommentFieldsSchema }) fields: AddTicketCommentFields,
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
}
