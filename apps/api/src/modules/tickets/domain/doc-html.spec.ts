import { describe, expect, it } from 'vitest';
import { sanitizeDocHtml } from './doc-html.js';

describe('sanitizeDocHtml', () => {
  it('keeps document structure', () => {
    const html = '<h1>Title</h1><p><strong>bold</strong> <em>it</em></p><table><tr><td colspan="2">x</td></tr></table>';
    expect(sanitizeDocHtml(html)).toBe(
      '<h1>Title</h1><p><strong>bold</strong> <em>it</em></p><table><tr><td colspan="2">x</td></tr></table>',
    );
  });

  it('removes scripts, handlers, styles and dangerous URLs', () => {
    const out = sanitizeDocHtml(
      '<p onclick="x()" style="color:red">a</p><script>alert(1)</script><iframe src="//evil"></iframe>' +
        '<a href="javascript:alert(1)">j</a><svg onload="alert(1)"></svg><img src="https://evil/x.png" onerror="x">',
    );
    expect(out).toBe('<p>a</p><a rel="noopener noreferrer nofollow" target="_blank">j</a>');
  });

  it('allows raster data images and safe links only', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeDocHtml(`<img src="${png}" alt="a">`)).toBe(`<img src="${png}" alt="a" />`);
    expect(sanitizeDocHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe('');
    expect(sanitizeDocHtml('<a href="https://ok.uz">ok</a>')).toBe(
      '<a href="https://ok.uz" rel="noopener noreferrer nofollow" target="_blank">ok</a>',
    );
  });
});
