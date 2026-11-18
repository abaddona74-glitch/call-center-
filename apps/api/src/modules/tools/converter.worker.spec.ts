import JSZip from 'jszip';
// Test-only (devDependency): reads the text layer of the PDFs we generate. The API never parses PDFs.
import { extractText, getDocumentProxy } from 'unpdf';
import { ConvertError, convert, docxToPdf, imageSize, textPagesToDocx } from './converter.worker.js';

async function pdfPages(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return (await extractText(doc, { mergePages: false })).text;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// 1×1 transparent PNG
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A small DOCX like the ones operators convert ("маълумотнома" with a 2-column tab row and a table). */
async function sampleDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const p = (text: string, bold = false) =>
    `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>` +
      p('МАЪЛУМОТНОМА', true) +
      '<w:p><w:r><w:t>Tug‘ilgan yili:</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>1990</w:t></w:r></w:p>' +
      p('Oddiy matn oʻzbekcha') +
      `<w:tbl><w:tr>${cell('Yil')}${cell('Lavozim')}</w:tr><w:tr>${cell('2015')}${cell('Operator')}</w:tr></w:tbl>` +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('converter engine', () => {
  it('builds a valid DOCX from text pages (escaping, tabs, page breaks)', async () => {
    const docx = await textPagesToDocx(['Salom\tdunyo <&>\n\nIkkinchi qator', 'Ikkinchi sahifa']);
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Salom</w:t><w:tab/><w:t xml:space="preserve">dunyo &lt;&amp;&gt;');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('Ikkinchi sahifa');
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    // and it reads back as text
    expect(new TextDecoder().decode(await convert({ source: 'docx', target: 'txt', bytes: docx }))).toContain(
      'Ikkinchi sahifa',
    );
  });

  it('converts DOCX to PDF keeping text, the tab row and the table', async () => {
    const pdf = await docxToPdf(await sampleDocx());
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const text = (await pdfPages(pdf)).join('\n');
    expect(text).toContain('МАЪЛУМОТНОМА');
    expect(text).toContain('1990');
    expect(text).toContain('Operator');
    expect(text).toContain('o‘zbekcha'); // ʻ is drawn as ‘ (Roboto has no U+02BB)
  }, 20_000);

  it('converts text to PDF (Cyrillic, ʻ) and a legacy .doc text to DOCX/PDF paths', async () => {
    const pdf = await convert({ source: 'txt', target: 'pdf', text: 'Birinchi qator\nПривет мир\nOʻzbekiston' });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const text = (await pdfPages(pdf)).join('\n');
    expect(text).toContain('Привет мир');
    expect(text).toContain('O‘zbekiston');
    const txt = await convert({ source: 'docx', target: 'txt', bytes: await textPagesToDocx(['Bir']) });
    expect([...txt.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for old Notepad
  });

  it('rejects damaged files and unknown pairs', async () => {
    await expect(convert({ source: 'doc', target: 'txt', bytes: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({
      reason: 'unreadable',
    });
    await expect(
      convert({ source: 'docx', target: 'pdf', bytes: new Uint8Array([0x50, 0x4b, 3, 4]) }),
    ).rejects.toBeInstanceOf(ConvertError);
    await expect(convert({ source: 'txt', target: 'txt' as never })).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('reads PNG and JPEG sizes, ignores other images', () => {
    expect(imageSize(PNG_1x1)).toEqual({ width: 1, height: 1 });
    expect(imageSize('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBeNull();
    expect(imageSize('data:image/jpeg;base64,AAAA')).toBeNull();
  });
});
