/**
 * Name of the converted file: the original base name (any language kept) + the new extension.
 * Characters that are not allowed in file names are replaced with "_" (legacy converterService rule).
 */
// oxlint-disable-next-line no-control-regex -- control characters are removed on purpose
const FORBIDDEN = /[/\\?%*:|"<>\u0000-\u001f\u007f-\u009f]/g;
const MAX_BASE_LENGTH = 120;

export function convertedFileName(originalName: string, target: string): string {
  let name = originalName;
  // Browsers send UTF-8 names; some clients percent-encode them.
  if (name.includes('%')) {
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep as is */
    }
  }
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // Leading dots would make a hidden file (".pdf" → "converted_file").
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(FORBIDDEN, '_').replace(/^\.+/, '').trim();
  const safe = [...(stem || 'converted_file')].slice(0, MAX_BASE_LENGTH).join('').trim();
  return `${safe || 'converted_file'}.${target}`;
}
