const { Client } = require('ssh2');
require('dotenv').config();
const redisService = require('./redisService');
const dbService = require('./dbService');

const EXCLUDED_OPERATORS = new Set(['1111', '1324', '1001', '1000', '402', '401', '207', '202', '201', '170', '161', '118', '115', '160', '66', '110']);

const DEFAULT_OPERATOR_NAMES = {
    '101': 'Oybek',
    '103': 'Feruza',
    '106': 'Gulchehra',
    '111': 'Nozima',
    '114': 'Maxmudbek',
    '116': 'Ibrohim',
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
                    COUNT(DISTINCT uniqueid) as total_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as in_talk_sec,
                    SUM(CASE WHEN disposition = 'FAILED' THEN 1 ELSE 0 END) as den_inbound
                FROM cdr 
                WHERE calldate >= CURDATE() 
                  AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%')
                  AND channel NOT LIKE 'Local/%'
                  AND (dcontext IS NULL OR dcontext != 'from-internal')
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$');

                SELECT '===SUMMARY_OUT===' as marker;
                SELECT 
                    COUNT(*) as total_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as out_talk_sec
                FROM cdr 
                WHERE calldate >= CURDATE() 
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst) >= 7);

                SELECT '===HOURLY===' as marker;
                SELECT 
                    HOUR(calldate) as hr,
                    COUNT(DISTINCT uniqueid) as total_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered
                FROM cdr 
                WHERE calldate >= CURDATE() 
                  AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%')
                  AND channel NOT LIKE 'Local/%'
                  AND (dcontext IS NULL OR dcontext != 'from-internal')
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')
                  AND HOUR(calldate) BETWEEN 8 AND 21
                GROUP BY hr ORDER BY hr ASC;

                SELECT '===OPERATORS===' as marker;
                SELECT 
                    dst,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as total_duration
                FROM cdr 
                WHERE calldate >= CURDATE() AND dst REGEXP '^[0-9]{2,4}$'
                GROUP BY dst;
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
                outTotal = parseInt(ot, 10) || 0;
                outAns = parseInt(oa, 10) || 0;
                outDur = parseInt(odur, 10) || 0;
            }

            const todayRejects = dbService.getTodayOperatorRejects();
            const totalOpDenied = Object.values(todayRejects).reduce((a, b) => a + b, 0);
            const total = inTotal + outTotal;
            const answered = inAns + outAns;
            const durationSec = inDur + outDur;
            const abandoned = Math.max(0, inTotal - inAns);
            const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;
            const abandonedRate = inTotal > 0 ? Math.round((abandoned / inTotal) * 100) : 0;
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

            // 4. Operator Stats
            const opStats = [];
            if (sectionMap['OPERATORS']) {
                const lines = sectionMap['OPERATORS'].split('\n');
                for (const l of lines) {
                    if (!l) continue;
                    const [extRaw, ansStr, durStr] = l.split('\t');
                    const ext = extRaw ? extRaw.trim() : '';
                    if (!ext || EXCLUDED_OPERATORS.has(ext)) continue;

                    const ans = parseInt(ansStr, 10) || 0;
                    const dur = parseInt(durStr, 10) || 0;
                    const avg = ans > 0 ? Math.round(dur / ans) : 0;
                    const name = ext === '114' ? 'Maxmudbek' : (this.operatorNames.get(ext) || `Operator ${ext}`);
                    const opDenied = todayRejects[ext] || 0;

                    opStats.push({
                        id: ext,
                        name: `${name} (${ext})`,
                        realName: name,
                        totalCalls: ans + opDenied,
                        answered: ans,
                        denied: opDenied,
                        totalDurationSec: dur,
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
            console.error('вљ пёЏ Issabel syncAllData xatosi:', err.message);
        }
    }

    /**
     * SSH orqali MySQL so'rovini bajarish
     */
    execQuery(sql) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                const cmd = `MYSQL_PWD='${this.dbPass}' mysql -u ${this.dbUser} -N -B -e "${sql.replace(/"/g, '\\"')}"`;
                conn.exec(cmd, (err, stream) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    let stdout = '';
                    let stderr = '';
                    stream.on('data', d => stdout += d.toString());
                    stream.stderr.on('data', d => stderr += d.toString());
                    stream.on('close', code => {
                        conn.end();
                        if (code !== 0 && stderr) {
                            return reject(new Error(stderr));
                        }
                        resolve(stdout);
                    });
                });
            }).on('error', err => {
                reject(err);
            }).connect(this.sshConfig);
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

    /**
     * 2. Bugungi operatorlar bo'yicha haqiqiy ko'rsatkichlar (Answered, Talk Time)
     */
    async fetchTodayOperatorStatsDirect() {
        try {
            const sql = `
                USE asteriskcdrdb;
                SELECT 
                    dst,
                    COUNT(*) as total_offered,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as total_duration
                FROM cdr 
                WHERE calldate >= CURDATE() AND dst REGEXP '^[0-9]{3,4}$'
                GROUP BY dst;
            `;
            const raw = await this.execQuery(sql);
            const lines = raw.trim().split('\n');
            const stats = [];
            const todayRejects = dbService.getTodayOperatorRejects();

            for (const line of lines) {
                if (!line) continue;
                const parts = line.split('\t');
                if (parts.length >= 4) {
                    const ext = parts[0].trim();
                    if (EXCLUDED_OPERATORS.has(ext)) continue;

                    const durationSec = parseInt(parts[3], 10) || 0;
                    const opDenied = todayRejects[ext] || 0;
                    const avgSec = answered > 0 ? Math.round(durationSec / answered) : 0;
                    const name = ext === '114' ? 'Maxmudbek' : (this.operatorNames.get(ext) || `Operator ${ext}`);

                    stats.push({
                        id: ext,
                        name: `${name} (${ext})`,
                        realName: name,
                        totalCalls: answered + opDenied,
                        answered: answered,
                        denied: opDenied,
                        totalDurationSec: durationSec,
                        avgDurationSec: avgSec
                    });
                }
            }

            return stats;
        } catch (err) {
            return [];
        }
    }

    async fetchTodayOperatorStats() {
        if (this.cache.operators && this.cache.operators.length > 0) {
            return this.cache.operators;
        }
        return this.fetchTodayOperatorStatsDirect();
    }

    /**
     * 3. Soatlik grafik (08:00 dan 21:00 gacha haqiqiy mijozlar dinamikasi)
     */
    async fetchTodayHourlyStatsDirect() {
        try {
            const sql = `
                USE asteriskcdrdb;
                SELECT 
                    HOUR(calldate) as hr,
                    COUNT(DISTINCT uniqueid) as total_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered
                FROM cdr 
                WHERE calldate >= CURDATE() 
                  AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%')
                  AND channel NOT LIKE 'Local/%'
                  AND (dcontext IS NULL OR dcontext != 'from-internal')
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')
                  AND HOUR(calldate) BETWEEN 8 AND 21
                GROUP BY hr
                ORDER BY hr ASC;
            `;
            const raw = await this.execQuery(sql);
            const lines = raw.trim().split('\n');
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

            // 08:00 dan 21:00 gacha to'liq soatlar
            for (let h = 8; h <= 21; h++) {
                labels.push(`${String(h).padStart(2, '0')}:00`);
                const val = hourlyMap.get(h) || { total: 0, answered: 0 };
                inboundData.push(val.total);
                answeredData.push(val.answered);
            }

            return { labels, inbound: inboundData, answered: answeredData };
        } catch (err) {
            const labels = [];
            for (let h = 8; h <= 21; h++) labels.push(`${String(h).padStart(2, '0')}:00`);
            return { labels, inbound: new Array(14).fill(0), answered: new Array(14).fill(0) };
        }
    }

    async fetchTodayHourlyStats() {
        if (this.cache.hourly) {
            return this.cache.hourly;
        }
        return this.fetchTodayHourlyStatsDirect();
    }

    /**
     * 4. Bugungi umumiy ko'rsatkichlar (KPI Cards - Inbound, Outbound, Answered, Abandoned)
     */
    async fetchTodaySummaryDirect() {
        try {
            // Kiruvchi va Chiquvchi umumiy ko'rsatkichlari
            const sql = `
                USE asteriskcdrdb;
                SELECT 
                    COUNT(DISTINCT uniqueid) as total_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_inbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as in_talk_sec,
                    SUM(CASE WHEN disposition = 'FAILED' THEN 1 ELSE 0 END) as den_inbound
                FROM cdr 
                WHERE calldate >= CURDATE()
                  AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%')
                  AND channel NOT LIKE 'Local/%'
                  AND (dcontext IS NULL OR dcontext != 'from-internal')
                  AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$');

                SELECT 
                    COUNT(*) as total_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as ans_outbound,
                    SUM(CASE WHEN disposition='ANSWERED' THEN billsec ELSE 0 END) as out_talk_sec
                FROM cdr 
                WHERE calldate >= CURDATE()
                  AND dcontext = 'from-internal'
                  AND channel REGEXP '^SIP/[0-9]{2,4}-'
                  AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst) >= 7);
            `;
            const raw = await this.execQuery(sql);
            const blocks = raw.trim().split('\n');
            
            const [inTotalStr, inAnsStr, inDurStr, inDenStr] = (blocks[0] || '').split('\t');
            const inTotal = parseInt(inTotalStr, 10) || 0;
            const inAns = parseInt(inAnsStr, 10) || 0;
            const inDur = parseInt(inDurStr, 10) || 0;
            const inDen = parseInt(inDenStr, 10) || 0;

            const [outTotalStr, outAnsStr, outDurStr] = (blocks[1] || '').split('\t');
            const outTotal = parseInt(outTotalStr, 10) || 0;
            const outAns = parseInt(outAnsStr, 10) || 0;
            const outDur = parseInt(outDurStr, 10) || 0;

            const todayRejects = dbService.getTodayOperatorRejects();
            const totalOpDenied = Object.values(todayRejects).reduce((a, b) => a + b, 0);
            const total = inTotal + outTotal;
            const answered = inAns + outAns;
            const durationSec = inDur + outDur;
            const denied = totalOpDenied;
            const abandoned = Math.max(0, inTotal - inAns);

            const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;
            const abandonedRate = inTotal > 0 ? Math.round((abandoned / inTotal) * 100) : 0;
            const denyRate = total > 0 ? Math.round((denied / total) * 100) : 0;

            return {
                totalCalls: total,
                inboundCalls: inTotal,
                outboundCalls: outTotal,
                answeredCalls: answered,
                abandonedCalls: abandoned,
                deniedCalls: denied,
                totalDurationSec: durationSec,
                answerRate,
                abandonedRate,
                denyRate
            };
        } catch (err) {
            console.error('вљ пёЏ Issabel fetchTodaySummary xatolik:', err.message);
            return null;
        }
    }

    async fetchTodaySummary() {
        if (this.cache.summary) {
            return this.cache.summary;
        }
        return this.fetchTodaySummaryDirect();
    }

    /**
     * 5. Tarixni to'g'ridan-to'g'ri Issabel MariaDB dan paginatsiya bilan olish
     */
    async fetchCallsPaginated(page = 1, limit = 20, search = '') {
        try {
            const offset = (Math.max(1, page) - 1) * limit;
            let filter = " WHERE calldate >= CURDATE() AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%' OR (dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-')) AND channel NOT LIKE 'Local/%' ";
            if (search) {
                const s = search.replace(/'/g, "\\'");
                filter += ` AND (src LIKE '%${s}%' OR dst LIKE '%${s}%' OR dstchannel LIKE '%${s}%' OR disposition LIKE '%${s}%') `;
            }

            let total = 0;
            if (!search && this.cache.summary && this.cache.summary.totalCalls) {
                total = this.cache.summary.totalCalls;
            } else {
                const countSql = `USE asteriskcdrdb; SELECT COUNT(DISTINCT uniqueid) FROM cdr ${filter};`;
                const countRaw = await this.execQuery(countSql);
                total = parseInt(countRaw.trim(), 10) || 0;
            }
            const totalPages = Math.ceil(total / limit) || 1;

            const dataSql = `
                USE asteriskcdrdb;
                SELECT 
                    uniqueid,
                    calldate,
                    src,
                    dst,
                    dstchannel,
                    disposition,
                    billsec,
                    recordingfile
                FROM cdr 
                ${filter}
                GROUP BY uniqueid
                ORDER BY calldate DESC 
                LIMIT ${limit} OFFSET ${offset};
            `;
            const dataRaw = await this.execQuery(dataSql);
            const lines = dataRaw.trim().split('\n');
            const calls = [];

            for (const line of lines) {
                if (!line) continue;
                const [uid, calldate, src, dst, dstchannel, disp, billsecStr, rec] = line.split('\t');
                const sec = parseInt(billsecStr, 10) || 0;
                const isAns = disp === 'ANSWERED' && sec > 0;
                
                // Operatorni aniqlash
                let opExt = '';
                const match = (dstchannel || '').match(/SIP\/([0-9]{3,4})/i) || (dst || '').match(/^([0-9]{3,4})$/) || (src || '').match(/^([0-9]{3,4})$/);
                if (match) opExt = match[1];
                let realName = this.operatorNames.get(opExt);
                if (opExt === '114') realName = 'Maxmudbek';
                const opName = opExt ? (realName ? `${realName} (${opExt})` : `Operator ${opExt}`) : 'Navbat';

                calls.push({
                    id: uid,
                    time: calldate,
                    callerId: src || 'Yashirin',
                    operator: opName,
                    operatorExten: opExt,
                    direction: (src && src.length <= 4) ? 'outbound' : 'inbound',
                    duration: sec,
                    status: isAns ? 'ANSWERED' : 'DENIED / NO ANSWER',
                    hangupParty: isAns ? 'Mijoz' : 'Ko\'tarilmadi',
                    recording: rec || ''
                });
            }

            return { total, page: Math.min(page, totalPages), totalPages, limit, data: calls };
        } catch (err) {
            console.error('вљ пёЏ Issabel fetchCallsPaginated xatolik:', err.message);
            return { total: 0, page: 1, totalPages: 1, limit, data: [] };
        }
    }

    /**
     * Kartochkalar yoki Operator bosilganda uning bugungi barcha qo'ng'iroqlari tafsiloti (Paginated & Chunked & Real Durations)
     */
    async fetchCallsDetail({ type = 'all', operatorExt = '', page = 1, limit = 50, search = '' }) {
        try {
            limit = Math.min(Math.max(10, parseInt(limit, 10) || 50), 500);
            page = Math.max(1, parseInt(page, 10) || 1);
            const offset = (page - 1) * limit;
            let whereClause = `calldate >= CURDATE()`;
            // 'abandoned' turi uchun: guruhlangan qo'ng'iroq bo'yicha hech qachon javob berilmaganligini tekshirish
            let isAbandoned = false;
            const abandonedHaving = `HAVING SUM(CASE WHEN disposition='ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) = 0`;

            if (type === 'denied') {
                const raw = dbService.getRejectEventsPaginated(page, limit, search);
                // operator nomini va caller_id ni to'g'irlash
                raw.data = raw.data.map(r => {
                    const opId = r.dst;
                    const opName = this.operatorNames.get(String(opId)) || DEFAULT_OPERATOR_NAMES[String(opId)] || null;
                    const displayOp = opName ? `${opName} (${opId})` : `Operator ${opId}`;
                    // caller_id "undefined" bo'lsa yoki "Yashirin raqam (Hidden)" - tozalash
                    const callerRaw = r.src || '';
                    const callerClean = (callerRaw === 'undefined' || callerRaw === 'undefined raqam' || !callerRaw)
                        ? 'Yashirin raqam'
                        : callerRaw;
                    return {
                        ...r,
                        src: callerClean,
                        callerId: callerClean,   // modal c.callerId ni kutadi
                        operator: displayOp,
                        recording: null,
                        duration: 0,
                        waitSec: 0
                    };
                });
                return raw;
            }

            if (type === 'missed') {
                const raw = dbService.getMissedEventsPaginated(page, limit, search);
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

            if (type === 'outbound') {
                whereClause += ` AND dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst) >= 7)`;
            } else if (type === 'inbound') {
                whereClause += ` AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%') AND channel NOT LIKE 'Local/%' AND (dcontext IS NULL OR dcontext != 'from-internal') AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')`;
            } else if (type === 'answered') {
                whereClause += ` AND disposition = 'ANSWERED' AND billsec > 0 AND ((dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%') OR (dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-'))`;
            } else if (type === 'abandoned') {
                // Faqat haqiqiy kiruvchi (navbat) qo'ng'iroqlari.
                // MUHIM: "javob berilmagan" sharti bu yerda qator darajasida qo'yilmaydi,
                // chunki keyinchalik javob berilgan qo'ng'iroqning navbat urinishlari (NO ANSWER
                // qatorlari) ham shu filtrga tushib qolardi. Buning o'rniga HAVING ishlatiladi.
                whereClause += ` AND (dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%') AND channel NOT LIKE 'Local/%' AND (dcontext IS NULL OR dcontext != 'from-internal') AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')`;
                isAbandoned = true;
            } else if (type === 'operator' && operatorExt) {
                // Faqat operator haqiqatda ishtirok etgan qo'ng'iroqlar (javob bergan yoki chiqargan)
                // Local/% kanallarini o'tkazib yuborish - bular faqat navbat tranzitlari
                whereClause += ` AND (
                    (dstchannel LIKE 'SIP/${operatorExt}-%') OR
                    (channel LIKE 'SIP/${operatorExt}-%') OR
                    (src = '${operatorExt}' AND dcontext = 'from-internal') OR
                    (dst = '${operatorExt}' AND disposition = 'ANSWERED' AND billsec > 0)
                )`;
            } else {
                whereClause += ` AND ((dcontext IN ('ext-queues', 'from-trunk', 'ivr-4') OR channel LIKE 'SIP/712020159%') AND channel NOT LIKE 'Local/%' OR (dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst) >= 7)))`;
            }

            if (search) {
                const s = search.replace(/'/g, '');
                whereClause += ` AND (src LIKE '%${s}%' OR dst LIKE '%${s}%')`;
            }

            let total = 0;
            // 'abandoned' uchun cache'dagi taxminiy son emas, aniq hisob ishlatiladi
            // (navbat urinishlari channel bo'yicha birlashtirilgani uchun cache bilan farq qiladi)
            if (type === 'abandoned') {
                // pastda hisoblanadi
            } else if (!search && this.cache.summary) {
                if (type === 'all') total = this.cache.summary.totalCalls;
                else if (type === 'inbound') total = this.cache.summary.inboundCalls;
                else if (type === 'outbound') total = this.cache.summary.outboundCalls;
                else if (type === 'answered') total = this.cache.summary.answeredCalls;
                else if (type === 'abandoned') total = this.cache.summary.abandonedCalls;
                else if (type === 'denied') total = this.cache.summary.deniedCalls;
            }
            if (!total) {
                const countSql = isAbandoned
                    ? `
                    USE asteriskcdrdb;
                    SELECT COUNT(*) FROM (
                        SELECT channel
                        FROM cdr
                        WHERE ${whereClause}
                        GROUP BY channel
                        ${abandonedHaving}
                    ) as t;
                `
                    : `
                    USE asteriskcdrdb;
                    SELECT COUNT(DISTINCT uniqueid)
                    FROM cdr
                    WHERE ${whereClause};
                `;
                const countRaw = await this.execQuery(countSql);
                total = parseInt(countRaw.trim(), 10) || 0;
            }
            const totalPages = Math.ceil(total / limit) || 1;

            const dataSql = `
                USE asteriskcdrdb;
                SELECT
                    DATE_FORMAT(MIN(calldate), '%Y-%m-%d %H:%i:%s') as call_time,
                    MIN(src) as src,
                    MIN(dst) as dst,
                    MAX(CASE 
                        WHEN channel REGEXP '^SIP/[0-9]{2,4}-' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '/', -1), '-', 1)
                        WHEN src REGEXP '^[0-9]{2,4}$' THEN src
                        WHEN disposition='ANSWERED' AND billsec > 0 AND dstchannel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '@', 1), '/', -1)
                        WHEN disposition='ANSWERED' AND billsec > 0 AND channel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '@', 1), '/', -1)
                        WHEN disposition='ANSWERED' AND billsec > 0 AND dstchannel LIKE 'SIP/%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '/', -1), '-', 1)
                        WHEN disposition='ANSWERED' AND billsec > 0 AND dst REGEXP '^[0-9]{2,4}$' THEN dst
                        WHEN dst REGEXP '^[0-9]{2,4}$' THEN dst 
                        WHEN dstchannel LIKE 'SIP/%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '/', -1), '-', 1)
                        ELSE ''
                    END) as op_ext,
                    MAX(CASE 
                        WHEN disposition='ANSWERED' AND billsec > 0 THEN 'ANSWERED' 
                        WHEN disposition='FAILED' THEN 'DENIED'
                        WHEN disposition='BUSY' THEN 'BUSY'
                        ELSE 'ABANDONED' 
                    END) as final_disp,
                    MAX(billsec) as talk_sec,
                    MAX(duration) as wait_sec,
                    MAX(recordingfile) as rec,
                    MAX(CASE WHEN dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' THEN 1 ELSE 0 END) as is_out
                FROM cdr
                WHERE ${whereClause}
                GROUP BY ${isAbandoned ? 'channel' : 'uniqueid'}
                ${isAbandoned ? abandonedHaving : ''}
                ORDER BY call_time DESC
                LIMIT ${limit} OFFSET ${offset};
            `;
            const dataRaw = await this.execQuery(dataSql);
            const lines = dataRaw.trim().split('\n');
            const calls = [];

            for (const line of lines) {
                if (!line) continue;
                const [callTime, src, dst, opExt, disp, talkSecStr, waitSecStr, rec, isOutFlag] = line.split('\t');
                const talkSec = parseInt(talkSecStr, 10) || 0;
                const waitSec = parseInt(waitSecStr, 10) || 0;
                const isAns = disp === 'ANSWERED' && talkSec > 0;
                // Yo'nalish: SQL tomonidan aniq hisoblanadi (dcontext='from-internal' + operator kanali = chiquvchi).
                // Eski taxminiy heuristikani (opExt.length<=4 && dst.length>=7) olib tashlangan -
                // u kiruvchi navbat qo'ng'iroqlarini (dst=DID raqami) "chiquvchi" deb noto'g'ri belgilab qo'yardi.
                const isOut = type === 'outbound' || isOutFlag === '1';
                
                let realOpName = this.operatorNames.get(opExt);
                if (opExt === '114') realOpName = 'Maxmudbek';
                const opName = opExt ? (realOpName ? `${realOpName} (${opExt})` : `Operator ${opExt}`) : (isAns ? 'Operator' : 'Navbat');

                calls.push({
                    time: callTime,
                    callerId: isOut ? (dst || 'Yashirin') : (src || 'Yashirin'),
                    direction: isOut ? 'outbound' : 'inbound',
                    operator: opName,
                    operatorExten: opExt || '',
                    duration: isAns ? talkSec : waitSec,
                    waitSec: waitSec,
                    status: isAns ? 'ANSWERED' : (disp === 'DENIED' ? 'DENIED' : (isOut ? 'NO ANSWER' : 'ABANDONED')),
                    recording: rec || ''
                });
            }

            return { total, page, totalPages, limit, data: calls };
        } catch (err) {
            console.error('вљ пёЏ Issabel fetchCallsDetail xatolik:', err.message);
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
