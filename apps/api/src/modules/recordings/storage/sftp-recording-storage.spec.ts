import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../config/app-config.js';
import type { RealtimeService } from '../../realtime/realtime.service.js';
import { StorageUnavailableError } from './recording-storage.port.js';
import { SftpRecordingStorage, hostKeyFingerprint } from './sftp-recording-storage.js';

function storage(env: Record<string, unknown>, production: boolean) {
  const config = { get: (k: string) => env[k], isProduction: production } as unknown as AppConfig;
  const realtime = { broadcast: vi.fn() } as unknown as RealtimeService;
  return new SftpRecordingStorage(config, realtime);
}

const configured = {
  SFTP_HOST: '192.0.2.10',
  SFTP_PORT: 22,
  SFTP_USER: 'cc_recordings',
  SFTP_PRIVATE_KEY_PATH: '/run/secrets/sftp_recordings_key',
  SFTP_MONITOR_PATH: '/monitor',
};

describe('SftpRecordingStorage host key pinning', () => {
  it('refuses to connect in production without a pinned host key (no network attempt)', async () => {
    const s = storage(configured, true);
    expect(s.configured).toBe(true);
    await expect(s.list('')).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(s.isConnected()).toBe(false);
  });

  it('is simply unavailable when SFTP is not configured', async () => {
    const s = storage({ SFTP_MONITOR_PATH: '/monitor' }, false);
    expect(s.configured).toBe(false);
    await expect(s.stat('2026/11/17/a.wav')).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('computes OpenSSH-style SHA256 fingerprints', () => {
    // sha256("") base64 without padding
    expect(hostKeyFingerprint(Buffer.alloc(0))).toBe('SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU');
  });
});
