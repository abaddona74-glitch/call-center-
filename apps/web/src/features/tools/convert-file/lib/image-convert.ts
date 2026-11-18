import { baseName } from '../model/plan';
import { type RasterFormat, canvasToBlob, drawImage } from './canvas';
import { jpegToPdf } from './jpeg-pdf';

export interface BrowserResult {
  blob: Blob;
  fileName: string;
}

/** Image → PNG / JPG / WEBP in the browser (legacy convertImageInBrowser: quality .95, white under JPEG). */
export async function convertImage(file: File, target: RasterFormat): Promise<BrowserResult> {
  const canvas = await drawImage(file, target === 'jpg');
  const blob = await canvasToBlob(canvas, target, 0.95);
  return { blob, fileName: `${baseName(file.name)}.${target}` };
}

/** Image → one-page PDF in the browser (legacy did this on the server with Pillow). */
export async function imageToPdf(file: File): Promise<BrowserResult> {
  const canvas = await drawImage(file, true);
  const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'jpg', 0.92)).arrayBuffer());
  const pdf = jpegToPdf(jpeg, canvas.width, canvas.height);
  return { blob: new Blob([pdf], { type: 'application/pdf' }), fileName: `${baseName(file.name)}.pdf` };
}
