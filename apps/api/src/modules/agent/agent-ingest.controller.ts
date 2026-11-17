import {
  AgentCallEventRequestSchema,
  type AgentCallEventRequest,
  AgentHeartbeatRequestSchema,
  type AgentHeartbeatRequest,
  type AgentHeartbeatResponse,
  AgentHeartbeatResponseSchema,
  AgentOkResponseSchema,
  AgentSyncBatchRequestSchema,
  AgentSyncBatchResponseSchema,
  AgentUpdateLogRequestSchema,
  type AgentUpdateLogRequest,
  type AgentVersionResponse,
  AgentVersionResponseSchema,
} from '@cc/shared';
import { Body, Controller, Get, HttpCode, Post, SerializeOptions, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { Public } from '../../common/decorators/auth.decorators.js';
import { type AgentAuth, AgentAuthGuard, CurrentAgent } from './agent-auth.guard.js';
import { AgentService } from './agent.service.js';

/**
 * Legacy desktop-agent paths and payloads (agent.exe keeps working unchanged). No user session:
 * `@Public()` + AgentAuthGuard (per-device `x-agent-key`, or compat mode from private networks).
 */
@Controller('agent')
@Public()
export class AgentIngestController {
  constructor(private readonly agents: AgentService) {}

  @Post('heartbeat')
  @HttpCode(200)
  @UseGuards(AgentAuthGuard)
  @SerializeOptions({ schema: AgentHeartbeatResponseSchema })
  heartbeat(
    @CurrentAgent() auth: AgentAuth,
    @Body({ schema: AgentHeartbeatRequestSchema }) body: AgentHeartbeatRequest,
  ): Promise<AgentHeartbeatResponse> {
    return this.agents.heartbeat(auth, body);
  }

  @Post('call-event')
  @HttpCode(200)
  @UseGuards(AgentAuthGuard)
  @SerializeOptions({ schema: AgentOkResponseSchema })
  async callEvent(
    @CurrentAgent() auth: AgentAuth,
    @Body({ schema: AgentCallEventRequestSchema }) body: AgentCallEventRequest,
  ): Promise<{ success: true }> {
    await this.agents.callEvent(auth, body);
    return { success: true };
  }

  @Post('sync-batch')
  @HttpCode(200)
  @UseGuards(AgentAuthGuard)
  @SerializeOptions({ schema: AgentSyncBatchResponseSchema })
  async syncBatch(
    @CurrentAgent() auth: AgentAuth,
    @Body({ schema: AgentSyncBatchRequestSchema }) body: z.infer<typeof AgentSyncBatchRequestSchema>,
  ): Promise<{ success: true; count: number; skipped: number }> {
    const { inserted, skipped } = await this.agents.syncBatch(auth, body.operatorId, body.hostname ?? null, body.calls);
    return { success: true, count: inserted, skipped };
  }

  @Post('update-log')
  @HttpCode(200)
  @UseGuards(AgentAuthGuard)
  @SerializeOptions({ schema: AgentOkResponseSchema })
  async updateLog(
    @CurrentAgent() auth: AgentAuth,
    @Body({ schema: AgentUpdateLogRequestSchema }) body: AgentUpdateLogRequest,
  ): Promise<{ success: true }> {
    await this.agents.updateLog(auth, body);
    return { success: true };
  }

  /** Legacy no-op kept so old agents don't log errors. */
  @Post('reject')
  @HttpCode(200)
  @UseGuards(AgentAuthGuard)
  reject(): { success: true; message: string } {
    return { success: true, message: 'Reject monitoring disabled' };
  }

  /** OTA version announcement; public like in legacy (no secrets in it). */
  @Get('version')
  @SerializeOptions({ schema: AgentVersionResponseSchema })
  version(): Promise<AgentVersionResponse> {
    return this.agents.version();
  }
}
