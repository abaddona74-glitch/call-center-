import type {
  ChangePasswordResponse,
  EmailChangeStatus,
  PasswordResetRequested,
  PasswordResetVerified,
} from '@cc/shared';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { codeMail } from '../mail/templates.js';
import { AuthRepository } from './auth.repository.js';
import type { AuthCodePurpose } from './auth.tables.js';
import { AuthService } from './auth.service.js';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_SECONDS,
  CODE_TTL_SECONDS,
  RESET_TOKEN_TTL_SECONDS,
  generateCode,
  generateToken,
  hashCode,
  hashToken,
  maskEmail,
  verifyCode,
} from './domain/codes.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { hashPassword } from './password-hasher.js';
import { SessionManager } from './session-manager.service.js';

const INVALID_CODE = 'Invalid or expired code';
const EMAIL_PURPOSES: AuthCodePurpose[] = ['email_current', 'email_new'];
/** Max codes per account per hour (both flows), against mail bombing. */
const MAX_CODES_PER_HOUR = 6;

/** Self-service account operations: own password, password reset by email, email binding. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly auth: AuthService,
    private readonly sessions: SessionManager,
    private readonly throttle: LoginThrottleService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // --- own password ------------------------------------------------------------------

  // Not @Transactional: a wrong current password must still be counted (a rollback would undo it).
  async changePassword(
    userId: number,
    currentSessionId: string,
    body: { currentPassword: string; newPassword: string; revokePasskeys: boolean },
    ip: string | undefined,
  ): Promise<ChangePasswordResponse> {
    const user = await this.auth.verifyCurrentPassword(userId, body.currentPassword, ip);
    if (body.currentPassword === body.newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }
    return this.applyPasswordChange(user.id, currentSessionId, body.newPassword, body.revokePasskeys);
  }

  @Transactional()
  private async applyPasswordChange(
    userId: number,
    currentSessionId: string,
    newPassword: string,
    revokePasskeys: boolean,
  ): Promise<ChangePasswordResponse> {
    await this.repo.setPassword(userId, await hashPassword(newPassword));
    const revokedPasskeys = revokePasskeys ? await this.sessions.revokeUserPasskeys(userId, 'password_changed') : 0;
    const revokedSessions = await this.sessions.revokeUserSessions(userId, 'password_changed', currentSessionId);
    await this.audit.record('auth.password.changed', {
      target: `user:${userId}`,
      details: { revokedSessions, revokedPasskeys },
    });
    return { revokedSessions };
  }

  // --- password reset by email (anonymous) ----------------------------------------------

  /**
   * Sends a code to the email ALREADY bound to the account. Never binds or uses an email
   * supplied by the anonymous caller. The response is the same whether or not anything was sent.
   */
  async requestPasswordReset(identifier: string, ip: string | undefined): Promise<PasswordResetRequested> {
    const generic = { expiresInSeconds: CODE_TTL_SECONDS };
    const user = await this.repo.findByIdentifier(identifier);
    if (!user || !user.isActive || !user.email) {
      await this.audit.record('auth.password_reset.ignored', {
        actorLabel: 'anonymous',
        target: `identifier:${identifier.slice(0, 64)}`,
      });
      return generic;
    }
    if (!(await this.mayIssueCode(user.id, ['password_reset']))) return generic;

    const code = generateCode();
    await this.repo.replaceCode(
      {
        userId: user.id,
        purpose: 'password_reset',
        email: user.email,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
        ip: ip ?? null,
      },
      ['password_reset'],
    );
    const sent = await this.mail.send(
      codeMail('password_reset', user.email, user.username, code, CODE_TTL_SECONDS / 60),
    );
    await this.audit.record('auth.password_reset.requested', {
      actorLabel: 'anonymous',
      target: `user:${user.id}`,
      details: { sent },
    });
    return generic;
  }

  // Not @Transactional: failed attempts must be persisted even though the request fails.
  async verifyPasswordReset(identifier: string, code: string): Promise<PasswordResetVerified> {
    const user = await this.repo.findByIdentifier(identifier);
    const row = user?.isActive ? await this.repo.latestCode(user.id, ['password_reset']) : undefined;
    if (!user || !row || row.tokenHash || row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(INVALID_CODE);
    }
    if (!verifyCode(code, row.codeHash)) {
      const attempts = await this.repo.addAttempt(row.id);
      if (attempts >= CODE_MAX_ATTEMPTS) await this.repo.consumeCode(row.id);
      await this.audit.record('auth.password_reset.bad_code', { actorLabel: 'anonymous', target: `user:${user.id}` });
      throw new BadRequestException(INVALID_CODE);
    }
    const token = generateToken();
    await this.repo.setResetToken(row.id, hashToken(token), new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000));
    return { resetToken: token, expiresInSeconds: RESET_TOKEN_TTL_SECONDS };
  }

  @Transactional()
  async completePasswordReset(resetToken: string, newPassword: string): Promise<void> {
    const row = await this.repo.findByResetToken(hashToken(resetToken));
    if (!row || !row.tokenExpiresAt || row.tokenExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('The reset link has expired. Request a new code');
    }
    const user = await this.repo.findById(row.userId);
    if (!user || !user.isActive) throw new BadRequestException('The reset link has expired. Request a new code');

    await this.repo.consumeCode(row.id);
    await this.repo.setPassword(user.id, await hashPassword(newPassword));
    // Whoever had access may have added a passkey or kept a session: end them all.
    const revokedPasskeys = await this.sessions.revokeUserPasskeys(user.id, 'password_reset');
    const revokedSessions = await this.sessions.revokeUserSessions(user.id, 'password_reset');
    await this.throttle.clearUser(user.username);
    await this.audit.record('auth.password_reset.completed', {
      actorLabel: user.username,
      target: `user:${user.id}`,
      details: { revokedSessions, revokedPasskeys },
    });
  }

  // --- email binding (logged in) --------------------------------------------------------

  async emailStatus(userId: number): Promise<EmailChangeStatus> {
    const user = await this.repo.findById(userId);
    const row = await this.repo.latestCode(userId, EMAIL_PURPOSES);
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      return { step: 'done', sentTo: null, expiresInSeconds: null, email: user?.email ?? null };
    }
    return {
      step: row.purpose === 'email_current' ? 'verify_current' : 'verify_new',
      sentTo: maskEmail(row.email),
      expiresInSeconds: Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000),
      email: user?.email ?? null,
    };
  }

  async startEmailChange(
    userId: number,
    body: { action: 'bind'; email: string; password: string } | { action: 'unbind'; password: string },
    ip: string | undefined,
  ): Promise<EmailChangeStatus> {
    const user = await this.auth.verifyCurrentPassword(userId, body.password, ip);
    return this.beginEmailChange(user, body.action === 'bind' ? body.email : null, ip);
  }

  @Transactional()
  private async beginEmailChange(
    user: { id: number; username: string; email: string | null },
    requestedEmail: string | null,
    ip: string | undefined,
  ): Promise<EmailChangeStatus> {
    const newEmail = requestedEmail;

    if (newEmail !== null) {
      if (user.email && user.email.toLowerCase() === newEmail)
        throw new BadRequestException('This email is already bound');
      if (await this.repo.emailTaken(newEmail, user.id))
        throw new ConflictException('This email is used by another account');
    } else if (!user.email) {
      throw new BadRequestException('No email is bound');
    }
    if (!(await this.mayIssueCode(user.id, EMAIL_PURPOSES))) {
      throw new BadRequestException('Too many codes requested. Try again later');
    }

    // An already bound email must confirm first (protects against a stolen session re-binding it).
    const purpose: AuthCodePurpose = user.email ? 'email_current' : 'email_new';
    const to = purpose === 'email_current' ? user.email! : newEmail!;
    return this.issueEmailCode(user.id, user.username, purpose, to, newEmail, ip);
  }

  // Not @Transactional: failed attempts must be persisted even though the request fails.
  async verifyEmailChange(userId: number, code: string, ip: string | undefined): Promise<EmailChangeStatus> {
    const user = await this.repo.findById(userId);
    const row = await this.repo.latestCode(userId, EMAIL_PURPOSES);
    if (!user || !row || row.expiresAt.getTime() <= Date.now()) throw new BadRequestException(INVALID_CODE);

    if (!verifyCode(code, row.codeHash)) {
      const attempts = await this.repo.addAttempt(row.id);
      if (attempts >= CODE_MAX_ATTEMPTS) await this.repo.consumeCode(row.id);
      throw new BadRequestException(INVALID_CODE);
    }
    await this.repo.consumeCode(row.id);

    if (row.purpose === 'email_current' && row.newEmail) {
      // Current email confirmed; now confirm the new one.
      if (await this.repo.emailTaken(row.newEmail, user.id))
        throw new ConflictException('This email is used by another account');
      return this.issueEmailCode(user.id, user.username, 'email_new', row.newEmail, row.newEmail, ip);
    }

    const finalEmail = row.purpose === 'email_new' ? row.email : null;
    if (finalEmail && (await this.repo.emailTaken(finalEmail, user.id))) {
      throw new ConflictException('This email is used by another account');
    }
    await this.repo.setEmail(user.id, finalEmail);
    await this.audit.record(finalEmail ? 'auth.email.bound' : 'auth.email.unbound', {
      target: `user:${user.id}`,
      details: {
        email: finalEmail ? maskEmail(finalEmail) : null,
        previous: user.email ? maskEmail(user.email) : null,
      },
    });
    return { step: 'done', sentTo: null, expiresInSeconds: null, email: finalEmail };
  }

  async cancelEmailChange(userId: number): Promise<void> {
    await this.repo.consumeCodes(userId, EMAIL_PURPOSES);
  }

  // --- helpers ---------------------------------------------------------------------------

  private async issueEmailCode(
    userId: number,
    username: string,
    purpose: AuthCodePurpose,
    to: string,
    newEmail: string | null,
    ip: string | undefined,
  ): Promise<EmailChangeStatus> {
    const code = generateCode();
    await this.repo.replaceCode(
      {
        userId,
        purpose,
        email: to,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
        newEmail,
        ip: ip ?? null,
      },
      EMAIL_PURPOSES,
    );
    const sent = await this.mail.send(codeMail(purpose, to, username, code, CODE_TTL_SECONDS / 60));
    if (!sent) throw new BadRequestException('The email could not be sent. Try again later');
    await this.audit.record('auth.email.code_sent', {
      target: `user:${userId}`,
      details: { purpose, to: maskEmail(to) },
    });
    return {
      step: purpose === 'email_current' ? 'verify_current' : 'verify_new',
      sentTo: maskEmail(to),
      expiresInSeconds: CODE_TTL_SECONDS,
      email: null,
    };
  }

  /** Resend cooldown + hourly cap per account. */
  private async mayIssueCode(userId: number, purposes: AuthCodePurpose[]): Promise<boolean> {
    const last = await this.repo.latestCode(userId, purposes);
    if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_SECONDS * 1000) {
      this.logger.debug(`code for user ${userId} requested again within ${CODE_RESEND_SECONDS}s`);
      return false;
    }
    let total = 0;
    for (const p of purposes) total += await this.repo.countRecentCodes(userId, p, 60);
    return total < MAX_CODES_PER_HOUR;
  }
}
