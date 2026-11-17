import type { OperatorStatsRow } from '@cc/shared';
import { buildExcelReport, cyrillicToLatin, formatHms, reportNames } from './excel-report.js';

const row = (ext: string, p: Partial<OperatorStatsRow>): OperatorStatsRow => ({
  ext,
  name: null,
  group: 'main',
  answered: 0,
  transferredIn: 0,
  transferredOut: 0,
  outbound: 0,
  outboundAttempts: 0,
  missed: 0,
  total: 0,
  talkSec: 0,
  avgTalkSec: 0,
  ...p,
});

describe('excel report', () => {
  it('names the file and sheet like legacy', () => {
    expect(
      reportNames({ from: '2026-11-01', to: '2026-11-30', lang: 'uz', group: { id: 'main', from: 100, to: 199 } }),
    ).toMatchObject({
      sheetTitle: 'noyabr 2026',
      fileName: 'Call_Center_Statistika_2026-11_Asosiy_UZ.xlsx',
    });
    expect(reportNames({ from: '2026-11-17', to: '2026-11-17', lang: 'ru', group: { id: 'all' } })).toMatchObject({
      sheetTitle: '17.11.2026',
      fileName: 'Call_Center_Export_2026-11-17_Общий_RU.xlsx',
    });
    expect(
      reportNames({ from: '2026-11-10', to: '2026-11-17', lang: 'uz', group: { id: 'secondary', from: 200, to: 299 } })
        .sheetTitle,
    ).toBe('10.11 - 17.11');
  });

  it('formats durations and transliterates names for the uz report', () => {
    expect(formatHms(3725)).toBe('01:02:05');
    expect(cyrillicToLatin('Жураева Нозима')).toBe('Juraeva Nozima');
  });

  it('builds the matrix sheet with day-off rows and totals, and the period summary sheet', () => {
    const perDay = new Map([
      [
        '2026-11-13',
        new Map([
          ['101', { count: 3, talkSec: 300 }],
          ['103', { count: 1, talkSec: 65 }],
        ]),
      ],
      ['2026-11-16', new Map([['101', { count: 2, talkSec: 100 }]])],
    ]);
    const { workbook } = buildExcelReport({
      from: '2026-11-13',
      to: '2026-11-16',
      today: '2026-11-17',
      lang: 'uz',
      group: { id: 'all' },
      operators: [
        { ext: '101', name: 'Ойбек' },
        { ext: '103', name: null },
      ],
      perDay,
      summary: [
        row('101', {
          answered: 4,
          outbound: 1,
          total: 5,
          talkSec: 400,
          avgTalkSec: 80,
          transferredIn: 0,
          transferredOut: 2,
        }),
      ],
      isWorkingDay: (d) => !['2026-11-14', '2026-11-15'].includes(d),
    });
    const [matrix, summary] = workbook.worksheets;
    expect(matrix.getRow(2).values).toEqual([
      undefined,
      'Sana',
      'Oybek',
      'Operator 103',
      '',
      'Sana',
      'Oybek',
      'Operator 103',
    ]);
    expect(matrix.getRow(3).values).toEqual([
      undefined,
      '13-noyabr 2026',
      3,
      1,
      '',
      '13-noyabr 2026',
      '00:05:00',
      '00:01:05',
    ]);
    expect(matrix.getCell(4, 2).value).toBe('Dam olish kuni'); // Saturday without calls
    expect(matrix.getCell(5, 2).value).toBe('Dam olish kuni');
    expect(matrix.getRow(7).values).toEqual([
      undefined,
      "Jami qo'ng'iroqlar:",
      5,
      1,
      '',
      'Jami suhbat vaqti:',
      '00:06:40',
      '00:01:05',
    ]);
    expect(matrix.getCell(8, 2).value).toBe('Jami:');
    expect(matrix.getCell(8, 3).value).toBe(6);
    expect(summary.name).toBe('Davr hisoboti');
    expect(summary.getRow(1).values).toEqual([
      undefined,
      'Operator ID',
      'Operator Ismi',
      'Qabul qilingan',
      'Chiquvchi',
      "O'tkazib yuborilgan",
      'Transfer (Kir / Chiq)',
      "Jami qo'ng'iroqlar",
      'Jami suhbat vaqti',
      "O'rtacha suhbat",
    ]);
    expect(summary.getRow(2).values).toEqual([
      undefined,
      '101',
      'Oybek (101)',
      4,
      1,
      0,
      '0 / 2',
      5,
      '00:06:40',
      '80 sek',
    ]);
    expect(summary.getRow(3).values).toEqual([
      undefined,
      '103',
      'Operator 103 (103)',
      0,
      0,
      0,
      '0 / 0',
      0,
      '00:00:00',
      '0 sek',
    ]);
  });
});
