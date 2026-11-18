import type { ServerConvertSource } from '@cc/shared';

/**
 * Checks that an uploaded document really is what its extension says (magic numbers), and decodes
 * plain text. Pure functions — no Nest, no I/O.
 */

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF- (a PDF renamed to .txt is refused)
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (DOCX is a ZIP package)
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // OLE compound file (DOC)

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/** The PDF header may follow a little junk; readers accept it within the first 1024 bytes. */
function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= limit; i += 1) if (startsWith(bytes, PDF_MAGIC, i)) return true;
  return false;
}

/** Text files: no NUL bytes in the first 64 KB (UTF-16 with a BOM is accepted separately). */
function looksLikeText(bytes: Uint8Array): boolean {
  if (hasUtf16Bom(bytes)) return true;
  const end = Math.min(bytes.length, 64 * 1024);
  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return false;
  return true;
}

function hasUtf16Bom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/** True when the bytes match the declared document type. */
export function matchesSignature(source: ServerConvertSource, bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  switch (source) {
    case 'docx':
      return startsWith(bytes, ZIP_MAGIC);
    case 'doc':
      return startsWith(bytes, CFB_MAGIC);
    case 'txt':
      return looksLikeText(bytes) && !startsWith(bytes, ZIP_MAGIC) && !hasPdfHeader(bytes);
  }
}

/**
 * Plain text as the user most likely saved it: BOM-marked UTF-16/UTF-8, else UTF-8, else Windows-1251
 * (Cyrillic files from Notepad). Legacy read UTF-8 and silently dropped what it could not decode.
 */
export function decodeText(bytes: Uint8Array): string {
  const utf16 = hasUtf16Bom(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes.subarray(2));
  const body = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1251').decode(body);
  }
}
