import { registerTranslations } from '@/shared/i18n';

registerTranslations('statisticsPage', {
  uz: {
    title: 'Statistika',
    periods: { day: 'Kun', month: 'Oy', year: 'Yil', range: 'Oraliq' },
    scope: { working: 'Ish vaqti', all: 'Barcha vaqt' },
    scopeHint: 'Ish vaqti: {{days}} {{start}}–{{end}} (Asia/Tashkent)',
    refresh: 'Yangilash',
    range: "Sana oralig'i",
    from: 'Boshlanish',
    to: 'Tugash',
    apply: "Qo'llash",
    presets: { today: 'Bugun', yesterday: 'Kecha', week: '7 kun', month: 'Bu oy', prevMonth: "O'tgan oy" },
    error: "Statistikani yuklab bo'lmadi",
    pbxDown: "ATS bazasiga ulanib bo'lmadi — statistika vaqtincha mavjud emas",
    weekdays: 'Du,Se,Ch,Pa,Ju,Sh,Ya',
  },
  ru: {
    title: 'Статистика',
    periods: { day: 'День', month: 'Месяц', year: 'Год', range: 'Период' },
    scope: { working: 'Рабочее время', all: 'Всё время' },
    scopeHint: 'Рабочее время: {{days}} {{start}}–{{end}} (Asia/Tashkent)',
    refresh: 'Обновить',
    range: 'Диапазон дат',
    from: 'Начало',
    to: 'Конец',
    apply: 'Применить',
    presets: { today: 'Сегодня', yesterday: 'Вчера', week: '7 дней', month: 'Этот месяц', prevMonth: 'Прошлый месяц' },
    error: 'Не удалось загрузить статистику',
    pbxDown: 'Нет связи с базой АТС — статистика временно недоступна',
    weekdays: 'Пн,Вт,Ср,Чт,Пт,Сб,Вс',
  },
});
