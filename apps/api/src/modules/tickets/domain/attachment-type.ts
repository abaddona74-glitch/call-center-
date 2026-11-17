import type { TicketAttachmentKind } from '@cc/shared';

/**
 * Attachment allow-list by CONTENT (magic bytes), not by name or client MIME:
 * PNG, JPEG, GIF, WEBP, PDF, DOCX. SVG, HTML, scripts, legacy .doc and everything else are refused —
 * legacy stored `.html`/`.svg` uploads under the web root and served them same-origin (stored XSS).
 */
export interface DetectedType {
  kind: TicketAttachmentKind;
  mime: string;
  ext: string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Refuse DOCX files that expand to more than this (zip bombs). */
export const DOCX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Buffer, offset: number, text: string): boolean {
  return buf.length >= offset + text.length && buf.toString('latin1', offset, offset + text.length) === text;
}

export function detectAttachmentType(buf: Buffer): DetectedType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a')) return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (ascii(buf, 0, '%PDF-')) return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const zip = readZipDirectory(buf);
    if (
      zip &&
      zip.names.includes('[Content_Types].xml') &&
      zip.names.includes('word/document.xml') &&
      zip.uncompressedTotal <= DOCX_MAX_UNCOMPRESSED
    ) {
      return { kind: 'docx', mime: DOCX_MIME, ext: 'docx' };
    }
  }
  return null;
}

/**
 * Minimal ZIP central-directory reader: entry names and the declared uncompressed total.
 * Returns null for malformed archives and ZIP64 (not needed for Word documents).
 */
export function readZipDirectory(buf: Buffer): { names: string[]; uncompressedTotal: number } | null {
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  const minEocd = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > buf.length || count > 5000) return null;

  const names: string[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (uncompressed === 0xffffffff || p + 46 + nameLen > buf.length) return null;
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    total += uncompressed;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { names, uncompressedTotal: total };
}

/**
 * Display/download name: no directories, no control or quote characters, bounded length,
 * and the extension always matches the detected content (`evil.html` with PNG bytes → `evil.png`).
 */
export function safeAttachmentName(original: string, type: DetectedType): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize('NFC')
    // oxlint-disable-next-line no-control-regex -- rejecting control characters on purpose
    .replace(/[\u0000-\u001f\u007f"<>|:*?\\/]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${stem || 'file'}.${type.ext}`;
}
