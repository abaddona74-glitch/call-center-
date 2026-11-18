import { registerTranslations } from '@/shared/i18n';

/** Uzbek wording follows the legacy "Statistika & Exclude List" tab (docs/rewrite/design/admin-17-settings-exclude.png). */
registerTranslations('excludedOperatorsForm', {
  uz: {
    search: 'Operatorni qidirish (ID yoki ism)...',
    operator: 'Operator {{ext}}',
    included: "Hisobotlarga qo'shilgan",
    excluded: 'Umumiy hisobotdan chiqarilgan',
    empty: 'Operatorlar topilmadi',
    noDirectory:
      "ATS ma'lumotlar bazasi bilan aloqa yo'q: faqat jonli monitordagi va chiqarilgan raqamlar ko'rsatilmoqda.",
    count: '{{count}} ta operator chiqarilgan',
    save: "Ro'yxatni saqlash",
    saved: "Statistikadan chiqarilganlar ro'yxati saqlandi",
    failed: "Saqlab bo'lmadi",
  },
  ru: {
    search: 'Поиск оператора (номер или имя)...',
    operator: 'Оператор {{ext}}',
    included: 'Учитывается в отчётах',
    excluded: 'Исключён из отчётов',
    empty: 'Операторы не найдены',
    noDirectory: 'Нет связи с базой АТС: показаны только номера с живого табло и уже исключённые.',
    count: 'Исключено операторов: {{count}}',
    save: 'Сохранить список',
    saved: 'Список исключённых операторов сохранён',
    failed: 'Не удалось сохранить',
  },
});
