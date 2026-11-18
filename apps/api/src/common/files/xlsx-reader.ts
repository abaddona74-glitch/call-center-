import { inflateRawSync } from 'node:zlib';

/**
 * A small .xlsx reader for imports: the first worksheet as rows of cell text.
 *
 * Why not ExcelJS: exports made by database tools (e.g. the organization registry, 18.11.2026) omit the
 * cell addresses (`<c r="A1">`), which ExcelJS requires. This reader takes a cell's column from `r` when
 * present and from its position otherwise. It handles shared strings, inline strings, numbers, booleans
 * and rich text; styles, dates as numbers and formulas (cached values are read) need nothing more here.
 */

export class XlsxError extends Error {}

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new XlsxError('ZIP64 files are not supported');
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new XlsxError('Broken zip directory');
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, {
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

function readEntry(buf: Buffer, entries: Map<string, ZipEntry>, name: string, maxBytes: number): string | null {
  const e = entries.get(name);
  if (!e) return null;
  if (e.size > maxBytes) throw new XlsxError(`${name} is too large`);
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== LOCAL) throw new XlsxError('Broken zip entry');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString('utf8');
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes }).toString('utf8');
  throw new XlsxError(`Unsupported zip compression (${e.method})`);
}

const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(ENTITY, (_, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
    if (named) return NAMED[named.toLowerCase()] ?? '';
    const code = hex ? Number.parseInt(hex, 16) : Number(dec);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** Text of `<t>` runs, without phonetic hints (`<rPh>`). */
function runsText(xml: string): string {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of plain.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ?? '';
  return unescapeXml(out);
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
}

/** "AB12" → 27 (0-based column). */
function columnOf(ref: string): number | null {
  const letters = /^([A-Z]+)\d*$/i.exec(ref)?.[1];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function firstSheetPath(workbook: string | null, rels: string | null): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  const sheet = workbook ? /<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] : undefined;
  const rid = sheet ? (attr(sheet, 'r:id') ?? /\sr:id="([^"]*)"|\s\w+:id="([^"]*)"/.exec(sheet)?.[1]) : undefined;
  if (!rid || !rels) return fallback;
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = m[1] ?? '';
    if (attr(a, 'Id') !== rid) continue;
    const target = attr(a, 'Target');
    if (!target) break;
    return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  return fallback;
}

export interface XlsxReadOptions {
  /** Largest uncompressed part (sheet / shared strings) accepted; guards against zip bombs. */
  maxPartBytes?: number;
}

/** Rows of the first worksheet; each row is an array of cell text ('' for empty cells). */
export function readFirstSheet(buf: Buffer, opts: XlsxReadOptions = {}): string[][] {
  const max = opts.maxPartBytes ?? 200 * 1024 * 1024;
  const entries = zipEntries(buf);
  const path = firstSheetPath(
    readEntry(buf, entries, 'xl/workbook.xml', max),
    readEntry(buf, entries, 'xl/_rels/workbook.xml.rels', max),
  );
  const sheet = readEntry(buf, entries, path, max);
  if (sheet === null) throw new XlsxError('The workbook has no worksheet');

  const sharedXml = readEntry(buf, entries, 'xl/sharedStrings.xml', max);
  const shared: string[] = [];
  if (sharedXml) for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(runsText(m[1] ?? ''));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    let pos = -1;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const body = cm[2] ?? '';
      const ref = attr(attrs, 'r');
      const col = ref !== undefined ? columnOf(ref) : null;
      pos = col ?? pos + 1;
      const type = attr(attrs, 't') ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = v !== undefined ? (shared[Number(v)] ?? '') : '';
      else if (type === 'inlineStr') text = runsText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') text = v === '1' ? 'true' : v === '0' ? 'false' : '';
      else text = v !== undefined ? unescapeXml(v) : '';
      while (cells.length < pos) cells.push('');
      cells[pos] = text;
    }
    rows.push(cells);
  }
  return rows;
}
