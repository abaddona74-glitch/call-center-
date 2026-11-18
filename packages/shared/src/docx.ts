/**
 * A minimal WordprocessingML (.docx) package from plain text: one paragraph per line, tabs kept,
 * a page break between pages. Returns the package parts (path → XML); the caller zips them
 * (the API with JSZip, the browser with fflate). Pure string building — no I/O.
 */

// oxlint-disable-next-line no-control-regex -- characters XML 1.0 does not allow
const INVALID_XML = /[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu;

function xmlText(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraph(line: string): string {
  if (!line) return '<w:p/>';
  const parts = line.split('\t').map((p) => `<w:t xml:space="preserve">${xmlText(p)}</w:t>`);
  return `<w:p><w:r>${parts.join('<w:tab/>')}</w:r></w:p>`;
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function textDocxParts(pages: readonly string[]): Record<string, string> {
  const body = pages.map((page) => page.replace(/\r\n?/g, '\n').split('\n').map(paragraph).join('')).join(PAGE_BREAK);
  return {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/_rels/document.xml.rels':
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'word/styles.xml':
      `${XML}<w:styles xmlns:w="${W_NS}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>' +
      '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>',
    'word/document.xml':
      `${XML}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>',
  };
}

/** Legacy convert_pdf_to_txt layout: "=== N-sahifa ===" before each page that has text. */
export function pagesToText(pages: readonly string[]): string {
  const parts = pages.map((t, i) => (t.trim() ? `=== ${i + 1}-sahifa ===\n${t.trim()}` : '')).filter(Boolean);
  return parts.length ? parts.join('\n\n') : '(Matn topilmadi)';
}
