/**
 * Rate Limiting & Anti-DDoS / Flood Protection Service
 * Himoya xususiyatlari:
 * 1. Ichki ofis tarmoqlarini (192.168.*, 10.*, 127.0.0.1) avtomatik aniqlash va oq ro'yxatga olish (operatorlar bloklanmaydi)
 * 2. Tashqi IP-lar uchun API so'rovlarini cheklash (Sliding Window Rate Limiter)
 * 3. Kuchli hujum qilgan IP-larni avtomatik vaqtincha JALB QILISH (Jail / Auto-Ban)
 * 4. WebSocket ulanishlar soni cheklovi (Connection Exhaustion hujumlariga qarshi)
 * 5. Katta hajmli yuklamalar (Excel, ZIP, Auth) uchun maxsus cheklovlar
 */

class RateLimitService {
    constructor() {
        this.ipBuckets = new Map(); // ip:prefix -> { count, resetAt, violations }
        this.jailedIps = new Map(); // ip -> unjailAt (ms)
        this.activeWsConnections = new Map(); // ip -> count
        this.totalBlockedRequests = 0;

        // Har 60 soniyada eskirgan ma'lumotlarni tozalash (Xotira to'lib ketmasligi uchun)
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
     * IP ichki/lokal tarmoqqa tegishli ekanligini tekshirish
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
        const unjailAt = this.jailedIps.get(ip);
        if (!unjailAt) return false;

        if (Date.now() > unjailAt) {
            this.jailedIps.delete(ip);
            return false;
        }
        return true;
    }

    /**
     * Qamoqqa tashlash (Auto-Ban)
     */
    jailIp(ip, durationMs = 15 * 60 * 1000, reason = 'Excessive flooding') {
        if (this.isTrustedInternalIp(ip)) return; // Ichki ofis IP lar hech qachon bloklanmaydi
        const unjailAt = Date.now() + durationMs;
        this.jailedIps.set(ip, unjailAt);
        console.warn(`🚨 [SECURITY / ANTI-DDOS] IP vaqtincha bloklandi: ${ip} (${Math.round(durationMs / 60000)} daqiqa). Sabab: ${reason}`);
    }

    /**
     * Express Middleware yaratuvchisi
     */
    createLimiter(options = {}) {
        const {
            windowMs = 60 * 1000, // 1 daqiqa
            max = 120,             // Maksimal so'rovlar soni (tashqi IP lar uchun)
            internalMax = 1200,    // Ichki ofis IP lari uchun erkin limit
            message = "Juda ko'p so'rov yuborildi. Iltimos, bir oz kuting.",
            keyPrefix = 'api',
            autoJailMultiplier = 3 // Limiti 3 baravar oshirib yuborsa avtomatik bloklash
        } = options;

        return (req, res, next) => {
            const ip = this.getClientIp(req);

            // 1. Agar IP qamoqda bo'lsa darhol 429 berish
            if (this.isJailed(ip)) {
                this.totalBlockedRequests++;
                const unjailAt = this.jailedIps.get(ip);
                const retryAfter = Math.max(1, Math.ceil((unjailAt - Date.now()) / 1000));

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
                bucket.violations++;

                // Agar normadan haddan tashqari oshirib yuborsa (hujum belgisi)
                if (!isInternal && bucket.count >= (effectiveMax * autoJailMultiplier)) {
                    this.jailIp(ip, 15 * 60 * 1000, `Limit oshirib yuborildi: ${bucket.count}/${effectiveMax} [${keyPrefix}]`);
                }

                const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
                res.setHeader('Retry-After', retryAfter);

                return res.status(429).json({
                    success: false,
                    error: message,
                    retryAfterSeconds: retryAfter
                });
            }

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
        for (const [ip, unjailAt] of this.jailedIps.entries()) {
            if (now > unjailAt) {
                this.jailedIps.delete(ip);
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
     * Xavfsizlik statistikasi
     */
    getStats() {
        const jailedList = [];
        const now = Date.now();
        for (const [ip, unjailAt] of this.jailedIps.entries()) {
            jailedList.push({
                ip,
                remainingSeconds: Math.max(0, Math.ceil((unjailAt - now) / 1000))
            });
        }

        return {
            totalBlockedRequests: this.totalBlockedRequests,
            activeTrackedIps: this.ipBuckets.size,
            jailedIpsCount: this.jailedIps.size,
            jailedIps: jailedList,
            activeWsPerIp: Object.fromEntries(this.activeWsConnections)
        };
    }
}

module.exports = new RateLimitService();
