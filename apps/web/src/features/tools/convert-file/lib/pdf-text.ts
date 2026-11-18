import { pagesToText, textDocxParts } from '@cc/shared';
import { zipSync, strToU8 } from 'fflate';
import { baseName } from '../model/plan';
import type { BrowserResult } from './image-convert';
import { openPdf } from './pdfjs';

/** Text layer of every page (scanned pages have none), lines kept. */
async function pdfPages(file: File, onPage?: (done: number, total: number) => void): Promise<string[]> {
  const task = await openPdf(file);
  try {
    const doc = await task.promise.catch(() => {
      throw new Error('decode');
    });
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      }
      pages.push(text);
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** PDF → TXT (legacy layout "=== N-sahifa ==="), UTF-8 with a BOM and CRLF for Notepad. */
export async function pdfToText(file: File, onPage?: (done: number, total: number) => void): Promise<BrowserResult> {
  const text = pagesToText(await pdfPages(file, onPage)).replace(/\r?\n/g, '\r\n');
  return {
    blob: new Blob(['﻿', text], { type: 'text/plain;charset=utf-8' }),
    fileName: `${baseName(file.name)}.txt`,
  };
}

/** PDF → DOCX: the text of each page as paragraphs, a page break between pages (layout is not kept). */
export async function pdfToDocx(file: File, onPage?: (done: number, total: number) => void): Promise<BrowserResult> {
  const pages = (await pdfPages(file, onPage)).map((p) => p.trim());
  const parts = textDocxParts(pages);
  const zip = zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])),
  ) as Uint8Array<ArrayBuffer>;
  return {
    blob: new Blob([zip], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    fileName: `${baseName(file.name)}.docx`,
  };
}
