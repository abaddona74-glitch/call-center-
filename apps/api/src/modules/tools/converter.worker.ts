/**
 * Document conversion, run in a worker thread by ConverterService (one worker per conversion, with
 * a heap limit and a hard timeout; terminated afterwards). Pure JavaScript libraries only — no
 * shell, no external programs, nothing written to disk: bytes in, bytes out.
 *
 *   docx → pdf | txt       mammoth (DOCX → semantic HTML) → pdfmake layout, like legacy converter.py
 *   doc  → docx | pdf | txt text of the legacy Word file (word-extractor)
 *   txt  → pdf | docx
 * PDF sources are converted in the browser (pdf.js), so the server never parses untrusted PDFs.
 *
 * This file must stay self-contained (npm packages and node: builtins only, erasable TypeScript):
 * when the API runs from sources (e2e tests) Node loads it as .ts with type stripping.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { type ChildNode, type Element, isTag, isText } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { textDocxParts } from '@cc/shared';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

export type WorkerSource = 'docx' | 'doc' | 'txt';
export type WorkerTarget = 'pdf' | 'docx' | 'txt';

export interface ConvertJob {
  source: WorkerSource;
  target: WorkerTarget;
  /** File bytes (docx / doc). */
  bytes?: Uint8Array;
  /** Already decoded text (txt). */
  text?: string;
}

export type ConvertFailure = 'unreadable' | 'unsupported' | 'failed';
export type ConvertReply = { ok: true; bytes: Uint8Array } | { ok: false; reason: ConvertFailure; detail: string };

export class ConvertError extends Error {
  readonly reason: ConvertFailure;
  constructor(reason: ConvertFailure, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

// --- PDF output (pdfmake) -------------------------------------------------------------------------

/** pdfmake ships no types; its document definition is plain JSON. */
type Content = any;

const require = createRequire(import.meta.url);
interface PdfMake {
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (p: string) => boolean): void;
  createPdf(doc: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
}
let pdfmakeInstance: PdfMake | null = null;

/** pdfmake with Roboto (Latin + Cyrillic) and no network / file access except the font files. */
function pdfmake(): PdfMake {
  if (pdfmakeInstance) return pdfmakeInstance;
  const pm = require('pdfmake') as PdfMake;
  const fonts = require('pdfmake/fonts/Roboto') as { Roboto: Record<string, string> };
  const allowed = new Set(Object.values(fonts.Roboto).map((p) => path.resolve(p)));
  pm.addFonts(fonts);
  pm.setUrlAccessPolicy(() => false);
  pm.setLocalAccessPolicy((p) => allowed.has(path.resolve(p)));
  pdfmakeInstance = pm;
  return pm;
}

const PAGE_CONTENT_WIDTH = 595.28 - 72; // A4 minus 36 pt margins (legacy: 523 pt)

/** Roboto has no U+02BB (Uzbek oʻ / gʻ); U+2018 looks the same on paper. */
export function pdfText(s: string): string {
  return s.replace(/\u02bb/g, '\u2018');
}

async function renderPdf(content: Content[], defaultStyle: Record<string, unknown>): Promise<Uint8Array> {
  const doc = {
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 36],
    content: content.length ? content : [{ text: "(Bo'sh hujjat)" }],
    defaultStyle: { font: 'Roboto', color: '#0f172a', ...defaultStyle },
    styles: {
      title: { fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 6] },
      subtitle: { fontSize: 11.5, bold: true, margin: [0, 6, 0, 4] },
    },
    info: { producer: 'Call Center converter', creator: 'Call Center converter' },
  };
  // A copy: Node's Buffer may sit in a shared pool, which cannot be transferred to the parent.
  return new Uint8Array(await pdfmake().createPdf(doc).getBuffer());
}

