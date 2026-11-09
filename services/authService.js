/**
 * Authentication & Brute-force Protection Service
 * Features:
 * - Secure password hashing with scrypt
 * - SQLite persistent sessions (7 days)
 * - Persistent brute-force lockout (5 failed attempts = 1 hour IP/User ban)
 * - HTTP-only secure cookie session management
 */

const crypto = require('crypto');
const path = require('path');
const dbService = require('./dbService');

class AuthService {
    constructor() {
        this.db = null;
        this.LOCKOUT_THRESHOLD = 5; // 5 xato urinish
        this.LOCKOUT_DURATION_MS = 60 * 60 * 1000; // 1 soat (60 daqiqa)
        this.SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun
    }

    init() {
        if (!dbService.db) {
            console.error('❌ AuthService: dbService bazasi hali ulanmagan');
            return;
        }
        this.db = dbService.db;

        // 1. Foydalanuvchilar jadvali
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS auth_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT DEFAULT 'superuser',
                operator_id TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_auth_users_username ON auth_users(username);

            -- 2. Faol sessiyalar jadvali
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                ip TEXT,
                user_agent TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                expires_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

            -- 3. Brute-force va Lockout (Bloklash) jadvali
            CREATE TABLE IF NOT EXISTS auth_lockouts (
                key TEXT PRIMARY KEY, -- IP yoki username
                failed_count INTEGER DEFAULT 0,
                locked_until TEXT,
                last_attempt TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_auth_lockouts_key ON auth_lockouts(key);

            -- 4. Tizim sozlamalari (System Settings) jadvali
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            -- 5. Parolni tiklash (Password Resets) jadvali
            CREATE TABLE IF NOT EXISTS auth_password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                expires_at INTEGER NOT NULL,
                reset_token TEXT,
                used INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_auth_password_resets_user ON auth_password_resets(username);
            CREATE INDEX IF NOT EXISTS idx_auth_password_resets_token ON auth_password_resets(reset_token);

            -- 6. Email tasdiqlash (Email Verifications) jadvali
            CREATE TABLE IF NOT EXISTS auth_email_verifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                expires_at INTEGER NOT NULL,
                used INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_auth_email_verifications_user ON auth_email_verifications(username);
        `);

        // Migration: Mavjud auth_users jadvalida operator_id va email ustunlari bo'lmasa, qo'shamiz
        try {
            const tableCols = this.db.prepare("PRAGMA table_info(auth_users)").all();
            const hasOpId = tableCols && tableCols.some(c => c.name === 'operator_id');
            if (!hasOpId) {
                this.db.exec("ALTER TABLE auth_users ADD COLUMN operator_id TEXT;");
                console.log("✅ auth_users jadvaliga 'operator_id' ustuni muvaffaqiyatli qo'shildi");
            }
            try {
                this.db.exec("CREATE INDEX IF NOT EXISTS idx_auth_users_operator_id ON auth_users(operator_id);");
            } catch (idxErr) {}

            const hasEmail = tableCols && tableCols.some(c => c.name === 'email');
            if (!hasEmail) {
                this.db.exec("ALTER TABLE auth_users ADD COLUMN email TEXT;");
                console.log("✅ auth_users jadvaliga 'email' ustuni muvaffaqiyatli qo'shildi");
            }
            try {
                this.db.exec("CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);");
            } catch (idxErr) {}
        } catch (migErr) {
            console.error("❌ auth_users migratsiyasida xatolik:", migErr.message);
        }

        // Superuser mavjudligini ta'minlash
        this.ensureDefaultUser('superuser', '@Abaddon2004', 'superuser');

        // Boshlang'ich default sozlamalarni saqlash (agar bo'lmasa)
        if (!this.getSetting('auth_lockout_threshold')) {
            this.setSetting('auth_lockout_threshold', '5');
        }
        if (!this.getSetting('auth_lockout_duration_min')) {
            this.setSetting('auth_lockout_duration_min', '60');
        }
        if (!this.getSetting('excluded_operators')) {
            this.setSetting('excluded_operators', JSON.stringify([]));
        }

        // Excluded operatorlarni issabelDbService ga darhol sinxronlashtirish
        try {
            const issabelDbService = require('./issabelDbService');
            const excluded = this.getExcludedOperators();
            if (issabelDbService && typeof issabelDbService.updateExcludedOperators === 'function') {
                issabelDbService.updateExcludedOperators(excluded);
            }
        } catch (e) {}

        console.log('🛡️ AuthService muvaffaqiyatli ishga tushirildi (RBAC & System Settings faol)');
    }

    getSetting(key, defaultValue = null) {
        try {
            if (!this.db) return defaultValue;
            const row = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
            return row ? row.value : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    setSetting(key, value) {
        try {
            if (!this.db) return false;
            this.db.prepare(`
                INSERT INTO system_settings (key, value, updated_at)
                VALUES (?, ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            `).run(key, String(value));
            return true;
        } catch (e) {
            console.error('❌ AuthService setSetting xatosi:', e.message);
            return false;
        }
    }

    getLockoutThreshold() {
        const val = parseInt(this.getSetting('auth_lockout_threshold', '5'), 10);
        return isNaN(val) ? 5 : Math.min(10, Math.max(3, val));
    }

    getLockoutDurationMinutes() {
        const val = parseInt(this.getSetting('auth_lockout_duration_min', '60'), 10);
        return isNaN(val) ? 60 : Math.max(1, val);
    }

    getExcludedOperators() {
        try {
            const val = this.getSetting('excluded_operators');
            if (val) {
                const parsed = JSON.parse(val);
                if (Array.isArray(parsed)) return parsed.map(String);
            }
        } catch (e) {}
        return [];
    }

    setExcludedOperators(operators) {
        if (!Array.isArray(operators)) return false;
        const clean = Array.from(new Set(operators.map(x => String(x).trim()).filter(Boolean)));
        const saved = this.setSetting('excluded_operators', JSON.stringify(clean));
        if (saved) {
            try {
                const issabelDbService = require('./issabelDbService');
                if (issabelDbService && typeof issabelDbService.updateExcludedOperators === 'function') {
                    issabelDbService.updateExcludedOperators(clean);
                }
            } catch (e) {}
        }
        return saved;
    }

    hashPassword(password, salt) {
        return crypto.scryptSync(password, salt, 64).toString('hex');
    }

    ensureDefaultUser(username, password, role = 'superuser') {
        try {
            const user = this.db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username);
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = this.hashPassword(password, salt);

            if (!user) {
                this.db.prepare(`
                    INSERT INTO auth_users (username, password_hash, salt, role)
                    VALUES (?, ?, ?, ?)
                `).run(username, hash, salt, role);
                console.log(`✅ AuthService: '${username}' (${role}) yaratildi`);
            } else {
                this.db.prepare(`
                    UPDATE auth_users SET password_hash = ?, salt = ?, role = ?, updated_at = datetime('now', 'localtime')
                    WHERE username = ?
                `).run(hash, salt, role, username);
                console.log(`✅ AuthService: '${username}' yangilandi`);
            }

            const adminEmail = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim().toLowerCase() : null;
            if (adminEmail) {
                this.db.prepare("UPDATE auth_users SET email = COALESCE(email, ?) WHERE username = ?").run(adminEmail, username);
            }
        } catch (e) {
            console.error('❌ AuthService ensureDefaultUser xatosi:', e.message);
        }
    }

    getClientIp(req) {
        if (!req) return '127.0.0.1';
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
        return req.socket?.remoteAddress || req.ip || '127.0.0.1';
    }

    isLocked(key) {
        try {
            const row = this.db.prepare('SELECT * FROM auth_lockouts WHERE key = ?').get(key);
            if (!row || !row.locked_until) return { locked: false, remainingMinutes: 0 };

            const lockedUntil = new Date(row.locked_until).getTime();
            const now = Date.now();
            if (now < lockedUntil) {
                const remainingMinutes = Math.ceil((lockedUntil - now) / 60000);
                return { locked: true, remainingMinutes };
            }

            // Blok muddati tugagan bo'lsa tozalash
            this.db.prepare('UPDATE auth_lockouts SET locked_until = NULL, failed_count = 0 WHERE key = ?').run(key);
            return { locked: false, remainingMinutes: 0 };
        } catch (e) {
            return { locked: false, remainingMinutes: 0 };
        }
    }

    recordFailedAttempt(key) {
        try {
            const threshold = this.getLockoutThreshold();
            const durationMs = this.getLockoutDurationMinutes() * 60 * 1000;
            const nowIso = new Date().toISOString();
            const row = this.db.prepare('SELECT * FROM auth_lockouts WHERE key = ?').get(key);
            let failedCount = 1;

            if (row) {
                failedCount = (row.failed_count || 0) + 1;
            }

            let lockedUntil = null;
            if (failedCount >= threshold) {
                // Dinamik muddatga bloklash
                lockedUntil = new Date(Date.now() + durationMs).toISOString();
            }

            this.db.prepare(`
                INSERT INTO auth_lockouts (key, failed_count, locked_until, last_attempt)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    failed_count = excluded.failed_count,
                    locked_until = excluded.locked_until,
                    last_attempt = excluded.last_attempt
            `).run(key, failedCount, lockedUntil, nowIso);

            return {
                failedCount,
                isLocked: Boolean(lockedUntil),
                remainingAttempts: Math.max(0, threshold - failedCount),
                threshold
            };
        } catch (e) {
            console.error('recordFailedAttempt error:', e.message);
            return { failedCount: 1, isLocked: false, remainingAttempts: 4, threshold: 5 };
        }
    }

    resetFailedAttempts(key) {
        try {
            this.db.prepare('DELETE FROM auth_lockouts WHERE key = ?').run(key);
        } catch (e) {}
    }

    getActiveLockouts() {
        try {
            const rows = this.db.prepare(`
                SELECT key, failed_count, locked_until, last_attempt 
                FROM auth_lockouts 
                WHERE locked_until IS NOT NULL
                ORDER BY last_attempt DESC
            `).all();

            const now = Date.now();
            const active = [];
            for (const r of rows) {
                const until = new Date(r.locked_until).getTime();
                if (now < until) {
                    const remainingMinutes = Math.ceil((until - now) / 60000);
                    const isIp = r.key.includes('.') || r.key.includes(':');
                    active.push({
                        key: r.key,
                        type: isIp ? 'IP manzil' : 'Foydalanuvchi hisobi',
                        isIp,
                        failedCount: r.failed_count,
                        lockedUntil: r.locked_until,
                        remainingMinutes,
                        lastAttempt: r.last_attempt
                    });
                } else {
                    this.db.prepare('DELETE FROM auth_lockouts WHERE key = ?').run(r.key);
                }
            }
            return active;
        } catch (e) {
            console.error('getActiveLockouts error:', e.message);
            return [];
        }
    }

    unlockKey(key) {
        try {
            const cleanKey = String(key || '').trim();
            if (!cleanKey) return false;
            this.db.prepare('DELETE FROM auth_lockouts WHERE key = ?').run(cleanKey);
            return true;
        } catch (e) {
            console.error('unlockKey error:', e.message);
            return false;
        }
    }

    unlockAll() {
        try {
            const info = this.db.prepare('DELETE FROM auth_lockouts WHERE locked_until IS NOT NULL').run();
            return info?.changes || 0;
        } catch (e) {
            console.error('unlockAll error:', e.message);
            return 0;
        }
    }

    lockUserImmediately(key, durationMinutes = 60) {
        try {
            const threshold = this.getLockoutThreshold();
            const durationMs = (durationMinutes || this.getLockoutDurationMinutes()) * 60 * 1000;
            const nowIso = new Date().toISOString();
            const lockedUntil = new Date(Date.now() + durationMs).toISOString();

            this.db.prepare(`
                INSERT INTO auth_lockouts (key, failed_count, locked_until, last_attempt)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    failed_count = excluded.failed_count,
                    locked_until = excluded.locked_until,
                    last_attempt = excluded.last_attempt
            `).run(key, threshold, lockedUntil, nowIso);
            console.warn(`🚨 [AUTH LOCKOUT] '${key}' xavfsizlik sababli darhol ${durationMinutes} daqiqaga bloklandi`);
            return true;
        } catch (e) {
            console.error('lockUserImmediately error:', e.message);
            return false;
        }
    }

    login(username, password, ip, userAgent = '') {
        const cleanUser = String(username || '').trim();
        const cleanPass = String(password || '');
        const threshold = this.getLockoutThreshold();

        // 1. IP va username bo'yicha bloklanganlikni tekshirish
        const ipLock = this.isLocked(ip);
        if (ipLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Ushbu IP manzil juda ko'p xato urinishlar sababli bloklangan. Qolgan vaqt: ${ipLock.remainingMinutes} daqiqa.`
            };
        }

        const userLock = this.isLocked(cleanUser);
        if (userLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Ushbu foydalanuvchi hisobi bloklangan. Qolgan vaqt: ${userLock.remainingMinutes} daqiqa.`
            };
        }

        // 2. Foydalanuvchini tekshirish
        const user = this.db.prepare('SELECT * FROM auth_users WHERE username = ?').get(cleanUser);
        if (!user) {
            const failIp = this.recordFailedAttempt(ip);
            return {
                success: false,
                locked: failIp.isLocked,
                error: failIp.isLocked 
                    ? `${threshold} marta xato kiritildi! Tizim vaqtincha bloklandi.`
                    : `Login yoki parol noto'g'ri. Qolgan urinishlar: ${failIp.remainingAttempts} ta.`
            };
        }

        // 3. Parol xeshini tekshirish
        const testHash = this.hashPassword(cleanPass, user.salt);
        const match = crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(user.password_hash, 'hex'));

        if (!match) {
            const failIp = this.recordFailedAttempt(ip);
            this.recordFailedAttempt(cleanUser);
            return {
                success: false,
                locked: failIp.isLocked,
                error: failIp.isLocked 
                    ? `${threshold} marta xato kiritildi! Tizim vaqtincha bloklandi.`
                    : `Login yoki parol noto'g'ri. Qolgan urinishlar: ${failIp.remainingAttempts} ta.`
            };
        }

        // 4. Muvaffaqiyatli kirish — bloklarni tozalash
        this.resetFailedAttempts(ip);
        this.resetFailedAttempts(cleanUser);

        // 5. Sessiya yaratish
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + this.SESSION_DURATION_MS).toISOString();

        this.db.prepare(`
            INSERT INTO auth_sessions (token, username, ip, user_agent, expires_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(token, cleanUser, ip, userAgent.slice(0, 255), expiresAt);

        return {
            success: true,
            token,
            username: cleanUser,
            role: user.role || 'superuser',
            operatorId: user.operator_id || null,
            email: user.email || null
        };
    }

    verifyUserPassword(username, password) {
        const cleanUser = String(username || '').trim();
        const cleanPass = String(password || '');
        if (!cleanUser || !cleanPass) return false;

        try {
            const user = this.db.prepare('SELECT password_hash, salt FROM auth_users WHERE username = ?').get(cleanUser);
            if (!user || !user.password_hash || !user.salt) return false;

            const testHash = this.hashPassword(cleanPass, user.salt);
            return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(user.password_hash, 'hex'));
        } catch (e) {
            return false;
        }
    }

    validateSession(token) {
        if (!token || typeof token !== 'string') return null;
        try {
            const nowIso = new Date().toISOString();
            const session = this.db.prepare(`
                SELECT s.token, s.username, s.ip, COALESCE(u.role, 'superuser') as role, u.operator_id, u.email
                FROM auth_sessions s
                LEFT JOIN auth_users u ON s.username = u.username
                WHERE s.expires_at > ?
            `).get(nowIso);

            // Aniq token bo'yicha filter qilish
            const row = this.db.prepare(`
                SELECT s.token, s.username, s.ip, COALESCE(u.role, 'superuser') as role, u.operator_id, u.email
                FROM auth_sessions s
                LEFT JOIN auth_users u ON s.username = u.username
                WHERE s.token = ? AND s.expires_at > ?
            `).get(token, nowIso);

            if (!row) return null;
            return {
                username: row.username,
                token: row.token,
                role: row.role || 'superuser',
                operatorId: row.operator_id || null,
                email: row.email || null
            };
        } catch (e) {
            return null;
        }
    }

    logout(token) {
        if (!token) return;
        try {
            this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
        } catch (e) {}
    }

    listActiveSessions() {
        try {
            const nowIso = new Date().toISOString();
            // Eski muddati o'tgan sessiyalarni tozalash
            try {
                this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowIso);
            } catch (err) {}

            const sessions = this.db.prepare(`
                SELECT s.token, s.username, s.ip, s.user_agent, s.created_at, s.expires_at,
                       COALESCE(u.role, 'superuser') as role
                FROM auth_sessions s
                LEFT JOIN auth_users u ON s.username = u.username
                WHERE s.expires_at > ?
                ORDER BY s.created_at DESC
            `).all(nowIso);

            return sessions || [];
        } catch (e) {
            console.error('listActiveSessions xatosi:', e.message);
            return [];
        }
    }

