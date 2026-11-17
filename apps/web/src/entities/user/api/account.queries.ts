import {
  type ChangePasswordRequest,
  type ChangePasswordResponse,
  ChangePasswordResponseSchema,
  type EmailChangeStart,
  type EmailChangeStatus,
  EmailChangeStatusSchema,
  type Passkey,
  PasskeyListSchema,
  type PasskeyRegistrationStart,
  PasskeySchema,
  SessionListSchema,
  type WebAuthnOptionsJSON,
  WebAuthnOptionsSchema,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** The signed-in user's own account: password, email, passkeys, sessions. */
export const accountKeys = {
  email: ['account', 'email'] as const,
  passkeys: ['account', 'passkeys'] as const,
  sessions: ['account', 'sessions'] as const,
};

export const emailStatusQuery = queryOptions({
  queryKey: accountKeys.email,
  queryFn: ({ signal }) => api('/auth/email', { schema: EmailChangeStatusSchema, signal }),
});

export const myPasskeysQuery = queryOptions({
  queryKey: accountKeys.passkeys,
  queryFn: async ({ signal }) => (await api('/auth/passkeys', { schema: PasskeyListSchema, signal })).items,
});

export const mySessionsQuery = queryOptions({
  queryKey: accountKeys.sessions,
  queryFn: async ({ signal }) => (await api('/auth/sessions', { schema: SessionListSchema, signal })).items,
});

export function changePassword(body: ChangePasswordRequest): Promise<ChangePasswordResponse> {
  return api('/auth/password', { body, schema: ChangePasswordResponseSchema });
}

export function startEmailChange(body: EmailChangeStart): Promise<EmailChangeStatus> {
  return api('/auth/email/start', { body, schema: EmailChangeStatusSchema });
}

export function verifyEmailChange(code: string): Promise<EmailChangeStatus> {
  return api('/auth/email/verify', { body: { code }, schema: EmailChangeStatusSchema });
}

export function cancelEmailChange(): Promise<void> {
  return api('/auth/email/pending', { method: 'DELETE' });
}

export function passkeyRegistrationOptions(body: PasskeyRegistrationStart): Promise<WebAuthnOptionsJSON> {
  return api('/auth/passkeys/registration/options', { body, schema: WebAuthnOptionsSchema });
}

/** `credential` is RegistrationResponseJSON from @simplewebauthn/browser. */
export function passkeyRegistrationVerify(credential: unknown): Promise<Passkey> {
  return api('/auth/passkeys/registration/verify', { body: { credential }, schema: PasskeySchema });
}

export function renamePasskey(id: string, name: string): Promise<Passkey> {
  return api(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name }, schema: PasskeySchema });
}

export function deletePasskey(id: string): Promise<void> {
  return api(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function revokeMySession(id: string): Promise<void> {
  return api(`/auth/sessions/${id}`, { method: 'DELETE' });
}
