const { Client } = require('ssh2');
require('dotenv').config();
const redisService = require('./redisService');
const dbService = require('./dbService');

const EXCLUDED_OPERATORS = new Set(['1234', '1111', '1324', '1001', '1000', '402', '401', '170', '161', '118', '115', '160', '66', '110', '213', '116']);

const DEFAULT_OPERATOR_NAMES = {
    '101': 'Oybek',
    '103': 'Feruza',
    '106': 'Ubaydullayeva Gulchehra',
    '111': 'Nozima',
    '114': 'Maxmudbek',
    '119': 'Muattar',
    '120': 'Navruzoy'
};

class IssabelDbService {
    constructor() {
        this.sshConfig = {
            host: process.env.SSH_HOST || '192.168.0.124',
            port: parseInt(process.env.SSH_PORT || '22', 10),
            username: process.env.SSH_USER || 'root',
            password: process.env.SSH_PASSWORD || 'ZAQ!2wsx123',
            readyTimeout: 15000
        };
        this.dbUser = 'asteriskuser';
        this.dbPass = 'ZAQ!2wsx123';
        this.operatorNames = new Map(Object.entries(DEFAULT_OPERATOR_NAMES));

        // Doimiy (persistent) SSH ulanish — har so'rov uchun qayta ulanish o'rniga
        // bitta ulanish qayta ishlatiladi (SSH handshake narxi faqat bir marta to'lanadi).
        this._sshConn = null;
        this._sshReady = null;

        // High-Speed In-Memory Cache (Redis muqobili)
        this.cache = {
            summary: null,
            hourly: null,
            operators: [],
            lastSync: 0
        };
        this.isSyncing = false;

        // Dastlabki yuklash va har 5 soniyada fonda yangilab turish
        this.startBackgroundSync();
    }

    getExcludedOperators() {
        return EXCLUDED_OPERATORS;
    }

    startBackgroundSync() {
        // Foniy yangilash tsikli (Server qotmasligi uchun)
        const syncWorker = async () => {
            if (this.isSyncing) return;
            this.isSyncing = true;
            try {
                await this.syncAllData();
            } catch (e) {
                // Background log
            } finally {
                this.isSyncing = false;
            }
        };

        syncWorker();
        setInterval(syncWorker, 5000);
    }

    async syncAllData() {
        try {
            const multiSql = `
                SELECT '===USERS===' as marker;
                USE asterisk;
                SELECT extension, name FROM users WHERE extension REGEXP '^[0-9]{2,4}$';

                SELECT '===SUMMARY_IN===' as marker;
                USE asteriskcdrdb;
                SELECT 
                    COUNT(DISTINCT c.uniqueid) as total_inbound,
                    COUNT(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN c.uniqueid END) as ans_inbound,
                    COALESCE(SUM(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN op.talk_sec END), 0) as in_talk_sec,
                    SUM(CASE WHEN c.disposition = 'FAILED' THEN 1 ELSE 0 END) as den_inbound
                FROM cdr c
                LEFT JOIN (
                    SELECT 
                        uniqueid,
                        MAX(billsec) as talk_sec
                    FROM cdr
                    WHERE calldate >= CURDATE()
                      AND disposition = 'ANSWERED'
                      AND billsec > 0
                      AND (
                          dst REGEXP '^[0-9]{2,4}$' 
                          OR dstchannel LIKE 'Local/%@from-queue%' 
                          OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%')
                      )
                    GROUP BY uniqueid
                ) op ON c.uniqueid = op.uniqueid
                WHERE c.calldate >= CURDATE() 
                  AND TIME(c.calldate) >= '08:00:00' AND TIME(c.calldate) <= '21:00:00'
                  AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%')
                  AND c.channel NOT LIKE 'Local/%'
                  AND (c.dcontext IS NULL OR c.dcontext != 'from-internal')
                  AND (c.src IS NULL OR c.src NOT REGEXP '^[0-9]{1,4}$');

                SELECT '===SUMMARY_OUT===' as marker;
                SELECT 
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as total_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as out_talk_sec
                FROM cdr 
                WHERE calldate >= CURDATE() 
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dcontext = 'from-internal' 
                  AND channel REGEXP '^SIP/[0-9]{2,4}-' 
                  AND LENGTH(dst) >= 7;

                SELECT '===HOURLY===' as marker;
                SELECT 
                    HOUR(c.calldate) as hr,
                    COUNT(DISTINCT c.uniqueid) as total_inbound,
                    COUNT(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN c.uniqueid END) as answered
                FROM cdr c
                LEFT JOIN (
                    SELECT DISTINCT uniqueid
                    FROM cdr
                    WHERE calldate >= CURDATE()
                      AND disposition = 'ANSWERED'
                      AND billsec > 0
                      AND (
                          dst REGEXP '^[0-9]{2,4}$' 
                          OR dstchannel LIKE 'Local/%@from-queue%' 
                          OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%')
                      )
                ) op ON c.uniqueid = op.uniqueid
                WHERE c.calldate >= CURDATE() 
                  AND TIME(c.calldate) >= '08:00:00' AND TIME(c.calldate) <= '21:00:00'
                  AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%')
                  AND c.channel NOT LIKE 'Local/%'
                  AND (c.dcontext IS NULL OR c.dcontext != 'from-internal')
                  AND (c.src IS NULL OR c.src NOT REGEXP '^[0-9]{1,4}$')
                  AND HOUR(c.calldate) BETWEEN 8 AND 21
                GROUP BY hr ORDER BY hr ASC;

                SELECT '===OPERATORS===' as marker;
                SELECT
                    dst,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as total_duration
                FROM cdr
                WHERE calldate >= CURDATE()
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dst REGEXP '^[0-9]{2,4}$'
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')
                GROUP BY dst;

                SELECT '===OP_OUTBOUND===' as marker;
                SELECT 
                    SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '/', -1), '-', 1) as op_ext,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as outbound_answered,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as outbound_duration
                FROM cdr 
                WHERE calldate >= CURDATE()
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND LENGTH(dst) >= 7
                GROUP BY op_ext;

                SELECT '===XFER_ROWS===' as marker;
                SELECT 
                    CASE 
                        WHEN channel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '@', 1), '/', -1)
                        WHEN channel LIKE 'SIP/%-%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), '/', -1)
                        ELSE '' 
                    END AS from_op,
                    dst as to_op,
                    channel
                FROM cdr
                WHERE calldate >= CURDATE()
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dcontext = 'from-internal-xfer'
                  AND disposition = 'ANSWERED' AND billsec > 0
                ORDER BY channel ASC, calldate ASC;
            `;

            const raw = await this.execQuery(multiSql);
            if (!raw) return;

            const sections = raw.split('===');
            const sectionMap = {};
            for (let i = 1; i < sections.length; i += 2) {
                const title = sections[i].trim();
                const content = (sections[i + 1] || '').trim();
                sectionMap[title] = content;
            }

            // 1. Users Map
            if (sectionMap['USERS']) {
                const lines = sectionMap['USERS'].split('\n');
                for (const l of lines) {
                    if (!l) continue;
                    const [ext, name] = l.split('\t');
                    const cleanExt = ext ? ext.trim() : '';
                    if (cleanExt && !EXCLUDED_OPERATORS.has(cleanExt)) {
                        if (cleanExt === '114') {
                            this.operatorNames.set('114', 'Maxmudbek');
                        } else {
                            this.operatorNames.set(cleanExt, (name || '').trim() || DEFAULT_OPERATOR_NAMES[cleanExt] || `Operator ${cleanExt}`);
                        }
                    }
                }
                this.operatorNames.set('114', 'Maxmudbek');
            }

            // 2. Summary
            let inTotal = 0, inAns = 0, inDur = 0, inDen = 0, outTotal = 0, outAns = 0, outDur = 0;
            if (sectionMap['SUMMARY_IN']) {
                const [it, ia, idur, iden] = sectionMap['SUMMARY_IN'].split('\t');
                inTotal = parseInt(it, 10) || 0;
                inAns = parseInt(ia, 10) || 0;
                inDur = parseInt(idur, 10) || 0;
                inDen = parseInt(iden, 10) || 0;
            }
            if (sectionMap['SUMMARY_OUT']) {
                const [ot, oa, odur] = sectionMap['SUMMARY_OUT'].split('\t');
                outTotal = parseInt(oa, 10) || parseInt(ot, 10) || 0;
                outAns = parseInt(oa, 10) || 0;
                outDur = parseInt(odur, 10) || 0;
            }

            const todayRejects = dbService.getTodayOperatorRejects();
            const totalOpDenied = Object.values(todayRejects).reduce((a, b) => a + b, 0);
            const total = inTotal + outTotal;
            const answered = inAns;
            const durationSec = inDur + outDur;
            const abandoned = Math.max(0, inTotal - inAns);
            const answerRate = inTotal > 0 ? Math.round((answered / inTotal) * 100) : 0;
            const abandonedRate = inTotal > 0 ? Math.round((abandoned / inTotal) * 100) : 0;
            const outboundRate = total > 0 ? Math.round((outTotal / total) * 100) : 0;
            const denyRate = total > 0 ? Math.round((totalOpDenied / total) * 100) : 0;

            this.cache.summary = {
                totalCalls: total,
                inboundCalls: inTotal,
                outboundCalls: outTotal,
                answeredCalls: answered,
                abandonedCalls: abandoned,
                deniedCalls: totalOpDenied,
                totalDurationSec: durationSec,
                answerRate,
                abandonedRate,
                outboundRate,
                denyRate
            };

            // 3. Hourly
            const hourlyMap = new Map();
            if (sectionMap['HOURLY']) {
                const lines = sectionMap['HOURLY'].split('\n');
                for (const l of lines) {
                    if (!l) continue;
                    const [hrStr, totStr, ansStr] = l.split('\t');
                    hourlyMap.set(parseInt(hrStr, 10), {
                        total: parseInt(totStr, 10) || 0,
                        answered: parseInt(ansStr, 10) || 0
                    });
                }
            }
            const labels = [];
            const inboundData = [];
            const answeredData = [];
            for (let h = 8; h <= 21; h++) {
                labels.push(`${String(h).padStart(2, '0')}:00`);
                const val = hourlyMap.get(h) || { total: 0, answered: 0 };
                inboundData.push(val.total);
                answeredData.push(val.answered);
            }
            this.cache.hourly = { labels, inbound: inboundData, answered: answeredData };

            // 4. Operator Outbound Map
            const outMap = new Map();
            if (sectionMap['OP_OUTBOUND']) {
                const lines = sectionMap['OP_OUTBOUND'].split('\n');
                for (const l of lines) {
                    if (!l) continue;
                    const [opId, ansStr, durStr] = l.split('\t');
                    const cleanOp = (opId || '').trim();
                    if (cleanOp) {
                        outMap.set(cleanOp, {
                            answered: parseInt(ansStr, 10) || 0,
                            duration: parseInt(durStr, 10) || 0
                        });
                    }
                }
            }

            // 4b. Transfer zanjirlari — bir zanjirning barcha qadamlari bir xil channel nomida yoziladi.
            // Olgan (xferIn) = zanjirni OXIRGI bo'lib qabul qilib, o'zi hal qilgan operator (boshqaga uzatmagan) -> Jami +1
            // Uzatgan (xferOut) = qabul qilib boshqaga o'tkazib yuborgan har bir qadam
            const xferOutMap = new Map();       // uzatgan (ko'rsatkich)
            const xferInMap = new Map();        // olgan = hal qilgan (Jami +1)
            const xferReceiptsMap = new Map();  // transfer qabul qatorlari (raw "Qabul qilingan"dan chiqariladi)
            const xferFirstFromMap = new Map(); // navbatdan to'g'ri olib boshqaga uzatganlar (raw dan chiqariladi)
            if (sectionMap['XFER_ROWS']) {
                const chains = new Map(); // channel -> [{ from, to }]
                for (const l of sectionMap['XFER_ROWS'].split('\n')) {
                    if (!l) continue;
                    const [fromOp, toOp, chan] = l.split('\t');
                    const cleanChan = (chan || '').trim();
                    if (!cleanChan) continue;
                    if (!chains.has(cleanChan)) chains.set(cleanChan, []);
                    chains.get(cleanChan).push({ from: (fromOp || '').trim(), to: (toOp || '').trim() });
                }
                for (const rows of chains.values()) {
                    if (!rows || rows.length === 0) continue;
                    for (const r of rows) {
                        if (r.from) xferOutMap.set(r.from, (xferOutMap.get(r.from) || 0) + 1);
                        if (r.to && /^[0-9]{2,4}$/.test(r.to)) {
                            xferReceiptsMap.set(r.to, (xferReceiptsMap.get(r.to) || 0) + 1);
                        }
                    }
                    // Birinchi qadam: navbatdan to'g'ri qabul qilingan qo'ng'iroq boshqaga uzatilgan
                    const first = rows[0];
                    if (first.from && /^[0-9]{2,4}$/.test(first.from)) {
                        xferFirstFromMap.set(first.from, (xferFirstFromMap.get(first.from) || 0) + 1);
                    }
                    // Olgan (hal qilgan): zanjirning oxirgi operator qabulchisi (tashqi raqamga uzatilgan bo'lsa — oxirgi operator)
                    let lastTo = '';
                    for (let i = rows.length - 1; i >= 0; i--) {
                        if (rows[i].to && /^[0-9]{2,4}$/.test(rows[i].to)) { lastTo = rows[i].to; break; }
                    }
                    if (lastTo) {
                        xferInMap.set(lastTo, (xferInMap.get(lastTo) || 0) + 1);
                    }
                }
            }

            // 5. Operator Stats (Inbound + Outbound + Transfers)
            const opStats = [];
            const processedExts = new Set();
            if (sectionMap['OPERATORS']) {
                const lines = sectionMap['OPERATORS'].split('\n');
                for (const l of lines) {
                    if (!l) continue;
                    const [extRaw, ansStr, durStr] = l.split('\t');
                    const ext = extRaw ? extRaw.trim() : '';
                    if (!ext || EXCLUDED_OPERATORS.has(ext)) continue;
                    processedExts.add(ext);

                    const inAns = parseInt(ansStr, 10) || 0;
                    const inDur = parseInt(durStr, 10) || 0;
                    const outInfo = outMap.get(ext) || { answered: 0, duration: 0 };
                    const totalDur = inDur + outInfo.duration;
                    const xOut = xferOutMap.get(ext) || 0;
                    const xIn = xferInMap.get(ext) || 0;
                    const receipts = xferReceiptsMap.get(ext) || 0;
                    const directFwd = xferFirstFromMap.get(ext) || 0;
                    // Haqiqiy yakunlangan kiruvchi: transfer qabullari va boshqaga uzatib yuborganlari chiqariladi.
                    // "Olgan" (transferni o'zi hal qilganlari) alohida xIn sifatida Jami ga qo'shiladi.
                    const resolvedIn = Math.max(0, inAns - receipts - directFwd);
                    const spokenCalls = resolvedIn + outInfo.answered + xIn;
                    const avg = spokenCalls > 0 ? Math.round(totalDur / spokenCalls) : 0;
                    const name = ext === '114' ? 'Maxmudbek' : (this.operatorNames.get(ext) || `Operator ${ext}`);
                    const opDenied = todayRejects[ext] || 0;

                    opStats.push({
                        id: ext,
                        name: `${name} (${ext})`,
                        realName: name,
                        totalCalls: resolvedIn + outInfo.answered + opDenied + xIn,
                        answered: resolvedIn,
                        rawAnswered: inAns,
                        outbound: outInfo.answered,
                        transferredOut: xOut,
                        transferredIn: xIn,
                        // Transfer zanjirini oxirida hal qilgan (A->B->C da faqat C hisoblanadi)
                        transferResolved: xIn,
                        denied: opDenied,
                        totalDurationSec: totalDur,
                        avgDurationSec: avg
                    });
                }
            }

            for (const [ext, outInfo] of outMap.entries()) {
                if (!processedExts.has(ext) && !EXCLUDED_OPERATORS.has(ext) && /^[0-9]{2,4}$/.test(ext)) {
                    const name = ext === '114' ? 'Maxmudbek' : (this.operatorNames.get(ext) || `Operator ${ext}`);
                    const opDenied = todayRejects[ext] || 0;
                    const spokenCalls = outInfo.answered;
                    const avg = spokenCalls > 0 ? Math.round(outInfo.duration / spokenCalls) : 0;
                    opStats.push({
                        id: ext,
                        name: `${name} (${ext})`,
                        realName: name,
                        totalCalls: outInfo.answered + opDenied + (xferInMap.get(ext) || 0),
                        answered: 0,
                        outbound: outInfo.answered,
                        transferredOut: xferOutMap.get(ext) || 0,
                        transferredIn: xferInMap.get(ext) || 0,
                        transferResolved: xferInMap.get(ext) || 0,
                        denied: opDenied,
                        totalDurationSec: outInfo.duration,
                        avgDurationSec: avg
                    });
                }
            }
            this.cache.operators = opStats;
            this.cache.lastSync = Date.now();

            // Redis ga saqlash
            redisService.set('callcenter:summary', this.cache.summary, 60);
            redisService.set('callcenter:hourly', this.cache.hourly, 60);
            redisService.set('callcenter:operators', this.cache.operators, 60);
        } catch (err) {
            console.error('⚠️ Issabel syncAllData xatosi:', err.message);
        }
    }

