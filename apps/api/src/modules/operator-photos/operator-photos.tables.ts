import type { Generated } from 'kysely';

/** One row per extension with a photo; the bytes are the file `storageKey` in OPERATOR_PHOTOS_DIR. */
export interface OperatorPhotosTable {
  extension: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: Generated<Date>;
  updatedByUserId: number | null;
}

declare module '../../database/db.js' {
  interface DB {
    operatorPhotos: OperatorPhotosTable;
  }
}
