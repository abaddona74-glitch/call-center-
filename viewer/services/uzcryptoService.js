const https = require('https');

let cachedInfo = null;
let lastFetchedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 soat kesh

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { rejectUnauthorized: false, timeout: 7000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchText(res.headers.location));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function resolveLatestUzcrypto(force = false) {
    const now = Date.now();
    if (!force && cachedInfo && (now - lastFetchedAt < CACHE_TTL_MS)) {
        return cachedInfo;
    }

    try {
        const html = await fetchText('https://edo.ijro.uz/');
        const mainMatch = html.match(/src=["'](main-[a-zA-Z0-9_-]+\.js)["']/i);
        if (!mainMatch) {
            throw new Error('main.js fayli topilmadi');
        }

        const mainJs = await fetchText('https://edo.ijro.uz/' + mainMatch[1]);
        const zipMatch = mainJs.match(/assets\/(uzcrypto-([0-9.]+)-x32-setup\.windows\.zip)/i);
        const macMatch = mainJs.match(/assets\/(uzcrypto-[a-zA-Z0-9._-]*macos[a-zA-Z0-9._-]*\.rar)/i);

        const filename = zipMatch ? zipMatch[1] : 'uzcrypto-2.2.4.24-x32-setup.windows.zip';
        const version = zipMatch ? zipMatch[2] : '2.2.4.24';
        const windowsUrl = `https://edo.ijro.uz/assets/${filename}`;
        const macosUrl = macMatch ? `https://edo.ijro.uz/assets/${macMatch[1]}` : 'https://edo.ijro.uz/assets/uzcrypto-macos.rar';

        cachedInfo = {
            success: true,
            version: version,
            filename: filename,
            windowsUrl: windowsUrl,
            macosUrl: macosUrl,
            updatedAt: new Date().toISOString()
        };
        lastFetchedAt = now;
        return cachedInfo;
    } catch (err) {
        if (cachedInfo) return cachedInfo;
        return {
            success: true,
            version: '2.2.4.24',
            filename: 'uzcrypto-2.2.4.24-x32-setup.windows.zip',
            windowsUrl: 'https://edo.ijro.uz/assets/uzcrypto-2.2.4.24-x32-setup.windows.zip',
            macosUrl: 'https://edo.ijro.uz/assets/uzcrypto-macos.rar',
            fallback: true,
            updatedAt: new Date().toISOString()
        };
    }
}

module.exports = {
    resolveLatestUzcrypto
};
