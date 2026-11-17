/**
 * Xavfsizlik uchun umumiy yordamchi funksiyalar.
 *
 * Qoida: foydalanuvchidan kelgan qiymat shell buyrug'i, SQL yoki HTML ichiga
 * faqat shu yerdagi funksiyalar orqali qo'yiladi.
 */
const crypto = require('crypto');

/**
 * POSIX shell uchun qiymatni bitta tirnoq ichiga xavfsiz o'rash.
 * Natijani `cmd ${shellQuote(x)}` ko'rinishida (qo'shimcha tirnoqsiz) ishlating.
 */
function shellQuote(value) {
    return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

/**
 * MySQL/MariaDB satr literali ichidagi qiymatni ekranlash (NO_BACKSLASH_ESCAPES o'chiq holat uchun).
 * Natija tirnoqsiz qaytadi: `WHERE src = '${sqlEscape(x)}'`.
 */
function sqlEscape(value) {
    return String(value ?? '').replace(/[\0\n\r\x1a\\'"]/g, (ch) => {
        switch (ch) {
            case '\0': return '\\0';
            case '\n': return '\\n';
            case '\r': return '\\r';
            case '\x1a': return '\\Z';
            default: return `\\${ch}`;
        }
    });
}

/** Asterisk ichki raqami (extension): faqat 2-6 ta raqam. */
function isExtension(value) {
    return /^[0-9]{2,6}$/.test(String(value ?? '').trim());
}

/** HTML matni yoki atribut qiymati uchun ekranlash. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Ikki satrni vaqt bo'yicha sizib chiqmaydigan tarzda solishtirish. */
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a ?? ''), 'utf8');
    const bufB = Buffer.from(String(b ?? ''), 'utf8');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/** Loopback (127.0.0.1 / ::1) manzilmi? */
function isLoopbackAddress(addr) {
    const ip = String(addr || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1';
}

/** Lokal / ichki tarmoq manzilimi (loopback, 10/8, 172.16/12, 192.168/16)? */
function isPrivateAddress(addr) {
    const ip = String(addr || '').replace(/^::ffff:/, '').trim();
    if (isLoopbackAddress(ip)) return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    return /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
}

/**
 * So'rov yuborgan mijozning haqiqiy IP manzili.
 * X-Forwarded-For / CF-Connecting-IP faqat ishonchli proksidan kelganda hisobga olinadi:
 *  - TRUSTED_PROXY_IPS (.env, vergul bilan) berilgan bo'lsa — faqat shu manzillar;
 *  - aks holda — loopback va ichki tarmoq manzillari (masalan Kerio Control reverse proxy).
 * Internetdan to'g'ridan-to'g'ri kelgan so'rov sarlavhasi bilan IP ni soxtalashtira olmaydi.
 */
function resolveClientIp(req) {
    if (!req) return '127.0.0.1';
    const socketIp = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
    const trustedList = String(process.env.TRUSTED_PROXY_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
    const fromTrustedProxy = trustedList.length > 0 ? trustedList.includes(socketIp) : isPrivateAddress(socketIp);
    if (fromTrustedProxy) {
        const forwarded = req.headers?.['x-forwarded-for'];
        if (forwarded) {
            const first = String(forwarded).split(',')[0].trim().replace(/^::ffff:/, '');
            if (first) return first;
        }
        const cfIp = req.headers?.['cf-connecting-ip'];
        if (cfIp) return String(cfIp).trim();
    }
    return socketIp;
}

module.exports = {
    isPrivateAddress,
    resolveClientIp,
    shellQuote,
    sqlEscape,
    isExtension,
    escapeHtml,
    safeEqual,
    isLoopbackAddress
};
