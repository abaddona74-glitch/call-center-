import { registerTranslations } from '@/shared/i18n';

registerTranslations('workingCalendarForm', {
  uz: {
    workDays: 'Ish kunlari',
    day: { 1: 'Du', 2: 'Se', 3: 'Chor', 4: 'Pay', 5: 'Ju', 6: 'Sha', 7: 'Yak' },
    start: 'Ish boshlanishi',
    end: 'Ish tugashi',
    hoursHint:
      "Bu vaqtdan tashqari, dam olish va bayram kunlari kelgan qo'ng'iroqlar «Ish vaqti emas» hisoblanadi: statistika, qayta bog'lanish va tiketlar muddati shu kalendar bo'yicha.",
    holidays: 'Bayram kunlari',
    holidayDate: 'Bayram sanasi',
    yearly: 'Har yili takrorlanadi',
    everyYear: 'har yili',
    holidaysHint:
      "Doimiy bayramlar (1-yanvar, 8-mart, 21-mart…) uchun «Har yili» belgisini qoldiring; Ramazon va Qurbon hayiti kabi ko'chma bayramlar — aniq sana sifatida.",
    add: "Qo'shish",
    remove: "O'chirish",
    noHolidays: 'Hozircha bayram kunlari kiritilmagan',
    save: 'Saqlash',
    saved: 'Ish vaqti saqlandi',
  },
  ru: {
    workDays: 'Рабочие дни',
    day: { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' },
    start: 'Начало работы',
    end: 'Конец работы',
    hoursHint:
      'Звонки вне этого времени, в выходные и праздники считаются «нерабочим временем». По этому календарю считаются статистика, перезвоны и сроки тикетов.',
    holidays: 'Праздничные дни',
    holidayDate: 'Дата праздника',
    yearly: 'Каждый год',
    everyYear: 'каждый год',
    holidaysHint:
      'Для постоянных праздников (1 января, 8 марта, 21 марта…) оставьте «Каждый год»; подвижные (Рамазан и Курбан хайит) добавляйте конкретной датой.',
    add: 'Добавить',
    remove: 'Удалить',
    noHolidays: 'Праздники пока не заданы',
    save: 'Сохранить',
    saved: 'Рабочий календарь сохранён',
  },
});
