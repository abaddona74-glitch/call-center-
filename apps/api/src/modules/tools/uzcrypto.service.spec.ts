import type { AppConfig } from '../../config/app-config.js';
import { UZCRYPTO_FALLBACK, UZCRYPTO_WELCOME_URL } from './domain/uzcrypto.js';
import { UzcryptoService, type VendorFetch } from './uzcrypto.service.js';

const INDEX = '<script src="main-ABC123.js" type="module"></script>';
const MAIN = 'a=`assets/uzcrypto-2.3.1.0-x32-setup.windows.zip`;b=`assets/uzcrypto-2.3-macos.rar`';

function setup(fetchText: VendorFetch, lookup = true) {
  const config = { get: (k: string) => (k === 'TOOLS_UZCRYPTO_LOOKUP' ? lookup : undefined) } as unknown as AppConfig;
  return new UzcryptoService(config, fetchText);
}

describe('UzcryptoService', () => {
  it('reads the latest version from the vendor site and caches it for an hour', async () => {
    const fetchText = vi.fn<VendorFetch>(async (url) => (url.endsWith('main-ABC123.js') ? MAIN : INDEX));
    const svc = setup(fetchText);
    const t0 = new Date('2026-11-18T10:00:00Z');
    const info = await svc.latest(t0);
    expect(info).toMatchObject({
      version: '2.3.1.0',
      windowsUrl: 'https://edo.ijro.uz/assets/uzcrypto-2.3.1.0-x32-setup.windows.zip',
      macosUrl: 'https://edo.ijro.uz/assets/uzcrypto-2.3-macos.rar',
      checkedAt: t0.toISOString(),
      stale: false,
    });
    expect(fetchText.mock.calls.map((c) => c[0])).toEqual([
      'https://edo.ijro.uz/',
      'https://edo.ijro.uz/main-ABC123.js',
    ]);

    await svc.latest(new Date('2026-11-18T10:59:00Z'));
    expect(fetchText).toHaveBeenCalledTimes(2); // cached
    await svc.latest(new Date('2026-11-18T11:01:00Z'));
    expect(fetchText).toHaveBeenCalledTimes(4); // refreshed after an hour
  });

  it('keeps the last known version when the site fails, and retries only after 5 minutes', async () => {
    let up = true;
    const fetchText = vi.fn<VendorFetch>(async (url) => {
      if (!up) throw new Error('timeout');
      return url.endsWith('.js') ? MAIN : INDEX;
    });
    const svc = setup(fetchText);
    await svc.latest(new Date('2026-11-18T10:00:00Z'));
    up = false;
    const later = await svc.latest(new Date('2026-11-18T11:30:00Z'));
    expect(later).toMatchObject({ version: '2.3.1.0', stale: true });
    const calls = fetchText.mock.calls.length;
    await svc.latest(new Date('2026-11-18T11:32:00Z'));
    expect(fetchText.mock.calls.length).toBe(calls); // backoff
  });

  it('falls back to the built-in version when the site was never read', async () => {
    const svc = setup(async () => '<html>changed layout</html>');
    expect(await svc.latest()).toMatchObject({ ...UZCRYPTO_FALLBACK, checkedAt: null, stale: true });
  });

  it('does not go to the internet when the lookup is off', async () => {
    const fetchText = vi.fn<VendorFetch>();
    const svc = setup(fetchText, false);
    expect(await svc.latest()).toMatchObject({ version: UZCRYPTO_FALLBACK.version });
    expect(await svc.downloadUrl('windows')).toBe(UZCRYPTO_FALLBACK.windowsUrl);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('never redirects outside the vendor host', async () => {
    const svc = setup(async (url) => (url.endsWith('.js') ? 'assets/uzcrypto-1.0-x32-setup.windows.zip' : INDEX));
    expect(await svc.downloadUrl('windows')).toBe('https://edo.ijro.uz/assets/uzcrypto-1.0-x32-setup.windows.zip');
    expect(UZCRYPTO_WELCOME_URL).toBe('https://edo.ijro.uz/welcome');
  });
});
