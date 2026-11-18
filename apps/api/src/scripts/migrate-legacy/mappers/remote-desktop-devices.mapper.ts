import { countArray, notMigratedMapper } from './not-implemented.js';

/**
 * Legacy `viewer/data/rustdesk_devices.json` (copy it into `--data-dir` as `rustdesk_devices.json`).
 * Not migrated — owner decision 2026-11-18 (docs/rewrite/DECISIONS.md, "Перенос данных legacy"):
 * the RustDesk PC list is dropped. The count stays in the report.
 */
export const remoteDesktopDevicesMapper = notMigratedMapper(
  { name: 'remote-desktop-devices', owner: 'stage 2' },
  { jsonFiles: [{ file: 'rustdesk_devices.json', count: countArray() }] },
  'owner decision 2026-11-18 — the RustDesk PC list is dropped',
);
