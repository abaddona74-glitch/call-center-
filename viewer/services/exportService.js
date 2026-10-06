/**
 * Excel Export Service
 * 
 * Ushbu servis "cal stat (5) (2).xlsx" andozasi (template) asosida
 * oylik operatorlar statistikasi hisobotini (qo'ng'iroqlar soni va suhbat vaqtlari matritsasi)
 * Excel (.xlsx) formatida generatsiya qiladi.
 */

const ExcelJS = require('exceljs');
const issabelDbService = require('./issabelDbService');
const dbService = require('./dbService');

const EXCLUDED_OPERATORS = new Set(['1234', '1111', '1324', '1001', '1000', '402', '401', '170', '161', '118', '115', '160', '66', '110', '213', '116']);

function cyrillicToLatin(text) {
    if (!text || typeof text !== 'string') return text;
    const cyrToLatMap = {
        'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v',
        'Г': 'G', 'г': 'g', 'Д': 'D', 'д': 'd', 'Е': 'E', 'е': 'e',
        'Ё': 'Yo', 'ё': 'yo', 'Ж': 'J', 'ж': 'j', 'З': 'Z', 'з': 'z',
        'И': 'I', 'и': 'i', 'Й': 'Y', 'й': 'y', 'К': 'K', 'к': 'k',
        'Л': 'L', 'л': 'l', 'М': 'M', 'м': 'm', 'Н': 'N', 'н': 'n',
        'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p', 'Р': 'R', 'р': 'r',
        'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'У': 'U', 'у': 'u',
        'Ф': 'F', 'ф': 'f', 'Х': 'X', 'х': 'x', 'Ц': 'Ts', 'ц': 'ts',
        'Ч': 'Ch', 'ч': 'ch', 'Ш': 'Sh', 'ш': 'sh', 'Щ': 'Sh', 'щ': 'sh',
        'Ъ': "'", 'ъ': "'", 'Ы': 'I', 'ы': 'i', 'Ь': '', 'ь': '',
        'Э': 'E', 'э': 'e', 'Ю': 'Yu', 'ю': 'yu', 'Я': 'Ya', 'я': 'ya',
        'Ў': "O'", 'ў': "o'", 'Ғ': "G'", 'ғ': "g'", 'Қ': 'Q', 'қ': 'q',
        'Ҳ': 'H', 'ҳ': 'h'
    };
    return text.replace(/[А-Яа-яЁёЎўҒғҚқҲҳ]/g, m => cyrToLatMap[m] !== undefined ? cyrToLatMap[m] : m);
}

const OPERATOR_DISPLAY_NAMES_UZ = {
    '101': 'Tuxtasinov Oybek',
    '103': 'Feruza (103)',
    '106': 'Ubaydullayeva Gulchehra',
    '111': "Jo'rayeva Nozima",
    '114': 'Maxmudbek',
    '119': 'Xudoyqulova Muattar',
    '120': 'Murodova Navruzoy'
};

const OPERATOR_DISPLAY_NAMES_RU = {
    '101': 'Тухтасинов Ойбек',
    '103': 'Феруза (103)',
    '106': 'Убайдуллаева Гульчехра',
    '111': 'Жураева Нозима',
    '114': 'Махмудбек',
    '119': 'Худойкулова Муаттар',
    '120': 'Муродова Наврузой'
};

const OPERATOR_DISPLAY_NAMES = OPERATOR_DISPLAY_NAMES_UZ;