/** Plain text → PDF (legacy convert_txt_to_pdf: 10 pt, 14 pt leading, blank line = 6 pt gap). */
export function textToPdf(text: string): Promise<Uint8Array> {
  const content: Content[] = [];
  for (const raw of splitLines(text)) {
    const line = pdfText(raw.trim());
    content.push(line ? { text: line, margin: [0, 0, 0, 2] } : { text: '', margin: [0, 6, 0, 0] });
  }
  if (!content.some((c) => c.text)) return renderPdf([{ text: "(Bo'sh matn)" }], { fontSize: 10, lineHeight: 1.3 });
  return renderPdf(content, { fontSize: 10, lineHeight: 1.3 });
}

// --- DOCX → PDF -----------------------------------------------------------------------------------

const TITLE_WORDS = ['маълумотнома', 'резюме'];
const SUBTITLE_WORDS = ['меҳнат фаолияти', 'маълумот', 'яқин'];

interface Run {
  text: string;
  bold?: boolean;
  italics?: boolean;
  decoration?: 'underline';
}

/** Width/height of a PNG or JPEG data URI (pdfmake embeds only these); null for anything else. */
export function imageSize(dataUri: string): { width: number; height: number } | null {
  const m = dataUri.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (m[1].toLowerCase() === 'png') {
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = bytes.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

/** An image block sized like legacy: at most the content width, at most 350 pt high. */
function imageBlock(src: string, maxW = PAGE_CONTENT_WIDTH, maxH = 350): Content | null {
  const size = imageSize(src);
  if (!size || !size.width || !size.height) return null;
  let width = Math.min(size.width, maxW);
  let height = size.height * (width / size.width);
  if (height > maxH) {
    height = maxH;
    width = size.width * (maxH / size.height);
  }
  return { image: src, width, height, margin: [0, 0, 0, 4] };
}

function collectInline(node: ChildNode, style: Omit<Run, 'text'>, runs: Run[], images: string[]): void {
  if (isText(node)) {
    if (node.data) runs.push({ text: pdfText(node.data), ...style });
    return;
  }
  if (!isTag(node)) return;
  const tag = node.name;
  if (tag === 'br') {
    runs.push({ text: '\n', ...style });
    return;
  }
  if (tag === 'img') {
    const src = node.attribs.src;
    if (src) images.push(src);
    return;
  }
  const next = { ...style };
  if (tag === 'strong' || tag === 'b') next.bold = true;
  if (tag === 'em' || tag === 'i') next.italics = true;
  if (tag === 'u') next.decoration = 'underline';
  for (const child of node.children) collectInline(child, next, runs, images);
}

function textOf(runs: Run[]): string {
  return runs.map((r) => r.text).join('');
}

const tabRowLayout = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 6,
  paddingTop: () => 1,
  paddingBottom: () => 1,
};

/** One paragraph (p / h1–h6) → pdfmake blocks, with the legacy heading heuristics and tab rows. */
function paragraphBlocks(el: Element): Content[] {
  const runs: Run[] = [];
  const images: string[] = [];
  for (const child of el.children) collectInline(child, {}, runs, images);
  const out: Content[] = [];
  for (const src of images) {
    const img = imageBlock(src);
    if (img) out.push(img);
  }
  const raw = textOf(runs);
  const text = raw.trim();
  if (!text) {
    if (!images.length) out.push({ text: '', margin: [0, 3, 0, 0] });
    return out;
  }
  const lower = text.toLowerCase();
  const short = text.length <= 120;
  if (el.name === 'h1' || (short && TITLE_WORDS.some((w) => lower.includes(w)))) {
    out.push({ text, style: 'title' });
  } else if (/^h[2-6]$/.test(el.name) || (short && SUBTITLE_WORDS.some((w) => lower.includes(w)))) {
    out.push({ text, style: 'subtitle' });
  } else if (raw.includes('\t')) {
    const cols = raw
      .split('\t')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length >= 2) {
      const widths = cols.length === 2 ? [175, 235] : cols.map(() => PAGE_CONTENT_WIDTH / cols.length);
      out.push({ table: { widths, body: [cols.map((c) => ({ text: c }))] }, layout: tabRowLayout });
    } else {
      out.push({ text: cols[0] ?? text, margin: [0, 0, 0, 2] });
    }
  } else {
    out.push({ text: runs.map((r) => ({ ...r })), margin: [0, 0, 0, 2] });
  }
  return out;
}

