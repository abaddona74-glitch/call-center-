import { randomUUID } from 'node:crypto';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterKysely } from '@nestjs-cls/transactional-adapter-kysely';
import { Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { AppClsStore } from './common/cls/app-cls.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { AppConfig } from './config/app-config.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule, KYSELY } from './database/database.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BlacklistModule } from './modules/blacklist/blacklist.module.js';
import { CallbacksModule } from './modules/callbacks/callbacks.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { PbxDbModule } from './pbx/pbx-db.module.js';

@Module({
  imports: [
    AppConfigModule,

    // AsyncLocalStorage request context + @Transactional() for Kysely
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => String(req.headers['x-request-id'] ?? randomUUID()),
        setup: (cls, req: Request) => {
          (cls as unknown as { set: <K extends keyof AppClsStore>(k: K, v: AppClsStore[K]) => void }).set('ip', req.ip);
          cls.set('userAgent', req.headers['user-agent']);
        },
      },
      plugins: [
        new ClsPluginTransactional({
          imports: [DatabaseModule],
          adapter: new TransactionalAdapterKysely({ kyselyInstanceToken: KYSELY }),
        }),
      ],
    }),

    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: (req) => String(req.headers['x-request-id'] ?? randomUUID()),
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
          transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),

    ScheduleModule.forRoot(),
    // Domain events between modules (see common/events/domain-events.ts)
    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 20 }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    DatabaseModule,
    PbxDbModule,
    AuditModule,
    AuthModule,
    RealtimeModule,
    HealthModule,
    // Feature modules are registered below this line (one import per module).
    CallbacksModule,
    ContactsModule,
    BlacklistModule,
    AgentModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector],
      useFactory: (reflector: Reflector) => new StandardSchemaSerializerInterceptor(reflector),
    },
  ],
})
export class AppModule {}
