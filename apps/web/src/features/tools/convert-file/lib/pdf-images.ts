import { zipSync } from 'fflate';
import { baseName } from '../model/plan';
import { canvasToBlob } from './canvas';
import type { BrowserResult } from './image-convert';
import { openPdf } from './pdfjs';

const DPI = 200; // legacy converter.py: page.get_pixmap(dpi=200)

/**
 * PDF pages → PNG / JPG, rendered by pdf.js in this browser (loaded only when needed). One page gives
 * one image; more pages give a ZIP with `sahifa_01.png`, … like legacy (`<name>_sahifalar.zip`).
 */
export async function pdfToImages(
  file: File,
  target: 'png' | 'jpg',
  onPage?: (done: number, total: number) => void,
): Promise<BrowserResult> {
  const task = await openPdf(file);
  const doc = await task.promise.catch(() => {
    throw new Error('decode');
  });
  try {
    const images: Uint8Array<ArrayBuffer>[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      images.push(new Uint8Array(await (await canvasToBlob(canvas, target, 0.92)).arrayBuffer()));
      page.cleanup();
      canvas.width = 0; // release the bitmap memory early
      onPage?.(n, doc.numPages);
    }
    if (!images.length) throw new Error('empty');
    const base = baseName(file.name);
    const mime = target === 'png' ? 'image/png' : 'image/jpeg';
    if (images.length === 1) return { blob: new Blob([images[0]], { type: mime }), fileName: `${base}.${target}` };
    const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
    images.forEach((bytes, i) => {
      entries[`sahifa_${String(i + 1).padStart(2, '0')}.${target}`] = [bytes, { level: 0 }];
    });
    const zip = zipSync(entries) as Uint8Array<ArrayBuffer>;
    return { blob: new Blob([zip], { type: 'application/zip' }), fileName: `${base}_sahifalar.zip` };
  } finally {
    await task.destroy();
  }
}
