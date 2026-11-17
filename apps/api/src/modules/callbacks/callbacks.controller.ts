import {
  AddCallbackNoteRequestSchema,
  type AddCallbackNoteRequest,
  AssignCallbackRequestSchema,
  type AssignCallbackRequest,
  type Callback,
  type CallbackDetails,
  CallbackDetailsSchema,
  CallbackListQuerySchema,
  type CallbackListQuery,
  type CallbackListResponse,
  CallbackListResponseSchema,
  CallbackSchema,
  type CallbackSettings,
  CallbackSettingsSchema,
  CallbackSyncRequestSchema,
  type CallbackSyncRequest,
  type CallbackSyncResult,
  CallbackSyncResultSchema,
  CloseCallbackRequestSchema,
  type CloseCallbackRequest,
  DismissAllCallbacksRequestSchema,
  type DismissAllCallbacksRequest,
  type DismissAllCallbacksResponse,
  DismissAllCallbacksResponseSchema,
  PositiveIdParamSchema,
  type SessionUser,
} from '@cc/shared';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, SerializeOptions } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { CallbacksReconciler } from './callbacks.reconciler.js';
import { CallbacksService } from './callbacks.service.js';

/**
 * Citizens to call back. Every role can see the list and log notes (operators do the calling);
 * closing callbacks by hand, bulk actions, settings and the CDR re-check are admin only.
 */
@Controller('callbacks')
export class CallbacksController {
  constructor(
    private readonly callbacks: CallbacksService,
    private readonly reconciler: CallbacksReconciler,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @SerializeOptions({ schema: CallbackListResponseSchema })
  list(
    @Query({ schema: CallbackListQuerySchema }) query: CallbackListQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<CallbackListResponse> {
    return this.callbacks.list(query, user);
  }

  @Get('settings')
  @RequirePermission('settings.manage')
  @SerializeOptions({ schema: CallbackSettingsSchema })
  settings(): Promise<CallbackSettings> {
    return this.callbacks.settings();
  }

  @Put('settings')
  @RequirePermission('settings.manage')
  @SerializeOptions({ schema: CallbackSettingsSchema })
  updateSettings(
    @Body({ schema: CallbackSettingsSchema }) body: CallbackSettings,
    @CurrentUser() user: SessionUser,
  ): Promise<CallbackSettings> {
    return this.callbacks.updateSettings(body, user);
  }

  /** Re-read the PBX CDR now (legacy "re-check" button). */
  @Post('sync')
  @RequirePermission('callbacks.manage')
  @HttpCode(200)
  @SerializeOptions({ schema: CallbackSyncResultSchema })
  async sync(@Body({ schema: CallbackSyncRequestSchema }) body: CallbackSyncRequest): Promise<CallbackSyncResult> {
    const result = await this.reconciler.run(body.hours);
    await this.audit.record('callbacks.sync', { target: 'callbacks', details: { hours: body.hours, ...result } });
    return result;
  }

  @Post('dismiss-all')
  @RequirePermission('callbacks.manage')
  @HttpCode(200)
  @SerializeOptions({ schema: DismissAllCallbacksResponseSchema })
  async dismissAll(
    @Body({ schema: DismissAllCallbacksRequestSchema }) body: DismissAllCallbacksRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<DismissAllCallbacksResponse> {
    return { dismissed: await this.callbacks.dismissAll(body.reason, body.date, user) };
  }

  @Get(':id')
  @SerializeOptions({ schema: CallbackDetailsSchema })
  details(@Param('id', { schema: PositiveIdParamSchema }) id: number): Promise<CallbackDetails> {
    return this.callbacks.details(id);
  }

  /** Close without a conversation: not needed (spam, wrong number, duplicate). */
  @Post(':id/dismiss')
  @RequirePermission('callbacks.manage')
  @HttpCode(200)
  @SerializeOptions({ schema: CallbackSchema })
  dismiss(
    @Param('id', { schema: PositiveIdParamSchema }) id: number,
    @Body({ schema: CloseCallbackRequestSchema }) body: CloseCallbackRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<Callback> {
    return this.callbacks.close(id, 'dismissed', body.reason, user);
  }

  /** Close as handled outside the PBX (e.g. reached by Telegram), with a reason. */
  @Post(':id/resolve')
  @RequirePermission('callbacks.manage')
  @HttpCode(200)
  @SerializeOptions({ schema: CallbackSchema })
  resolve(
    @Param('id', { schema: PositiveIdParamSchema }) id: number,
    @Body({ schema: CloseCallbackRequestSchema }) body: CloseCallbackRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<Callback> {
    return this.callbacks.close(id, 'resolved', body.reason, user);
  }

  @Post(':id/notes')
  @HttpCode(200)
  @SerializeOptions({ schema: CallbackSchema })
  addNote(
    @Param('id', { schema: PositiveIdParamSchema }) id: number,
    @Body({ schema: AddCallbackNoteRequestSchema }) body: AddCallbackNoteRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<Callback> {
    return this.callbacks.addNote(id, body.text, user);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @SerializeOptions({ schema: CallbackSchema })
  assign(
    @Param('id', { schema: PositiveIdParamSchema }) id: number,
    @Body({ schema: AssignCallbackRequestSchema }) body: AssignCallbackRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<Callback> {
    return this.callbacks.assign(id, body.userId, user);
  }
}
