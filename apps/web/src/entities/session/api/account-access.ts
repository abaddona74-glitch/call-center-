import {
  AuthOptionsSchema,
  type MeResponse,
  MeResponseSchema,
  type PasswordResetComplete,
  type PasswordResetRequest,
  type PasswordResetRequested,
  PasswordResetRequestedSchema,
  type PasswordResetVerified,
  PasswordResetVerifiedSchema,
  type PasswordResetVerify,
  type WebAuthnOptionsJSON,
  WebAuthnOptionsSchema,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** Anonymous ways in: login screen options, passkey login, password reset by email. */

export const authOptionsQuery = queryOptions({
  queryKey: ['session', 'options'] as const,
  queryFn: ({ signal }) => api('/auth/options', { schema: AuthOptionsSchema, signal }),
  staleTime: 5 * 60_000,
});

export function passkeyLoginOptions(): Promise<WebAuthnOptionsJSON> {
  return api('/auth/passkeys/login/options', { method: 'POST', schema: WebAuthnOptionsSchema });
}

/** `credential` is AuthenticationResponseJSON from @simplewebauthn/browser. */
export function passkeyLoginVerify(credential: unknown): Promise<MeResponse> {
  return api('/auth/passkeys/login/verify', { body: { credential }, schema: MeResponseSchema });
}

export function requestPasswordReset(body: PasswordResetRequest): Promise<PasswordResetRequested> {
  return api('/auth/password-reset/request', { body, schema: PasswordResetRequestedSchema });
}

export function verifyPasswordReset(body: PasswordResetVerify): Promise<PasswordResetVerified> {
  return api('/auth/password-reset/verify', { body, schema: PasswordResetVerifiedSchema });
}

export function completePasswordReset(body: PasswordResetComplete): Promise<void> {
  return api('/auth/password-reset/complete', { body });
}
