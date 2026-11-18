import type { Generated } from 'kysely';

/** Same data as legacy `auth_passkeys` (minus denormalized username/operator snapshots). */
export interface PasskeysTable {
  /** Credential id, base64url. */
  id: string;
  userId: number;
  /** COSE public key bytes. */
  publicKey: Buffer;
  counter: Generated<number>;
  deviceType: string | null;
  backedUp: Generated<boolean>;
  transports: string[] | null;
  name: string;
  createdAt: Generated<Date>;
  lastUsedAt: Date | null;
}

declare module '../../database/db.js' {
  interface DB {
    passkeys: PasskeysTable;
  }
}
