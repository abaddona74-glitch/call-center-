import { z } from 'zod';
import { PasswordSchema, RoleSchema } from './auth.js';

/**
 * Self-service account contracts: auth options, own password, password reset by email,
 * email binding, own sessions. Base path /api/auth.
 */

/** GET /api/auth/options (public) — what the login screen can offer. */
export const AuthOptionsSchema = z.object({
  passkeys: z.boolean(),
  passwordReset: z.boolean(),
});
export type AuthOptions = z.infer<typeof AuthOptionsSchema>;

export const AccountEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Six digits, as typed by the user (spaces are ignored). */
export const VerificationCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Code must be 6 digits'));

/** POST /api/auth/password — change own password. */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: PasswordSchema,
  /** Also delete own passkeys (e.g. after a lost device). */
  revokePasskeys: z.boolean().default(false),
});
export type ChangePasswordRequest = z.input<typeof ChangePasswordRequestSchema>;

export const ChangePasswordResponseSchema = z.object({
  /** Other sessions that were signed out. */
  revokedSessions: z.number().int(),
});
export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponseSchema>;

// --- Password reset by email (anonymous) -----------------------------------------------
// The code is sent ONLY to the email already bound to the account. Responses never reveal
// whether the account exists or has an email.

/** POST /api/auth/password-reset/request */
export const PasswordResetRequestSchema = z.object({
  /** Username or the email bound to the account. */
  identifier: z.string().trim().min(1).max(254),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetRequestedSchema = z.object({
  /** How long a code (if one was sent) stays valid. */
  expiresInSeconds: z.number().int(),
});
export type PasswordResetRequested = z.infer<typeof PasswordResetRequestedSchema>;

/** POST /api/auth/password-reset/verify — exchange the emailed code for a one-time reset token. */
export const PasswordResetVerifySchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  code: VerificationCodeSchema,
});
export type PasswordResetVerify = z.input<typeof PasswordResetVerifySchema>;

export const PasswordResetVerifiedSchema = z.object({
  resetToken: z.string(),
  expiresInSeconds: z.number().int(),
});
export type PasswordResetVerified = z.infer<typeof PasswordResetVerifiedSchema>;

/** POST /api/auth/password-reset/complete */
export const PasswordResetCompleteSchema = z.object({
  resetToken: z.string().min(20).max(200),
  newPassword: PasswordSchema,
});
export type PasswordResetComplete = z.infer<typeof PasswordResetCompleteSchema>;

// --- Email binding (logged-in user) -----------------------------------------------------
// Binding or changing requires the current password. If an email is already bound, a code is
// first sent to the CURRENT email (step "verify_current"), then to the new one ("verify_new").

/** POST /api/auth/email/start */
export const EmailChangeStartSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bind'), email: AccountEmailSchema, password: z.string().min(1).max(200) }),
  z.object({ action: z.literal('unbind'), password: z.string().min(1).max(200) }),
]);
export type EmailChangeStart = z.input<typeof EmailChangeStartSchema>;

export const EmailChangeStepSchema = z.enum(['verify_current', 'verify_new', 'done']);
export type EmailChangeStep = z.infer<typeof EmailChangeStepSchema>;

export const EmailChangeStatusSchema = z.object({
  step: EmailChangeStepSchema,
  /** Where the code was sent, masked (e.g. "j***@gmail.com"). */
  sentTo: z.string().nullable(),
  expiresInSeconds: z.number().int().nullable(),
  /** The bound email after the flow finished. */
  email: z.string().nullable(),
});
export type EmailChangeStatus = z.infer<typeof EmailChangeStatusSchema>;

/** POST /api/auth/email/verify */
export const EmailChangeVerifySchema = z.object({ code: VerificationCodeSchema });
export type EmailChangeVerify = z.input<typeof EmailChangeVerifySchema>;

// --- Own sessions -------------------------------------------------------------------

/** A session as shown to its owner or an admin. `id` is sha256(token) — never the token. */
export const SessionInfoSchema = z.object({
  id: z.string(),
  userId: z.number().int(),
  username: z.string(),
  role: RoleSchema,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  viaPasskey: z.boolean(),
  /** A superuser acting as this user ("log in as"). */
  impersonatedBy: z.string().nullable(),
  isCurrent: z.boolean(),
  /** The viewer may revoke it (admin rules; never the current session). */
  canRevoke: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SessionListSchema = z.object({ items: z.array(SessionInfoSchema) });
export type SessionList = z.infer<typeof SessionListSchema>;

/** Session ids are sha256 hex. */
export const SessionIdSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Invalid session id');

// --- "Log in as another user" (superuser, permission `impersonate`) --------------------------

/** POST /api/auth/impersonation — start acting as `userId` (new, separate, time-limited session). */
export const ImpersonationStartSchema = z.object({ userId: z.number().int().positive() });
export type ImpersonationStart = z.infer<typeof ImpersonationStartSchema>;

/** Minutes an impersonation session lasts (not renewable). */
export const IMPERSONATION_MINUTES = 30;
