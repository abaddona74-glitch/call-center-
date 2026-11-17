import { describe, expect, it } from 'vitest';
import { HTML_XSS, PDF_MIN, PNG_1PX, SVG_XSS, docx, paragraph, plainZip } from '../../../../test/fixtures/files.js';
import { detectAttachmentType, readZipDirectory, safeAttachmentName } from './attachment-type.js';

describe('detectAttachmentType', () => {
  it('accepts images, PDF and DOCX by content', async () => {
    expect(detectAttachmentType(PNG_1PX)?.mime).toBe('image/png');
    expect(detectAttachmentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(detectAttachmentType(Buffer.from('GIF89a......'))?.mime).toBe('image/gif');
    expect(detectAttachmentType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))?.mime).toBe('image/webp');
    expect(detectAttachmentType(PDF_MIN)?.kind).toBe('pdf');
    expect(detectAttachmentType(await docx(paragraph('Salom')))?.kind).toBe('docx');
  });

  it('refuses SVG, HTML, plain zips, text and empty files', async () => {
    expect(detectAttachmentType(SVG_XSS)).toBeNull();
    expect(detectAttachmentType(HTML_XSS)).toBeNull();
    expect(detectAttachmentType(await plainZip())).toBeNull();
    expect(detectAttachmentType(Buffer.from('just text'))).toBeNull();
    expect(detectAttachmentType(Buffer.alloc(0))).toBeNull();
    // legacy .doc (OLE2 compound file)
    expect(detectAttachmentType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBeNull();
  });

  it('refuses truncated zips', async () => {
    const full = await docx(paragraph('x'));
    expect(detectAttachmentType(full.subarray(0, full.length - 30))).toBeNull();
  });
});

describe('readZipDirectory', () => {
  it('lists entries and sizes', async () => {
    const dir = readZipDirectory(await docx(paragraph('abc')));
    expect(dir?.names).toContain('word/document.xml');
    expect(dir?.uncompressedTotal).toBeGreaterThan(0);
  });
});

describe('safeAttachmentName', () => {
  const png = { kind: 'image' as const, mime: 'image/png', ext: 'png' };
  it('forces the detected extension and strips paths and specials', () => {
    expect(safeAttachmentName('evil.html', png)).toBe('evil.png');
    expect(safeAttachmentName('../../etc/passwd', png)).toBe('passwd.png');
    expect(safeAttachmentName('C:\\Users\\a\\shot "1".PNG', png)).toBe('shot _1_.png');
    expect(safeAttachmentName('', png)).toBe('file.png');
    expect(safeAttachmentName('Скриншот 2026.png', png)).toBe('Скриншот 2026.png');
  });
});
