import type { ContactLanguage } from '@cc/shared';
import type { Generated } from 'kysely';

export interface ContactsTable {
  /** normalizeUzPhone() form */
  phone: string;
  name: Generated<string>;
  organization: Generated<string>;
  language: ContactLanguage | null;
  note: Generated<string>;
  telegram: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  createdByUserId: number | null;
  updatedByUserId: number | null;
}

declare module '../../database/db.js' {
  interface DB {
    contacts: ContactsTable;
  }
}
