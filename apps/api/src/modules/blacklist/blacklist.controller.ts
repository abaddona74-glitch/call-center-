import {
  AddBlockedNumberRequestSchema,
  type AddBlockedNumberRequestParsed,
  type BlacklistResponse,
  BlacklistResponseSchema,
  type BlacklistSyncResult,
  BlacklistSyncResultSchema,
  type BlockedNumber,
  BlockedNumberSchema,
  PositiveIdParamSchema,
  type SessionUser,
} from '@cc/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, SerializeOptions } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import { BlacklistService } from './blacklist.service.js';

/** Blocked caller numbers — admins only (no shared "blacklist password" any more). */
@Controller('blacklist')
@Roles('admin')
export class BlacklistController {
  constructor(private readonly blacklist: BlacklistService) {}

  @Get()
  @SerializeOptions({ schema: BlacklistResponseSchema })
  list(): Promise<BlacklistResponse> {
    return this.blacklist.list();
  }

  @Post()
  @HttpCode(200)
  @SerializeOptions({ schema: BlockedNumberSchema })
  add(
    @Body({ schema: AddBlockedNumberRequestSchema }) body: AddBlockedNumberRequestParsed,
    @CurrentUser() user: SessionUser,
  ): Promise<BlockedNumber> {
    return this.blacklist.add(body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', { schema: PositiveIdParamSchema }) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    await this.blacklist.remove(id, user);
  }

  /** Retry pending AstDB changes now. */
  @Post('sync')
  @HttpCode(200)
  @SerializeOptions({ schema: BlacklistSyncResultSchema })
  sync(): Promise<BlacklistSyncResult> {
    return this.blacklist.syncPending();
  }
}
