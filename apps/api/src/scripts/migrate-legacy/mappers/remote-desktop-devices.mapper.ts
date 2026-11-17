import { countArray, notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `viewer/data/rustdesk_devices.json` → remote desktop devices table (stage 2, RustDesk list).
 * Copy the file into `--data-dir` as `rustdesk_devices.json`.
 *
 * TODO(stage 2):
 * - `[{ ext: string|null, ip: string|null, hostname, installed: bool, updatedAt: ISO }]`, deduplicated by ext,
 *   else by ip → `operator_ext`, `ip inet`, `hostname`, `installed`, `updated_at timestamptz`.
 * - Idempotency: insert-if-absent by ext (or ip when ext is null).
 */
export const remoteDesktopDevicesMapper = notImplementedMapper(
  { name: 'remote-desktop-devices', owner: 'stage 2' },
  { jsonFiles: [{ file: 'rustdesk_devices.json', count: countArray() }] },
);
