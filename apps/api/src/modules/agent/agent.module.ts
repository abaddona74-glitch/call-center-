import { Module } from '@nestjs/common';
import { AgentAdminController } from './agent-admin.controller.js';
import { AgentAuthGuard } from './agent-auth.guard.js';
import { AgentIngestController } from './agent-ingest.controller.js';
import { AgentService } from './agent.service.js';

/** 3CX desktop agent: legacy ingest paths with per-device keys, plus admin of devices and releases. */
@Module({
  controllers: [AgentIngestController, AgentAdminController],
  providers: [AgentService, AgentAuthGuard],
})
export class AgentModule {}
