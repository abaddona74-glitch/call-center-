import { registerTranslations } from '@/shared/i18n';

registerTranslations('callbacksPanel', {
  uz: {
    title: 'Qayta bog‘lanish kerak',
    date: { today: 'Bugun', all: 'Barchasi' },
    tab: { pending: 'Kutilmoqda', unreachable: 'Ulanilmadi', resolved: 'Gaplashildi' },
    empty: {
      pending: "Hozircha kutilayotgan yangi mijozlar yo'q",
      unreachable: "Bog'lanib bo'lmagan mijozlar yo'q",
      resolved: "Hozircha gaplashilgan mijozlar yo'q",
    },
    loading: 'Yuklanmoqda…',
    error: "Ro'yxatni yuklab bo'lmadi",
    times: '{{n}} marta',
    resolved: 'Gaplashildi',
    unreachable: 'Ulanilmadi ({{n}} marta)',
    copyTitle: 'Raqamni nusxalash: {{phone}}',
    copied: 'Raqam nusxalandi: {{phone}}',
    copyFallback: 'Raqam: {{phone}}',
  },
  ru: {
    title: 'Требуют связи',
    date: { today: 'Сегодня', all: 'Все' },
    tab: { pending: 'Ожидают', unreachable: 'Не дозвонились', resolved: 'Поговорили' },
    empty: {
      pending: 'Новых ожидающих клиентов пока нет',
      unreachable: 'Нет клиентов, до которых не дозвонились',
      resolved: 'Пока нет клиентов, с которыми поговорили',
    },
    loading: 'Загрузка…',
    error: 'Не удалось загрузить список',
    times: '{{n}} раз',
    resolved: 'Поговорили',
    unreachable: 'Не дозвонились ({{n}} раз)',
    copyTitle: 'Скопировать номер: {{phone}}',
    copied: 'Номер скопирован: {{phone}}',
    copyFallback: 'Номер: {{phone}}',
  },
});
