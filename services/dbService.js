/**
 * SQLite Database Service for Call Center CDR & Operator Analytics
 * Built using Node.js 24 native node:sqlite DatabaseSync
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

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
        `);

        try {
            this.db.exec(`ALTER TABLE operator_daily_stats ADD COLUMN missed INTEGER DEFAULT 0;`);
        } catch (e) {
            // Already exists
        }

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
     * Bugun operatorlar qancha qo'ng'iroqni rad etganini bazadan olish (Faqat ish vaqti: 08:00 - 21:00)
     * @returns {Object} { [opId]: count }
     */
    getTodayOperatorRejects() {
        try {
            const dateStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
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
     * Bugun operatorlar qancha qo'ng'iroqni o'tkazib yuborganini (Missed) bazadan olish (Faqat ish vaqti: 08:00 - 21:00)
     * @returns {Object} { [opId]: count }
     */
    getTodayOperatorMissed() {
        try {
            const dateStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            const rows = this.db.prepare(`
                SELECT operator_id, COUNT(DISTINCT event_time) as count 
                FROM operator_missed_events 
                WHERE event_time LIKE ? 
                  AND channel LIKE '3CX%'
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
            console.error('❌ DB getTodayOperatorMissed xatolik:', err.message);
            return {};
        }
    }

    /**
     * Rad etilgan qo'ng'iroqlar ro'yxatini sahifalab olish (Modal uchun)
     */
    getRejectEventsPaginated(page = 1, limit = 50, search = '') {
        try {
            const dateStr = new Date().toISOString().slice(0, 10);
            let countSql = `SELECT COUNT(*) as total FROM operator_reject_events WHERE event_time LIKE ?`;
            let dataSql = `SELECT * FROM operator_reject_events WHERE event_time LIKE ?`;
            const countParams = [`${dateStr}%`];
            const dataParams = [`${dateStr}%`];

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
     */
    getMissedEventsPaginated(page = 1, limit = 50, search = '') {
        try {
            const dateStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            let countSql = `SELECT COUNT(*) as total FROM operator_missed_events WHERE event_time LIKE ? AND channel LIKE '3CX%'`;
            let dataSql = `SELECT * FROM operator_missed_events WHERE event_time LIKE ? AND channel LIKE '3CX%'`;
            const countParams = [`${dateStr}%`];
            const dataParams = [`${dateStr}%`];

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
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO calls 
                (id, channel, caller_id, operator, operator_exten, direction, status, hangup_party, duration, cause, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

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
                call.time || new Date().toISOString()
            );

            // Kunlik operator statistikasini yangilash
            if (call.operatorExten) {
                const today = (call.time ? new Date(call.time) : new Date()).toISOString().slice(0, 10);
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
                const q = `%${search.toLowerCase()}%`;
                const filter = ` WHERE LOWER(caller_id) LIKE ? OR LOWER(operator) LIKE ? OR LOWER(status) LIKE ? OR LOWER(hangup_party) LIKE ? OR operator_exten LIKE ?`;
                countSql += filter;
                dataSql += filter;
                params.push(q, q, q, q, `%${search}%`);
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
     * 3CX Desktop Agent tomonidan yuborilgan to'liq qo'ng'iroq hodisasini saqlash
     */
    recordAgentCallLog(data) {
        try {
            const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const opId = String(data.operatorId || '');
            const caller = String(data.callerId || 'Yashirin raqam');
            const details = String(data.details || '');

            // Takroriy yozuvlarni oldini olish
            if (details) {
                const existing = this.db.prepare(`
                    SELECT id FROM agent_3cx_call_logs 
                    WHERE operator_id = ? AND caller_id = ? AND details = ?
                `).get(opId, caller, details);
                if (existing) return existing;
            }

            const insert = this.db.prepare(`
                INSERT INTO agent_3cx_call_logs (
                    event_time, operator_id, caller_id, event_type, duration_sec, start_time, end_time, hostname, details
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            return insert.run(
                nowLocal,
                opId,
                caller,
                String(data.eventType || 'UNKNOWN'),
                parseInt(data.durationSec || 0, 10),
                String(data.startTime || nowLocal),
                String(data.endTime || nowLocal),
                String(data.hostname || ''),
                details
            );
        } catch (err) {
            console.error('❌ recordAgentCallLog xatolik:', err.message);
            return null;
        }
    }

    /**
     * 3CX Agent jurnali bo'yicha sahifalab olish
     */
    getAgentCallLogsPaginated(page = 1, limit = 50, operatorId = null) {
        try {
            page = Math.max(1, parseInt(page, 10) || 1);
            limit = Math.min(Math.max(10, parseInt(limit, 10) || 50), 500);
            const offset = (page - 1) * limit;

            let countSql = `SELECT COUNT(*) as total FROM agent_3cx_call_logs`;
            let dataSql = `SELECT * FROM agent_3cx_call_logs`;
            const params = [];

            if (operatorId) {
                countSql += ` WHERE operator_id = ?`;
                dataSql += ` WHERE operator_id = ?`;
                params.push(String(operatorId));
            }

            dataSql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;

            const total = this.db.prepare(countSql).get(...params).total;
            const rows = this.db.prepare(dataSql).all(...params, limit, offset);

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
                    category3cx = 'Answered';
                    statusName = 'Qabul qilingan (Answered)';
                } else if (status === 'OUTBOUND' || status === 'DIALLED') {
                    category3cx = 'Dialled';
                    statusName = 'Chiquvchi (Dialled)';
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
}

module.exports = new DbService();
