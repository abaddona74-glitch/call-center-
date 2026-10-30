/**
 * SQLite Database Service for Call Center CDR & Operator Analytics
 * Built using Node.js 24 native node:sqlite DatabaseSync
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const EXCLUDED_OPERATORS = new Set();

const KNOWN_OPERATORS = {
    '101': 'Oybek',
    '103': 'Feruza',
    '106': 'Ubaydullayeva Gulchehra',
    '111': 'Nozima',
    '114': 'Maxmudbek',
    '119': 'Muattar',
    '120': 'Navruzoy'
};

function findOperatorIdsByQuery(query) {
    if (!query || typeof query !== 'string') return [];
    const q = query.trim().toLowerCase();
    const matched = new Set();
    for (const [id, name] of Object.entries(KNOWN_OPERATORS)) {
        if (name.toLowerCase().includes(q) || q.includes(name.toLowerCase())) {
            matched.add(id);
        }
    }
    return Array.from(matched);
}

class DbService {
    constructor() {
        const dbDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        const dbPath = path.join(dbDir, 'callcenter.db');
        this.db = new DatabaseSync(dbPath);

        // WAL rejimini va 10 soniyalik kutish (busy_timeout) ni yoqish - database is locked xatolarining oldini oladi
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 10000;
            PRAGMA synchronous = NORMAL;
        `);

        this.initSchema();
    }

    initSchema() {
        // 1. Qo'ng'iroqlar tarixi (CDR - Call Detail Records)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS calls (
                id TEXT PRIMARY KEY,
                channel TEXT,
                caller_id TEXT,
                operator TEXT,
                operator_exten TEXT,
                direction TEXT DEFAULT 'inbound',
                status TEXT DEFAULT 'ANSWERED',
                hangup_party TEXT,
                duration INTEGER DEFAULT 0,
                cause TEXT,
                created_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls (caller_id);
            CREATE INDEX IF NOT EXISTS idx_calls_operator_exten ON calls (operator_exten);
        `);

        // 2. Kunlik operator statistikasi
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS operator_daily_stats (
                stat_date TEXT,
                operator_id TEXT,
                total_calls INTEGER DEFAULT 0,
                answered INTEGER DEFAULT 0,
                client_hangup INTEGER DEFAULT 0,
                operator_hangup INTEGER DEFAULT 0,
                denied INTEGER DEFAULT 0,
                total_duration_sec INTEGER DEFAULT 0,
                PRIMARY KEY (stat_date, operator_id)
            );
        `);

        // 3. Operator tomonidan rad etilgan (qizil tugma bosilgan) hodisalar
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS operator_reject_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_time TEXT,
                operator_id TEXT,
                caller_id TEXT,
                channel TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_reject_events_time ON operator_reject_events (event_time);
            CREATE INDEX IF NOT EXISTS idx_reject_events_op ON operator_reject_events (operator_id);

            -- 4. 3CX Desktop Agent to'liq qo'ng'iroqlar jurnali (Issabel bilan solishtirish uchun)
            CREATE TABLE IF NOT EXISTS agent_3cx_call_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_time TEXT,
                operator_id TEXT,
                caller_id TEXT,
                event_type TEXT,
                duration_sec INTEGER DEFAULT 0,
                start_time TEXT,
                end_time TEXT,
                hostname TEXT,
                details TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_3cx_logs_time ON agent_3cx_call_logs (event_time);
            CREATE INDEX IF NOT EXISTS idx_3cx_logs_op ON agent_3cx_call_logs (operator_id);
            CREATE INDEX IF NOT EXISTS idx_3cx_logs_type ON agent_3cx_call_logs (event_type);
            CREATE INDEX IF NOT EXISTS idx_3cx_logs_op_time ON agent_3cx_call_logs (operator_id, event_time);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_3cx_unique_call ON agent_3cx_call_logs (operator_id, caller_id, start_time);

            -- 5. Operator tomonidan o'tkazib yuborilgan (ko'tarilmagan / ring timeout) hodisalar
            CREATE TABLE IF NOT EXISTS operator_missed_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_time TEXT,
                operator_id TEXT,
                caller_id TEXT,
                channel TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_missed_events_time ON operator_missed_events (event_time);
            CREATE INDEX IF NOT EXISTS idx_missed_events_op ON operator_missed_events (operator_id);

            -- 6. Bog'lanishi kerak bo'lgan mijozlar (Pending Callbacks / Missed / IVR Non-working)
            CREATE TABLE IF NOT EXISTS pending_callbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                caller_name TEXT,
                source TEXT NOT NULL, -- 'abandoned' | 'ivr_non_working' | 'manual'
                call_time TEXT NOT NULL,
                attempts_count INTEGER DEFAULT 1,
                today_attempts INTEGER DEFAULT 1,
                status TEXT DEFAULT 'pending', -- 'pending' | 'resolved' | 'dismissed'
                dismissed_at TEXT,
                dismissed_by TEXT,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_pending_callbacks_phone ON pending_callbacks (phone);
            CREATE INDEX IF NOT EXISTS idx_pending_callbacks_status ON pending_callbacks (status);
            CREATE INDEX IF NOT EXISTS idx_pending_callbacks_time ON pending_callbacks (call_time DESC);

            -- 7. Mijozlar bazasi / Telefon kitobi (Client Contacts)
            CREATE TABLE IF NOT EXISTS client_contacts (
                phone TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                organization TEXT,
                notes TEXT,
                language TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_client_contacts_name ON client_contacts (name);
            CREATE INDEX IF NOT EXISTS idx_client_contacts_org ON client_contacts (organization);
        `);

        try {
            this.db.exec(`ALTER TABLE client_contacts ADD COLUMN language TEXT DEFAULT '';`);
        } catch (e) {
            // Already exists
        }

        try {
            this.db.exec(`ALTER TABLE operator_daily_stats ADD COLUMN missed INTEGER DEFAULT 0;`);
        } catch (e) {
            // Already exists
        }

        try {
            this.db.exec(`ALTER TABLE pending_callbacks ADD COLUMN outbound_attempts INTEGER DEFAULT 0;`);
        } catch (e) {}
        try {
            this.db.exec(`ALTER TABLE pending_callbacks ADD COLUMN last_outbound_time TEXT;`);
        } catch (e) {}
        try {
            this.db.exec(`ALTER TABLE pending_callbacks ADD COLUMN last_outbound_operator TEXT;`);
        } catch (e) {}
        try {
            this.db.exec(`ALTER TABLE pending_callbacks ADD COLUMN last_outbound_cause TEXT;`);
        } catch (e) {}
        try {
            this.db.exec(`ALTER TABLE pending_callbacks ADD COLUMN resolution_type TEXT;`);
        } catch (e) {}
        try {
            this.db.exec(`ALTER TABLE pending_callbacks ADD COLUMN today_attempts INTEGER DEFAULT 1;`);
        } catch (e) {}

        try {
            // Noto'g'ri 'NULL' yoki 'null' satrlarini tozalash
            this.db.exec(`
                UPDATE pending_callbacks 
                SET last_outbound_operator = NULL 
                WHERE last_outbound_operator = 'NULL' 
                   OR last_outbound_operator = 'null' 
                   OR last_outbound_operator = '\\N';
            `);
        } catch (e) {}

        try {
            // Noto'g'ri tushib qolgan ichki/trunk raqamlarni tozalash (2020159 va h.k.)
            this.db.exec(`
                DELETE FROM pending_callbacks 
                WHERE phone LIKE '%2020159%' 
                   OR phone = '712020159' 
                   OR LENGTH(phone) < 7 
                   OR LENGTH(phone) > 12;
            `);
        } catch (e) {}

        console.log('✅ SQLite ma\'lumotlar bazasi tayyor: data/callcenter.db');
    }

    /**
     * Hozirgi yoki berilgan vaqt call center ish vaqtiga (08:00 - 21:00) to'g'ri kelishini tekshirish
     */
    isWorkingHours(dateInput = null) {
        let d;
        if (dateInput) {
            d = new Date(dateInput);
        } else {
            const nowLocalStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' });
            d = new Date(nowLocalStr);
        }
        const hour = d.getHours();
        const min = d.getMinutes();
        const totalMinutes = hour * 60 + min;
        // 08:00 = 480 daqiqa, 21:00 = 1260 daqiqa
        return totalMinutes >= 480 && totalMinutes <= 1260;
    }

    /**
     * Operator qo'ng'iroqni rad etganda (jiringlaganda qizilni bosganda) bazaga yozish
     */
    recordOperatorReject(opId, callerId, channel, isWorkHours = null) {
        try {
            // Local vaqtni saqlash (UTC emas, Toshkent vaqti UTC+5)
            const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const dateStr = nowLocal.slice(0, 10); // "2026-09-03"

            const inWorkHours = isWorkHours !== null ? isWorkHours : this.isWorkingHours();
            const tagChannel = inWorkHours ? (channel || '3CX-Agent') : `${channel || '3CX-Agent'} (Ish vaqtidan tashqari)`;

            // 0. Dublikat tekshirish: so'nggi 5 soniya ichida aynan shu operator va shu raqam yozilgan bo'lsa - o'tkazib yuborish
            const recent = this.db.prepare(`
                SELECT id, event_time FROM operator_reject_events 
                WHERE operator_id = ? AND caller_id = ? 
                ORDER BY id DESC LIMIT 1
            `).get(String(opId), String(callerId || 'Yashirin raqam'));
            if (recent && recent.event_time) {
                const diffMs = Math.abs(new Date(nowLocal).getTime() - new Date(recent.event_time).getTime());
                if (diffMs < 5000) {
                    return false; // Dublikat, hisobga olinmaydi!
                }
            }

            // 1. Hodisa logiga yozish
            const insertEvent = this.db.prepare(`
                INSERT INTO operator_reject_events (event_time, operator_id, caller_id, channel)
                VALUES (?, ?, ?, ?)
            `);
            insertEvent.run(nowLocal, String(opId), String(callerId || 'Yashirin raqam'), String(tagChannel));

            // 2. Kunlik statistikani yangilash
            if (inWorkHours) {
                const existing = this.db.prepare(`SELECT * FROM operator_daily_stats WHERE stat_date = ? AND operator_id = ?`).get(dateStr, opId);
                if (!existing) {
                    this.db.prepare(`
                        INSERT INTO operator_daily_stats (stat_date, operator_id, total_calls, answered, client_hangup, operator_hangup, denied, missed, total_duration_sec)
                        VALUES (?, ?, 1, 0, 0, 0, 1, 0, 0)
                    `).run(dateStr, opId);
                } else {
                    this.db.prepare(`
                        UPDATE operator_daily_stats SET
                            total_calls = total_calls + 1,
                            denied = denied + 1
                        WHERE stat_date = ? AND operator_id = ?
                    `).run(dateStr, opId);
                }
            }
            return true;
        } catch (err) {
            console.error('❌ DB recordOperatorReject xatolik:', err.message);
            return false;
        }
    }

    /**
     * Operatorlar qancha qo'ng'iroqni rad etganini bazadan olish (Faqat ish vaqti: 08:00 - 21:00)
     * @param {string} [dateParam] - YYYY-MM-DD
     * @returns {Object} { [opId]: count }
     */
    getTodayOperatorRejects(dateParam) {
        try {
            const dateStr = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
                ? dateParam
                : new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            const rows = this.db.prepare(`
                SELECT operator_id, COUNT(DISTINCT event_time) as count 
                FROM operator_reject_events 
                WHERE event_time LIKE ? 
                  AND time(event_time) >= '08:00:00' 
                  AND time(event_time) <= '21:00:00'
                GROUP BY operator_id
            `).all(`${dateStr}%`);

            const map = {};
            for (const r of rows) {
                map[r.operator_id] = r.count || 0;
            }
            return map;
        } catch (err) {
            console.error('❌ DB getTodayOperatorRejects xatolik:', err.message);
            return {};
        }
    }

    /**
     * Operator qo'ng'iroqni o'tkazib yuborganda (jiringlaganda ko'tarmaganda) bazaga yozish
     */
    recordOperatorMissed(opId, callerId, channel, isWorkHours = null) {
        try {
            const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const dateStr = nowLocal.slice(0, 10);

            const inWorkHours = isWorkHours !== null ? isWorkHours : this.isWorkingHours();
            const tagChannel = inWorkHours ? (channel || 'AMI-Missed') : `${channel || 'AMI-Missed'} (Ish vaqtidan tashqari)`;

            // 0. Dublikat tekshirish: so'nggi 5 soniya ichida aynan shu operator va shu raqam yozilgan bo'lsa - o'tkazib yuborish
            const recent = this.db.prepare(`
                SELECT id, event_time FROM operator_missed_events 
                WHERE operator_id = ? AND caller_id = ? 
                ORDER BY id DESC LIMIT 1
            `).get(String(opId), String(callerId || 'Yashirin raqam'));
            if (recent && recent.event_time) {
                const diffMs = Math.abs(new Date(nowLocal).getTime() - new Date(recent.event_time).getTime());
                if (diffMs < 5000) {
                    return false; // Dublikat, hisobga olinmaydi!
                }
            }

            const insertEvent = this.db.prepare(`
                INSERT INTO operator_missed_events (event_time, operator_id, caller_id, channel)
                VALUES (?, ?, ?, ?)
            `);
            insertEvent.run(nowLocal, String(opId), String(callerId || 'Yashirin raqam'), String(tagChannel));

            if (inWorkHours) {
                const existing = this.db.prepare(`SELECT * FROM operator_daily_stats WHERE stat_date = ? AND operator_id = ?`).get(dateStr, opId);
                if (!existing) {
                    this.db.prepare(`
                        INSERT INTO operator_daily_stats (stat_date, operator_id, total_calls, answered, client_hangup, operator_hangup, denied, missed, total_duration_sec)
                        VALUES (?, ?, 1, 0, 0, 0, 0, 1, 0)
                    `).run(dateStr, opId);
                } else {
                    this.db.prepare(`
                        UPDATE operator_daily_stats SET
                            total_calls = total_calls + 1,
                            missed = COALESCE(missed, 0) + 1
                        WHERE stat_date = ? AND operator_id = ?
                    `).run(dateStr, opId);
                }
            }
            return true;
        } catch (err) {
            console.error('❌ DB recordOperatorMissed xatolik:', err.message);
            return false;
        }
    }

    /**
     * Operatorlar qancha qo'ng'iroqni o'tkazib yuborganini (Missed) bazadan olish (3CX Desktop Agent jurnali asosida)
     * @param {string} [dateParam] - YYYY-MM-DD
     * @returns {Object} { [opId]: count }
     */
    getTodayOperatorMissed(dateParam) {
        try {
            const dateStr = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
                ? dateParam
                : new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);

            const map = {};

            // 1. 3CX Desktop Agent jurnali bo'yicha operatorlar o'tkazib yuborgan (Missed) qo'ng'iroqlari
            try {
                const agentRows = this.db.prepare(`
                    SELECT
                        operator_id,
                        COUNT(CASE WHEN (event_type = 'MISSED' OR (duration_sec = 0 AND event_type NOT IN ('DIALLED', '1'))) AND LENGTH(caller_id) > 4 THEN 1 END) as count
                    FROM agent_3cx_call_logs
                    WHERE event_time >= ? AND event_time <= ?
                    GROUP BY operator_id
                `).all(`${dateStr} 08:00:00`, `${dateStr} 21:00:00`);

                for (const r of agentRows) {
                    const opId = String(r.operator_id);
                    if (EXCLUDED_OPERATORS.has(opId)) continue;
                    map[opId] = (map[opId] || 0) + (r.count || 0);
                }
            } catch (e) {
                console.error('❌ DB getTodayOperatorMissed agent_3cx xatolik:', e.message);
            }

            // 2. Agar operator_missed_events da ham yozuvlar bo'lsa (qo'shimcha)
            try {
                const rows = this.db.prepare(`
                    SELECT operator_id, COUNT(DISTINCT event_time) as count 
                    FROM operator_missed_events 
                    WHERE event_time LIKE ? 
                      AND time(event_time) >= '08:00:00' 
                      AND time(event_time) <= '21:00:00'
                    GROUP BY operator_id
                `).all(`${dateStr}%`);

                for (const r of rows) {
                    const opId = String(r.operator_id);
                    if (EXCLUDED_OPERATORS.has(opId)) continue;
                    if (!map[opId]) {
                        map[opId] = r.count || 0;
                    }
                }
            } catch (e) {}

            return map;
        } catch (err) {
            console.error('❌ DB getTodayOperatorMissed xatolik:', err.message);
            return {};
        }
    }

    /**
     * Rad etilgan qo'ng'iroqlar ro'yxatini sahifalab olish (Modal uchun)
     * @param {number} page
     * @param {number} limit
     * @param {string} search
     * @param {string} [dateParam]
     */
    getRejectEventsPaginated(page = 1, limit = 50, search = '', dateParam = '', operatorId = '') {
        try {
            const dateStr = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
                ? dateParam
                : new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            let countSql = `SELECT COUNT(*) as total FROM operator_reject_events WHERE event_time LIKE ? AND time(event_time) >= '08:00:00' AND time(event_time) <= '21:00:00'`;
            let dataSql = `SELECT * FROM operator_reject_events WHERE event_time LIKE ? AND time(event_time) >= '08:00:00' AND time(event_time) <= '21:00:00'`;
            const countParams = [`${dateStr}%`];
            const dataParams = [`${dateStr}%`];

            if (operatorId) {
                countSql += ` AND operator_id = ?`;
                dataSql += ` AND operator_id = ?`;
                countParams.push(String(operatorId));
                dataParams.push(String(operatorId));
            }

            if (search) {
                countSql += ` AND (operator_id LIKE ? OR caller_id LIKE ?)`;
                dataSql += ` AND (operator_id LIKE ? OR caller_id LIKE ?)`;
                countParams.push(`%${search}%`, `%${search}%`);
                dataParams.push(`%${search}%`, `%${search}%`);
            }

            const total = this.db.prepare(countSql).get(...countParams)?.total || 0;
            const offset = (Math.max(1, page) - 1) * limit;

            dataSql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
            dataParams.push(limit, offset);
            const rows = this.db.prepare(dataSql).all(...dataParams);

            const data = rows.map(r => ({
                time: r.event_time ? r.event_time.replace('T', ' ').slice(0, 19) : '',
                src: r.caller_id || 'Yashirin raqam',
                dst: r.operator_id || 'Operator',
                direction: 'inbound',
                operator: `Operator (${r.operator_id})`,
                durationFormatted: '00:00',
                status: 'DENIED',
                hangupParty: 'Operator (Qizil tugma / Reject)'
            }));

            return {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
                data
            };
        } catch (err) {
            console.error('❌ DB getRejectEventsPaginated xatolik:', err.message);
            return { total: 0, page: 1, limit, totalPages: 1, data: [] };
        }
    }

    /**
     * O'tkazib yuborilgan (Missed) qo'ng'iroqlar ro'yxatini sahifalab olish (Modal uchun)
     * @param {number} page
     * @param {number} limit
     * @param {string} search
     * @param {string} [dateParam]
     */
    getMissedEventsPaginated(page = 1, limit = 50, search = '', dateParam = '') {
        try {
            const dateStr = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
                ? dateParam
                : new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);

            let countSql = `
                SELECT COUNT(*) as total 
                FROM agent_3cx_call_logs 
                WHERE (event_type = 'MISSED' OR (duration_sec = 0 AND event_type NOT IN ('DIALLED', '1')))
                  AND event_time >= ? AND event_time <= ?
            `;
            let dataSql = `
                SELECT * 
                FROM agent_3cx_call_logs 
                WHERE (event_type = 'MISSED' OR (duration_sec = 0 AND event_type NOT IN ('DIALLED', '1')))
                  AND event_time >= ? AND event_time <= ?
            `;
            const countParams = [`${dateStr} 08:00:00`, `${dateStr} 21:00:00`];
            const dataParams = [`${dateStr} 08:00:00`, `${dateStr} 21:00:00`];

            if (search && search.trim()) {
                const s = `%${search.trim()}%`;
                countSql += ` AND (operator_id LIKE ? OR caller_id LIKE ?)`;
                dataSql += ` AND (operator_id LIKE ? OR caller_id LIKE ?)`;
                countParams.push(s, s);
                dataParams.push(s, s);
            }

            let total = this.db.prepare(countSql).get(...countParams)?.total || 0;
            const offset = (Math.max(1, page) - 1) * limit;

            dataSql += ` ORDER BY event_time DESC, id DESC LIMIT ? OFFSET ?`;
            dataParams.push(limit, offset);
            const rows = this.db.prepare(dataSql).all(...dataParams);

            const data = rows.map(r => ({
                time: r.event_time ? r.event_time.replace('T', ' ').slice(0, 19) : '',
                src: r.caller_id || 'Yashirin raqam',
                dst: r.operator_id || 'Operator',
                direction: 'inbound',
                operator: `Operator (${r.operator_id})`,
                durationFormatted: '00:00',
                status: 'MISSED',
                hangupParty: 'Operator javob bermadi (O\'tkazib yuborildi)'
            }));

            return {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
                data
            };
        } catch (err) {
            console.error('❌ DB getMissedEventsPaginated xatolik:', err.message);
            return { total: 0, page: 1, limit, totalPages: 1, data: [] };
        }
    }

    /**
     * Yangi yakunlangan qo'ng'iroqni bazaga saqlash
     */
    saveCall(call) {
        try {
            if (!call || !call.callerId) return;
            const cidStr = String(call.callerId).trim();
            if (cidStr === '712020159' || cidStr.endsWith('2020159') || cidStr.length < 7) {
                return;
            }

            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO calls 
                (id, channel, caller_id, operator, operator_exten, direction, status, hangup_party, duration, cause, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const localTime = call.time || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });

            stmt.run(
                String(call.id || Date.now()),
                String(call.channel || ''),
                String(call.callerId || 'Yashirin raqam (Hidden)'),
                String(call.operator || 'Operator'),
                String(call.operatorExten || ''),
                String(call.direction || 'inbound'),
                String(call.status || 'ANSWERED'),
                String(call.hangupParty || 'Noma\'lum'),
                parseInt(call.duration || '0', 10),
                String(call.cause || 'Normal'),
                localTime
            );

            // Kunlik operator statistikasini yangilash (faqat ish vaqti 08:00 - 21:00 va istisno qilinmagan raqamlar)
            if (call.operatorExten && !EXCLUDED_OPERATORS.has(String(call.operatorExten)) && this.isWorkingHours(localTime)) {
                const today = localTime.slice(0, 10);
                this.incrementOperatorDaily(today, call.operatorExten, call.status === 'ANSWERED', call.duration || 0, call.hangupParty);
            }
        } catch (err) {
            console.error('❌ DB saveCall xatolik:', err.message);
        }
    }

    incrementOperatorDaily(dateStr, opId, isAnswered, durationSec, hangupParty) {
        try {
            // Avval borligini tekshiramiz
            const getStmt = this.db.prepare(`SELECT * FROM operator_daily_stats WHERE stat_date = ? AND operator_id = ?`);
            const existing = getStmt.get(dateStr, opId);

            if (!existing) {
                const insertStmt = this.db.prepare(`
                    INSERT INTO operator_daily_stats (stat_date, operator_id, total_calls, answered, client_hangup, operator_hangup, denied, total_duration_sec)
                    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
                `);
                insertStmt.run(
                    dateStr,
                    opId,
                    isAnswered ? 1 : 0,
                    (isAnswered && (!hangupParty || hangupParty.includes('Mijoz'))) ? 1 : 0,
                    (isAnswered && hangupParty && hangupParty.includes('Operator')) ? 1 : 0,
                    0,
                    durationSec
                );
            } else {
                const updateStmt = this.db.prepare(`
                    UPDATE operator_daily_stats SET
                        total_calls = total_calls + 1,
                        answered = answered + ?,
                        client_hangup = client_hangup + ?,
                        operator_hangup = operator_hangup + ?,
                        total_duration_sec = total_duration_sec + ?
                    WHERE stat_date = ? AND operator_id = ?
                `);
                updateStmt.run(
                    isAnswered ? 1 : 0,
                    (isAnswered && (!hangupParty || hangupParty.includes('Mijoz'))) ? 1 : 0,
                    (isAnswered && hangupParty && hangupParty.includes('Operator')) ? 1 : 0,
                    durationSec,
                    dateStr,
                    opId
                );
            }
        } catch (err) {
            console.error('❌ DB incrementOperatorDaily xatolik:', err.message);
        }
    }

    /**
     * Tarixni paginatsiya va qidiruv bilan olish
     */
    getCallsPaginated(page = 1, limit = 20, search = '') {
        try {
            const offset = (Math.max(1, page) - 1) * limit;
            let countSql = `SELECT COUNT(*) as count FROM calls`;
            let dataSql = `SELECT * FROM calls`;
            const params = [];

            if (search) {
                const term = search.trim();
                const q = `%${term.toLowerCase()}%`;
                const matchedOpIds = findOperatorIdsByQuery(term);

                let filter = ` WHERE (LOWER(caller_id) LIKE ? OR LOWER(operator) LIKE ? OR LOWER(status) LIKE ? OR LOWER(hangup_party) LIKE ? OR operator_exten LIKE ?`;
                const filterParams = [q, q, q, q, `%${term}%`];

                if (matchedOpIds.length > 0) {
                    const placeholders = matchedOpIds.map(() => '?').join(',');
                    filter += ` OR operator_exten IN (${placeholders}))`;
                    filterParams.push(...matchedOpIds);
                } else {
                    filter += `)`;
                }

                countSql += filter;
                dataSql += filter;
                params.push(...filterParams);
            }

            dataSql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

            const countRow = this.db.prepare(countSql).get(...(search ? params.slice(0, 5) : []));
            const total = countRow ? countRow.count : 0;
            const totalPages = Math.ceil(total / limit) || 1;

            const rows = this.db.prepare(dataSql).all(...(search ? [...params, limit, offset] : [limit, offset]));

            const data = rows.map(r => ({
                id: r.id,
                channel: r.channel,
                callerId: r.caller_id,
                operator: r.operator,
                operatorExten: r.operator_exten,
                direction: r.direction,
                status: r.status,
                hangupParty: r.hangup_party,
                duration: r.duration,
                cause: r.cause,
                time: r.created_at
            }));

            return { total, page: Math.min(page, totalPages), totalPages, limit, data };
        } catch (err) {
            console.error('❌ DB getCallsPaginated xatolik:', err.message);
            return { total: 0, page: 1, totalPages: 1, limit, data: [] };
        }
    }

    /**
     * Bugungi umumiy statistikani bazadan olish
     */
    getTodaySummary() {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const row = this.db.prepare(`
                SELECT 
                    COUNT(*) as totalCalls,
                    SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inboundCalls,
                    SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) as outboundCalls,
                    SUM(CASE WHEN status = 'ANSWERED' THEN 1 ELSE 0 END) as answeredCalls,
                    SUM(CASE WHEN hangup_party LIKE '%Mijoz%' THEN 1 ELSE 0 END) as clientHangupCalls,
                    SUM(CASE WHEN hangup_party LIKE '%Operator%' THEN 1 ELSE 0 END) as operatorHangupCalls,
                    SUM(CASE WHEN status != 'ANSWERED' THEN 1 ELSE 0 END) as deniedCalls,
                    SUM(duration) as totalDurationSec
                FROM calls
                WHERE created_at LIKE ?
            `).get(`${today}%`);
            return row || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Bugungi soatlar bo'yicha kiruvchi va qabul qilingan qo'ng'iroqlar taqsimoti
     */
    getHourlyStats(dateStr) {
        try {
            const rows = this.db.prepare(`
                SELECT 
                    CAST(strftime('%H', created_at) AS INTEGER) as hour,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'ANSWERED' THEN 1 ELSE 0 END) as answered,
                    SUM(CASE WHEN status != 'ANSWERED' THEN 1 ELSE 0 END) as denied
                FROM calls
                WHERE created_at LIKE ?
                GROUP BY hour
                ORDER BY hour ASC
            `).all(`${dateStr}%`);

            return rows || [];
        } catch (e) {
            console.error('getHourlyStats error:', e.message);
            return [];
        }
    }

    /**
     * Navbat bir mijozni operatorga qayta-qayta jiringlatib qo'ysa (retry), 3CX Desktop Agent
     * har jiringlashni alohida "MISSED" deb yuborishi mumkin — natijada bitta chinakam
     * o'tkazib yuborilgan qo'ng'iroq o'nlab marta hisoblanib ketadi. Shu bitta operator +
     * bitta mijoz raqami uchun qisqa vaqt oralig'ida (90 soniya) faqat bittasini hisoblaymiz.
     */
    _hasRecentMissed(opId, caller, eventTime) {
        try {
            const row = this.db.prepare(`
                SELECT id FROM agent_3cx_call_logs
                WHERE operator_id = ? AND caller_id = ? AND event_type = 'MISSED'
                  AND ABS(strftime('%s', ?) - strftime('%s', event_time)) <= 90
                LIMIT 1
            `).get(opId, caller, eventTime);
            return !!row;
        } catch (e) {
            return false;
        }
    }

    /**
     * 3CX Desktop Agent tomonidan yuborilgan to'liq qo'ng'iroq hodisasini saqlash
     */
    recordAgentCallLog(data) {
        try {
            const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const opId = String(data.operatorId || '');
            const caller = String(data.callerId || 'Yashirin raqam');
            const details = String(data.details || '');
            const eventType = String(data.eventType || 'UNKNOWN').toUpperCase();

            // Vaqtni ISO / YYYY-MM-DD HH:mm:ss formatga keltirish
            let eventTime = nowLocal;
            if (data.startTime) {
                eventTime = String(data.startTime).replace(/\//g, '-').trim();
            }

            // "MISSED" hodisalar uchun qayta-qayta jiringlash sabab kelib chiqadigan
            // dublikatlarni to'xtatish (yuqoridagi izohga qarang)
            if (eventType === 'MISSED' && this._hasRecentMissed(opId, caller, eventTime)) {
                return null;
            }

            // Takroriy yozuvlarni oldini olish
            if (details) {
                const existing = this.db.prepare(`
                    SELECT id FROM agent_3cx_call_logs
                    WHERE operator_id = ? AND caller_id = ? AND details = ?
                `).get(opId, caller, details);
                if (existing) return existing;
            }

            const insert = this.db.prepare(`
                INSERT OR IGNORE INTO agent_3cx_call_logs (
                    event_time, operator_id, caller_id, event_type, duration_sec, start_time, end_time, hostname, details
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            return insert.run(
                eventTime,
                opId,
                caller,
                String(data.eventType || 'UNKNOWN'),
                parseInt(data.durationSec || 0, 10),
                String(data.startTime || eventTime),
                String(data.endTime || eventTime),
                String(data.hostname || ''),
                details
            );
        } catch (err) {
            console.error('❌ recordAgentCallLog xatolik:', err.message);
            return null;
        }
    }

    /**
     * 3CX Desktop Agent tomonidan yuborilgan to'plamli (batch) qo'ng'iroqlarni saqlash
     */
    recordAgentCallLogsBatch(operatorId, hostname, calls) {
        if (!Array.isArray(calls) || calls.length === 0) return 0;
        try {
            const insert = this.db.prepare(`
                INSERT OR IGNORE INTO agent_3cx_call_logs (
                    event_time, operator_id, caller_id, event_type, duration_sec, start_time, end_time, hostname, details
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const opId = String(operatorId || '');
            const host = String(hostname || '');
            const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });

            this.db.exec('BEGIN TRANSACTION');
            let count = 0;
            for (const c of calls) {
                const caller = String(c.callerId || 'Yashirin raqam');
                const startTime = c.startTime ? String(c.startTime).replace(/\//g, '-').trim() : nowLocal;
                const endTime = c.endTime ? String(c.endTime).replace(/\//g, '-').trim() : startTime;
                const eventTime = startTime;
                const dur = parseInt(c.durationSec || 0, 10);
                let evType = String(c.eventType || 'UNKNOWN');
                let details = String(c.details || '');

                if (evType === 'ANSWERED' && dur === 0) {
                    evType = 'MISSED';
                    if (details.includes('3CX Qabul qilindi')) {
                        details = details.replace('3CX Qabul qilindi', '3CX O\'tkazib yuborildi');
                    }
                }

                // Qayta-qayta jiringlash (navbat retry) sabab kelib chiqadigan "MISSED"
                // dublikatlarni o'tkazib yuborish (bir xil tranzaksiya ichida oldin
                // qo'shilgan qatorlar ham ko'rinadi, shuning uchun bitta batch ichidagi
                // "burst" ham to'xtatiladi)
                if (evType === 'MISSED' && this._hasRecentMissed(opId, caller, eventTime)) {
                    continue;
                }

                const res = insert.run(
                    eventTime,
                    opId,
                    caller,
                    evType,
                    dur,
                    startTime,
                    endTime,
                    host,
                    details
                );
                if (res.changes > 0) count++;
            }
            this.db.exec('COMMIT');
            return count;
        } catch (err) {
            try { this.db.exec('ROLLBACK'); } catch (e) {}
            console.error('❌ recordAgentCallLogsBatch xatolik:', err.message);
            return 0;
        }
    }

    /**
     * 3CX Desktop Agent tomonidan to'plangan kunlik operatorlar statistikasi
     * (Bugungi ANSWERED, MISSED, davomiyligi va o'rtacha suhbat vaqti)
     */
    getTodayAgentOperatorStats(targetDate = null) {
        try {
            const todayStr = targetDate || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            const startDay = `${todayStr} 00:00:00`;
            const endDay = `${todayStr} 23:59:59`;
            
            // Faqat 3CX Desktop Agent maxsus jurnali (0 soniyaliklar javob berilgan deb hisoblanmaydi)
            // Ichki (operatordan-operatorga) qo'ng'iroqlar chiqarib tashlanadi: caller_id 2-4 xonali
            // bo'lsa, bu tashqi telefon raqami emas, balki boshqa operatorning ichki extensioni
            // (masalan '106', '111'), shuning uchun statistikaga qo'shilmasligi kerak.
            const agentRows = this.db.prepare(`
                SELECT
                    operator_id,
                    COUNT(CASE WHEN (event_type = 'ANSWERED' OR event_type = '2') AND duration_sec > 0 AND LENGTH(caller_id) > 4 THEN 1 END) as answered,
                    COUNT(CASE WHEN (event_type = 'DIALLED' OR event_type = '1') AND duration_sec > 0 AND LENGTH(caller_id) > 4 THEN 1 END) as outbound,
                    COUNT(CASE WHEN (event_type = 'MISSED' OR (duration_sec = 0 AND event_type NOT IN ('DIALLED', '1'))) AND LENGTH(caller_id) > 4 THEN 1 END) as missed,
                    SUM(CASE WHEN (event_type IN ('ANSWERED', '2', 'DIALLED', '1')) AND duration_sec > 0 AND LENGTH(caller_id) > 4 THEN duration_sec ELSE 0 END) as total_duration_sec
                FROM agent_3cx_call_logs
                WHERE event_time >= ? AND event_time <= ?
                GROUP BY operator_id
            `).all(startDay, endDay);

            const map = {};
            for (const r of agentRows) {
                const opId = String(r.operator_id);
                const ans = r.answered || 0;
                const out = r.outbound || 0;
                const totDur = r.total_duration_sec || 0;
                const spoken = ans + out;
                map[opId] = {
                    operatorId: opId,
                    answered: ans,
                    outbound: out,
                    missed: r.missed || 0,
                    totalDurationSec: totDur,
                    avgDurationSec: spoken > 0 ? Math.round(totDur / spoken) : 0
                };
            }

            return map;
        } catch (err) {
            console.error('❌ getTodayAgentOperatorStats error:', err.message);
            return {};
        }
    }

    /**
     * 3CX Agent jurnali bo'yicha sahifalab olish (Faqat 3CX Desktop Agent yozuvlari)
     */
    getAgentCallLogsPaginated(page = 1, limit = 50, operatorId = null, dateFilter = 'today', search = '') {
        try {
            page = Math.max(1, parseInt(page, 10) || 1);
            limit = Math.min(Math.max(10, parseInt(limit, 10) || 50), 500);
            const offset = (page - 1) * limit;

            let dateStr = null;
            if (dateFilter === 'today' || !dateFilter) {
                dateStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            } else if (dateFilter !== 'all' && /^\d{4}-\d{2}-\d{2}/.test(dateFilter)) {
                dateStr = String(dateFilter).slice(0, 10);
            }

            let countSql = `SELECT COUNT(*) as total FROM agent_3cx_call_logs WHERE 1=1`;
            let dataSql = `SELECT * FROM agent_3cx_call_logs WHERE 1=1`;
            const params = [];

            if (dateStr) {
                countSql += ` AND event_time >= ? AND event_time <= ?`;
                dataSql += ` AND event_time >= ? AND event_time <= ?`;
                params.push(`${dateStr} 00:00:00`, `${dateStr} 23:59:59`);
            }

            if (operatorId) {
                countSql += ` AND operator_id = ?`;
                dataSql += ` AND operator_id = ?`;
                params.push(String(operatorId));
            }

            if (search && typeof search === 'string' && search.trim()) {
                const term = search.trim();
                const s = `%${term}%`;
                const matchedOpIds = findOperatorIdsByQuery(term);

                if (matchedOpIds.length > 0) {
                    const placeholders = matchedOpIds.map(() => '?').join(',');
                    countSql += ` AND (caller_id LIKE ? OR operator_id LIKE ? OR details LIKE ? OR hostname LIKE ? OR operator_id IN (${placeholders}))`;
                    dataSql += ` AND (caller_id LIKE ? OR operator_id LIKE ? OR details LIKE ? OR hostname LIKE ? OR operator_id IN (${placeholders}))`;
                    params.push(s, s, s, s, ...matchedOpIds);
                } else {
                    countSql += ` AND (caller_id LIKE ? OR operator_id LIKE ? OR details LIKE ? OR hostname LIKE ?)`;
                    dataSql += ` AND (caller_id LIKE ? OR operator_id LIKE ? OR details LIKE ? OR hostname LIKE ?)`;
                    params.push(s, s, s, s);
                }
            }

            dataSql += ` ORDER BY event_time DESC, id DESC LIMIT ? OFFSET ?`;

            let total = this.db.prepare(countSql).get(...params).total;
            let rows = this.db.prepare(dataSql).all(...params, limit, offset);

            if (total === 0) {
                return {
                    total: 0,
                    page,
                    limit,
                    totalPages: 1,
                    data: []
                };
            }

            const data = rows.map(r => {
                let status = r.event_type || 'UNKNOWN';
                let category3cx = 'All calls';
                let statusName = status;

                if (status === 'REJECT') {
                    category3cx = 'Missed';
                    statusName = 'Rad etilgan (Deny)';
                } else if (status === 'MISSED') {
                    category3cx = 'Missed';
                    statusName = 'O\'tkazib yuborilgan (Missed)';
                } else if (status === 'ANSWERED') {
                    if (r.duration_sec === 0) {
                        status = 'MISSED';
                        category3cx = 'Missed';
                        statusName = 'O\'tkazib yuborilgan (Missed)';
                    } else {
                        category3cx = 'Answered';
                        statusName = 'Qabul qilingan (Answered)';
                    }
                } else if (status === 'OUTBOUND' || status === 'DIALLED') {
                    category3cx = 'Dialled';
                    statusName = (r.duration_sec === 0) ? 'Chiquvchi (Ulanmagan)' : 'Chiquvchi (Dialled)';
                } else if (status === 'INCOMING') {
                    if (r.duration_sec === 0) {
                        status = 'MISSED';
                        category3cx = 'Missed';
                        statusName = 'O\'tkazib yuborilgan (Missed)';
                    } else {
                        status = 'ANSWERED';
                        category3cx = 'Answered';
                        statusName = 'Qabul qilingan (Answered)';
                    }
                }

                return {
                    id: r.id,
                    event_time: r.event_time,
                    operator_id: r.operator_id,
                    caller_id: r.caller_id,
                    status: status,
                    status_name: statusName,
                    category_3cx: category3cx,
                    duration_sec: r.duration_sec,
                    hostname: r.hostname,
                    details: r.details
                };
            });

            return {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
                data: data
            };
        } catch (err) {
            console.error('getAgentCallLogsPaginated error:', err.message);
            return { total: 0, page: 1, limit, totalPages: 1, data: [] };
        }
    }

    /**
     * Telefon raqamini tozalash va standartlashtirish (masalan: 901234567)
     */
    normalizePhone(raw) {
        if (!raw) return null;
        let digits = String(raw).replace(/[^0-9]/g, '');
        if (digits.length === 12 && digits.startsWith('998')) {
            digits = digits.slice(3);
        }
        // Ichki operator raqamlari (100-299) yoki qisqa raqamlarni istisno qilish
        if (digits.length < 7 || digits.length > 12) return null;

        // Call center o'zining trunk/DID raqamlari (2020159, 712020159 va h.k.) ni istisno qilish
        if (digits === '2020159' || digits === '712020159' || digits.endsWith('2020159')) {
            return null;
        }

        return digits;
    }

    /**
     * Faol (bog'lanilishi kerak bo'lgan) mijozlar ro'yxatini olish (faqat pending)
     * filter: 'all' (barchasi) yoki 'today' (bugungi kun)
     */
    getPendingCallbacks(filter = 'all') {
        return this.getCallbacks(filter, false);
    }

    /**
     * Barcha callbacks ro'yxatini olish (pending va resolved)
     * filter: 'all' yoki 'today'
     * includeResolved: true bo'lsa gaplashilgan (resolved) mijozlar ham qaytadi
     */
    getCallbacks(filter = 'all', includeResolved = true) {
        try {
            let sql = `
                SELECT 
                    id,
                    phone,
                    caller_name,
                    source,
                    call_time,
                    attempts_count,
                    COALESCE(outbound_attempts, 0) as outbound_attempts,
                    last_outbound_time,
                    last_outbound_operator,
                    last_outbound_cause,
                    status,
                    dismissed_at,
                    dismissed_by,
                    COALESCE(resolution_type, '') as resolution_type,
                    notes,
                    created_at,
                    updated_at
                FROM pending_callbacks
                WHERE phone NOT LIKE '%2020159%'
                  AND phone != '712020159'
                  AND LENGTH(phone) >= 7
                  AND source != 'ivr_non_working'
            `;
            if (includeResolved) {
                sql += ` AND status IN ('pending', 'resolved')`;
            } else {
                sql += ` AND status = 'pending'`;
            }

            const params = [];
            if (filter === 'today') {
                const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
                sql += ` AND call_time LIKE ?`;
                params.push(`${todayStr}%`);
            } else if (filter && /^\d{4}-\d{2}-\d{2}$/.test(filter)) {
                sql += ` AND call_time LIKE ?`;
                params.push(`${filter}%`);
            }

            sql += `
                ORDER BY 
                  CASE WHEN status = 'pending' THEN 0 ELSE 1 END ASC,
                  CASE WHEN COALESCE(outbound_attempts, 0) = 0 THEN 0 ELSE 1 END ASC,
                  call_time DESC,
                  COALESCE(updated_at, created_at) DESC
                LIMIT 500
            `;

            const stmt = this.db.prepare(sql);
            const rawRows = stmt.all(...params);

            // Unikal mijozlar bo'yicha guruhlash:
            // - Agar 'pending' bo'lsa: bir xil raqam bo'yicha bitta qilib jamlaymiz (operator bitta qo'ng'iroq qilishi uchun)
            // - Agar 'resolved' bo'lsa: sana bo'yicha ajratamiz (chunki o'tgan haftadagi hal qilingan qo'ng'iroq bugungisiga qo'shilib ketmasligi kerak)
            // - today_attempts esa FAQAT bugungi (Toshkent vaqti) urinishlarni hisoblaydi!
            const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            const map = new Map();
            for (const r of rawRows) {
                const isPending = (r.status === 'pending' || !r.status);
                const callDate = r.call_time ? r.call_time.slice(0, 10) : (r.created_at ? r.created_at.slice(0, 10) : todayStr);
                const groupKey = isPending ? `pending_${r.phone}` : `${r.phone}_${callDate}`;

                const isToday = Boolean(r.call_time && r.call_time.startsWith(todayStr));
                const att = Number(r.attempts_count) || 1;
                const rTodayAtt = (r.today_attempts !== undefined && r.today_attempts !== null)
                    ? Number(r.today_attempts)
                    : (isToday ? att : 0);

                if (!map.has(groupKey)) {
                    map.set(groupKey, {
                        ...r,
                        today_attempts: rTodayAtt,
                        attempts_count: att
                    });
                } else {
                    const existing = map.get(groupKey);
                    if (isToday) {
                        existing.today_attempts = Math.max(existing.today_attempts || 0, rTodayAtt);
                    }
                    existing.attempts_count = Math.max(existing.attempts_count || 1, att);
                    if (r.call_time && (!existing.call_time || r.call_time > existing.call_time)) {
                        existing.call_time = r.call_time;
                    }
                }
            }
            return Array.from(map.values());
        } catch (err) {
            console.error('getCallbacks error:', err.message);
            return [];
        }
    }

    /**
     * Navbatdan chiqqan qo'ng'iroqlarning kutilmoqda, ulanilmadi va gaplashildi bo'yicha taqsimoti
     */
    getAbandonedBreakdown(dateFilter = 'today') {
        try {
            const list = this.getCallbacks(dateFilter, true).filter(c => c.source === 'abandoned');
            const pendingList = list.filter(c => (c.status === 'pending' || !c.status) && (!c.outbound_attempts || c.outbound_attempts === 0));
            const unreachableList = list.filter(c => (c.status === 'pending' || !c.status) && c.outbound_attempts && c.outbound_attempts > 0);
            const resolvedList = list.filter(c => c.status === 'resolved');

            const pendingCount = pendingList.length;
            const unreachableCount = unreachableList.length;
            const resolvedCount = resolvedList.length;

            return { pendingCount, unreachableCount, resolvedCount };
        } catch (e) {
            return { pendingCount: 0, unreachableCount: 0, resolvedCount: 0 };
        }
    }

    /**
     * Yangi qo'shish yoki mavjud bo'lsa yangilash (Deduplication)
     * Agar mijoz 'pending' holatida bo'lsa: vaqti yangilanadi, attempts_count oshadi
     * Agar mijoz avval dismissed yoki resolved bo'lsa: faqatgina yangi qo'ng'iroq vaqti (callTime)
     * o'chirilgan/hal qilingan vaqtdan KEYIN bo'lsagina yangi pending yozuv ochiladi (eski qo'ng'iroqlar qaytib chiqmaydi)
     */
    upsertCallback({ phone, callerName = '', source = 'abandoned', callTime = null, attemptsCount = 1, todayAttempts = null }) {
        const cleanPhone = this.normalizePhone(phone);
        if (!cleanPhone) return null;

        const timeStr = callTime || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).replace('T', ' ');
        const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
        const isCallToday = Boolean(timeStr && timeStr.startsWith(todayStr));

        try {
            // 1. Agar 'pending' holatida mavjud bo'lsa - uni yangilaymiz
            const pendingStmt = this.db.prepare(`
                SELECT id, attempts_count, today_attempts, call_time FROM pending_callbacks 
                WHERE phone = ? AND status = 'pending'
                ORDER BY id DESC LIMIT 1
            `);
            const pendingRecord = pendingStmt.get(cleanPhone);

            if (pendingRecord) {
                // Mavjud yozuvni yangilash
                let newAttempts = pendingRecord.attempts_count;
                let newTodayAttempts = pendingRecord.today_attempts !== undefined && pendingRecord.today_attempts !== null
                    ? pendingRecord.today_attempts
                    : (isCallToday ? pendingRecord.attempts_count : 0);

                const isNewCall = timeStr && timeStr > (pendingRecord.call_time || '');
                if (attemptsCount !== undefined && attemptsCount !== null && Number.isInteger(attemptsCount)) {
                    newAttempts = attemptsCount;
                } else if (isNewCall) {
                    newAttempts = (pendingRecord.attempts_count || 1) + 1;
                }

                if (todayAttempts !== undefined && todayAttempts !== null && Number.isInteger(todayAttempts)) {
                    newTodayAttempts = todayAttempts;
                } else if (isNewCall && isCallToday) {
                    newTodayAttempts = (newTodayAttempts || 0) + 1;
                }

                const newerTime = (!pendingRecord.call_time || timeStr >= pendingRecord.call_time) ? timeStr : pendingRecord.call_time;

                // Agar mijoz yangi qo'ng'iroq bilan kelgan bo'lsa, 'Kutilmoqda' (outbound_attempts = 0) ga qaytariladi
                const updateStmt = this.db.prepare(`
                    UPDATE pending_callbacks 
                    SET 
                        call_time = ?,
                        attempts_count = ?,
                        today_attempts = ?,
                        source = ?,
                        caller_name = COALESCE(NULLIF(?, ''), caller_name),
                        outbound_attempts = CASE WHEN ? = 1 THEN 0 ELSE outbound_attempts END,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?
                `);
                updateStmt.run(newerTime, newAttempts, newTodayAttempts, source, callerName || '', isNewCall ? 1 : 0, pendingRecord.id);
                return { id: pendingRecord.id, phone: cleanPhone, updated: true };
            }

            // 2. Agar 'pending' bo'lmasa, avval o'chirilgan (dismissed) yoki hal qilingan (resolved) oxirgi yozuvni tekshiramiz
            const lastRecord = this.db.prepare(`
                SELECT id, attempts_count, call_time, status, dismissed_at, updated_at 
                FROM pending_callbacks 
                WHERE phone = ? 
                ORDER BY id DESC LIMIT 1
            `).get(cleanPhone);

            if (lastRecord) {
                if (lastRecord.status === 'dismissed') {
                    // Agar bu qo'ng'iroq vaqti o'chirilgan yozuvning vaqti bilan bir xil yoki undan oldin bo'lsa,
                    // yoki o'chirilgan paytdan (dismissed_at) oldin bo'lsa:
                    // demak bu avval admin tomonidan o'chirilgan ESKI qo'ng'iroq! Uni qayta chiqarmaymiz!
                    const dismissedAt = lastRecord.dismissed_at || lastRecord.updated_at || '';
                    if (timeStr <= (lastRecord.call_time || '') || (dismissedAt && timeStr <= dismissedAt)) {
                        return null; // O'chirilgan, qayta tiklanmasin!
                    }
                } else if (lastRecord.status === 'resolved') {
                    // Agar operator gaplashib yopgan bo'lsa va bu o'sha eski qo'ng'iroq bo'lsa:
                    const resolvedAt = lastRecord.updated_at || '';
                    if (timeStr <= (lastRecord.call_time || '') || (resolvedAt && timeStr <= resolvedAt)) {
                        return null; // Yopilgan, qayta chiqarmaymiz!
                    }
                }
            }

            // 3. Yangi kiritish (faqatgina yangi raqam yoki o'chirilgandan/hal qilingandan KEYIN kelgan yangi qo'ng'iroq bo'lsa)
            const initialTodayAttempts = (todayAttempts !== undefined && todayAttempts !== null && Number.isInteger(todayAttempts))
                ? todayAttempts
                : (isCallToday ? attemptsCount : 0);

            const insertStmt = this.db.prepare(`
                INSERT INTO pending_callbacks (phone, caller_name, source, call_time, attempts_count, today_attempts, status, outbound_attempts)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)
            `);
            const res = insertStmt.run(cleanPhone, callerName || '', source, timeStr, attemptsCount, initialTodayAttempts);
            return { id: res.lastInsertRowid, phone: cleanPhone, inserted: true };
        } catch (err) {
            console.error('upsertCallback error:', err.message);
            return null;
        }
    }

    /**
     * Operator mijoz bilan gaplashganda (Answered bo'lganda) ro'yxatdan avtomatik yechish
     * resolutionType: 'operator_outbound' | 'client_inbound'
     */
    resolveCallback(phone, resolvedBy = 'operator_answered', operatorName = null, resolutionType = null) {
        const cleanPhone = this.normalizePhone(phone);
        if (!cleanPhone) return false;

        try {
            let cleanOpName = operatorName;
            if (cleanOpName === 'NULL' || cleanOpName === 'null' || cleanOpName === '\\N' || cleanOpName === '' || (typeof cleanOpName === 'string' && (cleanOpName.includes('cdr_sync') || cleanOpName.includes('hangup')))) {
                cleanOpName = null;
            }

            // Agar operatorName berilmagan bo'lsa, resolvedBy dan raqamni topish
            if (!cleanOpName && resolvedBy && (resolvedBy.startsWith('3cx_') || resolvedBy.startsWith('operator_'))) {
                const match = resolvedBy.match(/operator_(\d{2,4})/);
                if (match && match[1]) {
                    cleanOpName = match[1];
                } else {
                    const parts = resolvedBy.split('_');
                    const ext = parts.find(p => /^\d{2,4}$/.test(p));
                    if (ext) cleanOpName = ext;
                }
            }

            // Agar cleanOpName faqat raqam bo'lsa (masalan 103, 111), uni ismga aylantirish
            if (cleanOpName && /^\d{2,4}$/.test(String(cleanOpName).trim())) {
                const ext = String(cleanOpName).trim();
                const named = KNOWN_OPERATORS[ext];
                cleanOpName = named ? `${named} (${ext})` : `Operator ${ext}`;
            }

            // Resolution type ni aniqlash
            let resType = resolutionType;
            if (!resType) {
                if (resolvedBy && (resolvedBy.includes('outbound') || resolvedBy === 'realtime_outbound_bridge')) {
                    resType = 'operator_outbound';
                } else if (resolvedBy && (resolvedBy.includes('inbound') || resolvedBy === 'realtime_agent_connect')) {
                    resType = 'client_inbound';
                }
            }

            const phone9 = cleanPhone;
            const phone12 = `998${cleanPhone}`;

            const stmt = this.db.prepare(`
                UPDATE pending_callbacks
                SET 
                    status = 'resolved',
                    dismissed_at = datetime('now', 'localtime'),
                    dismissed_by = ?,
                    last_outbound_operator = CASE 
                        WHEN ? IS NOT NULL AND ? != '' THEN ? 
                        WHEN last_outbound_operator = 'NULL' OR last_outbound_operator = 'null' THEN NULL
                        ELSE last_outbound_operator 
                    END,
                    resolution_type = COALESCE(?, resolution_type),
                    updated_at = datetime('now', 'localtime')
                WHERE (phone = ? OR phone = ? OR phone = ? OR phone LIKE ?) AND status = 'pending'
            `);
            const res = stmt.run(resolvedBy, cleanOpName, cleanOpName, cleanOpName, resType, phone9, phone12, String(phone), `%${cleanPhone}%`);

            // Allaqachon resolved bo'lgan yozuvlarda agar operator NULL yoki resolution_type bo'sh bo'lsa yangilash
            if (cleanOpName || resType) {
                try {
                    this.db.prepare(`
                        UPDATE pending_callbacks
                        SET 
                            last_outbound_operator = CASE 
                                WHEN (? IS NOT NULL AND (last_outbound_operator IS NULL OR last_outbound_operator = 'NULL' OR last_outbound_operator = 'null')) THEN ?
                                ELSE last_outbound_operator 
                            END,
                            resolution_type = COALESCE(?, resolution_type)
                        WHERE (phone = ? OR phone = ? OR phone = ? OR phone LIKE ?)
                          AND status = 'resolved'
                    `).run(cleanOpName, cleanOpName, resType, phone9, phone12, String(phone), `%${cleanPhone}%`);
                } catch (subErr) {}
            }

            return res.changes > 0;
        } catch (err) {
            console.error('resolveCallback error:', err.message);
            return false;
        }
    }

    /**
     * Operator chiquvchi qo'ng'iroq qilganida, mijoz go'shakni ko'tarmasa (No answer, Busy, etc.)
     * 'pending' mijozning chiquvchi urinishlar sonini (outbound_attempts) oshirish va
     * oxirgi uringan operator va vaqtni belgilash ("Bog'lanib bo'lmadi" ro'yxatiga o'tadi)
     */
    recordFailedOutboundAttempt({ phone, operator, cause = '', time = null, attempts = null }) {
        const cleanPhone = this.normalizePhone(phone);
        if (!cleanPhone) return null;

        const timeStr = time || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).replace('T', ' ');

        try {
            // Pending yozuvni qidiramiz
            const row = this.db.prepare(`
                SELECT id, outbound_attempts, last_outbound_time 
                FROM pending_callbacks
                WHERE (phone = ? OR phone = ? OR phone = ? OR phone LIKE ?) AND status = 'pending'
                ORDER BY id DESC LIMIT 1
            `).get(cleanPhone, `998${cleanPhone}`, String(phone), `%${cleanPhone}%`);

            if (!row) return null;

            // Takroriy hisoblanishni oldini olish yoki CDR dan aniq urinishlar sonini olish
            let finalAttempts = 1;
            if (attempts !== null && attempts !== undefined) {
                finalAttempts = Math.max(parseInt(attempts, 10) || 1, row.outbound_attempts || 0, 1);
            } else {
                finalAttempts = (row.outbound_attempts || 0) + 1;
                if (row.last_outbound_time) {
                    const prevTime = new Date(row.last_outbound_time.replace(' ', 'T')).getTime();
                    const currTime = new Date(timeStr.replace(' ', 'T')).getTime();
                    if (!isNaN(prevTime) && !isNaN(currTime) && Math.abs(currTime - prevTime) < 20000) {
                        finalAttempts = Math.max(1, row.outbound_attempts || 1);
                    }
                }
            }

            // Sababni qulay o'zbek tiliga keltirish
            let cleanCause = 'Javob bermadi';
            if (cause) {
                const c = String(cause).toLowerCase();
                if (c.includes('busy') || c === '17') cleanCause = 'Mijoz band';
                else if (c.includes('no answer') || c.includes('no user') || c === '18' || c === '19' || c.includes('failed')) cleanCause = 'Javob bermadi';
                else if (c.includes('reject') || c === '21') cleanCause = 'Rad etildi';
                else if (c.includes('absent') || c.includes('unavail') || c === '20') cleanCause = 'Aloqa doirasidan tashqarida';
            }

            const stmt = this.db.prepare(`
                UPDATE pending_callbacks
                SET 
                    outbound_attempts = ?,
                    last_outbound_time = ?,
                    last_outbound_operator = ?,
                    last_outbound_cause = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `);
            stmt.run(finalAttempts, timeStr, operator || 'Operator', cleanCause, row.id);
            return { id: row.id, phone: cleanPhone, outbound_attempts: finalAttempts, updated: true };
        } catch (err) {
            console.error('recordFailedOutboundAttempt error:', err.message);
            return null;
        }
    }

    /**
     * Admin tomonidan o'chirish (dismiss / delete bitta mijozni)
     */
    dismissCallback(id, dismissedBy = 'admin') {
        try {
            const row = this.db.prepare(`SELECT phone FROM pending_callbacks WHERE id = ?`).get(id);
            if (!row) return false;

            const stmt = this.db.prepare(`
                UPDATE pending_callbacks
                SET 
                    status = 'dismissed',
                    dismissed_at = datetime('now', 'localtime'),
                    dismissed_by = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ? OR (phone = ? AND status = 'pending')
            `);
            const res = stmt.run(dismissedBy, id, row.phone);
            return res.changes > 0;
        } catch (err) {
            console.error('dismissCallback error:', err.message);
            return false;
        }
    }

    /**
     * Admin tomonidan barcha 'pending' mijozlarni birdaniga o'chirish (Clear all)
     */
    dismissAllCallbacks(dismissedBy = 'admin') {
        try {
            const stmt = this.db.prepare(`
                UPDATE pending_callbacks
                SET 
                    status = 'dismissed',
                    dismissed_at = datetime('now', 'localtime'),
                    dismissed_by = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE status = 'pending'
            `);
            const res = stmt.run(dismissedBy);
            return res.changes;
        } catch (err) {
            console.error('dismissAllCallbacks error:', err.message);
            return 0;
        }
    }

    /**
     * Butunlay o'chirib tashlash (agar kerak bo'lsa)
     */
    deleteCallbackPermanent(id) {
        try {
            const stmt = this.db.prepare(`DELETE FROM pending_callbacks WHERE id = ?`);
            const res = stmt.run(id);
            return res.changes > 0;
        } catch (err) {
            console.error('deleteCallbackPermanent error:', err.message);
            return false;
        }
    }

    /**
     * Telefon raqamini tozalash (kontaktlar uchun 9 xonali standart)
     */
    cleanContactPhone(raw) {
        if (!raw) return null;
        let digits = String(raw).replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('998')) {
            digits = digits.slice(3);
        }
        return digits || String(raw).trim();
    }

    /**
     * Mijoz kontakt ma'lumotini saqlash yoki yangilash (Upsert)
     */
    saveContact(contactData) {
        try {
            const rawPhone = contactData.phone || '';
            const cleanPhone = this.cleanContactPhone(rawPhone);
            if (!cleanPhone) throw new Error('Telefon raqami kiritilmadi');
            const name = String(contactData.name || '').trim();
            const organization = String(contactData.organization || '').trim();
            const notes = String(contactData.notes || '').trim();
            const language = String(contactData.language || '').trim().toLowerCase(); // Optional, default empty

            if (!name && !organization) {
                throw new Error('Mijoz ismi yoki tashkilot/hudud nomidan kamida birini kiriting');
            }

            const stmt = this.db.prepare(`
                INSERT INTO client_contacts (phone, name, organization, notes, language, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
                ON CONFLICT(phone) DO UPDATE SET
                    name = excluded.name,
                    organization = excluded.organization,
                    notes = excluded.notes,
                    language = excluded.language,
                    updated_at = datetime('now', 'localtime')
            `);
            stmt.run(cleanPhone, name, organization, notes, language);

            return this.getContact(cleanPhone);
        } catch (err) {
            console.error('saveContact error:', err.message);
            throw err;
        }
    }

    /**
     * Raqam bo'yicha mijoz kontaktini olish (9 yoki 12 xonali formatda ham moslashadi)
     */
    getContact(phone) {
        try {
            const cleanPhone = this.cleanContactPhone(phone);
            if (!cleanPhone) return null;
            let row = this.db.prepare(`SELECT * FROM client_contacts WHERE phone = ?`).get(cleanPhone);
            if (!row && cleanPhone.length > 9) {
                row = this.db.prepare(`SELECT * FROM client_contacts WHERE phone = ?`).get(cleanPhone.slice(-9));
            }
            if (!row && cleanPhone.length === 9) {
                row = this.db.prepare(`SELECT * FROM client_contacts WHERE phone = ?`).get(`998${cleanPhone}`);
            }
            return row || null;
        } catch (err) {
            console.error('getContact error:', err.message);
            return null;
        }
    }

    /**
     * Barcha saqlangan mijozlar ro'yxatini olish (til va saralash bo'yicha filtr bilan)
     */
    getAllContacts(options = {}) {
        try {
            const lang = options.lang ? String(options.lang).trim().toLowerCase() : '';
            let sql = `SELECT * FROM client_contacts`;
            const params = [];

            if (lang) {
                if (lang === 'empty' || lang === 'none') {
                    sql += ` WHERE (language IS NULL OR language = '')`;
                } else {
                    sql += ` WHERE language = ?`;
                    params.push(lang);
                }
            }

            sql += ` ORDER BY name COLLATE NOCASE ASC`;
            return this.db.prepare(sql).all(...params);
        } catch (err) {
            console.error('getAllContacts error:', err.message);
            return [];
        }
    }

    /**
     * Mijozlarni qidirish (ism, raqam, tashkilot, izoh yoki til bo'yicha)
     */
    searchContacts(query, lang = '') {
        try {
            if (!query || typeof query !== 'string') return this.getAllContacts({ lang });
            const q = `%${query.trim()}%`;
            const cleanLang = lang ? String(lang).trim().toLowerCase() : '';

            let sql = `
                SELECT * FROM client_contacts
                WHERE (phone LIKE ? OR name LIKE ? OR organization LIKE ? OR notes LIKE ? OR language LIKE ?)
            `;
            const params = [q, q, q, q, q];

            if (cleanLang) {
                if (cleanLang === 'empty' || cleanLang === 'none') {
                    sql += ` AND (language IS NULL OR language = '')`;
                } else {
                    sql += ` AND language = ?`;
                    params.push(cleanLang);
                }
            }

            sql += ` ORDER BY name COLLATE NOCASE ASC`;
            return this.db.prepare(sql).all(...params);
        } catch (err) {
            console.error('searchContacts error:', err.message);
            return [];
        }
    }

    /**
     * Eng faol mijozlarni 3CX qo'ng'iroqlar jurnali bo'yicha olish (fallback sifatida)
     */
    getTopClients(limit = 15) {
        try {
            const safeLimit = Math.max(1, parseInt(limit, 10) || 15);
            const rows = this.db.prepare(`
                SELECT 
                    caller_id as phone,
                    COUNT(*) as total_calls,
                    SUM(CASE WHEN duration_sec > 0 THEN 1 ELSE 0 END) as answered_calls,
                    SUM(duration_sec) as total_duration_sec,
                    MAX(event_time) as last_call_time
                FROM agent_3cx_call_logs
                WHERE caller_id IS NOT NULL AND LENGTH(caller_id) >= 7
                GROUP BY caller_id
                ORDER BY total_calls DESC
                LIMIT ?
            `).all(safeLimit);

            return rows.map(r => {
                const contact = this.getContact(r.phone);
                return {
                    phone: r.phone,
                    name: contact ? contact.name : '',
                    organization: contact ? contact.organization : '',
                    language: contact ? (contact.language || '') : '',
                    notes: contact ? (contact.notes || '') : '',
                    is_saved: Boolean(contact),
                    total_calls: Number(r.total_calls || 0),
                    answered_calls: Number(r.answered_calls || 0),
                    total_duration_sec: Number(r.total_duration_sec || 0),
                    last_call_time: r.last_call_time || ''
                };
            });
        } catch (err) {
            console.error('getTopClients error:', err.message);
            return [];
        }
    }

    /**
     * Mijoz kontaktini o'chirish
     */
    deleteContact(phone) {
        try {
            const cleanPhone = this.cleanContactPhone(phone);
            if (!cleanPhone) return false;
            const stmt = this.db.prepare(`DELETE FROM client_contacts WHERE phone = ? OR phone = ? OR phone = ?`);
            const alt9 = cleanPhone.length > 9 ? cleanPhone.slice(-9) : cleanPhone;
            const alt12 = cleanPhone.length === 9 ? `998${cleanPhone}` : cleanPhone;
            const res = stmt.run(cleanPhone, alt9, alt12);
            return res.changes > 0;
        } catch (err) {
            console.error('deleteContact error:', err.message);
            return false;
        }
    }
}

module.exports = new DbService();


