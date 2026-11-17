import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { hashAgentKey, ipInCidrs, looksLikeAgentKey } from './domain/agent-rules.js';

export type AgentAuth =
  | { mode: 'key'; deviceId: number; extension: string; deviceName: string; ip: string | null }
  | { mode: 'legacy'; deviceId: null; extension: null; deviceName: null; ip: string | null };

export const AGENT_KEY_HEADER = 'x-agent-key';

/**
 * Authenticates desktop agents on the legacy ingest paths (no user session there):
 *  - `x-agent-key` must be an active per-device key (stored as sha256);
 *  - with AGENT_COMPAT_MODE=true, agents without a valid key are accepted as "legacy", but only from
 *    AGENT_COMPAT_ALLOWED_CIDRS (private office networks) — a temporary bridge until keys are rolled out.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  private readonly logger = new Logger(AgentAuthGuard.name);

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { agentAuth?: AgentAuth }>();
    const ip = req.ip ?? null;
    const presented = req.headers[AGENT_KEY_HEADER];

    if (looksLikeAgentKey(presented)) {
      const device = await this.txHost.tx
        .selectFrom('agentDevices')
        .select(['id', 'extension', 'name'])
        .where('keyHash', '=', hashAgentKey(presented))
        .where('revokedAt', 'is', null)
        .executeTakeFirst();
      if (device) {
        req.agentAuth = { mode: 'key', deviceId: device.id, extension: device.extension, deviceName: device.name, ip };
        return true;
      }
    }

    if (this.config.get('AGENT_COMPAT_MODE') && ipInCidrs(ip, this.config.get('AGENT_COMPAT_ALLOWED_CIDRS'))) {
      req.agentAuth = { mode: 'legacy', deviceId: null, extension: null, deviceName: null, ip };
      return true;
    }

    this.logger.warn(
      `rejected agent request from ${ip ?? 'unknown'} (${presented === undefined ? 'no key' : 'invalid key'})`,
    );
    throw new UnauthorizedException(presented === undefined ? 'Agent key required' : 'Invalid agent key');
  }
}

export const CurrentAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): AgentAuth => {
  const req = ctx.switchToHttp().getRequest<{ agentAuth?: AgentAuth }>();
  if (!req.agentAuth) throw new UnauthorizedException('Agent not authenticated');
  return req.agentAuth;
});
