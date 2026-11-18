/** Canvas helpers shared by the browser converters. */

export type RasterFormat = 'png' | 'jpg' | 'webp';

export const RASTER_MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export function canvasToBlob(canvas: HTMLCanvasElement, format: RasterFormat, quality = 0.95): Promise<Blob> {
  const mime = RASTER_MIME[format];
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Browsers fall back to PNG for formats they cannot encode.
        if (!blob || blob.type !== mime) reject(new Error('encode'));
        else resolve(blob);
      },
      mime,
      quality,
    );
  });
}

/** A canvas with the image drawn on white (JPEG and PDF have no transparency; legacy did the same). */
export async function drawImage(file: Blob, whiteBackground: boolean): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('decode');
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    if (whiteBackground) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}
