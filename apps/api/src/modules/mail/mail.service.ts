import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/app-config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outgoing email (nodemailer over SMTP_*).
 * Without SMTP_HOST nothing is sent; with NODE_ENV=development the message is printed to the
 * console so codes can be used locally. Message bodies are never logged in other environments.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor(private readonly config: AppConfig) {
    const host = config.get('SMTP_HOST');
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: config.get('SMTP_PORT'),
          secure: config.get('SMTP_SECURE'),
          requireTLS: !config.get('SMTP_SECURE'),
          auth: config.get('SMTP_USER')
            ? { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASSWORD') }
            : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null;
  }

  /** Mail can reach users (SMTP configured, or dev console). */
  get enabled(): boolean {
    return this.transporter !== null || this.config.get('NODE_ENV') === 'development';
  }

  /** Returns false when the message could not be sent (never throws). */
  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) {
      if (this.config.get('NODE_ENV') === 'development') {
        // Dev only: print the message so one-time codes can be used without SMTP.
        console.log(`\n[mail:dev] to=${message.to}\nsubject: ${message.subject}\n${message.text}\n`);
        return true;
      }
      this.logger.warn('SMTP is not configured (SMTP_HOST); an email was not sent');
      return false;
    }
    try {
      await this.transporter.sendMail({ from: this.config.get('SMTP_FROM'), ...message });
      return true;
    } catch (err) {
      this.logger.error(`sending mail failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}
