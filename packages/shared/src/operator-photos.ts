import { z } from 'zod';

/**
 * Operator photos (owner, 20.11.2026): one photo per extension, uploaded in Settings → "Operator rasmlari"
 * (`settings.manage`) and shown in the operator cards. Stored on the server (OPERATOR_PHOTOS_DIR, a volume that
 * survives deploys); the live operator list carries a versioned `photoUrl` for each operator that has one.
 */

/** Largest accepted photo. A portrait for a 56 px circle needs far less; phones' originals fit. */
export const OPERATOR_PHOTO_MAX_MB = 5;
export const OPERATOR_PHOTO_MAX_BYTES = OPERATOR_PHOTO_MAX_MB * 1024 * 1024;
/** Accepted types, checked by content on the server (SVG and the rest are refused). */
export const OPERATOR_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The image URL of a photo: the version (upload time) busts browser caches when the photo is replaced. */
export function operatorPhotoUrl(extension: string, updatedAt: Date | string): string {
  const version = new Date(updatedAt).getTime();
  return `/api/operator-photos/${encodeURIComponent(extension)}/image?v=${version}`;
}

/** One operator of the settings screen. */
export const OperatorPhotoEntrySchema = z.object({
  extension: z.string(),
  /** From the PBX directory (`asterisk.users`); null when the PBX does not know the number. */
  name: z.string().nullable(),
  /** Null: no photo (the cards show the name's initials). */
  photoUrl: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type OperatorPhotoEntry = z.infer<typeof OperatorPhotoEntrySchema>;

export const OperatorPhotosSchema = z.object({
  /** PBX directory + every extension with a photo, sorted by number. */
  operators: z.array(OperatorPhotoEntrySchema),
  /** False when the PBX database could not be read: only the extensions with a photo are listed. */
  directoryAvailable: z.boolean(),
});
export type OperatorPhotosInfo = z.infer<typeof OperatorPhotosSchema>;