function listBlock(el: Element): Content {
  const items: Content[] = [];
  for (const li of el.children) {
    if (!isTag(li) || li.name !== 'li') continue;
    const runs: Run[] = [];
    const nested: Content[] = [];
    for (const child of li.children) {
      if (isTag(child) && (child.name === 'ul' || child.name === 'ol')) nested.push(listBlock(child));
      else if (isTag(child) && child.name === 'p') {
        for (const c of child.children) collectInline(c, {}, runs, []);
      } else collectInline(child, {}, runs, []);
    }
    const text = textOf(runs).trim();
    items.push(nested.length ? { stack: [text, ...nested] } : text);
  }
  return el.name === 'ol' ? { ol: items, margin: [0, 0, 0, 4] } : { ul: items, margin: [0, 0, 0, 4] };
}

function cellContent(cell: Element): Content {
  const lines: string[] = [];
  const images: string[] = [];
  const walk = (nodes: ChildNode[]) => {
    for (const n of nodes) {
      if (isTag(n) && (n.name === 'p' || /^h[1-6]$/.test(n.name) || n.name === 'li')) {
        const runs: Run[] = [];
        for (const c of n.children) collectInline(c, {}, runs, images);
        lines.push(textOf(runs).trim());
      } else if (isTag(n) && n.name === 'img') {
        if (n.attribs.src) images.push(n.attribs.src);
      } else if (isTag(n)) walk(n.children);
      else if (isText(n) && n.data.trim()) lines.push(pdfText(n.data.trim()));
    }
  };
  walk(cell.children);
  const stack: Content[] = [];
  for (const src of images) {
    const img = imageBlock(src, 60, 75);
    if (img) stack.push(img);
  }
  const text = lines.filter(Boolean).join('\n');
  if (text) stack.push({ text });
  if (!stack.length) return { text: '' };
  return stack.length === 1 ? stack[0] : { stack };
}

/** HTML table (with col/row spans) → pdfmake table with the legacy grid style. */
function tableBlock(table: Element): Content | null {
  const rows: Element[] = [];
  const findRows = (nodes: ChildNode[]) => {
    for (const n of nodes) {
      if (!isTag(n)) continue;
      if (n.name === 'tr') rows.push(n);
      else if (n.name !== 'table') findRows(n.children);
    }
  };
  findRows(table.children);
  if (!rows.length) return null;

  const grid: Content[][] = [];
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of tr.children) {
      if (!isTag(cell) || (cell.name !== 'td' && cell.name !== 'th')) continue;
      while (grid[r][c] !== undefined) c += 1;
      const colSpan = Math.max(1, Math.min(50, Number(cell.attribs.colspan) || 1));
      const rowSpan = Math.max(1, Math.min(rows.length - r, Number(cell.attribs.rowspan) || 1));
      const content = cellContent(cell);
      if (colSpan > 1) content.colSpan = colSpan;
      if (rowSpan > 1) content.rowSpan = rowSpan;
      for (let dr = 0; dr < rowSpan; dr += 1) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < colSpan; dc += 1) grid[r + dr][c + dc] = dr === 0 && dc === 0 ? content : {};
      }
      c += colSpan;
    }
  });
  const cols = Math.max(...grid.map((row) => row.length));
  if (!cols) return null;
  const body = grid.map((row) => Array.from({ length: cols }, (_, i) => row[i] ?? { text: '' }));
  const widths =
    cols === 5 ? [0.14, 0.23, 0.21, 0.19, 0.23].map((f) => PAGE_CONTENT_WIDTH * f - 8) : body[0].map(() => '*');
  return {
    table: { widths, body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#94a3b8',
      vLineColor: () => '#94a3b8',
      fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f1f5f9' : null),
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 6, 0, 6],
  };
}

