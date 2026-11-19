/**
 * Excel report with the same sheets, columns and styling as legacy exportService ("cal stat" template):
 *  1. matrix "calls per operator per day" (left) + "talk time per operator per day" (right), day-off rows, totals;
 *  2. per-operator summary table (Operator ID, name, answered, outbound, missed with its split into "no answer" and
 *     "rejected", transfer in/out, total, talk, avg).
 * Fix vs legacy: sheet 2 covers the exported period (legacy always printed *today*, whatever period was chosen).
 * Numbers come from stats/domain operatorStats (same definitions as the statistics page).
 */
import type { OperatorStatsRow } from '@cc/shared';
import ExcelJS from 'exceljs';

export type ReportLang = 'uz' | 'ru';

export interface ReportInput {
  from: string;
  to: string;
  today: string;
  lang: ReportLang;
  /** Group id ("main", "secondary") or "all"; with its extension range for titles. */
  group: { id: string; from?: number; to?: number };
  /** Operators (columns), already filtered by group and sorted. */
  operators: { ext: string; name: string | null }[];
  /** date → ext → { count, talkSec } */
  perDay: Map<string, Map<string, { count: number; talkSec: number }>>;
  /** Period totals per operator (sheet 2). */
  summary: OperatorStatsRow[];
  isWorkingDay: (date: string) => boolean;
}

const MONTHS_UZ = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];
const MONTHS_RU_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const MONTHS_RU_NOM = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const CYR_TO_LAT: Record<string, string> = {
  А: 'A',
  а: 'a',
  Б: 'B',
  б: 'b',
  В: 'V',
  в: 'v',
  Г: 'G',
  г: 'g',
  Д: 'D',
  д: 'd',
  Е: 'E',
  е: 'e',
  Ё: 'Yo',
  ё: 'yo',
  Ж: 'J',
  ж: 'j',
  З: 'Z',
  з: 'z',
  И: 'I',
  и: 'i',
  Й: 'Y',
  й: 'y',
  К: 'K',
  к: 'k',
  Л: 'L',
  л: 'l',
  М: 'M',
  м: 'm',
  Н: 'N',
  н: 'n',
  О: 'O',
  о: 'o',
  П: 'P',
  п: 'p',
  Р: 'R',
  р: 'r',
  С: 'S',
  с: 's',
  Т: 'T',
  т: 't',
  У: 'U',
  у: 'u',
  Ф: 'F',
  ф: 'f',
  Х: 'X',
  х: 'x',
  Ц: 'Ts',
  ц: 'ts',
  Ч: 'Ch',
  ч: 'ch',
  Ш: 'Sh',
  ш: 'sh',
  Щ: 'Sh',
  щ: 'sh',
  Ъ: "'",
  ъ: "'",
  Ы: 'I',
  ы: 'i',
  Ь: '',
  ь: '',
  Э: 'E',
  э: 'e',
  Ю: 'Yu',
  ю: 'yu',
  Я: 'Ya',
  я: 'ya',
  Ў: "O'",
  ў: "o'",
  Ғ: "G'",
  ғ: "g'",
  Қ: 'Q',
  қ: 'q',
  Ҳ: 'H',
  ҳ: 'h',
};

export function cyrillicToLatin(text: string): string {
  return text.replace(/[А-Яа-яЁёЎўҒғҚқҲҳ]/g, (m) => CYR_TO_LAT[m] ?? m);
}

