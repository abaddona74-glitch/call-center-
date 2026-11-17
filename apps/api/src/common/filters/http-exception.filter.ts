import type { ApiError } from '@cc/shared';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';

/**
 * Every HTTP error leaves the API in one shape (ApiError from @cc/shared).
 * Unexpected errors are logged with stack and returned as a generic 500 — internals never leak.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = this.cls.isActive() ? this.cls.getId() : undefined;

    let body: ApiError;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const rawMessage = typeof raw === 'string' ? raw : (raw as { message?: unknown }).message;
      const messages = Array.isArray(rawMessage) ? rawMessage.map(String) : [String(rawMessage ?? exception.message)];
      body = {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message: messages.join('; '),
        requestId,
        ...(Array.isArray(rawMessage)
          ? {
              issues: messages.map((m) => {
                const idx = m.indexOf(': ');
                return idx > 0 ? { path: m.slice(0, idx), message: m.slice(idx + 2) } : { path: '', message: m };
              }),
            }
          : {}),
      };
      if (status >= 500) this.logger.error(exception);
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      body = {
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        requestId,
      };
    }

    if (!res.headersSent) res.status(body.statusCode).json(body);
  }
}
