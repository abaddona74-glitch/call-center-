import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthSettingsService } from './auth-settings.service.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { ImpersonationController } from './impersonation.controller.js';
import { ImpersonationService } from './impersonation.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { SecurityController } from './security.controller.js';
import { SessionManager } from './session-manager.service.js';
import { SessionsAdminController } from './sessions-admin.controller.js';
import { SessionsService } from './sessions.service.js';

@Global()
@Module({
  controllers: [
    AuthController,
    AccountController,
    SessionsAdminController,
    SecurityController,
    ImpersonationController,
  ],
  providers: [
    AuthService,
    SessionsService,
    SessionManager,
    AuthRepository,
    AuthSettingsService,
    LoginThrottleService,
    AccountService,
    ImpersonationService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [AuthService, SessionsService, SessionManager, AuthRepository],
})
export class AuthModule {}