    /**
     * Asterisk CDR dan bog'lanilishi kerak bo'lgan mijozlarni (navbatdan chiqqanlar,
     * ishdan tashqari vaqt / IVR) sinxronizatsiya qilish
     */
    async syncPendingCallbacks(days = 30) {
        try {
            let changed = false;

            // 1. Bazada ayni paytda 'pending' turgan barcha mijozlarni Asterisk CDR dan tekshirish:
            // Agar navbatdan chiqqan paytdan keyin operator bu raqamga chiqqan bo'lsa (chiquvchi ANSWERED)
            // yoki mijoz o'zi qayta qilib operator bilan gaplashgan bo'lsa -> 'resolved' deb yopiladi
            try {
                const pendingList = dbService.getPendingCallbacks();
                if (pendingList && pendingList.length > 0) {
                    const batchSql = `
                        SELECT 
                            CASE 
                                WHEN dcontext = 'from-internal' THEN dst
                                ELSE src
                            END as phone,
                            MAX(calldate) as last_answered_time
                        FROM asteriskcdrdb.cdr
                        WHERE calldate >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
                          AND disposition = 'ANSWERED' AND billsec > 0
                          AND (
                            (dcontext = 'from-internal')
                            OR
                            (dcontext != 'from-internal' AND dstchannel IS NOT NULL AND dstchannel != '')
                          )
                        GROUP BY phone;
                    `;
                    const rawBatch = await this.execQuery(batchSql);
                    if (rawBatch) {
                        const answeredMap = new Map();
                        const bLines = rawBatch.trim().split('\n');
                        for (const bl of bLines) {
                            if (!bl) continue;
                            const [p, t] = bl.split('\t');
                            if (p && t) {
                                const clean = p.replace(/\D/g, '').slice(-9);
                                if (clean.length === 9) {
                                    const existingT = answeredMap.get(clean);
                                    if (!existingT || t > existingT) answeredMap.set(clean, t);
                                }
                            }
                        }

                        for (const item of pendingList) {
                            const clean = dbService.normalizePhone(item.phone);
                            if (!clean) continue;
                            const lastAnswered = answeredMap.get(clean);
                            if (lastAnswered && item.call_time && lastAnswered >= item.call_time) {
                                const resolved = dbService.resolveCallback(clean, 'cdr_sync_answered');
                                if (resolved) changed = true;
                            }
                        }
                    }
                }
            } catch (pErr) {
                console.error('syncPendingCallbacks check active pending error:', pErr.message);
            }

            // 2. Asterisk CDR dan haqiqiy javobsiz qolgan (birorta operator javob bermagan) kiruvchi qo'ng'iroqlarni olish
            const intervalDays = parseInt(days, 10) || 30;
            const sql = `
                USE asteriskcdrdb;

                SELECT 
                    client_phone,
                    MAX(calldate) as callback_time,
                    COUNT(DISTINCT channel) as total_attempts,
                    CASE 
                        WHEN SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN dcontext != 'from-internal' THEN CONCAT(TIME(calldate), '|||', COALESCE(lastdata,'')) END ORDER BY calldate DESC SEPARATOR '###'), '###', 1) REGEXP 'working-time|music-working-time' 
                             OR SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN dcontext != 'from-internal' THEN TIME(calldate) END ORDER BY calldate DESC SEPARATOR '|||'), '|||', 1) < '08:00:00'
                             OR SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN dcontext != 'from-internal' THEN TIME(calldate) END ORDER BY calldate DESC SEPARATOR '|||'), '|||', 1) > '21:00:00'
                        THEN 'ivr_non_working'
                        ELSE 'abandoned'
                    END as source_type
                FROM (
                    SELECT 
                        c.src as client_phone,
                        MIN(c.calldate) as calldate,
                        c.channel,
                        MAX(c.dcontext) as dcontext,
                        MAX(c.lastdata) as lastdata
                    FROM cdr c
                    WHERE c.calldate >= DATE_SUB(CURDATE(), INTERVAL ${intervalDays} DAY)
                      AND c.calldate < DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                      AND c.dcontext != 'from-internal'
                      AND c.channel NOT LIKE 'Local/%'
                      AND c.src REGEXP '^[0-9]{7,12}$'
                      AND c.src NOT LIKE '%2020159%'
                    GROUP BY c.channel
                    HAVING SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) = 0
                ) missed_calls
                GROUP BY client_phone
                ORDER BY callback_time DESC
                LIMIT 250;
            `;

            const raw = await this.execQuery(sql);
            if (!raw) return changed;

            // Shu davrda har bir mijoz bilan qilingan oxirgi muvaffaqiyatli suhbatni olish
            const answeredMap = new Map();
            const answeredSql = `
                USE asteriskcdrdb;
                SELECT 
                    CASE WHEN dcontext = 'from-internal' THEN dst ELSE src END as phone,
                    MAX(calldate) as last_answered_time,
                    SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' THEN SUBSTRING(channel, 5, 3) END ORDER BY calldate DESC SEPARATOR '|||'), '|||', 1) as op_id
                FROM cdr
                WHERE calldate >= DATE_SUB(CURDATE(), INTERVAL ${intervalDays} DAY)
                  AND disposition = 'ANSWERED' AND billsec > 0
                  AND (
                    dcontext = 'from-internal'
                    OR (dcontext != 'from-internal' AND (dstchannel LIKE '%SIP/%' OR dstchannel LIKE 'Local/%@from-queue%'))
                  )
                GROUP BY phone;
            `;
            const rawAnswered = await this.execQuery(answeredSql);
            if (rawAnswered) {
                const aLines = rawAnswered.trim().split('\n');
                for (const al of aLines) {
                    if (!al) continue;
                    const [ap, at, aop] = al.split('\t');
                    const cleanA = dbService.normalizePhone(ap);
                    if (cleanA) answeredMap.set(cleanA, { time: at, opId: aop });
                }
            }

            const lines = raw.trim().split('\n');
            const validMissedPhonesSet = new Set();

            for (const line of lines) {
                if (!line) continue;
                const [clientPhone, callbackTime, totalAttemptsStr, sourceType] = line.split('\t');
                const totalAttempts = parseInt(totalAttemptsStr, 10) || 1;

                const cleanPhone = dbService.normalizePhone(clientPhone);
                if (!cleanPhone || cleanPhone === '712020159' || cleanPhone.endsWith('2020159')) {
                    continue;
                }

                validMissedPhonesSet.add(cleanPhone);

                // Mijoz shu javobsiz qo'ng'iroqdan KEYIN operator bilan gaplashganmi?
                const answeredInfo = answeredMap.get(cleanPhone);
                const hasAnsweredAfterMissed = Boolean(answeredInfo && answeredInfo.time && answeredInfo.time >= callbackTime);

                if (hasAnsweredAfterMissed) {
                    // Agar oxirgi suhbat javobsiz qo'ng'iroqdan keyin bo'lgan bo'lsa -> resolved qilinadi
                    const resolved = dbService.resolveCallback(
                        cleanPhone, 
                        answeredInfo.opId ? `operator_${answeredInfo.opId}` : 'cdr_sync_answered',
                        answeredInfo.opId || null
                    );
                    if (!resolved) {
                        dbService.upsertCallback({
                            phone: cleanPhone,
                            source: sourceType,
                            callTime: callbackTime,
                            attemptsCount: totalAttempts
                        });
                        dbService.resolveCallback(
                            cleanPhone, 
                            answeredInfo.opId ? `operator_${answeredInfo.opId}` : 'cdr_sync_answered',
                            answeredInfo.opId || null
                        );
                    }
                    changed = true;
                } else {
                    // Hali bog'lanilmagan -> pending sifatida kiritiladi yoki yangilanadi
                    const upsertRes = dbService.upsertCallback({
                        phone: cleanPhone,
                        source: sourceType,
                        callTime: callbackTime,
                        attemptsCount: totalAttempts
                    });
                    if (upsertRes && (upsertRes.inserted || upsertRes.updated)) changed = true;
                }
            }

            // 3. Tozalash (Cleanup): Bugun Asterisk CDR da birorta ham javobsiz/navbatdan chiqqan qo'ng'irog'i
            // bo'lmagan (barcha qo'ng'iroqlari operatorlarga muvaffaqiyatli ulangan), lekin AMI vaqtinchalik 
            // marshrutlash eventlari sabab adashib tushib qolgan soxta callbacklarni o'chirish
            try {
                const todayCallbacks = dbService.getCallbacks('today', true);
                if (todayCallbacks && todayCallbacks.length > 0) {
                    for (const cb of todayCallbacks) {
                        const clean = dbService.normalizePhone(cb.phone);
                        if (clean && !validMissedPhonesSet.has(clean)) {
                            dbService.deleteCallbackPermanent(cb.id);
                            changed = true;
                        }
                    }
                }
            } catch (cleanErr) {
                console.error('syncPendingCallbacks cleanup error:', cleanErr.message);
            }

            return changed;
        } catch (err) {
            console.error('syncPendingCallbacks error:', err.message);
            return false;
        }
    }