function blocksOf(nodes: ChildNode[]): Content[] {
  const out: Content[] = [];
  for (const n of nodes) {
    if (!isTag(n)) {
      if (isText(n) && n.data.trim()) out.push({ text: pdfText(n.data.trim()) });
      continue;
    }
    if (n.name === 'p' || /^h[1-6]$/.test(n.name)) out.push(...paragraphBlocks(n));
    else if (n.name === 'table') {
      const t = tableBlock(n);
      if (t) out.push(t);
    } else if (n.name === 'ul' || n.name === 'ol') out.push(listBlock(n));
    else if (n.name === 'img') {
      const img = n.attribs.src ? imageBlock(n.attribs.src) : null;
      if (img) out.push(img);
    } else out.push(...blocksOf(n.children));
  }
  return out;
}

const MAMMOTH_STYLE_MAP = ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"];

export async function docxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const { value: html } = await mammoth
    .convertToHtml({ buffer: Buffer.from(bytes) }, { styleMap: MAMMOTH_STYLE_MAP, ignoreEmptyParagraphs: false })
    .catch((e: unknown) => {
      throw new ConvertError('unreadable', `docx: ${(e as Error).message}`);
    });
  const dom = parseDocument(html);
  return renderPdf(blocksOf(dom.children), { fontSize: 9.5, lineHeight: 1.3 });
}

// --- text extraction ------------------------------------------------------------------------------

export async function docxToText(bytes: Uint8Array): Promise<string> {
  try {
    return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } catch (e) {
    throw new ConvertError('unreadable', `docx: ${(e as Error).message}`);
  }
}

export async function docToText(bytes: Uint8Array): Promise<string> {
  try {
    const doc = await new WordExtractor().extract(Buffer.from(bytes));
    return doc.getBody();
  } catch (e) {
    throw new ConvertError('unreadable', `doc: ${(e as Error).message}`);
  }
}

// --- DOCX output ----------------------------------------------------------------------------------

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Minimal WordprocessingML package (@cc/shared textDocxParts): a paragraph per line, page breaks. */
export async function textPagesToDocx(pages: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, xml] of Object.entries(textDocxParts(pages))) zip.file(name, xml);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** UTF-8 with a BOM, so old Notepad versions open Cyrillic correctly. */
function utf8WithBom(text: string): Uint8Array {
  const body = new TextEncoder().encode(text.replace(/\r?\n/g, '\r\n'));
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

// --- dispatcher -----------------------------------------------------------------------------------

export async function convert(job: ConvertJob): Promise<Uint8Array> {
  const bytes = job.bytes ?? new Uint8Array();
  const key = `${job.source}>${job.target}`;
  switch (key) {
    case 'docx>pdf':
      return docxToPdf(bytes);
    case 'docx>txt':
      return utf8WithBom(await docxToText(bytes));
    case 'doc>txt':
      return utf8WithBom(await docToText(bytes));
    case 'doc>docx':
      return textPagesToDocx([await docToText(bytes)]);
    case 'doc>pdf':
      return textToPdf(await docToText(bytes));
    case 'txt>pdf':
      return textToPdf(job.text ?? '');
    case 'txt>docx':
      return textPagesToDocx([job.text ?? '']);
    default:
      throw new ConvertError('unsupported', key);
  }
}

// Started by ConverterService only (workerData marker): importing this file elsewhere has no effect.
const port = parentPort;
if (port && (workerData as { ccConverter?: boolean } | null)?.ccConverter === true) {
  port.once('message', (job: ConvertJob) => {
    convert(job).then(
      (bytes) => {
        const reply: ConvertReply = { ok: true, bytes };
        port.postMessage(reply, [bytes.buffer as ArrayBuffer]);
      },
      (e: unknown) => {
        const reply: ConvertReply =
          e instanceof ConvertError
            ? { ok: false, reason: e.reason, detail: e.message }
            : { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
        port.postMessage(reply);
      },
    );
  });
}
