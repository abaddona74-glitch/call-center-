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
import { ActionsModule } from './modules/actions/actions.module.js';
import { AmiModule } from './modules/ami/ami.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { WorkingCalendarModule } from './modules/working-calendar/working-calendar.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BlacklistModule } from './modules/blacklist/blacklist.module.js';
import { CallbacksModule } from './modules/callbacks/callbacks.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { CdrModule } from './modules/cdr/cdr.module.js';
import { ExportModule } from './modules/export/export.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { LiveModule } from './modules/live/live.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { PasskeysModule } from './modules/passkeys/passkeys.module.js';
import { PresenceModule } from './modules/presence/presence.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { RecordingsModule } from './modules/recordings/recordings.module.js';
import { StatsModule } from './modules/stats/stats.module.js';
import { TicketsModule } from './modules/tickets/tickets.module.js';
import { ToolsModule } from './modules/tools/tools.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PbxDbModule } from './pbx/pbx-db.module.js';

/** Path without the query string: queries carry phone numbers and search text. */
const pathOf = (url: string | undefined) => (url ?? '').split('?')[0];
/** Express keeps the full path in `originalUrl` (`url` can be rewritten by routers). */
const requestUrl = (req: { url?: string }) => (req as { originalUrl?: string }).originalUrl ?? req.url;

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
          // One short access line per request (method, path, status, time) instead of every header;
          // logs written while handling a request carry only its id.
          quietReqLogger: true,
          quietResLogger: true,
          serializers: {
            req: (req: { id?: unknown; method?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              path: pathOf(req.url),
            }),
            res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
          },
          customLogLevel: (_req, res, err) =>
            err || res.statusCode >= 500
              ? 'error'
              : res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404
                ? 'warn'
                : 'info',
          customSuccessMessage: (req, res, ms) =>
            `${req.method} ${pathOf(requestUrl(req))} ${res.statusCode} ${Math.round(ms)}ms`,
          customErrorMessage: (req, res, err) =>
            `${req.method} ${pathOf(requestUrl(req))} ${res.statusCode} ${err.message}`,
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
    WorkingCalendarModule,
    AuthModule,
    RealtimeModule,
    HealthModule,
    // Feature modules are registered below this line (one import per module).
    MailModule,
    UsersModule,
    PasskeysModule,
    RecordingsModule,
    TicketsModule,
    CallbacksModule,
    ContactsModule,
    BlacklistModule,
    AmiModule,
    LiveModule,
    ActionsModule,
    PresenceModule,
    CdrModule,
    StatsModule,
    ExportModule,
    ToolsModule,
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
