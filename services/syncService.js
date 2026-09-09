/**
 * Synchronization Service between Asterisk PBX CDR and 3CX Desktop Agent Database
 * 
 * Ushbu servis har kuni soat 21:00 da (Toshkent vaqti) yoki administrator so'rovi bo'yicha
 * Asterisk PBX CDR bazasidagi haqiqiy qo'ng'iroqlarni 3CX Desktop Agent jurnali (agent_3cx_call_logs)
 * bilan to'liq sinxronizatsiya qiladi. Desktop Agent kechroq yoqilgan yoki o'chiq bo'lgan paytda
 * tushib qolgan barcha qo'ng'iroqlar avtomatik tiklanadi va /operators sahifasida 100%
 * haqqoniy ko'rsatkichlar ta'minlanadi.
 */

const issabelDbService = require('./issabelDbService');
const dbService = require('./dbService');

const EXCLUDED_OPERATORS = new Set(['1111', '1324', '1001', '1000', '402', '401', '207', '202', '201', '170', '161', '118', '115', '160', '66', '110']);

class SyncService {
    constructor() {
        this.lastDailySyncDate = null;
        this.lastSyncTime = null;
        this.isSyncRunning = false;
        this.onSyncComplete = null;

        // Har 30 soniyada soat 21:00 bo'lganini tekshirib borish
        this.startDailyScheduler();
    }

    getLastSyncInfo() {
        return {
            lastSyncTime: this.lastSyncTime,
            isSyncRunning: this.isSyncRunning
        };
    }

    startDailyScheduler() {
        setInterval(async () => {
            try {
                const nowTashkent = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
                const [curDate, curTime] = nowTashkent.split(' ');
                if (!curTime) return;

                const [hr, mn] = curTime.split(':');
                // Har kuni kechqurun 21:00 da Toshkent vaqti bilan avtomatik sinxronizatsiya
                if (hr === '21' && mn === '00' && this.lastDailySyncDate !== curDate) {
                    this.lastDailySyncDate = curDate;
                    console.log(`⏰ [21:00 Toshkent vaqti] Avtomatik kunlik CDR -> 3CX sinxronizatsiyasi boshlandi (${curDate})...`);
                    const res = await this.syncDailyCdrToAgentLogs(curDate);
                    console.log(`✅ [21:00 Toshkent vaqti] Sinxronizatsiya muvaffaqiyatli yakunlandi:`, res);
                    if (typeof this.onSyncComplete === 'function') {
                        this.onSyncComplete(res);
                    }
                }
            } catch (err) {
                console.error('❌ SyncService scheduler xatolik:', err.message);
            }
        }, 30000);
    }

    /**
     * Berilgan sana (yoki bugun) uchun Asterisk CDR dan 3CX Agent jurnaliga tushmay qolgan
     * barcha qo'ng'iroqlarni aniqlab, xavfsiz (dublikatsiz) tiklash.
     */
    async syncDailyCdrToAgentLogs(targetDate = null) {
        if (this.isSyncRunning) {
            return { success: false, message: 'Sinxronizatsiya hozirda davom etmoqda, kuting.' };
        }

        this.isSyncRunning = true;
        try {
            const dateStr = (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate))
                ? targetDate
                : new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);

            console.log(`🔄 [SyncService] ${dateStr} sanasi uchun Asterisk CDR va 3CX jurnali solishtirilmoqda...`);

            function toEpochSec(dtStr) {
                if (!dtStr) return 0;
                const clean = String(dtStr).trim().replace(' ', 'T');
                return Math.floor(new Date(clean + '+05:00').getTime() / 1000) || 0;
            }

            // 1. SQLite dagi mavjud 3CX Agent yozuvlarini olish
            const rawExisting = dbService.db.prepare(`
                SELECT operator_id, caller_id, event_type, duration_sec, start_time
                FROM agent_3cx_call_logs
                WHERE event_time >= ? AND event_time <= ?
            `).all(`${dateStr} 00:00:00`, `${dateStr} 23:59:59`);

            const existingRows = rawExisting.map(r => ({
                operator_id: r.operator_id,
                caller_id: r.caller_id,
                epoch_time: toEpochSec(r.start_time)
            }));

            function cleanPhone(num) {
                if (!num) return '';
                const digits = String(num).replace(/\D/g, '');
                return digits.length >= 9 ? digits.slice(-9) : digits;
            }

            function isDuplicate(opId, caller, epoch) {
                const c1 = cleanPhone(caller);
                return existingRows.some(e => {
                    if (String(e.operator_id) !== String(opId)) return false;
                    const c2 = cleanPhone(e.caller_id);
                    const phoneMatch = !c1 || !c2 || c1 === c2 || c1.includes(c2) || c2.includes(c1);
                    return phoneMatch && Math.abs(Number(e.epoch_time) - Number(epoch)) <= 120;
                });
            }

