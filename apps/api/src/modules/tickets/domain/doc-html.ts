import sanitizeHtml from 'sanitize-html';

/** Max size of a rendered preview; longer documents are cut (the full file can be downloaded). */
const MAX_HTML = 2 * 1024 * 1024;
const RASTER_DATA_URI = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;

/**
 * Strict allow-list for HTML produced by mammoth from an uploaded DOCX.
 * No scripts, styles, event handlers, iframes, forms or SVG; links open in a new tab without referrer;
 * embedded images only as raster data: URIs. The web client sanitizes again with DOMPurify.
 */
export function sanitizeDocHtml(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img',
    ],
    allowedAttributes: {
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !RASTER_DATA_URI.test(frame.attribs.src ?? ''),
  });
  return clean.length > MAX_HTML ? clean.slice(0, MAX_HTML) : clean;
}
