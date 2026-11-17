/**
 * RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 `filename*`.
 * Quotes, backslashes, control characters and path separators never reach the header.
 */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  // oxlint-disable-next-line no-control-regex -- rejecting control characters on purpose
  const clean = fileName.replace(/[\u0000-\u001f\u007f"\\/]+/g, '_').slice(0, 180) || 'file';
  const ascii = clean.replace(/[^\x20-\x7e]+/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
