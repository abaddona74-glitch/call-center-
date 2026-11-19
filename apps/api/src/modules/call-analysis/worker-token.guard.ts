import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../../config/app-config.js';
import { workerTokenMatches } from './domain/job-policy.js';

/**
 * The analysis worker is a service, not a user: it authenticates with `Authorization: Bearer <token>`, compared with
 * CALL_ANALYSIS_WORKER_TOKEN_SHA256. Routes using this guard are `@Public()` for the session guard.
 */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!workerTokenMatches(req.headers.authorization, this.config.get('CALL_ANALYSIS_WORKER_TOKEN_SHA256'))) {
      throw new UnauthorizedException('Invalid worker token');
    }
    return true;
  }
}
