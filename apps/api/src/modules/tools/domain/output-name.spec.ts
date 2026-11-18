import { convertedFileName } from './output-name.js';

describe('convertedFileName', () => {
  it('keeps the name (any language) and swaps the extension', () => {
    expect(convertedFileName('Маълумотнома Алиев.docx', 'pdf')).toBe('Маълумотнома Алиев.pdf');
    expect(convertedFileName('report.v2.PDF', 'docx')).toBe('report.v2.docx');
    expect(convertedFileName('noext', 'txt')).toBe('noext.txt');
  });

  it('drops paths and characters not allowed in file names', () => {
    expect(convertedFileName('../../etc/passwd.txt', 'pdf')).toBe('passwd.pdf');
    expect(convertedFileName('C:\\Users\\a\\b:c*d?.doc', 'pdf')).toBe('b_c_d_.pdf');
    expect(convertedFileName('a\u0000b\nc.txt', 'pdf')).toBe('a_b_c.pdf');
  });

  it('decodes percent-encoded names and falls back when nothing is left', () => {
    expect(convertedFileName('%D0%90%D0%BA%D1%82.pdf', 'txt')).toBe('Акт.txt');
    expect(convertedFileName('.pdf', 'txt')).toBe('pdf.txt'); // no hidden files
    expect(convertedFileName('', 'txt')).toBe('converted_file.txt');
    expect(convertedFileName('???.pdf', 'txt')).toBe('___.txt');
    expect(convertedFileName(`${'я'.repeat(300)}.txt`, 'pdf')).toBe(`${'я'.repeat(120)}.pdf`);
  });
});
