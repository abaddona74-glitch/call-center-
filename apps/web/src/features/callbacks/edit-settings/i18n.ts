import { registerTranslations } from '@/shared/i18n';

registerTranslations('callbacksSettings', {
  uz: {
    workDays: 'Ish kunlari',
    day: { 1: 'Du', 2: 'Se', 3: 'Chor', 4: 'Pay', 5: 'Ju', 6: 'Sha', 7: 'Yak' },
    start: 'Ish boshlanishi',
    end: 'Ish tugashi',
    minTalk: 'Minimal suhbat (soniya)',
    hoursHint:
      "Bu vaqtdan tashqari, dam olish va bayram kunlari kelgan qo'ng'iroqlar «Ish vaqti emas» deb belgilanadi. Kamida shuncha soniya gaplashilsa, qayta bog'lanish avtomatik yopiladi.",
    holidays: 'Bayram kunlari',
    add: "Qo'shish",
    remove: "O'chirish",
    noHolidays: 'Hozircha bayram kunlari kiritilmagan',
    save: 'Saqlash',
    saved: 'Sozlamalar saqlandi',
  },
  ru: {
    workDays: 'Рабочие дни',
    day: { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' },
    start: 'Начало работы',
    end: 'Конец работы',
    minTalk: 'Минимальный разговор (сек)',
    hoursHint:
      'Звонки вне этого времени, в выходные и праздники помечаются «Нерабочее время». Перезвон закрывается автоматически, если разговор длился не меньше этого числа секунд.',
    holidays: 'Праздничные дни',
    add: 'Добавить',
    remove: 'Удалить',
    noHolidays: 'Праздники пока не заданы',
    save: 'Сохранить',
    saved: 'Настройки сохранены',
  },
});
