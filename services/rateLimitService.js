/**
 * Rate Limiting & Anti-DDoS / Flood Protection Service (V2.0 Pro)
 * Cloudflare-Style Security Engine:
 * 1. Ichki ofis tarmoqlarini (192.168.*, 10.*, 127.0.0.1) avtomatik aniqlash va oq ro'yxatga olish (operatorlar bloklanmaydi)
 * 2. Tashqi IP-lar uchun API so'rovlarini cheklash (Sliding Window Rate Limiter)
 * 3. Kuchli hujum qilgan IP-larni avtomatik vaqtincha QAMOQQA OLISH (Auto-Jail / Auto-Ban)
 * 4. WebSocket ulanishlar soni cheklovi (Connection Exhaustion hujumlariga qarshi)
 * 5. Katta hajmli yuklamalar (Excel, ZIP, Auth) uchun maxsus cheklovlar
 * 6. Cloudflare-style Live Analytics: Real-time Time-series Graph & Live Threat Event Log
 */

class RateLimitService {
    constructor() {
        this.ipBuckets = new Map(); // ip:prefix -> { count, resetAt, violations }
        this.jailedIps = new Map(); // ip -> { unjailAt, reason, jailTime }
        this.activeWsConnections = new Map(); // ip -> count

        // Umumiy hisoblagichlar
        this.totalRequests = 0;
        this.totalPassedRequests = 0;
        this.totalBlockedRequests = 0;

        // Cloudflare-Style vaqtli oqim tarixi (Har 5 soniyada 1 ta nuqta, jami 30 ta nuqta = 2.5 daqiqa jonli grafik)
        this.history = [];
        this.currentWindowPassed = 0;
        this.currentWindowBlocked = 0;

        // Boshlang'ich bo'sh 20 ta nuqtani to'ldiramiz (grafik darhol chiroyli chiqishi uchun)
        const now = Date.now();
        for (let i = 20; i >= 1; i--) {
            const t = new Date(now - i * 5000);
            const timeStr = t.toTimeString().split(' ')[0];
            this.history.push({ time: timeStr, passed: 0, blocked: 0, jailed: 0 });
        }

        // Jonli xavflar va bloklash voqealari ro'yxati (Oxirgi 30 ta)
        this.recentEvents = [];

        // Har 5 soniyada grafik nuqtasini surish (Ticker)
        const tickerTimer = setInterval(() => this.tickHistory(), 5000);
        if (tickerTimer.unref) tickerTimer.unref();

        // Har 60 soniyada eskirgan xotira ma'lumotlarini tozalash
        const cleanupTimer = setInterval(() => this.cleanup(), 60000);
        if (cleanupTimer.unref) cleanupTimer.unref();
    }

    /**
     * Mijozning haqiqiy IP manzilini aniqlash
     */
    getClientIp(req) {
        if (!req) return '127.0.0.1';

        // Cloudflare orqali kelsa
        const cfIp = req.headers?.['cf-connecting-ip'];
        if (cfIp) return cfIp.trim();

        // X-Forwarded-For sarlavhasi
        const xForwarded = req.headers?.['x-forwarded-for'];
        if (xForwarded) {
            const parts = xForwarded.split(',');
            if (parts.length > 0 && parts[0].trim()) {
                return parts[0].trim().replace(/^::ffff:/, '');
            }
        }

        // To'g'ridan-to'g'ri soket IP
        let ip = req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
        return ip.replace(/^::ffff:/, '');
    }

