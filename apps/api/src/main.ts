import { randomUUID } from 'node:crypto';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';

/** WS frames are `{ type, data }`; Nest's WsAdapter expects `{ event, data }`. */
class TypedWsAdapter extends WsAdapter {
  constructor(app: NestExpressApplication) {
    super(app, {
      messageParser: (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as { type?: unknown; data?: unknown };
          return typeof parsed.type === 'string' ? { event: parsed.type, data: parsed.data } : undefined;
        } catch {
          return undefined;
        }
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(AppConfig);

  app.useLogger(app.get(Logger));

  const proxies = config.get('TRUSTED_PROXIES');
  app.set('trust proxy', proxies.length ? proxies : false);

  // Same request id in logs, CLS and the response header.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = String(req.headers['x-request-id'] ?? randomUUID());
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });
  app.use(helmet());
  app.use(cookieParser());

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useWebSocketAdapter(new TypedWsAdapter(app));
  app.enableShutdownHooks();

  await app.listen(config.get('PORT'));
}

await bootstrap();
