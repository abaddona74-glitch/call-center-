/** Longest side the uploaded photo keeps: the card circle is 56 px, so this is sharp on 2–3× screens too. */
export const PHOTO_MAX_SIDE = 480;

/** The size to scale an image to so its longest side is at most `max` (never enlarged). */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Shrinks a phone photo in the browser before upload: at most PHOTO_MAX_SIDE px, re-encoded as JPEG. Every card
 * downloads the photo, so a 4 MB original would be wasted; re-encoding also drops EXIF (GPS, device). Falls back
 * to the original file when the browser can't decode it — the server still checks the type and size.
 */
export async function shrinkPhoto(file: File): Promise<{ blob: Blob; name: string }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('encode failed');
    return { blob, name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg` };
  } catch {
    return { blob: file, name: file.name };
  }
}