    terminateSession(token) {
        if (!token) return { success: false, error: 'Token kiritilmadi' };
        try {
            this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // --- USER MANAGEMENT & RBAC METODLARI ---

    listUsers() {
        try {
            const rows = this.db.prepare(`
                SELECT id, username, email, role, operator_id as operatorId, created_at, updated_at
                FROM auth_users
                ORDER BY id ASC
            `).all();
            return rows || [];
        } catch (e) {
            console.error('listUsers error:', e.message);
            return [];
        }
    }

    createUser(username, password, role = 'operator', operatorId = null, email = null) {
        const cleanUser = String(username || '').trim();
        const cleanPass = String(password || '').trim();
        const cleanRole = role === 'superuser' ? 'superuser' : 'operator';
        const cleanOpId = (cleanRole === 'operator' && operatorId) ? String(operatorId).trim() : null;
        const cleanEmail = email ? String(email).trim().toLowerCase() : null;

        if (cleanUser.length < 3 || cleanUser.length > 32) {
            return { success: false, error: 'Login uzunligi 3 tadan 32 tagacha bo\'lishi kerak' };
        }
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(cleanUser)) {
            return { success: false, error: 'Loginda faqat lotin harflari, raqamlar va _ - . belgilari bo\'lishi mumkin' };
        }
        if (cleanPass.length < 6) {
            return { success: false, error: 'Parol uzunligi kamida 6 ta belgidan iborat bo\'lishi shart' };
        }
        if (cleanRole === 'operator' && !cleanOpId) {
            return { success: false, error: 'Operator roli uchun ichki raqam (Operator ID) tanlanishi shart' };
        }
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return { success: false, error: 'Email manzili noto\'g\'ri formatda' };
        }

        try {
            const existing = this.db.prepare('SELECT id FROM auth_users WHERE username = ?').get(cleanUser);
            if (existing) {
                return { success: false, error: `'${cleanUser}' nomli foydalanuvchi allaqachon mavjud` };
            }

            const salt = crypto.randomBytes(16).toString('hex');
            const hash = this.hashPassword(cleanPass, salt);

            this.db.prepare(`
                INSERT INTO auth_users (username, password_hash, salt, role, operator_id, email)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(cleanUser, hash, salt, cleanRole, cleanOpId, cleanEmail);

            return { success: true, username: cleanUser, role: cleanRole, operatorId: cleanOpId, email: cleanEmail };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    updateUserEmail(username, email) {
        const cleanUser = String(username || '').trim();
        const cleanEmail = email ? String(email).trim().toLowerCase() : null;
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return { success: false, error: 'Email manzili noto\'g\'ri formatda' };
        }
        try {
            this.db.prepare(`
                UPDATE auth_users SET email = ?, updated_at = datetime('now', 'localtime')
                WHERE username = ?
            `).run(cleanEmail, cleanUser);
            return { success: true, username: cleanUser, email: cleanEmail };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    updateUserOperatorId(username, operatorId) {
        const cleanUser = String(username || '').trim();
        const cleanOpId = operatorId ? String(operatorId).trim() : null;
        try {
            this.db.prepare(`
                UPDATE auth_users SET operator_id = ?, updated_at = datetime('now', 'localtime')
                WHERE username = ?
            `).run(cleanOpId, cleanUser);
            return { success: true, username: cleanUser, operatorId: cleanOpId };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    updateUserPassword(username, newPassword) {
        const cleanUser = String(username || '').trim();
        const cleanPass = String(newPassword || '').trim();

        if (cleanPass.length < 6) {
            return { success: false, error: 'Yangi parol kamida 6 ta belgidan iborat bo\'lishi shart' };
        }

        try {
            const user = this.db.prepare('SELECT id FROM auth_users WHERE username = ?').get(cleanUser);
            if (!user) {
                return { success: false, error: 'Foydalanuvchi topilmadi' };
            }

            const salt = crypto.randomBytes(16).toString('hex');
            const hash = this.hashPassword(cleanPass, salt);

            this.db.prepare(`
                UPDATE auth_users 
                SET password_hash = ?, salt = ?, updated_at = datetime('now', 'localtime')
                WHERE username = ?
            `).run(hash, salt, cleanUser);

            // Xavfsizlik: Parol o'zgarganda foydalanuvchining barcha faol sessiyalarini darhol bekor qilish (kick qilish)
            let kickedCount = 0;
            try {
                const del = this.db.prepare('DELETE FROM auth_sessions WHERE username = ?').run(cleanUser);
                kickedCount = del ? del.changes : 0;
                console.log(`🔒 Parol o'zgardi: '${cleanUser}' foydalanuvchisining ${kickedCount} ta faol sessiyasi bekor qilindi`);
            } catch (delErr) {
                console.warn('auth_sessions tozalash xatosi:', delErr.message);
            }

            return { success: true, kickedCount };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    deleteUserSessions(username) {
        const cleanUser = String(username || '').trim();
        try {
            const del = this.db.prepare('DELETE FROM auth_sessions WHERE username = ?').run(cleanUser);
            return del ? del.changes : 0;
        } catch (e) {
            return 0;
        }
    }

    updateUserRole(username, newRole) {
        const cleanUser = String(username || '').trim();
        const role = newRole === 'superuser' ? 'superuser' : 'operator';

        try {
            const user = this.db.prepare('SELECT id, role FROM auth_users WHERE username = ?').get(cleanUser);
            if (!user) {
                return { success: false, error: 'Foydalanuvchi topilmadi' };
            }

            // Agar yagona superuser bo'lsa, uning rolini pasaytirishga yo'l qo'ymaslik
            if (user.role === 'superuser' && role !== 'superuser') {
                const superCount = this.db.prepare("SELECT COUNT(*) as count FROM auth_users WHERE role = 'superuser'").get().count;
                if (superCount <= 1) {
                    return { success: false, error: 'Tizimda kamida 1 ta superuser qolishi shart!' };
                }
            }

            this.db.prepare(`
                UPDATE auth_users 
                SET role = ?, updated_at = datetime('now', 'localtime')
                WHERE username = ?
            `).run(role, cleanUser);

            return { success: true, role };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    deleteUser(username, currentAdminUser) {
        const cleanUser = String(username || '').trim();

        if (cleanUser === currentAdminUser) {
            return { success: false, error: 'O\'zingizning hisobingizni o\'chira olmaysiz!' };
        }

        try {
            const user = this.db.prepare('SELECT id, role FROM auth_users WHERE username = ?').get(cleanUser);
            if (!user) {
                return { success: false, error: 'Foydalanuvchi topilmadi' };
            }

            if (user.role === 'superuser') {
                const superCount = this.db.prepare("SELECT COUNT(*) as count FROM auth_users WHERE role = 'superuser'").get().count;
                if (superCount <= 1) {
                    return { success: false, error: 'Tizimda kamida bitta superuser qolishi shart!' };
                }
            }

            // Sessiyalarini ham o'chirish
            this.db.prepare('DELETE FROM auth_sessions WHERE username = ?').run(cleanUser);
            this.db.prepare('DELETE FROM auth_lockouts WHERE key = ?').run(cleanUser);
            this.db.prepare('DELETE FROM auth_users WHERE username = ?').run(cleanUser);

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // --- PASSWORD RESET & RECOVERY METODLARI ---

    maskEmail(email) {
        if (!email || typeof email !== 'string') return '';
        const parts = email.split('@');
        if (parts.length !== 2) return email;
        const name = parts[0];
        const domain = parts[1];
        if (name.length <= 2) {
            return `${name.charAt(0)}***@${domain}`;
        }
        return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
    }

    async requestPasswordReset(identifier, inputEmail = null, clientIp = '127.0.0.1') {
        const cleanId = String(identifier || '').trim();
        if (!cleanId) {
            return { success: false, error: "Login yoki email manzilini kiriting" };
        }

        // 1. IP yoki foydalanuvchi bloklanganligini tekshirish
        const ipLock = this.isLocked(clientIp);
        if (ipLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Sizning IP manzilingiz vaqtincha bloklangan. Qolgan vaqt: ${ipLock.remainingMinutes} daqiqa.`
            };
        }

        const userLock = this.isLocked(cleanId);
        if (userLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Ushbu hisob xavfsizlik sababli vaqtincha bloklangan. Qolgan vaqt: ${userLock.remainingMinutes} daqiqa.`
            };
        }

        // 2. Foydalanuvchini topish (username yoki email bo'yicha)
        const user = this.db.prepare(`
            SELECT id, username, email, role 
            FROM auth_users 
            WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
        `).get(cleanId, cleanId);

        if (!user) {
            return { success: false, error: "Bunday foydalanuvchi yoki email topilmadi" };
        }

        // 3. Foydalanuvchi bloklanganligini tekshirish (haqiqiy username bo'yicha)
        const actualUserLock = this.isLocked(user.username);
        if (actualUserLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Ushbu hisob xavfsizlik sababli vaqtincha bloklangan. Qolgan vaqt: ${actualUserLock.remainingMinutes} daqiqa.`
            };
        }

        // 4. Qaysi emailga jo'natilishini aniqlash
        let targetEmail = user.email ? user.email.trim() : null;

        if (!targetEmail) {
            if (inputEmail && String(inputEmail).trim()) {
                const candidate = String(inputEmail).trim().toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
                    return { success: false, error: "Email manzili noto'g'ri formatda" };
                }
                this.db.prepare("UPDATE auth_users SET email = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(candidate, user.id);
                targetEmail = candidate;
            } else if (process.env.ADMIN_EMAIL && user.role === 'superuser') {
                targetEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
                this.db.prepare("UPDATE auth_users SET email = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(targetEmail, user.id);
            } else {
                return {
                    success: false,
                    needsEmail: true,
                    username: user.username,
                    error: "Ushbu hisobga hali email biriktirilmagan. Iltimos, emailingizni kiriting."
                };
            }
        }

        // 5. Ushbu foydalanuvchining avvalgi ishlatilmagan reset kodlarini bekor qilish
        this.db.prepare('UPDATE auth_password_resets SET used = 1 WHERE username = ? AND used = 0').run(user.username);

        // 6. 6 xonali tasodifiy raqamli kod generatsiya qilish (100000 - 999999)
        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');

        // 2 daqiqa (120 soniya) amal qilish muddati
        const expiresInSeconds = 120;
        const expiresAt = Date.now() + (expiresInSeconds * 1000);

        this.db.prepare(`
            INSERT INTO auth_password_resets (user_id, username, email, code_hash, attempts, expires_at, used, created_at)
            VALUES (?, ?, ?, ?, 0, ?, 0, ?)
        `).run(user.id, user.username, targetEmail, codeHash, expiresAt, Date.now());

        // 7. Email jo'natish (Resend API yoki Console log fallback)
        const emailService = require('./emailService');
        const sendResult = await emailService.sendPasswordResetCode(targetEmail, code, user.username);

        return {
            success: true,
            username: user.username,
            maskedEmail: this.maskEmail(targetEmail),
            expiresInSeconds,
            simulated: Boolean(sendResult.simulated),
            message: sendResult.simulated 
                ? "Tasdiqlash kodi jo'natildi (Resend API key kiritilmaganligi sabab kod server konsoliga ham chiqarildi)"
                : `${this.maskEmail(targetEmail)} manziliga 6 xonali tasdiqlash kodi jo'natildi`
        };
    }

    verifyPasswordResetCode(username, inputCode, clientIp = '127.0.0.1') {
        const cleanUser = String(username || '').trim();
        const cleanCode = String(inputCode || '').trim();

        if (!cleanUser || !cleanCode) {
            return { success: false, error: "Foydalanuvchi nomi va tasdiqlash kodi kiritilishi shart" };
        }

        // 1. Akkaunt yoki IP blokda ekanligini tekshirish
        const userLock = this.isLocked(cleanUser);
        if (userLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Ushbu akkaunt xavfsizlik sababli vaqtincha bloklangan. Qolgan vaqt: ${userLock.remainingMinutes} daqiqa.`
            };
        }

        // 2. Oxirgi faol reset yozuvini olish
        const record = this.db.prepare(`
            SELECT * FROM auth_password_resets 
            WHERE username = ? AND used = 0 
            ORDER BY id DESC LIMIT 1
        `).get(cleanUser);

        if (!record) {
            return {
                success: false,
                error: "Parolni tiklash so'rovi topilmadi yoki muddati o'tgan. Iltimos, qaytadan kod so'rang."
            };
        }

        const now = Date.now();

        // 3. Kod muddati (2 daqiqa) o'tganligini tekshirish
        if (now > record.expires_at) {
            this.db.prepare('UPDATE auth_password_resets SET used = 1 WHERE id = ?').run(record.id);
            return {
                success: false,
                expired: true,
                error: "Kodning amal qilish muddati (2 daqiqa) tugagan. Qaytadan kod yuborish tugmasini bosing."
            };
        }

        // 4. Urinishlar sonini tekshirish (Maksimum 3 ta)
        if (record.attempts >= 3) {
            this.lockUserImmediately(cleanUser, this.getLockoutDurationMinutes());
            this.db.prepare('UPDATE auth_password_resets SET used = 1 WHERE id = ?').run(record.id);
            return {
                success: false,
                locked: true,
                remainingAttempts: 0,
                error: "3 marta noto'g'ri kod kiritildi! Akkauntingiz xavfsizlik yuzasidan bloklandi."
            };
        }

        // 5. Kodni tekshirish
        const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
        if (inputHash !== record.code_hash) {
            const nextAttempts = record.attempts + 1;
            this.db.prepare('UPDATE auth_password_resets SET attempts = ? WHERE id = ?').run(nextAttempts, record.id);

            if (nextAttempts >= 3) {
                // 3-urinish ham xato: darhol akkauntni bloklash!
                this.lockUserImmediately(cleanUser, this.getLockoutDurationMinutes());
                this.db.prepare('UPDATE auth_password_resets SET used = 1 WHERE id = ?').run(record.id);
                return {
                    success: false,
                    locked: true,
                    remainingAttempts: 0,
                    error: "3 marta xato kod kiritildi! Akkauntingiz xavfsizlik yuzasidan bloklandi."
                };
            }

            const remaining = 3 - nextAttempts;
            return {
                success: false,
                remainingAttempts: remaining,
                error: `Kiritilgan kod noto'g'ri! Qolgan urinishlar: ${remaining} ta. (3 tadan ko'p xato kiritilsa hisob bloklanadi)`
            };
        }

        // 6. Kod to'g'ri: Bir martalik reset_token berish va yangi parol kiritish uchun 10 daqiqa vaqt berish
        const resetToken = crypto.randomBytes(32).toString('hex');
        this.db.prepare(`
            UPDATE auth_password_resets 
            SET reset_token = ?, expires_at = ? 
            WHERE id = ?
        `).run(resetToken, Date.now() + (10 * 60 * 1000), record.id);

        return {
            success: true,
            username: cleanUser,
            resetToken,
            message: "Kod muvaffaqiyatli tasdiqlandi. Yangi parolni kiriting."
        };
    }

    completePasswordReset(username, resetToken, newPassword) {
        const cleanUser = String(username || '').trim();
        const cleanToken = String(resetToken || '').trim();
        const cleanPass = String(newPassword || '').trim();

        if (!cleanUser || !cleanToken || !cleanPass) {
            return { success: false, error: "Barcha ma'lumotlarni to'ldiring" };
        }

        if (cleanPass.length < 6) {
            return { success: false, error: "Yangi parol kamida 6 ta belgidan iborat bo'lishi shart" };
        }

        const record = this.db.prepare(`
            SELECT * FROM auth_password_resets 
            WHERE username = ? AND reset_token = ? AND used = 0
            ORDER BY id DESC LIMIT 1
        `).get(cleanUser, cleanToken);

        if (!record) {
            return { success: false, error: "Tasdiqlash tokeni yaroqsiz yoki eskirgan. Qaytadan urinib ko'ring." };
        }

        if (Date.now() > record.expires_at) {
            this.db.prepare('UPDATE auth_password_resets SET used = 1 WHERE id = ?').run(record.id);
            return { success: false, error: "Tiklash sessiyasi muddati o'tib ketdi. Qaytadan boshlang." };
        }

        // 1. Yangi parolni o'rnatish
        const updateRes = this.updateUserPassword(cleanUser, cleanPass);
        if (!updateRes.success) {
            return updateRes;
        }

        // 2. Reset yozuvini ishlatilgan (used = 1) deb belgilash
        this.db.prepare('UPDATE auth_password_resets SET used = 1 WHERE id = ?').run(record.id);

        // 3. Agar foydalanuvchi bloklangan bo'lsa, blokdan chiqarish
        this.unlockKey(cleanUser);

        return {
            success: true,
            message: "Parolingiz muvaffaqiyatli yangilandi! Yangi parol bilan tizimga kirishingiz mumkin."
        };
    }

    // --- EMAIL BOG'LASH VA TASDIQLASH METODLARI ---

    async requestEmailVerificationCode(username, email, clientIp = '127.0.0.1', password = '', action = 'auto') {
        const cleanUser = String(username || '').trim();
        const cleanEmail = email ? String(email).trim().toLowerCase() : '';
        const cleanPass = String(password || '').trim();

        const ipLock = this.isLocked(clientIp);
        if (ipLock.locked) {
            return {
                success: false,
                locked: true,
                error: `Sizning IP manzilingiz vaqtincha bloklangan. Qolgan vaqt: ${ipLock.remainingMinutes} daqiqa.`
            };
        }

        const user = this.db.prepare('SELECT id, username, email FROM auth_users WHERE username = ?').get(cleanUser);
        if (!user) {
            return { success: false, error: "Foydalanuvchi topilmadi" };
        }

        // Xavfsizlik tekshiruvi: Begona shaxs hisobga boshqa Gmail bog'lay olmasligi uchun joriy hisob parolini tekshirish
        if (!cleanPass) {
            return {
                success: false,
                error: "Joriy hisobingiz parolini kiriting! Xavfsizlik yuzasidan hisob paroli tasdiqlanishi shart."
            };
        }

        const isPasswordCorrect = this.verifyUserPassword(cleanUser, cleanPass);
        if (!isPasswordCorrect) {
            return {
                success: false,
                error: "Kiritilgan joriy parol noto'g'ri! Hisob xavfsizligi yuzasidan tasdiqlash kodi yuborilmadi."
            };
        }

        const currentEmail = user.email ? user.email.trim().toLowerCase() : null;

        // 1. Agar foydalanuvchi joriy emailni to'g'ridan-to'g'ri uzishni (unlink) so'ragan bo'lsa
        if (action === 'unlink' || (!cleanEmail && currentEmail)) {
            if (!currentEmail) {
                return { success: false, error: "Hisobingizga hech qanday Gmail bog'lanmagan." };
            }
            const code = crypto.randomInt(100000, 1000000).toString();
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            const expiresInSeconds = 120;
            const expiresAt = Date.now() + (expiresInSeconds * 1000);

            this.db.prepare('UPDATE auth_email_verifications SET used = 1 WHERE username = ? AND used = 0').run(cleanUser);
            this.db.prepare(`
                INSERT INTO auth_email_verifications (username, email, code_hash, attempts, expires_at, used, created_at)
                VALUES (?, ?, ?, 0, ?, 0, ?)
            `).run(cleanUser, currentEmail, codeHash, expiresAt, Date.now());

            const emailService = require('./emailService');
            const sendResult = await emailService.sendEmailUnlinkCode(currentEmail, code, cleanUser);

            return {
                success: true,
                step: 'unlink_current',
                currentEmail: currentEmail,
                maskedEmail: this.maskEmail(currentEmail),
                expiresInSeconds,
                simulated: Boolean(sendResult.simulated),
                message: sendResult.simulated
                    ? `Gmailni hisobdan uzish tasdiqlash kodi ${currentEmail} pochtangizga jo'natildi (Server konsoliga chiqarildi)`
                    : `Gmailni hisobdan uzish tasdiqlash kodi joriy bog'langan ${currentEmail} pochtangizga jo'natildi`
            };
        }

        // 2. Yangi kiritilgan email formatini tekshirish
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return { success: false, error: "Gmail manzili noto'g'ri formatda" };
        }

        // Agar kiritilgan Gmail allaqachon ayni shu hisobga bog'langan bo'lsa
        if (currentEmail && currentEmail === cleanEmail) {
            return {
                success: false,
                error: "Ushbu Gmail manzili allaqachon hisobingizga bog'langan."
            };
        }

        // Agar bu Gmail boshqa hisobga bog'langan bo'lsa
        const existingOtherUser = this.db.prepare('SELECT username FROM auth_users WHERE email = ? AND username != ?').get(cleanEmail, cleanUser);
        if (existingOtherUser) {
            return {
                success: false,
                error: `Ushbu Gmail manzili allaqachon boshqa hisobga (${existingOtherUser.username}) bog'langan.`
            };
        }

        // 3. MUHIM XAVFSIZLIK: Agar hisobda ALLAQACHON eski email mavjud bo'lsa,
        // yangi emailga emas, AVVAL ESKI GMAILGA kod yuboriladi!
        // Hacker parolni bilgan taqdirda ham eski pochtasiz akkauntni olib ketolmaydi!
        if (currentEmail) {
            const code = crypto.randomInt(100000, 1000000).toString();
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            const expiresInSeconds = 120;
            const expiresAt = Date.now() + (expiresInSeconds * 1000);

            this.db.prepare('UPDATE auth_email_verifications SET used = 1 WHERE username = ? AND used = 0').run(cleanUser);
            this.db.prepare(`
                INSERT INTO auth_email_verifications (username, email, code_hash, attempts, expires_at, used, created_at)
                VALUES (?, ?, ?, 0, ?, 0, ?)
            `).run(cleanUser, currentEmail, codeHash, expiresAt, Date.now());

            const emailService = require('./emailService');
            const sendResult = await emailService.sendEmailUnlinkCode(currentEmail, code, cleanUser);

            return {
                success: true,
                step: 'unlink_current',
                currentEmail: currentEmail,
                targetNewEmail: cleanEmail,
                maskedEmail: this.maskEmail(currentEmail),
                expiresInSeconds,
                simulated: Boolean(sendResult.simulated),
                message: sendResult.simulated
                    ? `🔒 Xavfsizlik tasdig'i: Yangi Gmail bog'lashdan oldin, tasdiqlash kodi joriy bog'langan ${currentEmail} pochtangizga jo'natildi (Server konsoliga chiqarildi)`
                    : `🔒 Xavfsizlik tasdig'i: Yangi manzil bog'lashdan oldin, tasdiqlash kodi joriy bog'langan ${currentEmail} pochtangizga yuborildi.`
            };
        }

        // 4. Agar hisobda hali hech qanday email bo'lmasa (birinchi marta bog'lanayotganda):
        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expiresInSeconds = 120;
        const expiresAt = Date.now() + (expiresInSeconds * 1000);

        this.db.prepare('UPDATE auth_email_verifications SET used = 1 WHERE username = ? AND used = 0').run(cleanUser);
        this.db.prepare(`
            INSERT INTO auth_email_verifications (username, email, code_hash, attempts, expires_at, used, created_at)
            VALUES (?, ?, ?, 0, ?, 0, ?)
        `).run(cleanUser, cleanEmail, codeHash, expiresAt, Date.now());

        const emailService = require('./emailService');
        const sendResult = await emailService.sendEmailVerificationCode(cleanEmail, code, cleanUser);

        return {
            success: true,
            step: 'bind_new',
            email: cleanEmail,
            maskedEmail: this.maskEmail(cleanEmail),
            expiresInSeconds,
            simulated: Boolean(sendResult.simulated),
            message: sendResult.simulated
                ? `${cleanEmail} manziliga tasdiqlash kodi jo'natildi (Server konsoliga chiqarildi)`
                : `${cleanEmail} manziliga 6 xonali tasdiqlash kodi jo'natildi`
        };
    }

    async verifyEmailAndBind(username, email, code, clientIp = '127.0.0.1', step = '', targetNewEmail = '') {
        const cleanUser = String(username || '').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();
        const cleanCode = String(code || '').trim();
        const cleanTargetNew = targetNewEmail ? String(targetNewEmail).trim().toLowerCase() : '';

        if (!cleanCode || cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
            return { success: false, error: "6 xonali raqamli tasdiqlash kodini to'liq kiriting" };
        }

        const user = this.db.prepare('SELECT id, username, email FROM auth_users WHERE username = ?').get(cleanUser);
        if (!user) {
            return { success: false, error: "Foydalanuvchi topilmadi" };
        }

        const row = this.db.prepare(`
            SELECT * FROM auth_email_verifications
            WHERE username = ? AND email = ? AND used = 0
            ORDER BY id DESC LIMIT 1
        `).get(cleanUser, cleanEmail);

        if (!row) {
            return { success: false, error: "Tasdiqlash kodi topilmadi yoki muddati tugagan. Iltimos qaytadan kod so'rang." };
        }

        if (Date.now() > row.expires_at) {
            this.db.prepare('UPDATE auth_email_verifications SET used = 1 WHERE id = ?').run(row.id);
            return { success: false, expired: true, error: "Tasdiqlash kodi muddati (2 daqiqa) tugagan. Yangi kod so'rang." };
        }

        const attempts = (row.attempts || 0) + 1;
        const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

        if (inputHash !== row.code_hash) {
            if (attempts >= 3) {
                this.db.prepare('UPDATE auth_email_verifications SET used = 1, attempts = ? WHERE id = ?').run(attempts, row.id);
                return {
                    success: false,
                    locked: true,
                    error: "Kod 3 marta noto'g'ri kiritildi. Kod bekor qilindi, iltimos qaytadan kod so'rang."
                };
            }
            this.db.prepare('UPDATE auth_email_verifications SET attempts = ? WHERE id = ?').run(attempts, row.id);
            const remaining = 3 - attempts;
            return {
                success: false,
                remainingAttempts: remaining,
                error: `Noto'g'ri kod kiritildi! Qolgan urinishlar: ${remaining} ta.`
            };
        }

        // Kod to'g'ri: ishlatildi deb belgilaymiz
        this.db.prepare('UPDATE auth_email_verifications SET used = 1 WHERE id = ?').run(row.id);

        const currentEmail = user.email ? user.email.trim().toLowerCase() : null;

        // AGAR BU ESKI EMAILNI TASDIQLASH / UZISH (unlink_current) BO'LSA:
        if (step === 'unlink_current' || (currentEmail && currentEmail === cleanEmail)) {
            // 1. Eski emailni hisobdan uzamiz
            this.db.prepare(`
                UPDATE auth_users SET email = NULL, updated_at = datetime('now', 'localtime')
                WHERE username = ?
            `).run(cleanUser);

            // Agar yangi email kiritilgan bo'lsa (almashtirish jarayoni):
            if (cleanTargetNew && cleanTargetNew !== cleanEmail) {
                // 2-bosqich: Yangi emailga avtomatik 6 xonali kod jo'natamiz!
                const newCode = crypto.randomInt(100000, 1000000).toString();
                const newCodeHash = crypto.createHash('sha256').update(newCode).digest('hex');
                const expiresInSeconds = 120;
                const expiresAt = Date.now() + (expiresInSeconds * 1000);

                this.db.prepare('UPDATE auth_email_verifications SET used = 1 WHERE username = ? AND used = 0').run(cleanUser);
                this.db.prepare(`
                    INSERT INTO auth_email_verifications (username, email, code_hash, attempts, expires_at, used, created_at)
                    VALUES (?, ?, ?, 0, ?, 0, ?)
                `).run(cleanUser, cleanTargetNew, newCodeHash, expiresAt, Date.now());

                const emailService = require('./emailService');
                const sendResult = await emailService.sendEmailVerificationCode(cleanTargetNew, newCode, cleanUser);

                return {
                    success: true,
                    step: 'bind_new',
                    unlinked: true,
                    previousEmail: cleanEmail,
                    newEmail: cleanTargetNew,
                    maskedEmail: this.maskEmail(cleanTargetNew),
                    expiresInSeconds,
                    simulated: Boolean(sendResult.simulated),
                    message: sendResult.simulated
                        ? `✅ Eski Gmail uzildi! Yangi ${cleanTargetNew} pochtasiga tasdiqlash kodi jo'natildi (Server konsoliga chiqarildi)`
                        : `✅ Eski Gmail muvaffaqiyatli uzildi! Endi yangi ${cleanTargetNew} pochtangizga yuborilgan tasdiqlash kodini kiriting.`
                };
            }

            // Faqat uzish bo'lsa
            return {
                success: true,
                step: 'unlinked',
                unlinked: true,
                previousEmail: cleanEmail,
                message: "Gmail manzili hisobingizdan muvaffaqiyatli uzildi!"
            };
        }

        // AGAR YANGI EMAILNI BIRIKTIRISH (bind_new) BO'LSA:
        this.db.prepare(`
            UPDATE auth_users SET email = ?, updated_at = datetime('now', 'localtime')
            WHERE username = ?
        `).run(cleanEmail, cleanUser);

        return {
            success: true,
            step: 'completed',
            username: cleanUser,
            email: cleanEmail,
            message: "Gmail manzili muvaffaqiyatli tasdiqlandi va hisobingizga bog'landi!"
        };
    }

    parseCookies(cookieHeader) {
        const list = {};
        if (!cookieHeader) return list;
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                if (name) list[name] = decodeURIComponent(value);
            }
        });
        return list;
    }

    extractToken(req) {
        if (!req) return null;
        // 1. Cookie
        const cookies = this.parseCookies(req.headers.cookie);
        if (cookies['cc_session']) return cookies['cc_session'];

        // 2. Authorization header
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.slice(7).trim();
        }

        return null;
    }
}

module.exports = new AuthService();
