import { z } from 'zod';

/**
 * "Tools" section (legacy viewer tools zones): links, installers, the managers directory and the
 * universal file converter. Page access: `tools.view`; the converter (and other extra tools that
 * legacy hid from the "200" group): `tools.use`, switched off per operator group by `canUseTools`.
 */

// --- converter ----------------------------------------------------------------------------------

/** Upload limit of the converter (legacy: 35 MB), checked by the browser and by the server. */
export const TOOLS_CONVERT_MAX_BYTES = 35 * 1024 * 1024;

export const CONVERT_SOURCE_FORMATS = ['pdf', 'docx', 'doc', 'txt', 'jpg', 'jpeg', 'png', 'webp'] as const;
export type ConvertSourceFormat = (typeof CONVERT_SOURCE_FORMATS)[number];

export const CONVERT_TARGET_FORMATS = ['pdf', 'docx', 'txt', 'png', 'jpg', 'webp'] as const;
export type ConvertTargetFormat = (typeof CONVERT_TARGET_FORMATS)[number];

/** Target formats offered for each source (legacy `formatMap`, the first one is preselected). */
export const CONVERT_TARGETS: Readonly<Record<ConvertSourceFormat, readonly ConvertTargetFormat[]>> = {
  pdf: ['docx', 'png', 'jpg', 'txt'],
  docx: ['pdf', 'txt'],
  doc: ['docx', 'pdf', 'txt'],
  txt: ['pdf', 'docx'],
  jpg: ['png', 'webp', 'pdf'],
  jpeg: ['png', 'webp', 'pdf'],
  png: ['jpg', 'webp', 'pdf'],
  webp: ['png', 'jpg', 'pdf'],
};

/**
 * Documents the server converts (Word and text). Everything else runs in the browser: images (canvas)
 * and PDF sources (pdf.js — text layer or page images), so the server never parses untrusted PDFs.
 */
export const SERVER_CONVERT_SOURCES = ['docx', 'doc', 'txt'] as const;
export type ServerConvertSource = (typeof SERVER_CONVERT_SOURCES)[number];
export const SERVER_CONVERT_TARGETS = ['pdf', 'docx', 'txt'] as const;
export const ServerConvertTargetSchema = z.enum(SERVER_CONVERT_TARGETS);
export type ServerConvertTarget = z.infer<typeof ServerConvertTargetSchema>;

/** Lower-case extension of a file name without the dot ('' when there is none). */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function isConvertSource(ext: string): ext is ConvertSourceFormat {
  return (CONVERT_SOURCE_FORMATS as readonly string[]).includes(ext);
}

export function convertTargetsFor(fileName: string): readonly ConvertTargetFormat[] {
  const ext = fileExtension(fileName);
  return isConvertSource(ext) ? CONVERT_TARGETS[ext] : [];
}

/** True when this pair is converted by the server (`POST /api/tools/convert`). */
export function isServerConversion(source: string, target: string): boolean {
  return (
    (SERVER_CONVERT_SOURCES as readonly string[]).includes(source) &&
    (SERVER_CONVERT_TARGETS as readonly string[]).includes(target) &&
    isConvertSource(source) &&
    (CONVERT_TARGETS[source] as readonly string[]).includes(target)
  );
}

/**
 * `POST /api/tools/convert` — multipart/form-data: `file` (≤ 35 MB) and `target`.
 * The response is the converted file itself (Content-Disposition: attachment).
 */
export const ConvertRequestSchema = z.object({ target: ServerConvertTargetSchema });
export type ConvertRequest = z.infer<typeof ConvertRequestSchema>;

// --- configuration, Uzcrypto, downloads -----------------------------------------------------------

/** `GET /api/tools/config` — tool links that depend on the installation. */
export const ToolsConfigSchema = z.object({
  /** Telegram Form dashboard (a separate app); null = not configured, the card shows that. */
  telegramFormUrl: z.url().nullable(),
});
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;

/** `GET /api/tools/uzcrypto` — the latest Uzcrypto version published on edo.ijro.uz. */
export const UzcryptoInfoSchema = z.object({
  version: z.string(),
  windowsUrl: z.url(),
  macosUrl: z.url(),
  /** When the vendor site was last read successfully (null = never, built-in fallback values). */
  checkedAt: z.iso.datetime({ offset: true }).nullable(),
  /** The vendor site could not be read; the values are the last known (or built-in) ones. */
  stale: z.boolean(),
});
export type UzcryptoInfo = z.infer<typeof UzcryptoInfoSchema>;

/** `GET /api/tools/uzcrypto/download?os=` — 302 to the vendor file. */
export const UzcryptoDownloadQuerySchema = z.object({
  os: z.enum(['windows', 'macos']).default('windows'),
});
export type UzcryptoDownloadQuery = z.infer<typeof UzcryptoDownloadQuerySchema>;

/** Files the API serves for download (`GET /api/tools/files/:name`). */
export const TOOL_FILES = ['uzb2026-klaviatura.zip'] as const;
export const ToolFileNameSchema = z.enum(TOOL_FILES);
export type ToolFileName = z.infer<typeof ToolFileNameSchema>;

// --- managers directory (legacy tools/managers.html) ----------------------------------------------

export const ManagersTashkentEntrySchema = z.object({
  org: z.string(),
  name: z.string(),
  phone: z.string(),
  /** The city contracts department: highlighted row + banner. */
  isSpecial: z.boolean(),
});
export const ManagersMinistryEntrySchema = z.object({
  name: z.string(),
  phone: z.string(),
  ministries: z.array(z.string()),
});
export const ManagersRegionEntrySchema = z.object({
  region: z.string(),
  lead: z.string(),
  leadPhone: z.string(),
  extraPhone: z.string().nullable(),
  offices: z.array(z.string()),
  head: z.string(),
  headPhone: z.string().nullable(),
});
export const ManagersExatEntrySchema = z.object({
  title: z.string(),
  org: z.string(),
  desc: z.string(),
  phone: z.string(),
});

/** `GET /api/tools/managers` — responsible staff and E-XAT support (reference data, read-only). */
export const ManagersDirectorySchema = z.object({
  tashkent: z.array(ManagersTashkentEntrySchema),
  ministries: z.array(ManagersMinistryEntrySchema),
  regions: z.array(ManagersRegionEntrySchema),
  exat: z.array(ManagersExatEntrySchema),
});
export type ManagersDirectory = z.infer<typeof ManagersDirectorySchema>;
export type ManagersTashkentEntry = z.infer<typeof ManagersTashkentEntrySchema>;
export type ManagersMinistryEntry = z.infer<typeof ManagersMinistryEntrySchema>;
export type ManagersRegionEntry = z.infer<typeof ManagersRegionEntrySchema>;
export type ManagersExatEntry = z.infer<typeof ManagersExatEntrySchema>;
