import { describe, expect, it } from 'vitest';
import { jpegToPdf } from './jpeg-pdf';

describe('jpegToPdf', () => {
  it('writes a one-page PDF with the JPEG embedded and a correct xref', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pdf = jpegToPdf(jpeg, 200, 100);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 144 72]'); // 200×100 px at 100 dpi
    expect(text).toContain('/Filter /DCTDecode /Length 9');
    // every xref offset points at "n 0 obj"
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5);
    entries.forEach((off, i) => expect(text.slice(off, off + 7)).toBe(`${i + 1} 0 obj`));
    // the image bytes are there unchanged
    const at = pdf.findIndex((b, i) => b === 0xff && pdf[i + 1] === 0xd8);
    expect([...pdf.subarray(at, at + jpeg.length)]).toEqual([...jpeg]);
  });
});
