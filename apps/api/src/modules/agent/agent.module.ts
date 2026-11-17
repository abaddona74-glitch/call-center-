import { Module } from '@nestjs/common';
import { AgentAdminController } from './agent-admin.controller.js';
import { AgentAuthGuard } from './agent-auth.guard.js';
import { AgentIngestController } from './agent-ingest.controller.js';
import { AgentService } from './agent.service.js';

/**
 * 3CX desktop agent: legacy ingest paths with per-device keys, plus admin of devices and releases.
 *
 * Isolated on purpose — the owner is likely to drop the agent (it duplicates PBX data). Nothing else
 * depends on it. To remove it completely:
 *  - api: this folder, `AgentModule` line in app.module.ts, AGENT_* in config/env.schema.ts and both
 *    .env.example files, test/s4/agent.e2e-spec.ts; add a migration that drops the agent_* tables
 *    (created by 202611171413_agent_init.ts — never edit an applied migration);
 *  - shared: src/agent.ts, src/realtime/agent.ts and their lines in index.ts / realtime.ts;
 *  - web: entities/agent, features/agents, pages/settings-agents, app/routes/_app/settings_.agents.tsx,
 *    the nav item in widgets/app-shell/model/nav.ts and the `nav.agents` locale keys.
 */
@Module({
  controllers: [AgentIngestController, AgentAdminController],
  providers: [AgentService, AgentAuthGuard],
})
export class AgentModule {}