function formatDurationHms(seconds) {
    const sec = Math.max(0, parseInt(seconds || 0, 10));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const MONTH_NAMES_UZ = [
    'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
    'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
];

const MONTH_NAMES_RU = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const MONTH_NAMES_RU_NOM = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

class ExportService {

    /**
     * Sana oralig'i bo'yicha kunlar ro'yxatini generatsiya qilish (UTC)
     */
    getDateList(startStr, endStr) {
        const list = [];
        const [sy, sm, sd] = startStr.split('-').map(Number);
        const [ey, em, ed] = endStr.split('-').map(Number);
        const cur = new Date(Date.UTC(sy, sm - 1, sd));
        const end = new Date(Date.UTC(ey, em - 1, ed));
        while (cur <= end) {
            const y = cur.getUTCFullYear();
            const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
            const d = String(cur.getUTCDate()).padStart(2, '0');
            list.push(`${y}-${m}-${d}`);
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return list;
    }

    /**
     * Oylik hisobot bufferini olish (Eski chaqiruvlar bilan moslik uchun)
     */
    async generateMonthlyReportBuffer(targetMonth = null) {
        const res = await this.generateReportBuffer({ targetMonth });
        return res.buffer;
    }

    /**
     * Excel hisobotini generatsiya qilish (cal stat template) - Oylik yoki Sana oralig'i (Range)
     * @param {Object|string} options - { targetMonth, startDate, endDate } yoki 'YYYY-MM'
     */
    async generateReportBuffer(options = {}) {
        let targetMonth = null;
        let startDate = null;
        let endDate = null;
        let operatorGroup = 'all';
        let lang = 'uz';

        if (typeof options === 'string') {
            targetMonth = options;
        } else if (options && typeof options === 'object') {
            targetMonth = options.targetMonth || null;
            startDate = options.startDate || null;
            endDate = options.endDate || null;
            operatorGroup = options.operatorGroup || options.group || 'all';
            lang = (options.lang || options.language || 'uz').toLowerCase();
            if (lang !== 'ru' && lang !== 'uz') lang = 'uz';
        }

        let groupSuffix = '';
        let groupTitleText = '';
        if (lang === 'ru') {
            if (operatorGroup === 'main' || operatorGroup === '100') {
                groupSuffix = '_Основные_100_199';
                groupTitleText = ' (Основные 100-199)';
            } else if (operatorGroup === 'secondary' || operatorGroup === '200') {
                groupSuffix = '_Зангиота_42';
                groupTitleText = ' (Зангиота 42 200+)';
            } else {
                groupSuffix = '_Общий';
                groupTitleText = ' (Все операторы)';
            }
        } else {
            if (operatorGroup === 'main' || operatorGroup === '100') {
                groupSuffix = '_Asosiy';
                groupTitleText = ' (Asosiy 100-199)';
            } else if (operatorGroup === 'secondary' || operatorGroup === '200') {
                groupSuffix = '_Zangiota_42';
                groupTitleText = ' (Zangiota 42 200+)';
            } else {
                groupSuffix = '_Umumiy';
                groupTitleText = ' (Barchasi)';
            }
        }
        const langSuffix = lang === 'ru' ? '_RU' : '_UZ';

        const todayTashkent = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
        let dates = [];
        let sheetTitle = 'Statistika';
        let leftTitle = '';
        let rightTitle = '';
        let fileName = '';

        if (startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            if (startDate > endDate) {
                const tmp = startDate;
                startDate = endDate;
                endDate = tmp;
            }
            dates = this.getDateList(startDate, endDate);

            const [sy, sm, sd] = startDate.split('-');
            const [ey, em, ed] = endDate.split('-');
            const startDisplay = `${sd}.${sm}.${sy}`;
            const endDisplay = `${ed}.${em}.${ey}`;

            if (startDate === endDate) {
                sheetTitle = `${sd}.${sm}.${sy}`;
                if (lang === 'ru') {
                    leftTitle = `📞 ${startDisplay}${groupTitleText} — КОЛИЧЕСТВО ПРИНЯТЫХ ЗВОНКОВ`;
                    rightTitle = `⏱️ ${startDisplay}${groupTitleText} — ОБЩЕЕ ВРЕМЯ РАЗГОВОРА (ЧЧ:ММ:СС)`;
                } else {
                    leftTitle = `📞 ${startDisplay}${groupTitleText} — QABUL QILINGAN QO'NG'IROQLAR SONI`;
                    rightTitle = `⏱️ ${startDisplay}${groupTitleText} — UMUMIY SUHBAT VAQTI (HH:MM:SS)`;
                }
                fileName = `Call_Center_Export_${startDate}${groupSuffix}${langSuffix}.xlsx`;
            } else {
                sheetTitle = `${sd}.${sm} - ${ed}.${em}`;
                if (lang === 'ru') {
                    leftTitle = `📞 ${startDisplay} — ${endDisplay}${groupTitleText} КОЛИЧЕСТВО ПРИНЯТЫХ ЗВОНКОВ`;
                    rightTitle = `⏱️ ${startDisplay} — ${endDisplay}${groupTitleText} ОБЩЕЕ ВРЕМЯ РАЗГОВОРА (ЧЧ:ММ:СС)`;
                } else {
                    leftTitle = `📞 ${startDisplay} — ${endDisplay}${groupTitleText} QABUL QILINGAN QO'NG'IROQLAR SONI`;
                    rightTitle = `⏱️ ${startDisplay} — ${endDisplay}${groupTitleText} UMUMIY SUHBAT VAQTI (HH:MM:SS)`;
                }
                fileName = `Call_Center_Export_${startDate}_${endDate}${groupSuffix}${langSuffix}.xlsx`;
            }
        } else {
            const [curYear, curMonth] = todayTashkent.split('-');
            let year = parseInt(curYear, 10);
            let month = parseInt(curMonth, 10);

            if (targetMonth && /^\d{4}-\d{2}$/.test(targetMonth)) {
                const [y, m] = targetMonth.split('-');
                year = parseInt(y, 10);
                month = parseInt(m, 10);
            }

            const monthStr = String(month).padStart(2, '0');
            const monthNameUz = MONTH_NAMES_UZ[month - 1] || 'oy';
            const monthNameRuNom = MONTH_NAMES_RU_NOM[month - 1] || 'месяц';
            const daysInMonth = new Date(year, month, 0).getDate();
            startDate = `${year}-${monthStr}-01`;
            endDate = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
            dates = this.getDateList(startDate, endDate);

            if (lang === 'ru') {
                sheetTitle = `${monthNameRuNom} ${year}`;
                leftTitle = `📞 ${monthNameRuNom.toUpperCase()} ${year}${groupTitleText} — КОЛИЧЕСТВО ПРИНЯТЫХ ЗВОНКОВ`;
                rightTitle = `⏱️ ${monthNameRuNom.toUpperCase()} ${year}${groupTitleText} — ОБЩЕЕ ВРЕМЯ РАЗГОВОРА (ЧЧ:ММ:СС)`;
                fileName = `Call_Center_Statistika_${year}-${monthStr}${groupSuffix}${langSuffix}.xlsx`;
            } else {
                sheetTitle = `${monthNameUz} ${year}`;
                leftTitle = `📞 ${monthNameUz.toUpperCase()} ${year}${groupTitleText} — QABUL QILINGAN QO'NG'IROQLAR SONI`;
                rightTitle = `⏱️ ${monthNameUz.toUpperCase()} ${year}${groupTitleText} — UMUMIY SUHBAT VAQTI (HH:MM:SS)`;
                fileName = `Call_Center_Statistika_${year}-${monthStr}${groupSuffix}${langSuffix}.xlsx`;
            }
        }

        // 1. Asterisk PBX CDR dan ma'lumotlarni yig'ish (Kiruvchi navbat va chiquvchi barcha qo'ng'iroqlar)
        // Format (6 ustun): A-qatorlar = sana, op_id, soni, suhbat_vaqt, 'A', '' — allaqachon agregatlangan
        //                   X-qatorlar = sana, from_op, to_op, channel, 'X', billsec — xom transfer zanjiri qatorlari
        const cdrSql = `
            USE asteriskcdrdb;
            -- 1. Operatorlar qabul qilgan kiruvchi va navbat (queue) qo'ng'iroqlari
            SELECT 
                DATE(calldate) as call_date,
                dst as op_id,
                COUNT(*) as answered_count,
                SUM(billsec) as total_talk_sec,
                'A' as kind,
                '' as extra
            FROM cdr
            WHERE calldate >= '${startDate} 00:00:00' AND calldate <= '${endDate} 23:59:59'
              AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
              AND dst REGEXP '^[0-9]{2,4}$'
              AND dcontext != 'from-internal-xfer'
              AND disposition = 'ANSWERED' AND billsec > 0
            GROUP BY call_date, op_id

            UNION ALL

            -- 2. Operatorlar amalga oshirgan chiquvchi qo'ng'iroqlar
            SELECT 
                DATE(calldate) as call_date,
                SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), 'SIP/', -1) as op_id,
                COUNT(*) as answered_count,
                SUM(billsec) as total_talk_sec,
                'A' as kind,
                '' as extra
            FROM cdr
            WHERE calldate >= '${startDate} 00:00:00' AND calldate <= '${endDate} 23:59:59'
              AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
              AND dcontext = 'from-internal'
              AND channel REGEXP '^SIP/[0-9]{2,4}-'
              AND (dstchannel LIKE 'SIP/%' OR LENGTH(dst) >= 7)
              AND disposition = 'ANSWERED' AND billsec > 0
            GROUP BY call_date, op_id

            UNION ALL

            -- 3. Transfer zanjirlari xom qatorlari (zanjir boshiga 0 yoki 1 ta -1 va 0 yoki 1 ta +1 beriladi, JS tomonda hisoblanadi)
            SELECT 
                DATE(calldate) as call_date,
                CASE 
                    WHEN channel LIKE 'Local/%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '@', 1), '/', -1)
                    WHEN channel LIKE 'SIP/%-%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), '/', -1)
                    ELSE '' 
                END AS op_id,
                dst as to_op,
                channel,
                'X' as kind,
                billsec as extra
            FROM cdr
            WHERE calldate >= '${startDate} 00:00:00' AND calldate <= '${endDate} 23:59:59'
              AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
              AND dcontext = 'from-internal-xfer'
              AND disposition = 'ANSWERED' AND billsec > 0
            ORDER BY 4 ASC, 1 ASC;
        `;

        // Map: dateStr -> { opId -> { count, talkSec } }
        const dataMap = new Map();
        for (const dStr of dates) {
            dataMap.set(dStr, new Map());
        }

        const defaultMainOps = ['101', '103', '106', '111', '114', '119', '120'];
        const defaultSecondaryOps = ['200', '203', '204', '205', '206', '208', '209'];

        const activeOpSet = new Set();
        if (operatorGroup === 'main' || operatorGroup === '100') {
            defaultMainOps.forEach(id => activeOpSet.add(id));
        } else if (operatorGroup === 'secondary' || operatorGroup === '200') {
            defaultSecondaryOps.forEach(id => activeOpSet.add(id));
        } else {
            defaultMainOps.forEach(id => activeOpSet.add(id));
            defaultSecondaryOps.forEach(id => activeOpSet.add(id));
        }

        // 1. SQLite bazasidagi 3CX Desktop Agent to'liq jurnali (eng aniq va to'liq ma'lumot)
        try {
            const sqliteSql = `
                SELECT 
                    substr(event_time, 1, 10) as call_date,
                    operator_id,
                    COUNT(*) as answered_count,
                    SUM(duration_sec) as total_talk_sec
                FROM agent_3cx_call_logs
                WHERE event_time >= ? AND event_time <= ?
                  AND duration_sec > 0
                  AND (event_type IN ('ANSWERED', '2', 'DIALLED', '1', 'OUTBOUND', 'INCOMING'))
                  AND LENGTH(caller_id) > 4
                GROUP BY call_date, operator_id
                ORDER BY call_date ASC, operator_id ASC
            `;
            const sqliteRows = dbService.db.prepare(sqliteSql).all(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
            for (const row of sqliteRows) {
                const callDate = row.call_date;
                const opId = String(row.operator_id || '').trim();
                if (!opId || EXCLUDED_OPERATORS.has(opId)) continue;
                if (!/^[0-9]{2,4}$/.test(opId)) continue;

                const opNum = parseInt(opId, 10);
                if ((operatorGroup === 'main' || operatorGroup === '100') && (opNum < 100 || opNum >= 200)) continue;
                if ((operatorGroup === 'secondary' || operatorGroup === '200') && opNum < 200) continue;

                activeOpSet.add(opId);
                if (dataMap.has(callDate)) {
                    dataMap.get(callDate).set(opId, {
                        count: parseInt(row.answered_count, 10) || 0,
                        talkSec: parseInt(row.total_talk_sec, 10) || 0
                    });
                }
            }
        } catch (sqliteErr) {
            console.error('❌ exportService SQLite agent_3cx_call_logs xatolik:', sqliteErr.message);
        }

        // 2. Asterisk PBX CDR dan ham ma'lumotlarni yig'ish va birlashtirish (eng to'liq qiymat Math.max)
        let rawCdr = null;
        try {
            rawCdr = await issabelDbService.execQuery(cdrSql);
        } catch (cdrErr) {
            console.warn('⚠️ exportService Asterisk CDR so\'rovida ogohlantirish:', cdrErr.message);
        }

        if (rawCdr) {
            // Transfer tuzatishlari: sana -> operator -> delta (qabul qilinganlardan chiqarish / olganiga qo'shish)
            const xferDelta = new Map(); // dateStr -> Map(opId -> delta)
            const addDelta = (dStr, opId, delta) => {
                if (!opId || !/^[0-9]{2,4}$/.test(opId)) return;
                if (EXCLUDED_OPERATORS.has(opId)) return;
                if (!xferDelta.has(dStr)) xferDelta.set(dStr, new Map());
                const m = xferDelta.get(dStr);
                m.set(opId, (m.get(opId) || 0) + delta);
            };

            // 1-o'tish: transfer xom qatorlarini zanjirlarga yig'ish (bir zanjirning barcha qadamlari bir xil channel)
            const xferChains = new Map(); // dateStr -> Map(channel -> [{ from, to, billsec }])
            const aggRows = [];
            for (const line of rawCdr.trim().split('\n')) {
                if (!line) continue;
                const parts = line.split('\t');
                const [callDate, opId, c3, c4] = parts;
                const kind = (parts[4] || '').trim();
                if (kind === 'X') {
                    const cleanChan = (c4 || '').trim();
                    if (!cleanChan) continue;
                    if (!xferChains.has(callDate)) xferChains.set(callDate, new Map());
                    const dayChains = xferChains.get(callDate);
                    if (!dayChains.has(cleanChan)) dayChains.set(cleanChan, []);
                    dayChains.get(cleanChan).push({ from: (opId || '').trim(), to: (c3 || '').trim(), billsec: parseInt(parts[5], 10) || 0 });
                } else {
                    aggRows.push(parts);
                }
            }

            // Suhbat vaqti tuzatishlari: qabul qilingan transfer qatorlarining billsec i qabul qiluvchiga qaytariladi
            // (1-bo'limdan chiqarilgani uchun) — "o'zi gaplashgan vaqt" saqlanadi
            const xferTalkDelta = new Map(); // dateStr -> Map(opId -> sec)
            const addTalk = (dStr, opId, sec) => {
                if (!opId || !/^[0-9]{2,4}$/.test(opId) || sec <= 0) return;
                if (EXCLUDED_OPERATORS.has(opId)) return;
                if (!xferTalkDelta.has(dStr)) xferTalkDelta.set(dStr, new Map());
                const m = xferTalkDelta.get(dStr);
                m.set(opId, (m.get(opId) || 0) + sec);
            };

            // 2-o'tish: zanjirlardan tuzatishlarni hisoblash
            //   Olgan (+1) = zanjirning oxirgi operator qabulchisi (o'zi hal qilgan)
            //   Qabul qilingandan chiqarish (-1) = har bir transfer qabul qatori
            //   Zanjir boshiga -1 = navbatdan to'g'ri qabul qilib boshqaga uzatgan birinchi operator
            for (const [dStr, dayChains] of xferChains.entries()) {
                for (const rows of dayChains.values()) {
                    if (!rows || rows.length === 0) continue;
                    let lastTo = '';
                    for (let i = rows.length - 1; i >= 0; i--) {
                        if (rows[i].to && /^[0-9]{2,4}$/.test(rows[i].to)) { lastTo = rows[i].to; break; }
                    }
                    if (lastTo) addDelta(dStr, lastTo, 1);
                    const first = rows[0];
                    if (first.from && /^[0-9]{2,4}$/.test(first.from)) addDelta(dStr, first.from, -1);
                    for (const r of rows) {
                        if (r.to && /^[0-9]{2,4}$/.test(r.to)) {
                            if (r.to !== lastTo) addDelta(dStr, r.to, -1);
                            addTalk(dStr, r.to, r.billsec);
                        }
                    }
                }
            }

            // 3-o'tish: agregat qatorlar (qabul + chiquvchi)
            for (const parts of aggRows) {
                if (parts.length < 4) continue;
                const [callDate, opId, countStr, talkSecStr] = parts;
                const cleanOp = (opId || '').trim();
                if (!cleanOp || EXCLUDED_OPERATORS.has(cleanOp)) continue;
                if (!/^[0-9]{2,4}$/.test(cleanOp)) continue;

                const opNum = parseInt(cleanOp, 10);
                if ((operatorGroup === 'main' || operatorGroup === '100') && (opNum < 100 || opNum >= 200)) continue;
                if ((operatorGroup === 'secondary' || operatorGroup === '200') && opNum < 200) continue;

                activeOpSet.add(cleanOp);
                if (dataMap.has(callDate)) {
                    const existing = dataMap.get(callDate).get(cleanOp) || { count: 0, talkSec: 0 };
                    const cdrCount = parseInt(countStr, 10) || 0;
                    const cdrTalkSec = parseInt(talkSecStr, 10) || 0;
                    dataMap.get(callDate).set(cleanOp, {
                        count: cdrCount,
                        talkSec: Math.max(existing.talkSec, cdrTalkSec)
                    });
                }
            }

            // 4-o'tish: transfer tuzatishlarini qo'llash (soni + suhbat vaqti)
            const talkDeltas = xferTalkDelta;
            for (const [dStr, ops] of xferDelta.entries()) {
                if (!dataMap.has(dStr)) continue;
                const allOps = new Set([...ops.keys(), ...((talkDeltas.get(dStr) || new Map()).keys())]);
                for (const opId of allOps) {
                    const opNum = parseInt(opId, 10);
                    if ((operatorGroup === 'main' || operatorGroup === '100') && (opNum < 100 || opNum >= 200)) continue;
                    if ((operatorGroup === 'secondary' || operatorGroup === '200') && opNum < 200) continue;
                    activeOpSet.add(opId);
                    const delta = ops.get(opId) || 0;
                    const talkAdd = (talkDeltas.get(dStr) || new Map()).get(opId) || 0;
                    const existing = dataMap.get(dStr).get(opId) || { count: 0, talkSec: 0 };
                    dataMap.get(dStr).set(opId, {
                        count: existing.count + delta,
                        talkSec: existing.talkSec + talkAdd
                    });
                }
            }
        }

        // Operatorlar ro'yxatini tartiblash (101, 103, 106, 111, 114, 116, 119, 120 ...)
        const operators = Array.from(activeOpSet).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        // 2. Excel Workbook yaratish
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Call Center Real-Time Dashboard';
        workbook.lastModifiedBy = 'Admin';
        workbook.created = new Date();
        workbook.modified = new Date();

        const sheet = workbook.addWorksheet(sheetTitle, {
            views: [{ showGridLines: true }]
        });

        // 3. Sarlavhalarni (Headers) shakllantirish
        // Chap qism: [Sana, Op1, Op2, ...]
        // Ajratuvchi: [Bo'sh ustun]
        // O'ng qism: [Sana, Op1, Op2, ...]
        const dateColTitle = lang === 'ru' ? 'Дата' : 'Sana';
        const leftHeaders = [dateColTitle];
        const rightHeaders = [dateColTitle];

        const operatorNamesMap = (lang === 'ru') ? OPERATOR_DISPLAY_NAMES_RU : OPERATOR_DISPLAY_NAMES_UZ;
        const opFallbackPrefix = (lang === 'ru') ? 'Оператор' : 'Operator';

        for (const opId of operators) {
            let name = operatorNamesMap[opId] || `${opFallbackPrefix} ${opId}`;
            if (lang !== 'ru') {
                name = cyrillicToLatin(name);
            }
            leftHeaders.push(name);
            rightHeaders.push(name);
        }

        const totalLeftCols = leftHeaders.length;
        const totalRightCols = rightHeaders.length;
        const spacerColIdx = totalLeftCols + 1;
        const rightStartColIdx = spacerColIdx + 1;

        // Yuqori Title qatori (Row 1): "QO'NG'IROQLAR SONI" va "SUHBAT VAQTI"
        const rowTitle = sheet.getRow(1);
        rowTitle.height = 28;

        sheet.mergeCells(1, 1, 1, totalLeftCols);
        const leftTitleCell = sheet.getCell(1, 1);
        leftTitleCell.value = leftTitle;
        leftTitleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
        leftTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        leftTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

        sheet.mergeCells(1, rightStartColIdx, 1, rightStartColIdx + totalRightCols - 1);
        const rightTitleCell = sheet.getCell(1, rightStartColIdx);
        rightTitleCell.value = rightTitle;
        rightTitleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
        rightTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
        rightTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

        // 4. Ustunlar nomlari qatori (Row 2)
        const rowHeaders = sheet.getRow(2);
        rowHeaders.height = 24;

        const headerValues = [...leftHeaders, '', ...rightHeaders];
        rowHeaders.values = headerValues;

        // Ustun kengliklarini o'rnatish va Header stillari
        for (let col = 1; col <= headerValues.length; col++) {
            const cell = sheet.getCell(2, col);
            if (col === spacerColIdx) {
                sheet.getColumn(col).width = 4;
                continue;
            }

            const isLeft = col <= totalLeftCols;
            sheet.getColumn(col).width = (col === 1 || col === rightStartColIdx) ? 18 : 20;

            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: isLeft ? 'FF2563EB' : 'FF059669' }
            };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF94A3B8' } },
                left: { style: 'thin', color: { argb: 'FF94A3B8' } },
                bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
                right: { style: 'thin', color: { argb: 'FF94A3B8' } }
            };
        }

        // 5. Kunlik ma'lumotlarni yozish (Rows 3 to Days+2)
        let currentRow = 3;
        const opTotalCalls = new Array(operators.length).fill(0);
        const opTotalSecs = new Array(operators.length).fill(0);

        for (const dateStr of dates) {
            const [y, m, d] = dateStr.split('-');
            const dateObj = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
            const dayOfWeek = dateObj.getUTCDay(); // 0 = Yakshanba, 6 = Shanba
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            const isPastOrToday = dateStr <= todayTashkent;
            const dayNum = parseInt(d, 10);
            const mNum = parseInt(m, 10);
            let displayDate = '';
            if (lang === 'ru') {
                const monthNameRu = MONTH_NAMES_RU[mNum - 1] || m;
                displayDate = `${dayNum} ${monthNameRu} ${y} г.`;
            } else {
                const monthName = MONTH_NAMES_UZ[mNum - 1] || m;
                displayDate = `${dayNum}-${monthName} ${y}`;
            }

            const dayData = dataMap.get(dateStr) || new Map();
            let totalDayCalls = 0;
            for (const opId of operators) {
                const item = dayData.get(opId);
                if (item) totalDayCalls += item.count;
            }

            const row = sheet.getRow(currentRow);
            row.height = 20;

            const thinBorder = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };

            // Dam olish kuni yoki bayram:
            // MUHIM: Bugungi kun (isToday) yoki birorta qo'ng'iroq bo'lgan kun HECH QACHON "ВЫХОДНОЙ" bo'lmaydi!
            const isToday = (dateStr === todayTashkent);
            let isDayOff = false;
            if (!isToday && totalDayCalls === 0) {
                if (isPastOrToday) {
                    // O'tgan kunda umuman qo'ng'iroq bo'lmagan bo'lsa (Shanba/Yakshanba yoki bayram kuni)
                    isDayOff = true;
                } else if (isWeekend) {
                    // Kelajakdagi shanba va yakshanba kunlari
                    isDayOff = true;
                }
            }

            if (isDayOff) {
                // Chap jadval: Sana
                const dateCell1 = sheet.getCell(currentRow, 1);
                dateCell1.value = displayDate;
                dateCell1.alignment = { horizontal: 'center', vertical: 'middle' };
                dateCell1.font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
                dateCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                dateCell1.border = thinBorder;

                // Chap jadval: Barcha operatorlar kataklarini birlashtirib "Dam olish kuni"
                const dayOffLabel = lang === 'ru' ? 'Выходной день' : 'Dam olish kuni';
                sheet.mergeCells(currentRow, 2, currentRow, totalLeftCols);
                const leftCell = sheet.getCell(currentRow, 2);
                leftCell.value = dayOffLabel;
                leftCell.alignment = { horizontal: 'center', vertical: 'middle' };
                leftCell.font = { name: 'Calibri', size: 11, bold: true, italic: true, color: { argb: 'FF1D4ED8' } };
                leftCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

                for (let c = 2; c <= totalLeftCols; c++) {
                    sheet.getCell(currentRow, c).border = thinBorder;
                }

                // O'rtadagi bo'sh katak
                const spacerCell = sheet.getCell(currentRow, spacerColIdx);
                spacerCell.value = '';

                // O'ng jadval: Sana
                const dateCell2 = sheet.getCell(currentRow, rightStartColIdx);
                dateCell2.value = displayDate;
                dateCell2.alignment = { horizontal: 'center', vertical: 'middle' };
                dateCell2.font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
                dateCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                dateCell2.border = thinBorder;

                // O'ng jadval: Barcha operator vaqt kataklarini birlashtirib "Dam olish kuni"
                const rightEndCol = rightStartColIdx + totalRightCols - 1;
                sheet.mergeCells(currentRow, rightStartColIdx + 1, currentRow, rightEndCol);
                const rightCell = sheet.getCell(currentRow, rightStartColIdx + 1);
                rightCell.value = dayOffLabel;
                rightCell.alignment = { horizontal: 'center', vertical: 'middle' };
                rightCell.font = { name: 'Calibri', size: 11, bold: true, italic: true, color: { argb: 'FF1D4ED8' } };
                rightCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

                for (let c = rightStartColIdx + 1; c <= rightEndCol; c++) {
                    sheet.getCell(currentRow, c).border = thinBorder;
                }
            } else {
                // Ish kuni ma'lumotlari
                const rowVals = [displayDate];

                // Chap jadval: Qo'ng'iroqlar soni
                for (let i = 0; i < operators.length; i++) {
                    const opId = operators[i];
                    const item = dayData.get(opId);
                    const cnt = item ? item.count : 0;
                    opTotalCalls[i] += cnt;
                    rowVals.push(cnt > 0 ? cnt : 0);
                }

                // Bo'sh ustun
                rowVals.push('');

                // O'ng jadval: Suhbat vaqti
                rowVals.push(displayDate);
                for (let i = 0; i < operators.length; i++) {
                    const opId = operators[i];
                    const item = dayData.get(opId);
                    const secs = item ? item.talkSec : 0;
                    opTotalSecs[i] += secs;
                    rowVals.push(secs > 0 ? formatDurationHms(secs) : '00:00:00');
                }

                row.values = rowVals;

                for (let col = 1; col <= rowVals.length; col++) {
                    if (col === spacerColIdx) continue;
                    const cell = sheet.getCell(currentRow, col);
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    cell.font = { name: 'Calibri', size: 10 };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                    };

                    // Bugungi kun bo'lsa sal yorqinroq fon bilan ajratish
                    if (dateStr === todayTashkent) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
                        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
                    }
                }
            }

            currentRow++;
        }

        // 6. Jami qatori (Row: Jami qo'ng'iroqlar / Jami suhbat vaqti)
        const totalRow1 = sheet.getRow(currentRow);
        totalRow1.height = 24;

        const totalCallsLabel = lang === 'ru' ? 'Всего звонков:' : "Jami qo'ng'iroqlar:";
        const totalDurationLabel = lang === 'ru' ? 'Общее время разговора:' : "Jami suhbat vaqti:";
        const totalVals1 = [totalCallsLabel];
        for (let i = 0; i < operators.length; i++) totalVals1.push(opTotalCalls[i]);
        totalVals1.push('');
        totalVals1.push(totalDurationLabel);
        for (let i = 0; i < operators.length; i++) totalVals1.push(formatDurationHms(opTotalSecs[i]));

        totalRow1.values = totalVals1;

        for (let col = 1; col <= totalVals1.length; col++) {
            if (col === spacerColIdx) continue;
            const cell = sheet.getCell(currentRow, col);
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'medium', color: { argb: 'FF475569' } },
                bottom: { style: 'thin', color: { argb: 'FF475569' } },
                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
            };
        }
        currentRow++;

        // 7. Umumiy jami qatori (Row: Jami)
        const grandTotalCalls = opTotalCalls.reduce((s, c) => s + c, 0);
        const grandTotalSecs = opTotalSecs.reduce((s, c) => s + c, 0);

        const totalRow2 = sheet.getRow(currentRow);
        totalRow2.height = 24;

        const grandTotalLabel = lang === 'ru' ? 'Итого:' : 'Jami:';
        const totalVals2 = new Array(totalLeftCols).fill('');
        totalVals2[totalLeftCols - 2] = grandTotalLabel;
        totalVals2[totalLeftCols - 1] = grandTotalCalls;

        totalVals2.push(''); // spacer

        const rightVals2 = new Array(totalRightCols).fill('');
        rightVals2[totalRightCols - 2] = grandTotalLabel;
        rightVals2[totalRightCols - 1] = formatDurationHms(grandTotalSecs);

        totalRow2.values = [...totalVals2, ...rightVals2];

        for (let col = 1; col <= totalRow2.values.length; col++) {
            if (col === spacerColIdx) continue;
            const cell = sheet.getCell(currentRow, col);
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                bottom: { style: 'double', color: { argb: 'FF0F172A' } }
            };
            if (cell.value) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            }
        }

        // 8. Qo'shimcha varaq: Bugungi kunlik operatorlar hisoboti
        await this.addDailySummarySheet(workbook, todayTashkent, operatorGroup, lang);

        const buffer = await workbook.xlsx.writeBuffer();
        return { buffer, fileName };
    }

    /**
     * Ikkinchi varaq: Kunlik hisobot jadvali
     */
    async addDailySummarySheet(workbook, todayStr, operatorGroup = 'all', lang = 'uz') {
        const sheetTitle = lang === 'ru' ? 'Сегодняшний отчет' : 'Bugungi hisobot';
        const sheet = workbook.addWorksheet(sheetTitle, {
            views: [{ showGridLines: true }]
        });

        if (lang === 'ru') {
            sheet.columns = [
                { header: 'ID оператора', key: 'id', width: 14 },
                { header: 'Имя оператора', key: 'name', width: 24 },
                { header: 'Принято', key: 'answered', width: 16 },
                { header: 'Исходящие', key: 'outbound', width: 16 },
                { header: 'Пропущено', key: 'missed', width: 18 },
                { header: 'Всего звонков', key: 'total', width: 18 },
                { header: 'Общая длительность', key: 'duration', width: 20 },
                { header: 'Среднее время', key: 'avg', width: 18 }
            ];
        } else {
            sheet.columns = [
                { header: 'Operator ID', key: 'id', width: 14 },
                { header: 'Operator Ismi', key: 'name', width: 24 },
                { header: 'Qabul qilingan', key: 'answered', width: 16 },
                { header: 'Chiquvchi', key: 'outbound', width: 16 },
                { header: 'O\'tkazib yuborilgan', key: 'missed', width: 18 },
                { header: 'Jami qo\'ng\'iroqlar', key: 'total', width: 18 },
                { header: 'Jami suhbat vaqti', key: 'duration', width: 20 },
                { header: 'O\'rtacha suhbat', key: 'avg', width: 18 }
            ];
        }

        // Header stillari
        const headerRow = sheet.getRow(1);
        headerRow.height = 26;
        headerRow.eachCell((cell) => {
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Bugungi agent statistikasi
        const statsMap = dbService.getTodayAgentOperatorStats(todayStr);
        const isRu = (lang === 'ru');
        const defaultMainListUz = [
            { id: '101', name: 'Oybek' },
            { id: '103', name: 'Feruza' },
            { id: '106', name: 'Ubaydullayeva Gulchehra' },
            { id: '111', name: 'Nozima' },
            { id: '114', name: 'Maxmudbek' },
            { id: '119', name: 'Muattar' },
            { id: '120', name: 'Navruzoy' }
        ];
        const defaultSecondaryListUz = [
            { id: '200', name: 'Operator 200' },
            { id: '203', name: 'Operator 203' },
            { id: '204', name: 'Operator 204' },
            { id: '205', name: 'Operator 205' },
            { id: '206', name: 'Operator 206' },
            { id: '208', name: 'Operator 208' },
            { id: '209', name: 'Operator 209' }
        ];

        const defaultMainListRu = [
            { id: '101', name: 'Ойбек' },
            { id: '103', name: 'Феруза' },
            { id: '106', name: 'Убайдуллаева Гульчехра' },
            { id: '111', name: 'Нозима' },
            { id: '114', name: 'Махмудбек' },
            { id: '119', name: 'Муаттар' },
            { id: '120', name: 'Наврузой' }
        ];
        const defaultSecondaryListRu = [
            { id: '200', name: 'Оператор 200' },
            { id: '203', name: 'Оператор 203' },
            { id: '204', name: 'Оператор 204' },
            { id: '205', name: 'Оператор 205' },
            { id: '206', name: 'Оператор 206' },
            { id: '208', name: 'Оператор 208' },
            { id: '209', name: 'Оператор 209' }
        ];

        const defaultMainList = isRu ? defaultMainListRu : defaultMainListUz;
        const defaultSecondaryList = isRu ? defaultSecondaryListRu : defaultSecondaryListUz;
        const opFallbackPrefix = isRu ? 'Оператор' : 'Operator';
        const operatorNamesMap = isRu ? OPERATOR_DISPLAY_NAMES_RU : OPERATOR_DISPLAY_NAMES_UZ;

        let operatorsList = [];
        if (operatorGroup === 'main' || operatorGroup === '100') {
            operatorsList = [...defaultMainList];
        } else if (operatorGroup === 'secondary' || operatorGroup === '200') {
            operatorsList = [...defaultSecondaryList];
        } else {
            operatorsList = [...defaultMainList, ...defaultSecondaryList];
        }

        // Stats mapdagi qo'shimcha operatorlarni ham qo'shish
        for (const [opId, st] of Object.entries(statsMap)) {
            if (EXCLUDED_OPERATORS.has(opId)) continue;
            const n = parseInt(opId, 10);
            if ((operatorGroup === 'main' || operatorGroup === '100') && (n < 100 || n >= 200)) continue;
            if ((operatorGroup === 'secondary' || operatorGroup === '200') && n < 200) continue;
            if (!operatorsList.some(o => o.id === opId)) {
                const knownName = operatorNamesMap[opId] || `${opFallbackPrefix} ${opId}`;
                operatorsList.push({ id: opId, name: knownName });
            }
        }
        operatorsList.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

        for (const op of operatorsList) {
            const st = statsMap[op.id] || { answered: 0, outbound: 0, missed: 0, totalDurationSec: 0, avgDurationSec: 0 };
            const total = (st.answered || 0) + (st.outbound || 0) + (st.missed || 0);

            const row = sheet.addRow({
                id: op.id,
                name: `${op.name} (${op.id})`,
                answered: st.answered || 0,
                outbound: st.outbound || 0,
                missed: st.missed || 0,
                total: total,
                duration: formatDurationHms(st.totalDurationSec || 0),
                avg: `${st.avgDurationSec || 0} ${lang === 'ru' ? 'сек' : 'sek'}`
            });

            row.height = 20;
            row.eachCell((cell) => {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
            });
        }
    }
}

module.exports = new ExportService();
