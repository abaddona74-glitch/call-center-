import { z } from 'zod';
import { MeResponseSchema } from './auth.js';

/**
 * Passkeys (WebAuthn). Base path /api/auth/passkeys.
 * Options/credential JSON follows the WebAuthn JSON shapes (@simplewebauthn); only the fields we
 * rely on are checked, everything else is passed through untouched.
 */

export const PasskeyNameSchema = z.string().trim().min(1).max(60);

export const PasskeySchema = z.object({
  /** Credential id, base64url. */
  id: z.string(),
  name: z.string(),
  deviceType: z.string().nullable(),
  backedUp: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type Passkey = z.infer<typeof PasskeySchema>;

export const PasskeyListSchema = z.object({ items: z.array(PasskeySchema) });
export type PasskeyList = z.infer<typeof PasskeyListSchema>;

/** Base64url credential id in a URL path. */
export const PasskeyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/, 'Invalid passkey id');

/** POST /registration/options — registering requires the current password. */
export const PasskeyRegistrationStartSchema = z.object({
  password: z.string().min(1).max(200),
  name: PasskeyNameSchema,
});
export type PasskeyRegistrationStart = z.infer<typeof PasskeyRegistrationStartSchema>;

/** PublicKeyCredentialCreationOptionsJSON / PublicKeyCredentialRequestOptionsJSON (passed through). */
export const WebAuthnOptionsSchema = z.looseObject({ challenge: z.string() });
export type WebAuthnOptionsJSON = z.infer<typeof WebAuthnOptionsSchema>;

const base64url = z
  .string()
  .regex(/^[A-Za-z0-9_-]*={0,2}$/)
  .max(20_000);

/** RegistrationResponseJSON from the browser. */
export const RegistrationCredentialSchema = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().max(32).optional(),
});

/** AuthenticationResponseJSON from the browser. */
export const AuthenticationCredentialSchema = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().max(32).optional(),
});

/** POST /registration/verify */
export const PasskeyRegistrationFinishSchema = z.object({ credential: RegistrationCredentialSchema });
export type PasskeyRegistrationFinish = z.input<typeof PasskeyRegistrationFinishSchema>;

/** POST /login/verify (public) — responds like /api/auth/login. */
export const PasskeyLoginFinishSchema = z.object({ credential: AuthenticationCredentialSchema });
export type PasskeyLoginFinish = z.input<typeof PasskeyLoginFinishSchema>;
export const PasskeyLoginResponseSchema = MeResponseSchema;

/** PATCH /:id */
export const PasskeyRenameSchema = z.object({ name: PasskeyNameSchema });
export type PasskeyRename = z.infer<typeof PasskeyRenameSchema>;
