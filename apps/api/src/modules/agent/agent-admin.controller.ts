import {
  type AgentDevice,
  type AgentDeviceListResponse,
  AgentDeviceListResponseSchema,
  AgentDeviceSchema,
  AgentEventsQuerySchema,
  type AgentEventsQuery,
  type AgentEventsResponse,
  AgentEventsResponseSchema,
  type AgentRelease,
  AgentReleaseListResponseSchema,
  AgentReleaseSchema,
  type AgentStatusListResponse,
  AgentStatusListResponseSchema,
  type AgentUpdateLog,
  AgentUpdateLogListResponseSchema,
  CreateAgentDeviceRequestSchema,
  type CreateAgentDeviceRequest,
  type CreateAgentDeviceResponse,
  CreateAgentDeviceResponseSchema,
  CreateAgentReleaseRequestSchema,
  PositiveIdParamSchema,
  type SessionUser,
} from '@cc/shared';
import { Body, Controller, Get, HttpCode, Param, Post, Query, SerializeOptions } from '@nestjs/common';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import { AgentService } from './agent.service.js';

/** Agent devices (API keys), status, releases (OTA) and raw events — admin only, audited. */
@Controller('agent')
@Roles('admin')
export class AgentAdminController {
  constructor(private readonly agents: AgentService) {}

  @Get('devices')
  @SerializeOptions({ schema: AgentDeviceListResponseSchema })
  devices(): Promise<AgentDeviceListResponse> {
    return this.agents.listDevices();
  }

  /** Issues a key; the response is the only time the plaintext key is shown. */
  @Post('devices')
  @SerializeOptions({ schema: CreateAgentDeviceResponseSchema })
  createDevice(
    @Body({ schema: CreateAgentDeviceRequestSchema }) body: CreateAgentDeviceRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<CreateAgentDeviceResponse> {
    return this.agents.createDevice(body.name, body.extension, user);
  }

  @Post('devices/:id/revoke')
  @HttpCode(200)
  @SerializeOptions({ schema: AgentDeviceSchema })
  revoke(
    @Param('id', { schema: PositiveIdParamSchema }) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<AgentDevice> {
    return this.agents.revokeDevice(id, user);
  }

  @Get('status')
  @SerializeOptions({ schema: AgentStatusListResponseSchema })
  status(): Promise<AgentStatusListResponse> {
    return this.agents.statuses();
  }

  @Get('releases')
  @SerializeOptions({ schema: AgentReleaseListResponseSchema })
  async releases(): Promise<{ items: AgentRelease[] }> {
    return { items: await this.agents.releases() };
  }

  @Post('releases')
  @SerializeOptions({ schema: AgentReleaseSchema })
  createRelease(
    @Body({ schema: CreateAgentReleaseRequestSchema }) body: z.infer<typeof CreateAgentReleaseRequestSchema>,
    @CurrentUser() user: SessionUser,
  ): Promise<AgentRelease> {
    return this.agents.createRelease(body, user);
  }

  @Get('update-logs')
  @SerializeOptions({ schema: AgentUpdateLogListResponseSchema })
  async updateLogs(): Promise<{ items: AgentUpdateLog[] }> {
    return { items: await this.agents.updateLogs() };
  }

  @Get('events')
  @SerializeOptions({ schema: AgentEventsResponseSchema })
  events(@Query({ schema: AgentEventsQuerySchema }) q: AgentEventsQuery): Promise<AgentEventsResponse> {
    return this.agents.events(q);
  }
}
