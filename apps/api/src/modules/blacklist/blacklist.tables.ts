import type { BlacklistScope, BlacklistSyncState } from '@cc/shared';
import type { Generated } from 'kysely';

export interface BlockedNumbersTable {
  id: Generated<number>;
  number: string;
  variants: string[];
  scope: BlacklistScope;
  extension: string | null;
  note: Generated<string>;
  syncState: Generated<BlacklistSyncState>;
  syncError: string | null;
  syncedAt: Date | null;
  createdByUserId: number | null;
  createdByLabel: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

declare module '../../database/db.js' {
  interface DB {
    blockedNumbers: BlockedNumbersTable;
  }
}
