import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionsService, { provide: APP_GUARD, useClass: SessionAuthGuard }],
  exports: [AuthService, SessionsService],
})
export class AuthModule {}