export function formatHms(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`;
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function isFullMonth(from: string, to: string): boolean {
  if (!from.endsWith('-01') || from.slice(0, 7) !== to.slice(0, 7)) return false;
  const [y, m] = from.split('-').map(Number);
  return Number(to.slice(8)) === new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const dmy = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

function displayDate(d: string, lang: ReportLang): string {
  const [y, m, day] = d.split('-').map(Number);
  return lang === 'ru' ? `${day} ${MONTHS_RU_GEN[m - 1]} ${y} г.` : `${day}-${MONTHS_UZ[m - 1]} ${y}`;
}

function groupLabels(group: ReportInput['group'], lang: ReportLang): { title: string; file: string } {
  const range = group.from !== undefined ? `${group.from}-${group.to}` : '';
  if (group.id === 'main') {
    return lang === 'ru'
      ? { title: ` (Основные ${range})`, file: `_Основные_${range.replace('-', '_')}` }
      : { title: ` (Asosiy ${range})`, file: '_Asosiy' };
  }
  if (group.id === 'secondary') {
    return lang === 'ru'
      ? { title: ` (Зангиота 42 ${group.from ?? ''}+)`, file: '_Зангиота_42' }
      : { title: ` (Zangiota 42 ${group.from ?? ''}+)`, file: '_Zangiota_42' };
  }
  if (group.id !== 'all') return { title: ` (${group.id} ${range})`, file: `_${group.id}` };
  return lang === 'ru' ? { title: ' (Все операторы)', file: '_Общий' } : { title: ' (Barchasi)', file: '_Umumiy' };
}

/** Titles and the download file name, exactly like legacy. */
export function reportNames(input: Pick<ReportInput, 'from' | 'to' | 'lang' | 'group'>) {
  const { from, to, lang } = input;
  const g = groupLabels(input.group, lang);
  const langSuffix = lang === 'ru' ? '_RU' : '_UZ';
  const callsTitle = lang === 'ru' ? 'КОЛИЧЕСТВО ПРИНЯТЫХ ЗВОНКОВ' : "QABUL QILINGAN QO'NG'IROQLAR SONI";
  const talkTitle = lang === 'ru' ? 'ОБЩЕЕ ВРЕМЯ РАЗГОВОРА (ЧЧ:ММ:СС)' : 'UMUMIY SUHBAT VAQTI (HH:MM:SS)';
  if (isFullMonth(from, to)) {
    const [y, m] = from.split('-').map(Number);
    const month = lang === 'ru' ? MONTHS_RU_NOM[m - 1] : MONTHS_UZ[m - 1];
    return {
      sheetTitle: `${month} ${y}`,
      leftTitle: `📞 ${month.toUpperCase()} ${y}${g.title} — ${callsTitle}`,
      rightTitle: `⏱️ ${month.toUpperCase()} ${y}${g.title} — ${talkTitle}`,
      fileName: `Call_Center_Statistika_${from.slice(0, 7)}${g.file}${langSuffix}.xlsx`,
    };
  }
  if (from === to) {
    return {
      sheetTitle: dmy(from),
      leftTitle: `📞 ${dmy(from)}${g.title} — ${callsTitle}`,
      rightTitle: `⏱️ ${dmy(from)}${g.title} — ${talkTitle}`,
      fileName: `Call_Center_Export_${from}${g.file}${langSuffix}.xlsx`,
    };
  }
  return {
    sheetTitle: `${from.slice(8)}.${from.slice(5, 7)} - ${to.slice(8)}.${to.slice(5, 7)}`,
    leftTitle: `📞 ${dmy(from)} — ${dmy(to)}${g.title} ${callsTitle}`,
    rightTitle: `⏱️ ${dmy(from)} — ${dmy(to)}${g.title} ${talkTitle}`,
    fileName: `Call_Center_Export_${from}_${to}${g.file}${langSuffix}.xlsx`,
  };
}

function operatorLabel(op: { ext: string; name: string | null }, lang: ReportLang): string {
  const name = op.name ?? `${lang === 'ru' ? 'Оператор' : 'Operator'} ${op.ext}`;
  return lang === 'ru' ? name : cyrillicToLatin(name);
}

const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } });
const cellBorder: Partial<ExcelJS.Borders> = {
  top: thin('FFE2E8F0'),
  bottom: thin('FFE2E8F0'),
  left: thin('FFE2E8F0'),
  right: thin('FFE2E8F0'),
};
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export function buildExcelReport(input: ReportInput): { workbook: ExcelJS.Workbook; fileName: string } {
  const { lang, operators } = input;
  const names = reportNames(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Call Center';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(names.sheetTitle, { views: [{ showGridLines: true }] });
  const dateCol = lang === 'ru' ? 'Дата' : 'Sana';
  const headers = [dateCol, ...operators.map((o) => operatorLabel(o, lang))];
  const leftCols = headers.length;
  const spacer = leftCols + 1;
  const rightStart = spacer + 1;

  // Row 1: titles
  sheet.getRow(1).height = 28;
  sheet.mergeCells(1, 1, 1, leftCols);
  Object.assign(sheet.getCell(1, 1), {
    value: names.leftTitle,
    font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: fill('FF1E3A8A'),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  sheet.mergeCells(1, rightStart, 1, rightStart + leftCols - 1);
  Object.assign(sheet.getCell(1, rightStart), {
    value: names.rightTitle,
    font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: fill('FF065F46'),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });

  // Row 2: column headers
  const headerValues = [...headers, '', ...headers];
  sheet.getRow(2).height = 24;
  sheet.getRow(2).values = headerValues;
  for (let col = 1; col <= headerValues.length; col++) {
    if (col === spacer) {
      sheet.getColumn(col).width = 4;
      continue;
    }
    const isLeft = col <= leftCols;
    sheet.getColumn(col).width = col === 1 || col === rightStart ? 18 : 20;
    Object.assign(sheet.getCell(2, col), {
      font: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: fill(isLeft ? 'FF2563EB' : 'FF059669'),
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: thin('FF94A3B8'),
        left: thin('FF94A3B8'),
        right: thin('FF94A3B8'),
        bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
      },
    });
  }

  // Day rows
  let r = 3;
  const totalCalls: number[] = Array.from({ length: operators.length }, () => 0);
  const totalSecs: number[] = Array.from({ length: operators.length }, () => 0);
  for (const date of datesBetween(input.from, input.to)) {
    const day = input.perDay.get(date) ?? new Map();
    const dayCalls = operators.reduce((s, o) => s + (day.get(o.ext)?.count ?? 0), 0);
    const isToday = date === input.today;
    // A day with no calls is a day off; a future working day stays an empty row (legacy rule, calendar-aware).
    const dayOff = !isToday && dayCalls === 0 && (date < input.today || !input.isWorkingDay(date));
    const label = displayDate(date, lang);
    sheet.getRow(r).height = 20;

    if (dayOff) {
      const offLabel = lang === 'ru' ? 'Выходной день' : 'Dam olish kuni';
      for (const [start, end] of [
        [1, leftCols],
        [rightStart, rightStart + leftCols - 1],
      ]) {
        Object.assign(sheet.getCell(r, start), {
          value: label,
          alignment: { horizontal: 'center', vertical: 'middle' },
          font: { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } },
          fill: fill('FFF8FAFC'),
          border: cellBorder,
        });
        if (end > start) {
          sheet.mergeCells(r, start + 1, r, end);
          Object.assign(sheet.getCell(r, start + 1), {
            value: offLabel,
            alignment: { horizontal: 'center', vertical: 'middle' },
            font: { name: 'Calibri', size: 11, bold: true, italic: true, color: { argb: 'FF1D4ED8' } },
            fill: fill('FFF8FAFC'),
          });
          for (let c = start + 1; c <= end; c++) sheet.getCell(r, c).border = cellBorder;
        }
      }
    } else {
      const values: (string | number)[] = [label];
      operators.forEach((o, i) => {
        const count = day.get(o.ext)?.count ?? 0;
        totalCalls[i] += count;
        values.push(count);
      });
      values.push('', label);
      operators.forEach((o, i) => {
        const secs = day.get(o.ext)?.talkSec ?? 0;
        totalSecs[i] += secs;
        values.push(formatHms(secs));
      });
      sheet.getRow(r).values = values;
      for (let col = 1; col <= values.length; col++) {
        if (col === spacer) continue;
        const cell = sheet.getCell(r, col);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = cellBorder;
        if (isToday) {
          cell.fill = fill('FFEFF6FF');
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
        }
      }
    }
    r++;
  }

  // Totals per operator
  const totals1 = [
    lang === 'ru' ? 'Всего звонков:' : "Jami qo'ng'iroqlar:",
    ...totalCalls,
    '',
    lang === 'ru' ? 'Общее время разговора:' : 'Jami suhbat vaqti:',
    ...totalSecs.map(formatHms),
  ];
  sheet.getRow(r).height = 24;
  sheet.getRow(r).values = totals1;
  for (let col = 1; col <= totals1.length; col++) {
    if (col === spacer) continue;
    Object.assign(sheet.getCell(r, col), {
      font: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } },
      fill: fill('FFE2E8F0'),
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'medium', color: { argb: 'FF475569' } },
        bottom: thin('FF475569'),
        left: thin('FFCBD5E1'),
        right: thin('FFCBD5E1'),
      },
    });
  }
  r++;

  // Grand total
  const grandLabel = lang === 'ru' ? 'Итого:' : 'Jami:';
  const left: (string | number)[] = Array.from({ length: leftCols }, () => '');
  const right: (string | number)[] = Array.from({ length: leftCols }, () => '');
  if (leftCols >= 2) {
    left[leftCols - 2] = grandLabel;
    right[leftCols - 2] = grandLabel;
  }
  left[leftCols - 1] = totalCalls.reduce((s, c) => s + c, 0);
  right[leftCols - 1] = formatHms(totalSecs.reduce((s, c) => s + c, 0));
  const totals2 = [...left, '', ...right];
  sheet.getRow(r).height = 24;
  sheet.getRow(r).values = totals2;
  for (let col = 1; col <= totals2.length; col++) {
    if (col === spacer) continue;
    const cell = sheet.getCell(r, col);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'double', color: { argb: 'FF0F172A' } } };
    if (totals2[col - 1] !== '') cell.fill = fill('FFFEF3C7');
  }

  addSummarySheet(workbook, input);
  return { workbook, fileName: names.fileName };
}

function addSummarySheet(workbook: ExcelJS.Workbook, input: ReportInput): void {
  const ru = input.lang === 'ru';
  const sheet = workbook.addWorksheet(ru ? 'Отчёт за период' : 'Davr hisoboti', { views: [{ showGridLines: true }] });
  sheet.columns = [
    { header: ru ? 'ID оператора' : 'Operator ID', key: 'id', width: 14 },
    { header: ru ? 'Имя оператора' : 'Operator Ismi', key: 'name', width: 24 },
    { header: ru ? 'Принято' : 'Qabul qilingan', key: 'answered', width: 16 },
    { header: ru ? 'Исходящие' : 'Chiquvchi', key: 'outbound', width: 16 },
    { header: ru ? 'Пропущено' : "O'tkazib yuborilgan", key: 'missed', width: 18 },
    { header: ru ? 'Не взял' : "Ko'tarmagan", key: 'missedNoAnswer', width: 14 },
    { header: ru ? 'Отклонил' : 'Rad etgan', key: 'missedRejected', width: 14 },
    { header: ru ? 'Перевод (Вх / Исх)' : 'Transfer (Kir / Chiq)', key: 'transfer', width: 20 },
    { header: ru ? 'Всего звонков' : "Jami qo'ng'iroqlar", key: 'total', width: 18 },
    { header: ru ? 'Общая длительность' : 'Jami suhbat vaqti', key: 'duration', width: 20 },
    { header: ru ? 'Среднее время' : "O'rtacha suhbat", key: 'avg', width: 18 },
  ];
  const header = sheet.getRow(1);
  header.height = 26;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill('FF1E293B');
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  const byExt = new Map(input.summary.map((s) => [s.ext, s]));
  for (const op of input.operators) {
    const s = byExt.get(op.ext);
    const row = sheet.addRow({
      id: op.ext,
      name: `${operatorLabel(op, input.lang)} (${op.ext})`,
      answered: s?.answered ?? 0,
      outbound: s?.outbound ?? 0,
      missed: s?.missed ?? 0,
      missedNoAnswer: s?.missedNoAnswer ?? 0,
      missedRejected: s?.missedRejected ?? 0,
      transfer: `${s?.transferredIn ?? 0} / ${s?.transferredOut ?? 0}`,
      total: s?.total ?? 0,
      duration: formatHms(s?.talkSec ?? 0),
      avg: `${s?.avgTalkSec ?? 0} ${ru ? 'сек' : 'sek'}`,
    });
    row.height = 20;
    row.eachCell((cell) => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = cellBorder;
    });
  }
}
