import { describe, expect, it } from 'vitest';
import { pagesToText, textDocxParts } from './docx.js';

describe('textDocxParts', () => {
  it('escapes text, keeps tabs, breaks pages and drops characters XML forbids', () => {
    const xml = textDocxParts(['Salom\tdunyo <&>\n\nIkki\u0001', 'Sahifa 2'])['word/document.xml'];
    expect(xml).toContain('Salom</w:t><w:tab/><w:t xml:space="preserve">dunyo &lt;&amp;&gt;');
    expect(xml).toContain('<w:p/>');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('>Ikki<');
    expect(Object.keys(textDocxParts(['']))).toContain('[Content_Types].xml');
  });
});

describe('pagesToText', () => {
  it('adds page headers to pages with text', () => {
    expect(pagesToText(['  bir  ', '', 'uch'])).toBe('=== 1-sahifa ===\nbir\n\n=== 3-sahifa ===\nuch');
    expect(pagesToText(['', ' '])).toBe('(Matn topilmadi)');
  });
});
