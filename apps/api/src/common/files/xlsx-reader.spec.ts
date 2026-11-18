import { crc32, deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { XlsxError, readFirstSheet } from './xlsx-reader.js';

/** Minimal zip writer (deflate) for hand-made workbooks. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** A workbook like the database tool's export: sheet before shared strings, no `r` on cells. */
function dbToolWorkbook(): Buffer {
  return zip({
    'xl/worksheets/sheet1.xml':
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>` +
      '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row>' +
      '<row><c t="s"><v>3</v></c><c><v>200836354</v></c><c t="s"><v>4</v></c></row>' +
      '<row><c t="inlineStr"><is><t>b2</t></is></c><c/><c t="s"><v>5</v></c></row>' +
      '<row/>' +
      '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${NS}"><sheetData><row><c t="inlineStr"><is><t>select …</t></is></c></row></sheetData></worksheet>`,
    '_rels/.rels': '<Relationships/>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/>' +
      '<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>',
    'xl/sharedStrings.xml':
      `<sst xmlns="${NS}" count="6" uniqueCount="6">` +
      '<si><t>id</t></si><si><t>tin</t></si><si><t>name_uz_latn</t></si><si><t>a1</t></si>' +
      '<si><r><t>“O’zmilliybank” </t></r><r><rPr><b/></rPr><t xml:space="preserve">AJ &amp; Co</t></r></si>' +
      '<si><t>Qoʻqon &#x41;&#66;</t><rPh><t>ignored</t></rPh></si></sst>',
    'xl/workbook.xml':
      `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<sheets><sheet name="Result 1" sheetId="1" r:id="rId1"/><sheet name="Query" sheetId="2" r:id="rId2"/></sheets></workbook>',
    '[Content_Types].xml': '<Types/>',
  });
}

describe('xlsx reader', () => {
  it('reads a database-tool export: no cell addresses, sheet before shared strings, rich text, entities', () => {
    expect(readFirstSheet(dbToolWorkbook())).toEqual([
      ['id', 'tin', 'name_uz_latn'],
      ['a1', '200836354', '“O’zmilliybank” AJ & Co'],
      ['b2', '', 'Qoʻqon AB'],
      [],
    ]);
  });

  it('reads an Excel-style file (cell addresses with gaps) written by ExcelJS', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Orgs');
    ws.addRow(['id', 'tin', 'name_uz_latn']);
    ws.getCell('A2').value = 'x1';
    ws.getCell('C2').value = 'Adliya vazirligi';
    ws.getCell('B3').value = 12345;
    ws.getCell('C3').value = { richText: [{ text: 'Rich ' }, { text: 'text' }] };
    wb.addWorksheet('Other').addRow(['no']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(readFirstSheet(buf)).toEqual([
      ['id', 'tin', 'name_uz_latn'],
      ['x1', '', 'Adliya vazirligi'],
      ['', '12345', 'Rich text'],
    ]);
  });

  it('rejects files that are not workbooks and oversized parts', () => {
    expect(() => readFirstSheet(Buffer.from('not a zip at all, just some text'))).toThrow(XlsxError);
    expect(() => readFirstSheet(zip({ 'a.txt': 'x' }))).toThrow('no worksheet');
    expect(() => readFirstSheet(dbToolWorkbook(), { maxPartBytes: 100 })).toThrow(XlsxError);
  });
});
