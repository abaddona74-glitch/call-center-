import { UZCRYPTO_FALLBACK, findMainScriptUrl, isVendorUrl, parseUzcryptoAssets } from './uzcrypto.js';

describe('uzcrypto lookup parsing', () => {
  it('finds the main bundle on the index page', () => {
    const html =
      '<script src="polyfills-AYWKP32X.js" type="module"></script><script src="main-SQVHKFWX.js" type="module"></script>';
    expect(findMainScriptUrl(html)).toBe('https://edo.ijro.uz/main-SQVHKFWX.js');
    expect(findMainScriptUrl("<script src='./main-ab_C-1.js'>")).toBe('https://edo.ijro.uz/main-ab_C-1.js');
    expect(findMainScriptUrl('<script src="https://evil.example/main-x.js">')).toBeNull();
    expect(findMainScriptUrl('<html></html>')).toBeNull();
  });

  it('reads the installer names from the bundle', () => {
    const js = 'x=`assets/uzcrypto-2.3.0.1-x32-setup.windows.zip`;var y=`assets/uzcrypto-macos.rar`;';
    expect(parseUzcryptoAssets(js)).toEqual({
      version: '2.3.0.1',
      windowsUrl: 'https://edo.ijro.uz/assets/uzcrypto-2.3.0.1-x32-setup.windows.zip',
      macosUrl: 'https://edo.ijro.uz/assets/uzcrypto-macos.rar',
    });
    expect(parseUzcryptoAssets('assets/uzcrypto-2.2.4.24-x32-setup.windows.zip')?.macosUrl).toBe(
      UZCRYPTO_FALLBACK.macosUrl,
    );
    expect(parseUzcryptoAssets('nothing here')).toBeNull();
  });

  it('allows only https URLs on the vendor host', () => {
    expect(isVendorUrl('https://edo.ijro.uz/assets/x.zip')).toBe(true);
    expect(isVendorUrl('http://edo.ijro.uz/assets/x.zip')).toBe(false);
    expect(isVendorUrl('https://edo.ijro.uz.evil.example/x')).toBe(false);
    expect(isVendorUrl('https://user:pw@edo.ijro.uz/x')).toBe(false);
    expect(isVendorUrl('not a url')).toBe(false);
  });
});
