import {
  type ConvertTargetFormat,
  TOOLS_CONVERT_MAX_BYTES,
  convertTargetsFor,
  fileExtension,
  isServerConversion,
} from '@cc/shared';

/**
 * Where a conversion runs: the server (Word and text documents) or this browser (images; PDFs with
 * pdf.js — page images or the text layer — so the server never parses untrusted PDFs).
 */
export type ConversionMode = 'server' | 'image' | 'image-pdf' | 'pdf-images' | 'pdf-text';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

export function conversionMode(source: string, target: ConvertTargetFormat): ConversionMode | null {
  if (isServerConversion(source, target)) return 'server';
  if (IMAGE_EXTS.includes(source) && (target === 'png' || target === 'jpg' || target === 'webp')) return 'image';
  if (IMAGE_EXTS.includes(source) && target === 'pdf') return 'image-pdf';
  if (source === 'pdf' && (target === 'png' || target === 'jpg')) return 'pdf-images';
  if (source === 'pdf' && (target === 'txt' || target === 'docx')) return 'pdf-text';
  return null;
}

export type FileCheck =
  | { ok: true; ext: string; targets: readonly ConvertTargetFormat[] }
  | { ok: false; error: 'tooLarge' | 'unsupported' | 'empty' };

/** Legacy handleConverterFileSelected: ≤ 35 MB and one of PDF, DOCX, DOC, TXT, JPG, PNG, WEBP. */
export function checkFile(file: { name: string; size: number }): FileCheck {
  if (file.size > TOOLS_CONVERT_MAX_BYTES) return { ok: false, error: 'tooLarge' };
  if (file.size === 0) return { ok: false, error: 'empty' };
  const targets = convertTargetsFor(file.name);
  if (!targets.length) return { ok: false, error: 'unsupported' };
  return { ok: true, ext: fileExtension(file.name), targets };
}

/** "document.final.pdf" → "document.final" (legacy kept the name as is). */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName) || 'file';
}

/** Legacy formatConverterFileSize: 0 B, 512 B, 1.4 MB. */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0 || Number.isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Badge colors of the selected file (legacy: images amber, PDF red, Word blue, other purple). */
export function fileTone(ext: string): 'image' | 'pdf' | 'word' | 'other' {
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc') return 'word';
  return 'other';
}