            // 2. Asterisk PBX CDR bazasidan qabul qilingan va chiquvchi barcha qo'ng'iroqlarni olish
            const sql = `
                USE asteriskcdrdb;
                -- 1. Operatorlar qabul qilgan kiruvchi qo'ng'iroqlar
                SELECT 
                    calldate,
                    src,
                    dst,
                    disposition,
                    billsec
                FROM cdr
                WHERE calldate >= '${dateStr} 00:00:00' AND calldate <= '${dateStr} 23:59:59'
                  AND dst REGEXP '^[0-9]{2,4}$'
                  AND disposition = 'ANSWERED' AND billsec > 0
                ORDER BY calldate ASC;

                SELECT '===OUTBOUND===';
                -- 2. Operatorlar amalga oshirgan chiquvchi qo'ng'iroqlar
                SELECT 
                    calldate,
                    src,
                    dst,
                    SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), 'SIP/', -1) as op_id,
                    disposition,
                    billsec
                FROM cdr
                WHERE calldate >= '${dateStr} 00:00:00' AND calldate <= '${dateStr} 23:59:59'
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst) >= 7)
                  AND disposition = 'ANSWERED' AND billsec > 0
                ORDER BY calldate ASC;
            `;

            const raw = await issabelDbService.execQuery(sql);
            if (!raw) {
                return { success: false, addedCount: 0, message: 'Asterisk CDR dan ma\'lumot olinmadi' };
            }

            const [inPart, outPart] = raw.split('===OUTBOUND===');
            const toInsert = [];
            const perOp = {};

            // Kiruvchi qo'ng'iroqlarni tekshirish
            if (inPart) {
                for (const line of inPart.trim().split('\n')) {
                    if (!line) continue;
                    const parts = line.split('\t');
                    if (parts.length < 5) continue;
                    const [cdate, src, dst, disp, bsec] = parts;
                    const opId = (dst || '').trim();
                    if (!opId || EXCLUDED_OPERATORS.has(opId)) continue;
                    const caller = (src || '').trim() || 'Yashirin raqam';
                    const dur = parseInt(bsec, 10) || 0;
                    const epoch = toEpochSec(cdate);

                    if (isDuplicate(opId, caller, epoch)) continue;

                    toInsert.push({
                        operatorId: opId,
                        callerId: caller,
                        eventType: 'ANSWERED',
                        durationSec: dur,
                        startTime: cdate,
                        details: `3CX Qabul qilindi (Asterisk CDR sinxron): ${cdate}`
                    });
                    existingRows.push({ operator_id: opId, caller_id: caller, epoch_time: epoch });

                    if (!perOp[opId]) perOp[opId] = { answered: 0, outbound: 0 };
                    perOp[opId].answered++;
                }
            }

            // Chiquvchi qo'ng'iroqlarni tekshirish
            if (outPart) {
                for (const line of outPart.trim().split('\n')) {
                    if (!line) continue;
                    const parts = line.split('\t');
                    if (parts.length < 6) continue;
                    const [cdate, src, dst, op_id, disp, bsec] = parts;
                    const opId = (op_id || '').trim();
                    if (!opId || EXCLUDED_OPERATORS.has(opId)) continue;
                    const caller = (dst || '').trim();
                    const dur = parseInt(bsec, 10) || 0;
                    if (dur <= 0) continue; // 0 soniyalik gaplashilmagan chiquvchi hisoblanmaydi
                    const epoch = toEpochSec(cdate);

                    if (isDuplicate(opId, caller, epoch)) continue;

                    toInsert.push({
                        operatorId: opId,
                        callerId: caller,
                        eventType: 'DIALLED',
                        durationSec: dur,
                        startTime: cdate,
                        details: `3CX Chiquvchi (Asterisk CDR sinxron): ${cdate}`
                    });
                    existingRows.push({ operator_id: opId, caller_id: caller, epoch_time: epoch });

                    if (!perOp[opId]) perOp[opId] = { answered: 0, outbound: 0 };
                    perOp[opId].outbound++;
                }
            }

            // 3. SQLite bazaga to'plamli yozish
            let insertedCount = 0;
            if (toInsert.length > 0) {
                const insertStmt = dbService.db.prepare(`
                    INSERT OR IGNORE INTO agent_3cx_call_logs (
                        event_time, operator_id, caller_id, event_type, duration_sec, start_time, end_time, hostname, details
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                dbService.db.exec('BEGIN TRANSACTION');
                for (const item of toInsert) {
                    const res = insertStmt.run(
                        item.startTime,
                        item.operatorId,
                        item.callerId,
                        item.eventType,
                        item.durationSec,
                        item.startTime,
                        item.startTime,
                        'Asterisk PBX',
                        item.details
                    );
                    if (res.changes > 0) insertedCount++;
                }
                dbService.db.exec('COMMIT');
            }

            console.log(`✅ [SyncService] ${dateStr}: ${insertedCount} ta yetishmayotgan qo'ng'iroq Asterisk CDR dan tiklandi.`);
            const nowTimeStr = new Date().toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
            this.lastSyncTime = `Bugun ${nowTimeStr}`;

            return {
                success: true,
                date: dateStr,
                addedCount: insertedCount,
                lastSyncTime: this.lastSyncTime,
                perOperator: perOp
            };
        } catch (err) {
            try { dbService.db.exec('ROLLBACK'); } catch (e) {}
            console.error('❌ syncDailyCdrToAgentLogs xatolik:', err.message);
            return { success: false, error: err.message };
        } finally {
            this.isSyncRunning = false;
        }
    }
}

module.exports = new SyncService();
