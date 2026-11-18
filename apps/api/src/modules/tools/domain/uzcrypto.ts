/**
 * Latest Uzcrypto (ERI / E-imzo client) on the EDO vendor site. The site is an Angular app: its
 * index page loads `main-<hash>.js`, which contains the installer asset names
 * (`assets/uzcrypto-<version>-x32-setup.windows.zip`, `assets/uzcrypto-…macos….rar`).
 * Same lookup as legacy services/uzcryptoService.js, with the hosts pinned.
 */

export const UZCRYPTO_SITE = 'https://edo.ijro.uz/';
/** The only host the lookup and the download redirect may use. */
export const UZCRYPTO_HOST = 'edo.ijro.uz';
/** Legacy "EDO Welcome" page — where downloads go when nothing else is known. */
export const UZCRYPTO_WELCOME_URL = 'https://edo.ijro.uz/welcome';

/** Built-in values (the last version seen when this was written, 18.11.2026). */
export const UZCRYPTO_FALLBACK = {
  version: '2.2.4.24',
  windowsUrl: 'https://edo.ijro.uz/assets/uzcrypto-2.2.4.24-x32-setup.windows.zip',
  macosUrl: 'https://edo.ijro.uz/assets/uzcrypto-macos.rar',
} as const;

export interface UzcryptoAssets {
  version: string;
  windowsUrl: string;
  macosUrl: string;
}

/** `main-XXXX.js` referenced by the index page, as an absolute URL on the vendor host. */
export function findMainScriptUrl(indexHtml: string): string | null {
  const m = indexHtml.match(/src=["'](?:\.?\/)?(main-[A-Za-z0-9_-]+\.js)["']/i);
  return m ? new URL(m[1], UZCRYPTO_SITE).toString() : null;
}

/** Installer links found in the main bundle; null when the Windows installer is not mentioned. */
export function parseUzcryptoAssets(mainJs: string): UzcryptoAssets | null {
  const win = mainJs.match(/assets\/(uzcrypto-(\d+(?:\.\d+){1,4})-x32-setup\.windows\.zip)/i);
  if (!win) return null;
  const mac = mainJs.match(/assets\/(uzcrypto-[A-Za-z0-9._-]*macos[A-Za-z0-9._-]*\.rar)/i);
  return {
    version: win[2],
    windowsUrl: new URL(`assets/${win[1]}`, UZCRYPTO_SITE).toString(),
    macosUrl: mac ? new URL(`assets/${mac[1]}`, UZCRYPTO_SITE).toString() : UZCRYPTO_FALLBACK.macosUrl,
  };
}

/** Only https on the vendor host — guards both the lookup (redirects) and the download redirect. */
export function isVendorUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === UZCRYPTO_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}