    /**
     * IP ichki/lokal ofis tarmog'iga tegishli ekanligini tekshirish
     */
    isTrustedInternalIp(ip) {
        if (!ip) return true;
        const cleanIp = ip.replace(/^::ffff:/, '').trim();

        // Localhost
        if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') return true;

        // Private IP Ranges (RFC 1918)
        // 192.168.0.0 - 192.168.255.255 (Ofis ichki tarmog'i)
        if (cleanIp.startsWith('192.168.')) return true;

        // 10.0.0.0 - 10.255.255.255
        if (cleanIp.startsWith('10.')) return true;

        // 172.16.0.0 - 172.31.255.255
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)) return true;

        return false;
    }

    /**
     * IP hozir qamoqda (vaqtincha bloklangan) ekanligini tekshirish
     */
    isJailed(ip) {
        const item = this.jailedIps.get(ip);
        if (!item) return false;

        if (Date.now() > item.unjailAt) {
            this.jailedIps.delete(ip);
            this.addEvent(ip, 'ALL', 'UNJAILED', '15 daqiqalik jazo muddati tugadi');
            return false;
        }
        return true;
    }

    /**
     * Qamoqqa tashlash (Auto-Ban)
     */
    jailIp(ip, durationMs = 15 * 60 * 1000, reason = 'Limitdan oshirib yuborilgan soxta flood') {
        if (this.isTrustedInternalIp(ip)) return; // Ichki ofis IP lar hech qachon bloklanmaydi
        const unjailAt = Date.now() + durationMs;
        this.jailedIps.set(ip, { unjailAt, reason, jailTime: Date.now() });
        this.addEvent(ip, 'ALL', 'JAILED', `${Math.round(durationMs / 60000)} daqiqa bloklandi (${reason})`);
        console.warn(`🚨 [SECURITY / ANTI-DDOS] IP vaqtincha bloklandi: ${ip} (${Math.round(durationMs / 60000)} daqiqa). Sabab: ${reason}`);
    }

    /**
     * IP ni qamoqdan chiqarish (Manual Unjail)
     */
    unjailIp(ip) {
        if (this.jailedIps.has(ip)) {
            this.jailedIps.delete(ip);
            this.addEvent(ip, 'ALL', 'UNJAILED', 'Administrator tomonidan qamoqdan chiqarildi');
            return true;
        }
        return false;
    }

    /**
     * Voqealar ro'yxatiga qo'shish
     */
    addEvent(ip, path, status, details) {
        const timeStr = new Date().toTimeString().split(' ')[0];
        this.recentEvents.unshift({
            id: 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            time: timeStr,
            timestamp: Date.now(),
            ip,
            path: path || '/',
            status, // 'PASSED' | 'BLOCKED' | 'JAILED' | 'UNJAILED'
            details
        });

        // Faqat oxirgi 40 ta voqeani saqlaymiz
        if (this.recentEvents.length > 40) {
            this.recentEvents.pop();
        }
    }

    /**
     * Har 5 soniyada grafik nuqtasini saqlash
     */
    tickHistory() {
        const timeStr = new Date().toTimeString().split(' ')[0];
        this.history.push({
            time: timeStr,
            passed: this.currentWindowPassed,
            blocked: this.currentWindowBlocked,
            jailed: this.jailedIps.size
        });

        // 30 ta nuqtadan oshsa eskilarini o'chirish
        if (this.history.length > 30) {
            this.history.shift();
        }

        // Yangi oraliq hisoblagichlarini nollash
        this.currentWindowPassed = 0;
        this.currentWindowBlocked = 0;
    }

    /**
     * Express Middleware yaratuvchisi
     */
    createLimiter(options = {}) {
        const {
            windowMs = 60 * 1000,
            max = 120,
            internalMax = 1200,
            message = "Juda ko'p so'rov yuborildi. Iltimos, bir oz kuting.",
            keyPrefix = 'api',
            autoJailMultiplier = 3
        } = options;

        return (req, res, next) => {
            this.totalRequests++;
            const ip = this.getClientIp(req);
            const reqPath = req.originalUrl || req.url || '';

            // 1. Agar IP qamoqda bo'lsa darhol 429 berish
            if (this.isJailed(ip)) {
                this.totalBlockedRequests++;
                this.currentWindowBlocked++;
                const item = this.jailedIps.get(ip);
                const retryAfter = item ? Math.max(1, Math.ceil((item.unjailAt - Date.now()) / 1000)) : 60;

                this.addEvent(ip, reqPath, 'BLOCKED', `Qamoqdagi IP so'rovi to'xtatildi (${retryAfter}s qoldi)`);

                res.setHeader('Retry-After', retryAfter);
                res.setHeader('X-Security-Jail', 'active');
                return res.status(429).json({
                    success: false,
                    error: "Xavfsizlik tizimi: IP-manzil shubhali faollik sababli vaqtincha cheklandi.",
                    retryAfterSeconds: retryAfter
                });
            }

            const isInternal = this.isTrustedInternalIp(ip);
            const effectiveMax = isInternal ? internalMax : max;
            const now = Date.now();
            const bucketKey = `${keyPrefix}:${ip}`;

            let bucket = this.ipBuckets.get(bucketKey);
            if (!bucket || now > bucket.resetAt) {
                bucket = {
                    count: 1,
                    resetAt: now + windowMs,
                    violations: bucket ? bucket.violations : 0
                };
                this.ipBuckets.set(bucketKey, bucket);
            } else {
                bucket.count++;
            }

            // Headers
            res.setHeader('X-RateLimit-Limit', effectiveMax);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, effectiveMax - bucket.count));
            res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

            // Agar limitdan oshsa
            if (bucket.count > effectiveMax) {
                this.totalBlockedRequests++;
                this.currentWindowBlocked++;
                bucket.violations++;

                const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
                this.addEvent(ip, reqPath, 'BLOCKED', `Limit oshdi: ${bucket.count}/${effectiveMax} so'rov [${keyPrefix}]`);

                // Agar normadan haddan tashqari oshirib yuborsa (hujum belgisi)
                if (!isInternal && bucket.count >= (effectiveMax * autoJailMultiplier)) {
                    this.jailIp(ip, 15 * 60 * 1000, `Haddan ortiq flood: ${bucket.count}/${effectiveMax} [${keyPrefix}]`);
                }

                res.setHeader('Retry-After', retryAfter);
                return res.status(429).json({
                    success: false,
                    error: message,
                    retryAfterSeconds: retryAfter
                });
            }

            // Muvaffaqiyatli o'tgan so'rov
            this.totalPassedRequests++;
            this.currentWindowPassed++;

            next();
        };
    }

    /**
     * WebSocket ulanishlarini tekshirish (Connection Flood Guard)
     */
    canAcceptWebSocket(req) {
        const ip = this.getClientIp(req);
        if (this.isJailed(ip)) return false;

        const isInternal = this.isTrustedInternalIp(ip);
        if (isInternal) return true; // Ofis ichki ulanishlariga cheklov yo'q

        const currentActive = this.activeWsConnections.get(ip) || 0;
        const MAX_CONCURRENT_WS = 15; // Bitta tashqi IP dan maksimum 15 ta faol WS

        if (currentActive >= MAX_CONCURRENT_WS) {
            this.totalBlockedRequests++;
            this.currentWindowBlocked++;
            this.addEvent(ip, '/ws', 'BLOCKED', `Ko'p parallel WebSocket: ${currentActive}/${MAX_CONCURRENT_WS}`);
            console.warn(`⚠️ [ANTI-DDOS] WebSocket ulanish limiti oshdi: IP ${ip} (${currentActive}/${MAX_CONCURRENT_WS})`);
            return false;
        }

        return true;
    }

    trackWsConnection(req) {
        const ip = this.getClientIp(req);
        const current = this.activeWsConnections.get(ip) || 0;
        this.activeWsConnections.set(ip, current + 1);
    }

    releaseWsConnection(req) {
        const ip = this.getClientIp(req);
        const current = this.activeWsConnections.get(ip) || 0;
        if (current <= 1) {
            this.activeWsConnections.delete(ip);
        } else {
            this.activeWsConnections.set(ip, current - 1);
        }
    }

    /**
     * Eskirgan xotira yozuvlarini tozalash
     */
    cleanup() {
        const now = Date.now();

        // Jailed IP larni tozalash
        for (const [ip, item] of this.jailedIps.entries()) {
            if (now > item.unjailAt) {
                this.jailedIps.delete(ip);
                this.addEvent(ip, 'ALL', 'UNJAILED', 'Jazo muddati tugadi');
            }
        }

        // Buckets tozalash
        for (const [key, bucket] of this.ipBuckets.entries()) {
            if (now > bucket.resetAt) {
                this.ipBuckets.delete(key);
            }
        }
    }

    /**
     * Xavfsizlik statistikasi (Cloudflare-style Live Analytics)
     */
    getStats() {
        const jailedList = [];
        const now = Date.now();
        for (const [ip, item] of this.jailedIps.entries()) {
            jailedList.push({
                ip,
                reason: item.reason,
                jailedAt: item.jailTime,
                remainingSeconds: Math.max(0, Math.ceil((item.unjailAt - now) / 1000))
            });
        }

        return {
            totalRequests: this.totalRequests,
            passedRequests: this.totalPassedRequests,
            blockedRequests: this.totalBlockedRequests,
            jailedIpsCount: this.jailedIps.size,
            jailedIps: jailedList,
            activeTrackedIps: this.ipBuckets.size,
            activeWsPerIp: Object.fromEntries(this.activeWsConnections),
            history: this.history,
            recentEvents: this.recentEvents
        };
    }
}

module.exports = new RateLimitService();
