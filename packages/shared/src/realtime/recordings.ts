import type { ZipJob } from '../recordings.js';

/** Recordings events: SFTP link state (admins) and ZIP job progress (job owner only). */
export interface RecordingsServerEvents {
  'recordings.status': { connected: boolean };
  'recordings.zipJob': ZipJob;
}
