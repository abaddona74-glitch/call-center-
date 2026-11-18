import { decodeText, matchesSignature } from './document-input.js';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

describe('matchesSignature', () => {
  it('accepts real documents', () => {
    expect(matchesSignature('docx', bytes([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(true);
    expect(matchesSignature('doc', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe(true);
    expect(matchesSignature('txt', bytes('Salom, dunyo'))).toBe(true);
    expect(matchesSignature('txt', bytes([0xff, 0xfe, 0x41, 0x00]))).toBe(true); // UTF-16 with BOM
  });

  it('rejects a file whose content does not match its extension', () => {
    expect(matchesSignature('docx', bytes('%PDF-1.7'))).toBe(false);
    expect(matchesSignature('doc', bytes([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(matchesSignature('txt', bytes('MZ', [0, 0, 0]))).toBe(false); // a binary (NUL bytes)
    expect(matchesSignature('txt', bytes('%PDF-1.7 text'))).toBe(false);
    expect(matchesSignature('txt', bytes('\n\n%PDF-1.4'))).toBe(false); // PDF header after a little junk
    expect(matchesSignature('txt', new Uint8Array())).toBe(false);
  });
});

describe('decodeText', () => {
  it('reads UTF-8 (with or without BOM), UTF-16 and Windows-1251', () => {
    expect(decodeText(new Uint8Array(Buffer.from('Привет oʻzbek', 'utf8')))).toBe('Привет oʻzbek');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('BOM', 'utf8')]))).toBe('BOM');
    expect(decodeText(new Uint8Array([0xff, 0xfe, ...Buffer.from('Ўзб', 'utf16le')]))).toBe('Ўзб');
    // "Привет" in Windows-1251 is not valid UTF-8
    expect(decodeText(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]))).toBe('Привет');
  });
});
