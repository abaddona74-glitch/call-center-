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

const EXCLUDED_OPERATORS = new Set(['1111', '1324', '1001', '1000', '402', '401', '207', '202', '201', '170', '161', '118', '115', '160', '66', '110', '213']);

const OPERATOR_DISPLAY_NAMES = {
    '101': 'Тухтасинов Ойбек',
    '103': 'Феруза (103)',
    '106': 'Убайдуллаева Гулчехра',
    '111': 'Жураева Нозима',
    '114': 'Maxmudbek',
    '116': 'Ibrohim',
    '119': 'Худойкулова Муаттар',
    '120': 'Муродова Наврузой'
};

function formatDurationHms(seconds) {
    const sec = Math.max(0, parseInt(seconds || 0, 10));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const MONTH_NAMES_UZ = [
    'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
    'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'
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

        if (typeof options === 'string') {
            targetMonth = options;
        } else if (options && typeof options === 'object') {
            targetMonth = options.targetMonth || null;
            startDate = options.startDate || null;
            endDate = options.endDate || null;
        }

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
                leftTitle = `📞 ${startDisplay} — QABUL QILINGAN QO'NG'IROQLAR SONI`;
                rightTitle = `⏱️ ${startDisplay} — UMUMIY SUHBAT VAQTI (HH:MM:SS)`;
                fileName = `Call_Center_Export_${startDate}.xlsx`;
            } else {
                sheetTitle = `${sd}.${sm} - ${ed}.${em}`;
                leftTitle = `📞 ${startDisplay} — ${endDisplay} QABUL QILINGAN QO'NG'IROQLAR SONI`;
                rightTitle = `⏱️ ${startDisplay} — ${endDisplay} UMUMIY SUHBAT VAQTI (HH:MM:SS)`;
                fileName = `Call_Center_Export_${startDate}_${endDate}.xlsx`;
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
            const monthName = MONTH_NAMES_UZ[month - 1] || 'oy';
            const daysInMonth = new Date(year, month, 0).getDate();
            startDate = `${year}-${monthStr}-01`;
            endDate = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
            dates = this.getDateList(startDate, endDate);

            sheetTitle = `${monthName} ${year}`;
            leftTitle = `📞 ${monthName.toUpperCase()} ${year} — QABUL QILINGAN QO'NG'IROQLAR SONI`;
            rightTitle = `⏱️ ${monthName.toUpperCase()} ${year} — UMUMIY SUHBAT VAQTI (HH:MM:SS)`;
            fileName = `Call_Center_Statistika_${year}-${monthStr}.xlsx`;
        }

        // 1. Asterisk PBX CDR dan ma'lumotlarni yig'ish
        const cdrSql = `
            USE asteriskcdrdb;
            SELECT 
                DATE(calldate) as call_date,
                CASE 
                    WHEN dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '-', 1), 'SIP/', -1)
                    WHEN dst REGEXP '^[0-9]{2,4}$' THEN dst
                    WHEN dstchannel REGEXP '^SIP/[0-9]{2,4}-' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '-', 1), 'SIP/', -1)
                    WHEN channel REGEXP 'Local/[0-9]{2,4}@' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(channel, '@', 1), 'Local/', -1)
                    ELSE dst
                END as op_id,
                COUNT(*) as answered_count,
                SUM(billsec) as total_talk_sec
            FROM cdr
            WHERE calldate >= '${startDate} 00:00:00' AND calldate <= '${endDate} 23:59:59'
              AND TIME(calldate) >= '08:00:00' AND TIME(calldate) <= '21:00:00'
              AND disposition = 'ANSWERED' AND billsec > 0
              AND (
                  (
                      (dst REGEXP '^[0-9]{2,4}$' OR dstchannel REGEXP '^SIP/[0-9]{2,4}-' OR channel REGEXP 'Local/[0-9]{2,4}@')
                      AND (dcontext IS NULL OR dcontext != 'from-internal')
                      AND (src IS NULL OR src NOT REGEXP '^[0-9]{1,4}$')
                  )
                  OR (dcontext = 'from-internal' AND channel REGEXP '^SIP/[0-9]{2,4}-' AND LENGTH(dst) >= 7)
              )
            GROUP BY call_date, op_id
            ORDER BY call_date ASC, op_id ASC;
        `;

        const rawCdr = await issabelDbService.execQuery(cdrSql);

        // Map: dateStr -> { opId -> { count, talkSec } }
        const dataMap = new Map();
        for (const dStr of dates) {
            dataMap.set(dStr, new Map());
        }

        const activeOpSet = new Set(['101', '103', '106', '111', '116', '119', '120']);

        if (rawCdr) {
            for (const line of rawCdr.trim().split('\n')) {
                if (!line) continue;
                const parts = line.split('\t');
                if (parts.length < 4) continue;
                const [callDate, opId, countStr, talkSecStr] = parts;
                const cleanOp = (opId || '').trim();
                if (!cleanOp || EXCLUDED_OPERATORS.has(cleanOp)) continue;
                if (!/^[0-9]{2,4}$/.test(cleanOp)) continue;

                activeOpSet.add(cleanOp);
                if (dataMap.has(callDate)) {
                    dataMap.get(callDate).set(cleanOp, {
                        count: parseInt(countStr, 10) || 0,
                        talkSec: parseInt(talkSecStr, 10) || 0
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
        // Chap qism: [Дата, Op1, Op2, ...]
        // Ajratuvchi: [Bo'sh ustun]
        // O'ng qism: [Дата, Op1, Op2, ...]
        const leftHeaders = ['Дата'];
        const rightHeaders = ['Дата'];

        for (const opId of operators) {
            const name = OPERATOR_DISPLAY_NAMES[opId] || `Operator ${opId}`;
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
            sheet.getColumn(col).width = (col === 1 || col === rightStartColIdx) ? 14 : 20;

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
            const displayDate = `${d}.${m}.${y}`;

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
            // 1. Shanba yoki Yakshanba (agar qo'ng'iroq bo'lmasa yoki kelajakdagi kun bo'lsa)
            // 2. Ish kuni (Dushanba-Juma) bo'lsa ham, o'tgan yoki bugungi kun bo'lib, hammada 0 ta bo'lsa (Bayramlar!)
            const isDayOff = (isWeekend && totalDayCalls === 0) || 
                             (isPastOrToday && totalDayCalls === 0) ||
                             (!isPastOrToday && isWeekend);

            if (isDayOff) {
                // Chap jadval: Sana
                const dateCell1 = sheet.getCell(currentRow, 1);
                dateCell1.value = displayDate;
                dateCell1.alignment = { horizontal: 'center', vertical: 'middle' };
                dateCell1.font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
                dateCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                dateCell1.border = thinBorder;

                // Chap jadval: Barcha operatorlar kataklarini birlashtirib "ВЫХОДНОЙ"
                sheet.mergeCells(currentRow, 2, currentRow, totalLeftCols);
                const leftCell = sheet.getCell(currentRow, 2);
                leftCell.value = 'ВЫХОДНОЙ';
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

                // O'ng jadval: Barcha operator vaqt kataklarini birlashtirib "ВЫХОДНОЙ"
                const rightEndCol = rightStartColIdx + totalRightCols - 1;
                sheet.mergeCells(currentRow, rightStartColIdx + 1, currentRow, rightEndCol);
                const rightCell = sheet.getCell(currentRow, rightStartColIdx + 1);
                rightCell.value = 'ВЫХОДНОЙ';
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

        // 6. Jami qatori (Row: Всего звонков / Всего времени)
        const totalRow1 = sheet.getRow(currentRow);
        totalRow1.height = 24;

        const totalVals1 = ['Всего звонков:'];
        for (let i = 0; i < operators.length; i++) totalVals1.push(opTotalCalls[i]);
        totalVals1.push('');
        totalVals1.push('Всего времени:');
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

        // 7. Umumiy jami qatori (Row: Всего)
        const grandTotalCalls = opTotalCalls.reduce((s, c) => s + c, 0);
        const grandTotalSecs = opTotalSecs.reduce((s, c) => s + c, 0);

        const totalRow2 = sheet.getRow(currentRow);
        totalRow2.height = 24;

        const totalVals2 = new Array(totalLeftCols).fill('');
        totalVals2[totalLeftCols - 2] = 'Всего:';
        totalVals2[totalLeftCols - 1] = grandTotalCalls;

        totalVals2.push(''); // spacer

        const rightVals2 = new Array(totalRightCols).fill('');
        rightVals2[totalRightCols - 2] = 'Всего:';
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
        await this.addDailySummarySheet(workbook, todayTashkent);

        const buffer = await workbook.xlsx.writeBuffer();
        return { buffer, fileName };
    }

    /**
     * Ikkinchi varaq: Kunlik hisobot jadvali
     */
    async addDailySummarySheet(workbook, todayStr) {
        const sheet = workbook.addWorksheet('Bugungi hisobot', {
            views: [{ showGridLines: true }]
        });

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
        const operatorsList = [
            { id: '101', name: 'Oybek' },
            { id: '103', name: 'Feruza' },
            { id: '106', name: 'Gulchehra' },
            { id: '111', name: 'Nozima' },
            { id: '114', name: 'Maxmudbek' },
            { id: '116', name: 'Ibrohim' },
            { id: '119', name: 'Muattar' },
            { id: '120', name: 'Navruzoy' }
        ];

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
                avg: `${st.avgDurationSec || 0} sek`
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