    /**
     * Doimiy SSH ulanishni qaytaradi (mavjud bo'lsa shuni, bo'lmasa yangi ochadi).
     * Bir nechta so'rov bir vaqtda kelsa ham (SSH kanal multiplekslash orqali) bitta
     * ulanishni baham ko'radi — har biri uchun alohida handshake kerak emas.
     */
    _getSshConnection() {
        if (this._sshReady) return this._sshReady;

        this._sshReady = new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                this._sshConn = conn;
                resolve(conn);
            }).on('error', err => {
                this._sshConn = null;
                this._sshReady = null;
                reject(err);
            }).on('close', () => {
                // Ulanish uzilsa, keyingi so'rov avtomatik qayta ulanadi
                this._sshConn = null;
                this._sshReady = null;
            }).connect(this.sshConfig);
        });

        return this._sshReady;
    }

    /**
     * SSH orqali MySQL so'rovini bajarish.
     * Endi har so'rovda yangi SSH ulanish ochilmaydi — mavjud doimiy ulanish qayta
     * ishlatiladi (faqat masofaviy `mysql` CLI jarayoni qayta ishga tushadi). Bu SSH
     * handshake narxini (odatda 200ms-2s) deyarli har bir so'rovdan olib tashlaydi.
     */
    async execQuery(sql) {
        let conn;
        try {
            conn = await this._getSshConnection();
        } catch (err) {
            throw err;
        }

        return new Promise((resolve, reject) => {
            const cmd = `MYSQL_PWD='${this.dbPass}' mysql -u ${this.dbUser} -N -B -e "${sql.replace(/"/g, '\\"')}"`;
            conn.exec(cmd, (err, stream) => {
                if (err) {
                    // Ulanish "chirigan" (masalan tarmoq uzilishi) bo'lishi mumkin —
                    // keyingi chaqiruv yangi ulanish ochishi uchun keshni tozalaymiz.
                    this._sshConn = null;
                    this._sshReady = null;
                    return reject(err);
                }
                let stdout = '';
                let stderr = '';
                stream.on('data', d => stdout += d.toString());
                stream.stderr.on('data', d => stderr += d.toString());
                stream.on('close', code => {
                    if (code !== 0 && stderr) {
                        return reject(new Error(stderr));
                    }
                    resolve(stdout);
                });
            });
        });
    }

    /**
     * SSH orqali Linux tizim buyrug'ini bajarish (masalan `du -sb ...`)
     */
    async execCommand(cmd, timeoutMs = 10000) {
        let conn;
        try {
            conn = await this._getSshConnection();
        } catch (err) {
            throw err;
        }

        return new Promise((resolve, reject) => {
            let timer = null;
            let finished = false;

            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        resolve('');
                    }
                }, timeoutMs);
            }

            conn.exec(cmd, (err, stream) => {
                if (err) {
                    if (timer) clearTimeout(timer);
                    this._sshConn = null;
                    this._sshReady = null;
                    return reject(err);
                }
                let stdout = '';
                let stderr = '';
                stream.on('data', d => stdout += d.toString());
                stream.stderr.on('data', d => stderr += d.toString());
                stream.on('close', code => {
                    if (timer) clearTimeout(timer);
                    if (finished) return;
                    finished = true;
                    if (code !== 0 && stderr && !stdout) {
                        return reject(new Error(stderr));
                    }
                    resolve(stdout);
                });
            });
        });
    }

    /**
     * 1. Operatorlarning haqiqiy ismlarini Issabel asterisk.users jadvalidan olish
     */
    async fetchOperatorNamesDirect() {
        try {
            const sql = 'USE asterisk; SELECT extension, name FROM users WHERE extension REGEXP "^[0-9]{3,4}$";';
            const raw = await this.execQuery(sql);
            const lines = raw.trim().split('\n');
            for (const line of lines) {
                if (!line) continue;
                const [ext, name] = line.split('\t');
                const cleanExt = ext ? ext.trim() : '';
                if (cleanExt && !EXCLUDED_OPERATORS.has(cleanExt)) {
                    if (cleanExt === '114') {
                        this.operatorNames.set('114', 'Maxmudbek');
                    } else {
                        this.operatorNames.set(cleanExt, (name || '').trim() || DEFAULT_OPERATOR_NAMES[cleanExt] || `Operator ${cleanExt}`);
                    }
                }
            }
            this.operatorNames.set('114', 'Maxmudbek');
            return this.operatorNames;
        } catch (err) {
            this.operatorNames.set('114', 'Maxmudbek');
            return this.operatorNames;
        }
    }

    async fetchOperatorNames() {
        this.operatorNames.set('114', 'Maxmudbek');
        return this.operatorNames;
    }

    getTodayDate() {
        return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
    }

    getDateCondition(dateStr) {
        if (dateStr === 'all' || dateStr === 'all_time') {
            return '1=1';
        }
        if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return `calldate >= '${dateStr} 00:00:00' AND calldate <= '${dateStr} 23:59:59'`;
        }
        return `calldate >= CURDATE()`;
    }

    /**
     * 2. Operatorlar statistikasi (Answered, Talk Time, Rejects, Missed)
     */
    async fetchOperatorStats(dateStr = '') {
        const targetDate = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : this.getTodayDate();
        const isToday = targetDate === this.getTodayDate();

        if (isToday && this.cache.operators && this.cache.operators.length > 0) {
            return this.cache.operators;
        }

        const redisKey = `callcenter:hist:operators:${targetDate}`;
        try {
            const redisCached = await redisService.get(redisKey);
            if (redisCached && Array.isArray(redisCached) && redisCached.length > 0) {
                let hasGrand = true;
                for (const op of redisCached) {
                    if (op.grandTotal === undefined) {
                        op.grandTotal = (op.answered || 0) + (op.outbound || 0) + (op.transferredIn || 0);
                        hasGrand = false;
                    }
                }
                if (!hasGrand) {
                    await redisService.set(redisKey, redisCached, 604800);
                }
                return redisCached;
            }
        } catch (e) {}

        if (!this.historicalCache) this.historicalCache = new Map();
        const cacheKey = `operators:${targetDate}`;
        const cached = this.historicalCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 300000) {
            if (cached.data && Array.isArray(cached.data)) {
                for (const op of cached.data) {
                    if (op.grandTotal === undefined) {
                        op.grandTotal = (op.answered || 0) + (op.outbound || 0) + (op.transferredIn || 0);
                    }
                }
                return cached.data;
            }
        }

        try {
            const dateCond = this.getDateCondition(targetDate);
            const sql = `
                USE asteriskcdrdb;
                SELECT
                    dst,
                    COUNT(*) as total_offered,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN billsec ELSE 0 END) as total_duration
                FROM cdr
                WHERE ${dateCond}
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dst REGEXP '^[0-9]{3,4}$'
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')
                GROUP BY dst;

                SELECT '===OP_OUTBOUND===';
                SELECT 
                    SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), 'SIP/', -1) as op_id,
                    COUNT(*) as total_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN billsec ELSE 0 END) as out_duration
                FROM cdr 
                WHERE ${dateCond}
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND LENGTH(dst) >= 7
                GROUP BY op_id;

                SELECT '===XFER_ROWS===';
                SELECT 
                    CASE 
                        WHEN channel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '@', 1), '/', -1)
                        WHEN channel LIKE 'SIP/%-%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), '/', -1)
                        ELSE '' 
                    END AS from_op,
                    dst as to_op,
                    channel
                FROM cdr
                WHERE ${dateCond}
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dcontext = 'from-internal-xfer'
                  AND disposition = 'ANSWERED' AND billsec > 0
                ORDER BY channel ASC, calldate ASC;
            `;
            const raw = await this.execQuery(sql);
            const sections = (raw || '').split('===');
            const sectionMap = {};
            for (let i = 1; i < sections.length; i += 2) {
                sectionMap[sections[i].trim()] = (sections[i + 1] || '').trim();
            }
            const inPart = (sections[0] || '').trim();

            const outMap = new Map();
            if (sectionMap['OP_OUTBOUND']) {
                for (const line of sectionMap['OP_OUTBOUND'].split('\n')) {
                    if (!line) continue;
                    const parts = line.split('\t');
                    const opId = (parts[0] || '').trim();
                    if (opId) {
                        outMap.set(opId, {
                            totalOut: parseInt(parts[1], 10) || 0,
                            ansOut: parseInt(parts[2], 10) || 0,
                            outDur: parseInt(parts[3], 10) || 0
                        });
                    }
                }
            }

            // 4b. Transfer zanjirlari (channel bo'yicha guruhlash)
            // Olgan (xferIn) = oxirgi bo'lib qabul qilib o'zi hal qilgan; Uzatgan (xferOut) = qabul qilib boshqaga o'tkazgan
            const xferOutMap = new Map();       // uzatgan
            const xferInMap = new Map();        // olgan = hal qilgan (Jami +1)
            const xferReceiptsMap = new Map();  // transfer qabul qatorlari (raw dan chiqariladi)
            const xferFirstFromMap = new Map(); // navbatdan to'g'ri olib boshqaga uzatganlar (raw dan chiqariladi)
            if (sectionMap['XFER_ROWS']) {
                const chains = new Map();
                for (const line of sectionMap['XFER_ROWS'].split('\n')) {
                    if (!line) continue;
                    const parts = line.split('\t');
                    const cleanChan = (parts[2] || '').trim();
                    if (!cleanChan) continue;
                    if (!chains.has(cleanChan)) chains.set(cleanChan, []);
                    chains.get(cleanChan).push({ from: (parts[0] || '').trim(), to: (parts[1] || '').trim() });
                }
                for (const rows of chains.values()) {
                    if (!rows || rows.length === 0) continue;
                    for (const r of rows) {
                        if (r.from) xferOutMap.set(r.from, (xferOutMap.get(r.from) || 0) + 1);
                        if (r.to && /^[0-9]{2,4}$/.test(r.to)) {
                            xferReceiptsMap.set(r.to, (xferReceiptsMap.get(r.to) || 0) + 1);
                        }
                    }
                    const first = rows[0];
                    if (first.from && /^[0-9]{2,4}$/.test(first.from)) {
                        xferFirstFromMap.set(first.from, (xferFirstFromMap.get(first.from) || 0) + 1);
                    }
                    let lastTo = '';
                    for (let i = rows.length - 1; i >= 0; i--) {
                        if (rows[i].to && /^[0-9]{2,4}$/.test(rows[i].to)) { lastTo = rows[i].to; break; }
                    }
                    if (lastTo) {
                        xferInMap.set(lastTo, (xferInMap.get(lastTo) || 0) + 1);
                    }
                }
            }

            const inLines = inPart.split('\n');
            const stats = [];
            const rejects = dbService.getTodayOperatorRejects(targetDate);
            const missed = dbService.getTodayOperatorMissed(targetDate);
            const processedExts = new Set();

            for (const line of inLines) {
                if (!line) continue;
                const parts = line.split('\t');
                if (parts.length >= 4) {
                    const ext = parts[0].trim();
                    if (EXCLUDED_OPERATORS.has(ext)) continue;
                    processedExts.add(ext);

                    const ans = parseInt(parts[2], 10) || 0;
                    const inDuration = parseInt(parts[3], 10) || 0;
                    const outInfo = outMap.get(ext) || { ansOut: 0, outDur: 0 };
                    const outbound = outInfo.ansOut;
                    const totalDurationSec = inDuration + outInfo.outDur;
                    const xOut = xferOutMap.get(ext) || 0;
                    const xIn = xferInMap.get(ext) || 0;
                    const receipts = xferReceiptsMap.get(ext) || 0;
                    const directFwd = xferFirstFromMap.get(ext) || 0;
                    const resolvedIn = Math.max(0, ans - receipts - directFwd);
                    const spoken = resolvedIn + outbound + xIn;

                    const opDenied = rejects[ext] || 0;
                    const opMissed = missed[ext] || 0;
                    const avgSec = spoken > 0 ? Math.round(totalDurationSec / spoken) : 0;
                    const name = ext === '114' ? 'Maxmudbek' : (this.operatorNames.get(ext) || `Operator ${ext}`);

                    stats.push({
                        id: ext,
                        name: `${name} (${ext})`,
                        realName: name,
                        totalCalls: resolvedIn + outbound + opDenied + xIn,
                        grandTotal: resolvedIn + outbound + xIn,
                        answered: resolvedIn,
                        rawAnswered: ans,
                        outbound: outbound,
                        transferredOut: xOut,
                        transferredIn: xIn,
                        transferResolved: xIn,
                        denied: opDenied,
                        missed: opMissed,
                        totalDurationSec: totalDurationSec,
                        avgDurationSec: avgSec
                    });
                }
            }

            for (const [ext, outInfo] of outMap.entries()) {
                if (!processedExts.has(ext) && !EXCLUDED_OPERATORS.has(ext) && /^[0-9]{2,4}$/.test(ext)) {
                    processedExts.add(ext);
                    const name = ext === '114' ? 'Maxmudbek' : (this.operatorNames.get(ext) || `Operator ${ext}`);
                    const outbound = outInfo.ansOut;
                    const totalDurationSec = outInfo.outDur;
                    const opDenied = rejects[ext] || 0;
                    const opMissed = missed[ext] || 0;
                    const avgSec = outbound > 0 ? Math.round(totalDurationSec / outbound) : 0;
                    const xIn = xferInMap.get(ext) || 0;

                    stats.push({
                        id: ext,
                        name: `${name} (${ext})`,
                        realName: name,
                        totalCalls: outbound + opDenied + xIn,
                        grandTotal: outbound + xIn,
                        answered: 0,
                        outbound: outbound,
                        transferredOut: xferOutMap.get(ext) || 0,
                        transferredIn: xIn,
                        transferResolved: xIn,
                        denied: opDenied,
                        missed: opMissed,
                        totalDurationSec: totalDurationSec,
                        avgDurationSec: avgSec
                    });
                }
            }

            for (const [ext, name] of this.operatorNames.entries()) {
                if (!processedExts.has(ext) && !EXCLUDED_OPERATORS.has(ext) && /^[0-9]{2,4}$/.test(ext)) {
                    processedExts.add(ext);
                    const opName = ext === '114' ? 'Maxmudbek' : (name || `Operator ${ext}`);
                    const opDenied = rejects[ext] || 0;
                    const opMissed = missed[ext] || 0;
                    stats.push({
                        id: ext,
                        name: `${opName} (${ext})`,
                        realName: opName,
                        totalCalls: opDenied,
                        grandTotal: 0,
                        answered: 0,
                        rawAnswered: 0,
                        outbound: 0,
                        transferredOut: 0,
                        transferredIn: 0,
                        transferResolved: 0,
                        denied: opDenied,
                        missed: opMissed,
                        totalDurationSec: 0,
                        avgDurationSec: 0
                    });
                }
            }

            this.historicalCache.set(cacheKey, { data: stats, timestamp: Date.now() });
            if (!isToday) {
                await redisService.set(redisKey, stats, 604800); // 7 kun Redis kesh
            }
            return stats;
        } catch (err) {
            console.error('❌ fetchOperatorStats xatolik:', err.message);
            return [];
        }
    }

    async fetchTodayOperatorStatsDirect() {
        return this.fetchOperatorStats(this.getTodayDate());
    }

    async fetchTodayOperatorStats() {
        if (this.cache.operators && this.cache.operators.length > 0) {
            return this.cache.operators;
        }
        return this.fetchOperatorStats(this.getTodayDate());
    }

    /**
     * 3. Soatlik grafik (08:00 dan 21:00 gacha)
     */
    async fetchHourlyStats(dateStr = '') {
        const targetDate = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : this.getTodayDate();
        const isToday = targetDate === this.getTodayDate();

        if (isToday && this.cache.hourly) {
            return this.cache.hourly;
        }

        if (!this.historicalCache) this.historicalCache = new Map();
        const cacheKey = `hourly:${targetDate}`;
        const cached = this.historicalCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 300000) {
            return cached.data;
        }

        try {
            const dateCond = this.getDateCondition(targetDate);
            const sql = `
                USE asteriskcdrdb;
                SELECT 
                    HOUR(calldate) as hr,
                    COUNT(DISTINCT uniqueid) as total_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered
                FROM cdr 
                WHERE ${dateCond} 
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%')
                  AND channel NOT LIKE 'Local/%'
                  AND (dcontext IS NULL OR dcontext != 'from-internal')
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')
                  AND HOUR(calldate) BETWEEN 8 AND 21
                GROUP BY hr
                ORDER BY hr ASC;
            `;
            const raw = await this.execQuery(sql);
            const lines = (raw || '').trim().split('\n');
            const hourlyMap = new Map();

            for (const line of lines) {
                if (!line) continue;
                const [hrStr, totalStr, ansStr] = line.split('\t');
                const hr = parseInt(hrStr, 10);
                const total = parseInt(totalStr, 10) || 0;
                const ans = parseInt(ansStr, 10) || 0;
                hourlyMap.set(hr, { total, answered: ans });
            }

            const labels = [];
            const inboundData = [];
            const answeredData = [];
            for (let h = 8; h <= 21; h++) {
                labels.push(`${String(h).padStart(2, '0')}:00`);
                const val = hourlyMap.get(h) || { total: 0, answered: 0 };
                inboundData.push(val.total);
                answeredData.push(val.answered);
            }

            const res = { labels, inbound: inboundData, answered: answeredData };
            this.historicalCache.set(cacheKey, { data: res, timestamp: Date.now() });
            return res;
        } catch (err) {
            const labels = [];
            for (let h = 8; h <= 21; h++) labels.push(`${String(h).padStart(2, '0')}:00`);
            return { labels, inbound: new Array(14).fill(0), answered: new Array(14).fill(0) };
        }
    }

    async fetchTodayHourlyStatsDirect() {
        return this.fetchHourlyStats(this.getTodayDate());
    }

    async fetchTodayHourlyStats() {
        if (this.cache.hourly) {
            return this.cache.hourly;
        }
        return this.fetchHourlyStats(this.getTodayDate());
    }

    /**
     * 4. Umumiy ko'rsatkichlar (KPI Cards - Inbound, Outbound, Answered, Abandoned, Denied)
     */
    async fetchSummaryByDate(dateStr = '') {
        const targetDate = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : this.getTodayDate();
        const isToday = targetDate === this.getTodayDate();

        if (isToday && this.cache.summary) {
            return this.cache.summary;
        }

        if (!this.historicalCache) this.historicalCache = new Map();
        const cacheKey = `summary:${targetDate}`;
        const cached = this.historicalCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 300000) {
            return cached.data;
        }

        try {
            const dateCond = this.getDateCondition(targetDate);
            const sql = `
                USE asteriskcdrdb;
                SELECT 
                    COUNT(DISTINCT c.uniqueid) as total_inbound,
                    COUNT(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN c.uniqueid END) as ans_inbound,
                    COALESCE(SUM(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN op.talk_sec END), 0) as in_talk_sec,
                    SUM(CASE WHEN c.disposition = 'FAILED' THEN 1 ELSE 0 END) as den_inbound
                FROM cdr c
                LEFT JOIN (
                    SELECT 
                        uniqueid,
                        MAX(billsec) as talk_sec
                    FROM cdr
                    WHERE ${dateCond}
                      AND disposition = 'ANSWERED'
                      AND billsec > 0
                      AND (
                          dst REGEXP '^[0-9]{2,4}$' 
                          OR dstchannel LIKE 'Local/%@from-queue%' 
                          OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%')
                      )
                    GROUP BY uniqueid
                ) op ON c.uniqueid = op.uniqueid
                WHERE ${dateCond}
                  AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%')
                  AND c.channel NOT LIKE 'Local/%'
                  AND (c.dcontext IS NULL OR c.dcontext != 'from-internal')
                  AND (c.src IS NULL OR c.src NOT REGEXP '^[0-9]{1,4}$');

                SELECT 
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as total_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as out_talk_sec
                FROM cdr 
                WHERE ${dateCond}
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND LENGTH(dst) >= 7;
            `;
            const raw = await this.execQuery(sql);
            const blocks = (raw || '').trim().split('\n');

            const [inTotalStr, inAnsStr, inDurStr, inDenStr] = (blocks[0] || '').split('\t');
            const inTotal = parseInt(inTotalStr, 10) || 0;
            const inAns = parseInt(inAnsStr, 10) || 0;
            const inDur = parseInt(inDurStr, 10) || 0;
            const inDen = parseInt(inDenStr, 10) || 0;

            const [outTotalStr, outAnsStr, outDurStr] = (blocks[1] || '').split('\t');
            const outTotal = parseInt(outAnsStr, 10) || parseInt(outTotalStr, 10) || 0;
            const outAns = parseInt(outAnsStr, 10) || 0;
            const outDur = parseInt(outDurStr, 10) || 0;

            const dateRejects = dbService.getTodayOperatorRejects(targetDate);
            const totalOpDenied = Object.values(dateRejects).reduce((a, b) => a + b, 0);

            const total = inTotal + outTotal;
            const answered = inAns;
            const durationSec = inDur + outDur;
            const denied = totalOpDenied;
            const abandoned = Math.max(0, inTotal - inAns);

            const answerRate = inTotal > 0 ? Math.round((answered / inTotal) * 100) : 0;
            const abandonedRate = inTotal > 0 ? Math.round((abandoned / inTotal) * 100) : 0;
            const outboundRate = total > 0 ? Math.round((outTotal / total) * 100) : 0;
            const denyRate = total > 0 ? Math.round((denied / total) * 100) : 0;

            const result = {
                totalCalls: total,
                inboundCalls: inTotal,
                outboundCalls: outTotal,
                answeredCalls: answered,
                abandonedCalls: abandoned,
                deniedCalls: denied,
                totalDurationSec: durationSec,
                answerRate,
                abandonedRate,
                outboundRate,
                denyRate
            };

            this.historicalCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        } catch (err) {
            console.error('❌ fetchSummaryByDate xatolik:', err.message);
            return null;
        }
    }

    async fetchTodaySummaryDirect() {
        return this.fetchSummaryByDate(this.getTodayDate());
    }

    async fetchTodaySummary() {
        if (this.cache.summary) {
            return this.cache.summary;
        }
        return this.fetchSummaryByDate(this.getTodayDate());
    }

    /**
     * Dashboard uchun to'liq statistika (KPIs, Charts, Rejects, Missed) sanaga bog'langan holda (Single fast SSH multiSql)
     */
    async fetchFullStatsByDate(dateStr = '') {
        const targetDate = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : this.getTodayDate();
        const isPastDate = targetDate < this.getTodayDate();

        const redisKey = `callcenter:hist:full_stats:${targetDate}`;
        try {
            const redisCached = await redisService.get(redisKey);
            if (redisCached && typeof redisCached === 'object' && redisCached.totalCalls !== undefined) {
                const dateMissed = dbService.getTodayOperatorMissed(targetDate);
                const totalOpMissed = Object.values(dateMissed).reduce((a, b) => a + b, 0);
                redisCached.missedCalls = totalOpMissed;
                return redisCached;
            }
        } catch (e) {}

        if (!this.historicalCache) this.historicalCache = new Map();
        const cacheKey = `full_stats:${targetDate}`;
        const cached = this.historicalCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 300000) {
            const dateMissed = dbService.getTodayOperatorMissed(targetDate);
            const totalOpMissed = Object.values(dateMissed).reduce((a, b) => a + b, 0);
            cached.data.missedCalls = totalOpMissed;
            return cached.data;
        }

        try {
            const dateCond = this.getDateCondition(targetDate);
            const multiSql = `
                SELECT '===SUMMARY_IN===' as marker;
                USE asteriskcdrdb;
                SELECT 
                    COUNT(DISTINCT c.uniqueid) as total_inbound,
                    COUNT(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN c.uniqueid END) as ans_inbound,
                    COALESCE(SUM(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN op.talk_sec END), 0) as in_talk_sec,
                    SUM(CASE WHEN c.disposition = 'FAILED' THEN 1 ELSE 0 END) as den_inbound
                FROM cdr c
                LEFT JOIN (
                    SELECT 
                        uniqueid,
                        MAX(billsec) as talk_sec
                    FROM cdr
                    WHERE ${dateCond}
                      AND disposition = 'ANSWERED'
                      AND billsec > 0
                      AND (
                          dst REGEXP '^[0-9]{2,4}$' 
                          OR dstchannel LIKE 'Local/%@from-queue%' 
                          OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%')
                      )
                    GROUP BY uniqueid
                ) op ON c.uniqueid = op.uniqueid
                WHERE ${dateCond} 
                  AND TIME(c.calldate) >= '08:00:00' AND TIME(c.calldate) <= '21:00:00'
                  AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%')
                  AND c.channel NOT LIKE 'Local/%'
                  AND (c.dcontext IS NULL OR c.dcontext != 'from-internal')
                  AND (c.src IS NULL OR c.src NOT REGEXP '^[0-9]{1,4}$');

                SELECT '===SUMMARY_OUT===' as marker;
                SELECT 
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as total_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as out_talk_sec
                FROM cdr 
                WHERE ${dateCond} 
                  AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND LENGTH(dst) >= 7;

                SELECT '===HOURLY===' as marker;
                SELECT 
                    HOUR(c.calldate) as hr,
                    COUNT(DISTINCT c.uniqueid) as total_inbound,
                    COUNT(DISTINCT CASE WHEN op.uniqueid IS NOT NULL THEN c.uniqueid END) as answered
                FROM cdr c
                LEFT JOIN (
                    SELECT DISTINCT uniqueid
                    FROM cdr
                    WHERE ${dateCond}
                      AND disposition = 'ANSWERED'
                      AND billsec > 0
                      AND (
                          dst REGEXP '^[0-9]{2,4}$' 
                          OR dstchannel LIKE 'Local/%@from-queue%' 
                          OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%')
                      )
                ) op ON c.uniqueid = op.uniqueid
                WHERE ${dateCond} 
                  AND TIME(c.calldate) >= '08:00:00' AND TIME(c.calldate) <= '21:00:00'
                  AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%')
                  AND c.channel NOT LIKE 'Local/%'
                  AND (c.dcontext IS NULL OR c.dcontext != 'from-internal')
                  AND (c.src IS NULL OR c.src NOT REGEXP '^[0-9]{1,4}$')
                  AND HOUR(c.calldate) BETWEEN 8 AND 21
                GROUP BY hr ORDER BY hr ASC;
            `;

            const raw = await this.execQuery(multiSql);
            const sections = (raw || '').split('===');
            const sectionMap = {};
            for (let i = 1; i < sections.length; i += 2) {
                const title = sections[i].trim();
                const content = (sections[i + 1] || '').trim();
                sectionMap[title] = content;
            }

            let inTotal = 0, inAns = 0, inDur = 0, inDen = 0, outTotal = 0, outAns = 0, outDur = 0;
            if (sectionMap['SUMMARY_IN']) {
                const [it, ia, idur, iden] = sectionMap['SUMMARY_IN'].split('\t');
                inTotal = parseInt(it, 10) || 0;
                inAns = parseInt(ia, 10) || 0;
                inDur = parseInt(idur, 10) || 0;
                inDen = parseInt(iden, 10) || 0;
            }
            if (sectionMap['SUMMARY_OUT']) {
                const [ot, oa, odur] = sectionMap['SUMMARY_OUT'].split('\t');
                outTotal = parseInt(oa, 10) || parseInt(ot, 10) || 0;
                outAns = parseInt(oa, 10) || 0;
                outDur = parseInt(odur, 10) || 0;
            }

            const dateRejects = dbService.getTodayOperatorRejects(targetDate);
            const totalOpDenied = Object.values(dateRejects).reduce((a, b) => a + b, 0);

            const dateMissed = dbService.getTodayOperatorMissed(targetDate);
            const totalOpMissed = Object.values(dateMissed).reduce((a, b) => a + b, 0);

            const total = inTotal + outTotal;
            const answered = inAns;
            const durationSec = inDur + outDur;
            const abandoned = Math.max(0, inTotal - inAns);
            const answerRate = inTotal > 0 ? Math.round((answered / inTotal) * 100) : 0;
            const abandonedRate = inTotal > 0 ? Math.round((abandoned / inTotal) * 100) : 0;
            const outboundRate = total > 0 ? Math.round((outTotal / total) * 100) : 0;
            const denyRate = total > 0 ? Math.round((totalOpDenied / total) * 100) : 0;
            const missedRate = total > 0 ? Math.round((totalOpMissed / total) * 100) : 0;

            const hourlyMap = new Map();
            if (sectionMap['HOURLY']) {
                const lines = sectionMap['HOURLY'].split('\n');
                for (const l of lines) {
                    if (!l) continue;
                    const [hrStr, totStr, ansStr] = l.split('\t');
                    hourlyMap.set(parseInt(hrStr, 10), {
                        total: parseInt(totStr, 10) || 0,
                        answered: parseInt(ansStr, 10) || 0
                    });
                }
            }
            const labels = [];
            const inboundData = [];
            const answeredData = [];
            for (let h = 8; h <= 21; h++) {
                labels.push(`${String(h).padStart(2, '0')}:00`);
                const val = hourlyMap.get(h) || { total: 0, answered: 0 };
                inboundData.push(val.total);
                answeredData.push(val.answered);
            }
            const hourlyChart = { labels, inbound: inboundData, answered: answeredData };

            const result = {
                totalCalls: total,
                inboundCalls: inTotal,
                outboundCalls: outTotal,
                answeredCalls: answered,
                abandonedCalls: abandoned,
                deniedCalls: totalOpDenied,
                missedCalls: totalOpMissed,
                totalDurationSec: durationSec,
                answerRate,
                abandonedRate,
                outboundRate,
                denyRate,
                missedRate,
                hourlyChart,
                activeCount: 0,
                queueWaitingTotal: 0,
                clientHangupCalls: 0,
                operatorHangupCalls: 0,
                selectedDate: targetDate
            };

            this.historicalCache.set(cacheKey, { data: result, timestamp: Date.now() });
            if (isPastDate) {
                await redisService.set(redisKey, result, 604800); // 7 kun
            }
            return result;
        } catch (err) {
            console.error('❌ fetchFullStatsByDate xatolik:', err.message);
            return null;
        }
    }

    /**
     * 5. Tarixni to'g'ridan-to'g'ri Issabel MariaDB dan paginatsiya bilan olish
     */
    async fetchCallsPaginated(page = 1, limit = 20, search = '', dateStr = '', direction = '', status = '') {
        try {
            const isAll = dateStr === 'all' || dateStr === 'all_time';
            const targetDate = isAll ? 'all' : ((dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : this.getTodayDate());
            const isPastDate = !isAll && targetDate < this.getTodayDate();
            const redisKey = `callcenter:hist:calls:v5:${targetDate}:${page}:${limit}:${search || '_'}:${direction || '_'}:${status || '_'}`;

            // 1. Redis dan tayyor sahifa keshini tekshirish (Bugun uchun ham 15 soniya, arxiv uchun 7 kun, all uchun 30s)
            try {
                const cached = await redisService.get(redisKey);
                if (cached && typeof cached === 'object' && cached.data) {
                    return cached;
                }
            } catch (e) {}

            const offset = (Math.max(1, page) - 1) * limit;
            const dateCond = this.getDateCondition(dateStr);
            const dateCondCdr = dateCond.replace(/calldate/g, 'c.calldate');
            let filter = ` WHERE ${dateCondCdr} AND TIME(c.calldate) >= '08:00:00' AND TIME(c.calldate) <= '21:00:00' AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%' OR (c.dcontext = 'from-internal' AND c.channel REGEXP '^SIP/[0-9]{2,4}-')) AND c.channel NOT LIKE 'Local/%' `;

            if (search) {
                const s = search.replace(/'/g, "\\'");
                const searchLower = search.trim().toLowerCase();
                const matchedExts = [];
                for (const [ext, name] of this.operatorNames.entries()) {
                    if (name.toLowerCase().includes(searchLower) || searchLower.includes(name.toLowerCase())) {
                        matchedExts.push(ext);
                    }
                }
                for (const [ext, name] of Object.entries(DEFAULT_OPERATOR_NAMES)) {
                    if ((name.toLowerCase().includes(searchLower) || searchLower.includes(name.toLowerCase())) && !matchedExts.includes(ext)) {
                        matchedExts.push(ext);
                    }
                }

                let searchCond = `(c.src LIKE '%${s}%' OR c.dst LIKE '%${s}%' OR c.dstchannel LIKE '%${s}%' OR c.disposition LIKE '%${s}%' OR c.channel LIKE '%${s}%')`;
                if (matchedExts.length > 0) {
                    const extConds = matchedExts.map(ext => `((c.disposition = 'ANSWERED' AND c.billsec > 0 AND (c.dstchannel LIKE '%/${ext}-%' OR c.channel LIKE '%/${ext}-%' OR c.dstchannel LIKE '%Local/${ext}@%' OR c.channel LIKE '%Local/${ext}@%' OR c.dst = '${ext}')) OR c.src = '${ext}')`).join(' OR ');
                    searchCond = `(${searchCond} OR (${extConds}))`;
                }
                filter += ` AND ${searchCond} `;
            }

            if (direction === 'transfer') {
                filter += ` AND (xfer.xfer_chain IS NOT NULL AND xfer.xfer_chain != '' AND xfer.xfer_chain != 'NULL' AND xfer.xfer_chain != '\\\\N') `;
            } else if (direction === 'outbound') {
                filter += ` AND (c.dcontext = 'from-internal' AND c.channel REGEXP '^SIP/[0-9]{2,4}-') AND (xfer.xfer_chain IS NULL OR xfer.xfer_chain = 'NULL' OR xfer.xfer_chain = '') `;
            } else if (direction === 'inbound') {
                filter += ` AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%') AND (xfer.xfer_chain IS NULL OR xfer.xfer_chain = 'NULL' OR xfer.xfer_chain = '') `;
            }

            if (status === 'answered') {
                filter += ` AND (c.disposition = 'ANSWERED' AND c.billsec > 0) `;
            } else if (status === 'missed') {
                filter += ` AND (c.disposition != 'ANSWERED' OR c.billsec = 0) `;
            }

            let total = 0;
            const isToday = !isAll && (!dateStr || dateStr === this.getTodayDate());
            const countRedisKey = `callcenter:hist:count:v5:${targetDate}:${search || '_'}:${direction || '_'}:${status || '_'}`;

            let cachedCount = null;
            try {
                cachedCount = await redisService.get(countRedisKey);
            } catch (e) {}

            const xferSubDateCond = (!isAll && dateCond) ? `WHERE ${dateCond} AND dcontext = 'from-internal-xfer' AND dst REGEXP '^[0-9]{2,4}$'` : `WHERE dcontext = 'from-internal-xfer' AND dst REGEXP '^[0-9]{2,4}$'`;

            if (cachedCount !== null && cachedCount !== undefined) {
                total = parseInt(cachedCount, 10) || 0;
            } else if (!search && !direction && !status && isToday && this.cache.summary && this.cache.summary.totalCalls) {
                total = this.cache.summary.totalCalls;
            } else {
                const countSql = `
                    USE asteriskcdrdb;
                    SELECT COUNT(DISTINCT c.uniqueid)
                    FROM cdr c
                    LEFT JOIN (
                        SELECT 
                            uniqueid,
                            SUBSTRING_INDEX(channel, ';', 1) as xfer_key,
                            SUBSTRING_INDEX(SUBSTRING_INDEX(MIN(channel), '@', 1), '/', -1) as xfer_from,
                            GROUP_CONCAT(DISTINCT dst ORDER BY calldate ASC SEPARATOR ' ➔ ') as xfer_chain
                        FROM cdr
                        ${xferSubDateCond}
                        GROUP BY uniqueid
                    ) xfer ON (c.uniqueid = xfer.uniqueid OR (xfer.xfer_key IS NOT NULL AND xfer.xfer_key != '' AND (SUBSTRING_INDEX(c.channel, ';', 1) = xfer.xfer_key OR SUBSTRING_INDEX(c.dstchannel, ';', 1) = xfer.xfer_key)))
                    ${filter};
                `;
                const countRaw = await this.execQuery(countSql);
                total = parseInt((countRaw || '').trim(), 10) || 0;
                await redisService.set(countRedisKey, total, isPastDate ? 604800 : (isAll ? 60 : 45));
            }
            const totalPages = Math.ceil(total / limit) || 1;

            const dataSql = `
                USE asteriskcdrdb;
                SELECT 
                    c.uniqueid,
                    DATE_FORMAT(MIN(c.calldate), '%Y-%m-%d %H:%i:%s') as call_time,
                    MIN(c.src) as src,
                    MIN(c.dst) as dst,
                    MAX(CASE 
                        WHEN c.channel REGEXP '^SIP/[0-9]{2,4}-' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.channel, '/', -1), '-', 1)
                        WHEN c.src REGEXP '^[0-9]{2,4}$' THEN c.src
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.dstchannel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.dstchannel, '@', 1), '/', -1)
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.channel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.channel, '@', 1), '/', -1)
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.dstchannel LIKE 'SIP/%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.dstchannel, '/', -1), '-', 1)
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.dst REGEXP '^[0-9]{2,4}$' THEN c.dst
                        WHEN c.dst REGEXP '^[0-9]{2,4}$' THEN c.dst 
                        WHEN c.dstchannel LIKE 'SIP/%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.dstchannel, '/', -1), '-', 1)
                        ELSE ''
                    END) as op_ext,
                    CASE 
                        WHEN MAX(CASE WHEN c.disposition='ANSWERED' AND c.billsec > 0 THEN 1 ELSE 0 END) = 1 THEN 'ANSWERED' 
                        WHEN MAX(CASE WHEN c.disposition='BUSY' THEN 1 ELSE 0 END) = 1 THEN 'BUSY'
                        WHEN MAX(CASE WHEN c.disposition='FAILED' THEN 1 ELSE 0 END) = 1 THEN 'DENIED'
                        ELSE 'ABANDONED' 
                    END as final_disp,
                    MAX(c.billsec) as talk_sec,
                    MAX(c.duration) as wait_sec,
                    TIMESTAMPDIFF(SECOND, MIN(c.calldate), MAX(CASE WHEN c.disposition='ANSWERED' AND c.billsec > 0 THEN c.calldate END)) as ans_lag_sec,
                    MAX(c.recordingfile) as rec,
                    MAX(CASE WHEN c.dcontext = 'from-internal' AND c.channel REGEXP '^SIP/[0-9]{2,4}-' THEN 1 ELSE 0 END) as is_out,
                    MAX(xfer.xfer_from) as xfer_from,
                    MAX(xfer.xfer_chain) as xfer_chain
                FROM cdr c
                LEFT JOIN (
                    SELECT 
                        uniqueid,
                        SUBSTRING_INDEX(channel, ';', 1) as xfer_key,
                        SUBSTRING_INDEX(SUBSTRING_INDEX(MIN(channel), '@', 1), '/', -1) as xfer_from,
                        GROUP_CONCAT(DISTINCT dst ORDER BY calldate ASC SEPARATOR ' ➔ ') as xfer_chain
                    FROM cdr
                    ${xferSubDateCond}
                    GROUP BY uniqueid
                ) xfer ON (c.uniqueid = xfer.uniqueid OR (xfer.xfer_key IS NOT NULL AND xfer.xfer_key != '' AND (SUBSTRING_INDEX(c.channel, ';', 1) = xfer.xfer_key OR SUBSTRING_INDEX(c.dstchannel, ';', 1) = xfer.xfer_key)))
                ${filter}
                GROUP BY c.uniqueid
                ORDER BY call_time DESC 
                LIMIT ${limit} OFFSET ${offset};
            `;
            const dataRaw = await this.execQuery(dataSql);
            const lines = (dataRaw || '').trim().split('\n');
            const calls = [];

            for (const line of lines) {
                if (!line) continue;
                const [uid, calldate, src, dst, opExtRaw, disp, talkSecStr, waitSecStr, ansLagStr, rec, isOutFlag, xferFromRaw, xferChainRaw] = line.split('\t');
                const talkSec = parseInt(talkSecStr, 10) || 0;
                const waitSecVal = parseInt(waitSecStr, 10) || 0;
                const ansLagSec = parseInt(ansLagStr, 10) || 0;
                const opExt = (opExtRaw || '').trim();
                const xferChain = (xferChainRaw || '').trim();
                const isXfer = Boolean(xferChain && xferChain !== 'NULL' && xferChain !== '\\N');

                const hasRealOp = Boolean((opExt && opExt.length >= 2 && opExt.length <= 4 && opExt !== '2020159') || isXfer);
                let realName = hasRealOp ? this.operatorNames.get(opExt) : null;
                if (opExt === '114') realName = 'Maxmudbek';

                // Haqiqiy javob berilgan faqat operatorga ulanib suhbat bo'lganda hisoblanadi
                const isRealAnswered = hasRealOp && (disp === 'ANSWERED' || talkSec > 0);

                let opName = 'Operatorga ulanmadi';
                let direction = (isOutFlag === '1' || (src && src.length <= 4)) ? 'outbound' : 'inbound';
                let finalOpExt = opExt;

                if (isXfer) {
                    direction = 'transfer';

                    // Multi-hop transfer zanjiri (masalan: Navruzoy (120) ➔ Muattar (119) [➔ ...])
                    const initOp = (xferFromRaw && xferFromRaw !== 'NULL' && xferFromRaw !== '\\N' ? xferFromRaw : opExt || '').trim();
                    const destOps = xferChain.split('➔').map(s => s.trim()).filter(Boolean);
                    const chainList = [];
                    if (initOp) chainList.push(initOp);
                    for (const d of destOps) {
                        if (!chainList.includes(d) || chainList[chainList.length - 1] !== d) {
                            chainList.push(d);
                        }
                    }

                    if (chainList.length > 0) {
                        opName = chainList.map(ext => {
                            let name = this.operatorNames.get(ext) || DEFAULT_OPERATOR_NAMES[ext];
                            if (ext === '114') name = 'Maxmudbek';
                            return name ? `${name} (${ext})` : `Operator ${ext}`;
                        }).join(' ➔ ');
                        finalOpExt = chainList[chainList.length - 1];
                    } else {
                        opName = `Operator (Transfer: ${xferChain})`;
                    }
                } else if (hasRealOp) {
                    opName = realName ? `${realName} (${opExt})` : `Operator ${opExt}`;
                }

                const isOut = direction === 'outbound';
                const callerNumber = isOut ? (dst || 'Yashirin') : (src || 'Yashirin');
                let hangupParty = isXfer 
                    ? 'Transfer (Operatorga)' 
                    : (isRealAnswered ? 'Mijoz' : ((isOut && disp === 'BUSY') ? 'Band' : 'Ko\'tarilmadi'));

                calls.push({
                    id: uid,
                    time: calldate,
                    callerId: callerNumber,
                    operator: opName,
                    operatorExten: hasRealOp ? (finalOpExt || opExt || xferFromRaw || '') : '',
                    direction: direction,
                    duration: isRealAnswered ? talkSec : 0,
                    waitSec: isRealAnswered ? Math.max(0, ansLagSec) : waitSecVal,
                    status: isRealAnswered ? 'ANSWERED' : ((isOut && disp === 'BUSY') ? 'BUSY' : 'ABANDONED'),
                    hangupParty: hangupParty,
                    recording: isRealAnswered ? (rec || '') : ''
                });
            }

            const result = { total, page: Math.min(page, totalPages), totalPages, limit, data: calls };
            await redisService.set(redisKey, result, isPastDate ? 604800 : (isAll ? 30 : 15));
            return result;
        } catch (err) {
            console.error('⚠️ Issabel fetchCallsPaginated xatolik:', err.message);
            return { total: 0, page: 1, totalPages: 1, limit, data: [] };
        }
    }

    /**
     * Kartochkalar yoki Operator bosilganda uning tanlangan sana bo'yicha barcha qo'ng'iroqlari tafsiloti
     */
    async fetchCallsDetail({ type = 'all', operatorExt = '', page = 1, limit = 50, search = '', dateStr = '' }) {
        try {
            limit = Math.min(Math.max(10, parseInt(limit, 10) || 50), 500);
            page = Math.max(1, parseInt(page, 10) || 1);
            const offset = (page - 1) * limit;
            const targetDate = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : null;
            const isToday = !targetDate || targetDate === this.getTodayDate();
            const isPastDate = targetDate && targetDate < this.getTodayDate();

            const redisKey = `callcenter:hist:detail:${targetDate}:${type}:${operatorExt || '_'}:${page}:${limit}:${search || '_'}`;
            if (isPastDate) {
                try {
                    const cached = await redisService.get(redisKey);
                    if (cached && typeof cached === 'object' && cached.data) {
                        return cached;
                    }
                } catch (e) {}
            }

            let whereClause = this.getDateCondition(targetDate);
            whereClause += " AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00' ";

            const dateCondDetail = this.getDateCondition(targetDate);
            const opAnsSub = `
                SELECT DISTINCT uniqueid
                FROM cdr
                WHERE ${dateCondDetail}
                  AND disposition = 'ANSWERED'
                  AND billsec > 0
                  AND (
                      dst REGEXP '^[0-9]{2,4}$' 
                      OR dstchannel LIKE 'Local/%@from-queue%' 
                      OR (dstchannel LIKE 'SIP/%' AND dstchannel NOT LIKE '%2020159%')
                  )
            `;

            // 'abandoned' turi uchun: operator javob bermagan kiruvchi qo'ng'iroqlar
            let isAbandoned = false;

            if (type === 'denied') {
                const raw = dbService.getRejectEventsPaginated(page, limit, search, targetDate, operatorExt);
                // operator nomini va caller_id ni to'g'irlash
                raw.data = raw.data.map(r => {
                    const opId = r.dst;
                    const opName = this.operatorNames.get(String(opId)) || DEFAULT_OPERATOR_NAMES[String(opId)] || null;
                    const displayOp = opName ? `${opName} (${opId})` : `Operator ${opId}`;
                    const callerRaw = r.src || '';
                    const callerClean = (callerRaw === 'undefined' || callerRaw === 'undefined raqam' || !callerRaw)
                        ? 'Yashirin raqam'
                        : callerRaw;
                    return {
                        ...r,
                        src: callerClean,
                        callerId: callerClean,
                        operator: displayOp,
                        recording: null,
                        duration: 0,
                        waitSec: 0
                    };
                });
                return raw;
            }

            if (type === 'missed') {
                const raw = dbService.getMissedEventsPaginated(page, limit, search, targetDate);
                raw.data = raw.data.map(r => {
                    const opId = r.dst;
                    const opName = this.operatorNames.get(String(opId)) || DEFAULT_OPERATOR_NAMES[String(opId)] || null;
                    const displayOp = opName ? `${opName} (${opId})` : `Operator ${opId}`;
                    const callerRaw = r.src || '';
                    const callerClean = (callerRaw === 'undefined' || callerRaw === 'undefined raqam' || !callerRaw)
                        ? 'Yashirin raqam'
                        : callerRaw;
                    return {
                        ...r,
                        src: callerClean,
                        callerId: callerClean,
                        operator: displayOp,
                        recording: null,
                        duration: 0,
                        waitSec: 0
                    };
                });
                return raw;
            }

            if (type === 'transferred') {
                whereClause += ` AND dcontext = 'from-internal-xfer' AND disposition = 'ANSWERED'`;
                if (operatorExt) {
                    whereClause += ` AND (
                        dst = '${operatorExt}' OR
                        channel LIKE 'Local/${operatorExt}@%' OR
                        channel LIKE 'SIP/${operatorExt}-%'
                    )`;
                }
            } else if (type === 'outbound') {
                whereClause += ` AND dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND LENGTH(dst) >= 7 AND disposition = 'ANSWERED' AND billsec > 0`;
            } else if (type === 'inbound') {
                whereClause += ` AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%') AND channel NOT LIKE 'Local/%' AND (dcontext IS NULL OR dcontext != 'from-internal') AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')`;
            } else if (type === 'answered') {
                whereClause += ` AND disposition = 'ANSWERED' AND billsec > 0 AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%')`;
            } else if (type === 'abandoned') {
                whereClause += ` AND (c.dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR c.channel LIKE 'SIP/712020159%') AND c.channel NOT LIKE 'Local/%' AND (c.dcontext IS NULL OR c.dcontext != 'from-internal') AND (c.src IS NULL OR c.src NOT REGEXP '^[0-9]{1,4}$') AND op_ans.uniqueid IS NULL`;
                isAbandoned = true;
            } else if (type === 'operator' && operatorExt) {
                whereClause += ` AND (
                    (dstchannel LIKE 'SIP/${operatorExt}-%') OR
                    (channel LIKE 'SIP/${operatorExt}-%') OR
                    (src = '${operatorExt}' AND dcontext = 'from-internal') OR
                    (dst = '${operatorExt}' AND disposition = 'ANSWERED' AND billsec > 0)
                ) AND dst NOT IN ('s', 'h', 't', 'i', 'e') AND dcontext NOT LIKE 'app-%' AND dst NOT LIKE '*%'`;
            } else {
                whereClause += ` AND ((dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%') AND channel NOT LIKE 'Local/%' OR (dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND LENGTH(dst) >= 7))`;
            }

            if (search) {
                const s = search.replace(/'/g, '').trim();
                const searchLower = s.toLowerCase();
                const matchedExts = [];
                for (const [ext, name] of this.operatorNames.entries()) {
                    if (name.toLowerCase().includes(searchLower) || searchLower.includes(name.toLowerCase())) {
                        matchedExts.push(ext);
                    }
                }
                for (const [ext, name] of Object.entries(DEFAULT_OPERATOR_NAMES)) {
                    if ((name.toLowerCase().includes(searchLower) || searchLower.includes(name.toLowerCase())) && !matchedExts.includes(ext)) {
                        matchedExts.push(ext);
                    }
                }

                const isPhone = /^[0-9+]{6,15}$/.test(s);
                let sCond = '';
                if (isPhone) {
                    const cleanPhone = s.replace(/^\+/, '');
                    sCond = `(src = '${cleanPhone}' OR dst = '${cleanPhone}' OR src LIKE '%${cleanPhone}' OR dst LIKE '%${cleanPhone}')`;
                } else {
                    sCond = `(src LIKE '%${s}%' OR dst LIKE '%${s}%' OR dstchannel LIKE '%${s}%' OR channel LIKE '%${s}%')`;
                }

                if (matchedExts.length > 0) {
                    const extConds = matchedExts.map(ext => `dstchannel LIKE '%/${ext}-%' OR channel LIKE '%/${ext}-%' OR dstchannel LIKE '%Local/${ext}@%' OR channel LIKE '%Local/${ext}@%' OR dst = '${ext}' OR src = '${ext}'`).join(' OR ');
                    sCond = `(${sCond} OR (${extConds}))`;
                }
                whereClause += ` AND ${sCond}`;
            }

            let total = 0;
            if (type === 'abandoned') {
                // pastda hisoblanadi
            } else if (!search && isToday && this.cache.summary) {
                if (type === 'all') total = this.cache.summary.totalCalls;
                else if (type === 'inbound') total = this.cache.summary.inboundCalls;
                else if (type === 'outbound') total = this.cache.summary.outboundCalls;
                else if (type === 'answered') total = this.cache.summary.answeredCalls;
                else if (type === 'abandoned') total = this.cache.summary.abandonedCalls;
                else if (type === 'denied') total = this.cache.summary.deniedCalls;
            }

            // Tezkor qidiruv optimizatsiyasi: qidiruv bo'lganda og'ir COUNT(DISTINCT) qilinmaydi!
            const skipCount = Boolean(search);
            if (!total && !skipCount) {
                const countSql = isAbandoned
                    ? `
                    USE asteriskcdrdb;
                    SELECT COUNT(DISTINCT c.uniqueid)
                    FROM cdr c
                    LEFT JOIN (${opAnsSub}) op_ans ON c.uniqueid = op_ans.uniqueid
                    WHERE ${whereClause};
                `
                    : `
                    USE asteriskcdrdb;
                    SELECT COUNT(DISTINCT uniqueid)
                    FROM cdr
                    WHERE ${whereClause};
                `;
                const countRaw = await this.execQuery(countSql);
                total = parseInt((countRaw || '').trim(), 10) || 0;
            }
            const totalPages = Math.ceil(total / limit) || 1;

            const dataSql = `
                USE asteriskcdrdb;
                SELECT
                    c.uniqueid,
                    DATE_FORMAT(MIN(c.calldate), '%Y-%m-%d %H:%i:%s') as call_time,
                    MIN(c.src) as src,
                    MIN(c.dst) as dst,
                    MAX(CASE 
                        WHEN c.channel REGEXP '^SIP/[0-9]{2,4}-' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.channel, '/', -1), '-', 1)
                        WHEN c.src REGEXP '^[0-9]{2,4}$' THEN c.src
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.dstchannel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.dstchannel, '@', 1), '/', -1)
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.channel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.channel, '@', 1), '/', -1)
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.dstchannel LIKE 'SIP/%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.dstchannel, '/', -1), '-', 1)
                        WHEN c.disposition='ANSWERED' AND c.billsec > 0 AND c.dst REGEXP '^[0-9]{2,4}$' THEN c.dst
                        WHEN c.dst REGEXP '^[0-9]{2,4}$' THEN c.dst 
                        WHEN c.dstchannel LIKE 'SIP/%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(c.dstchannel, '/', -1), '-', 1)
                        ELSE ''
                    END) as op_ext,
                    CASE 
                        WHEN MAX(CASE WHEN c.disposition='ANSWERED' AND c.billsec > 0 THEN 1 ELSE 0 END) = 1 THEN 'ANSWERED' 
                        WHEN MAX(CASE WHEN c.disposition='BUSY' THEN 1 ELSE 0 END) = 1 THEN 'BUSY'
                        WHEN MAX(CASE WHEN c.disposition='FAILED' THEN 1 ELSE 0 END) = 1 THEN 'DENIED'
                        ELSE 'ABANDONED' 
                    END as final_disp,
                    MAX(c.billsec) as talk_sec,
                    MAX(c.duration) as wait_sec,
                    TIMESTAMPDIFF(SECOND, MIN(c.calldate), MAX(CASE WHEN c.disposition='ANSWERED' AND c.billsec > 0 THEN c.calldate END)) as ans_lag_sec,
                    MAX(c.recordingfile) as rec,
                    MAX(CASE WHEN c.dcontext = 'from-internal' AND c.channel REGEXP '^SIP/[0-9]{2,4}-' THEN 1 ELSE 0 END) as is_out,
                    MAX(c.dcontext) as dcontext,
                    MAX(c.lastdata) as lastdata,
                    MAX(xfer.xfer_from) as xfer_from,
                    MAX(xfer.xfer_chain) as xfer_chain
                FROM cdr c
                ${isAbandoned ? `LEFT JOIN (${opAnsSub}) op_ans ON c.uniqueid = op_ans.uniqueid` : ''}
                LEFT JOIN (
                    SELECT 
                        uniqueid,
                        SUBSTRING_INDEX(channel, ';', 1) as xfer_key,
                        SUBSTRING_INDEX(SUBSTRING_INDEX(MIN(channel), '@', 1), '/', -1) as xfer_from,
                        GROUP_CONCAT(DISTINCT dst ORDER BY calldate ASC SEPARATOR ' ➔ ') as xfer_chain
                    FROM cdr
                    WHERE ${this.getDateCondition(targetDate)} AND dcontext = 'from-internal-xfer' AND dst REGEXP '^[0-9]{2,4}$'
                    GROUP BY uniqueid
                ) xfer ON (c.uniqueid = xfer.uniqueid OR (xfer.xfer_key IS NOT NULL AND xfer.xfer_key != '' AND (SUBSTRING_INDEX(c.channel, ';', 1) = xfer.xfer_key OR SUBSTRING_INDEX(c.dstchannel, ';', 1) = xfer.xfer_key)))
                WHERE ${whereClause}
                GROUP BY c.uniqueid
                ORDER BY call_time DESC
                LIMIT ${limit} OFFSET ${offset};
            `;
            const dataRaw = await this.execQuery(dataSql);
            const lines = dataRaw.trim().split('\n');
            const calls = [];

            for (const line of lines) {
                if (!line) continue;
                const [uid, callTime, src, dst, opExt, disp, talkSecStr, waitSecStr, ansLagStr, rec, isOutFlag, dcontext, lastdata, xferFromRaw, xferChainRaw] = line.split('\t');
                const talkSec = parseInt(talkSecStr, 10) || 0;
                const waitSec = parseInt(waitSecStr, 10) || 0;
                const ansLagSec = parseInt(ansLagStr, 10) || 0;
                const xferChain = (xferChainRaw || '').trim();
                const isAns = (type !== 'abandoned' && disp === 'ANSWERED');
                const isXfer = isAns && Boolean(xferChain && xferChain !== 'NULL' && xferChain !== '\\N');
                const hasRealOp = isAns && (Boolean(opExt && opExt.length >= 2 && opExt.length <= 4 && opExt !== '2020159') || isXfer);
                let isOut = (type === 'outbound' || isOutFlag === '1' || (src && src.length <= 4)) && dst && dst !== 's' && dst.length >= 7;
                let direction = isOut ? 'outbound' : 'inbound';
                let hangupParty = isAns ? (isOut ? 'Operator' : 'Mijoz') : (isOut ? 'Javobsiz' : 'Ko\'tarilmadi');

                let realOpName = this.operatorNames.get(opExt);
                if (opExt === '114') realOpName = 'Maxmudbek';

                let opName = '';
                let finalOpExt = opExt;
                if (isXfer) {
                    direction = 'transfer';
                    hangupParty = 'Transfer (Operatorga)';

                    const initOp = (xferFromRaw && xferFromRaw !== 'NULL' && xferFromRaw !== '\\N' ? xferFromRaw : opExt || '').trim();
                    const destOps = xferChain.split('➔').map(s => s.trim()).filter(Boolean);
                    const chainList = [];
                    if (initOp) chainList.push(initOp);
                    for (const d of destOps) {
                        if (!chainList.includes(d) || chainList[chainList.length - 1] !== d) {
                            chainList.push(d);
                        }
                    }

                    if (chainList.length > 0) {
                        opName = chainList.map(ext => {
                            let name = this.operatorNames.get(ext) || DEFAULT_OPERATOR_NAMES[ext];
                            if (ext === '114') name = 'Maxmudbek';
                            return name ? `${name} (${ext})` : `Operator ${ext}`;
                        }).join(' ➔ ');

                        if (operatorExt && chainList.includes(operatorExt)) {
                            finalOpExt = operatorExt;
                        } else {
                            finalOpExt = chainList[chainList.length - 1];
                        }
                    } else {
                        opName = `Operator (Transfer: ${xferChain})`;
                    }
                } else if (opExt) {
                    opName = realOpName ? `${realOpName} (${opExt})` : `Operator ${opExt}`;
                } else {
                    const isQueue = (dcontext === 'ext-queues') || (dst && dst.includes('2020159')) || (rec && rec.includes('q-2020159'));
                    const isOffHours = (lastdata && (lastdata.includes('working-time') || lastdata.includes('music-working-time')));
                    const isIvr = (dcontext && dcontext.startsWith('ivr')) || (lastdata && lastdata.includes('ivr'));

                    if (isOffHours) {
                        opName = 'IVR (Ish vaqti emas)';
                    } else if (isQueue) {
                        opName = 'Navbat';
                    } else if (isIvr) {
                        opName = 'Navbatga kirmasdan chiqdi';
                    } else if (isAns) {
                        opName = 'Avtojavob (Tizim)';
                    } else {
                        opName = 'Navbat';
                    }
                }

                let calculatedWait = !isAns ? Math.max(waitSec, talkSec) : ((isAns && hasRealOp) ? Math.max(0, ansLagSec) : waitSec);
                if (isAns && hasRealOp && calculatedWait === 0 && rec) {
                    const match = rec.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/);
                    if (match) {
                        const [_, Y, M, D, h, m, s] = match;
                        const recDate = new Date(Y, parseInt(M, 10) - 1, D, h, m, s);
                        const callDate = new Date(callTime.replace(/-/g, '/'));
                        const diff = Math.round((recDate.getTime() - callDate.getTime()) / 1000);
                        if (diff > 0 && diff < 3600) {
                            calculatedWait = diff;
                        }
                    }
                }
                if (isAns && hasRealOp && calculatedWait === 0 && !isOut && (dcontext === 'ext-queues' || (rec && rec.includes('q-2020159')))) {
                    calculatedWait = 8;
                }

                calls.push({
                    id: uid,
                    time: callTime,
                    callerId: isOut ? (dst || 'Yashirin') : (src || 'Yashirin'),
                    direction: direction,
                    operator: opName,
                    operatorExten: hasRealOp ? (finalOpExt || opExt || xferFromRaw || '') : '',
                    duration: isAns ? talkSec : 0,
                    waitSec: calculatedWait,
                    status: isAns ? 'ANSWERED' : (type === 'abandoned' ? 'ABANDONED' : (disp === 'DENIED' ? 'DENIED' : (isOut ? 'NO ANSWER' : 'ABANDONED'))),
                    recording: isAns ? (rec || '') : '',
                    hangupParty: hangupParty
                });
            }

            if (skipCount) {
                total = calls.length;
            }

            const result = { total, page, totalPages: Math.ceil(total / limit) || 1, limit, data: calls };
            if (isPastDate) {
                await redisService.set(redisKey, result, 604800); // 7 kun
            }
            return result;
        } catch (err) {
            console.error('⚠️ Issabel fetchCallsDetail xatolik:', err.message);
            return { total: 0, page: 1, totalPages: 1, limit, data: [] };
        }
    }

    getOperatorName(ext) {
        const raw = this.operatorNames.get(String(ext)) || `Operator ${ext}`;
        // Agar nom allaqachon "(ext)" bilan tugagan bo'lsa (masalan Issabel DB'da
        // "Ibrohim (116)" deb yozilgan bo'lsa) — takrorlanishning oldini olish uchun tozalash.
        const cleaned = String(raw).replace(new RegExp(`\\s*\\(${ext}\\)\\s*$`), '').trim();
        return cleaned || `Operator ${ext}`;
    }
}

module.exports = new IssabelDbService();
