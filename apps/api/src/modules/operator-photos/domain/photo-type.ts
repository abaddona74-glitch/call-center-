import type { OPERATOR_PHOTO_TYPES } from '@cc/shared';

export type OperatorPhotoMime = (typeof OPERATOR_PHOTO_TYPES)[number];

/**
 * The photo's type by CONTENT (magic bytes), never by file name or the browser's MIME: JPEG, PNG or WEBP.
 * Everything else (SVG, GIF, HTML, …) is null and refused — the image is served from our own origin.
 */
export function detectPhotoType(buf: Buffer): OperatorPhotoMime | null {
  const at = (offset: number, bytes: number[]) =>
    buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
  const text = (offset: number, s: string) =>
    buf.length >= offset + s.length && buf.toString('latin1', offset, offset + s.length) === s;
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (text(0, 'RIFF') && text(8, 'WEBP')) return 'image/webp';
  return null;
}
