/**
 * A one-page PDF around a JPEG (DCTDecode — the JPEG bytes are embedded as they are). Page size is
 * the image at 100 dpi, like legacy (Pillow `save(..., 'PDF', resolution=100)`). No library needed.
 */
export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number, dpi = 100): Uint8Array<ArrayBuffer> {
  const w = +((widthPx * 72) / dpi).toFixed(2);
  const h = +((heightPx * 72) / dpi).toFixed(2);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let n = 1; n <= 5; n += 1) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
