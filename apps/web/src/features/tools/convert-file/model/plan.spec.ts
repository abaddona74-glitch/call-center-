import { describe, expect, it } from 'vitest';
import { baseName, checkFile, conversionMode, fileTone, formatFileSize } from './plan';

describe('converter plan', () => {
  it('offers the legacy targets and rejects big or unknown files', () => {
    expect(checkFile({ name: 'a.PDF', size: 10 })).toEqual({
      ok: true,
      ext: 'pdf',
      targets: ['docx', 'png', 'jpg', 'txt'],
    });
    expect(checkFile({ name: 'scan.jpeg', size: 10 })).toMatchObject({ ok: true, targets: ['png', 'webp', 'pdf'] });
    expect(checkFile({ name: 'a.xlsx', size: 10 })).toEqual({ ok: false, error: 'unsupported' });
    expect(checkFile({ name: 'a.pdf', size: 35 * 1024 * 1024 + 1 })).toEqual({ ok: false, error: 'tooLarge' });
    expect(checkFile({ name: 'a.pdf', size: 0 })).toEqual({ ok: false, error: 'empty' });
  });

  it('sends Word/text documents to the server and keeps images and PDFs in the browser', () => {
    expect(conversionMode('docx', 'pdf')).toBe('server');
    expect(conversionMode('pdf', 'txt')).toBe('pdf-text'); // PDFs never go to the server
    expect(conversionMode('pdf', 'docx')).toBe('pdf-text');
    expect(conversionMode('doc', 'docx')).toBe('server');
    expect(conversionMode('png', 'jpg')).toBe('image');
    expect(conversionMode('jpeg', 'webp')).toBe('image');
    expect(conversionMode('webp', 'pdf')).toBe('image-pdf');
    expect(conversionMode('pdf', 'png')).toBe('pdf-images');
    expect(conversionMode('txt', 'png')).toBeNull();
  });

  it('formats names and sizes like legacy', () => {
    expect(baseName('hisobot.final.pdf')).toBe('hisobot.final');
    expect(baseName('.env')).toBe('.env');
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1.4 * 1024 * 1024)).toBe('1.4 MB');
    expect(fileTone('jpg')).toBe('image');
    expect(fileTone('doc')).toBe('word');
    expect(fileTone('txt')).toBe('other');
  });
});
