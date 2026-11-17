import { registerTranslations } from '@/shared/i18n';

// Shared namespace of the telephony action features; each slice adds its own keys.
registerTranslations('telephonyActions', {
  uz: {
    transfer: {
      button: "O'tkazish",
      title: "Boshqa operatorga o'tkazish",
      description: "Qo'ng'iroq tanlangan operatorga yo'naltiriladi",
      empty: "O'tkazish uchun bo'sh operator yo'q",
      done: "Qo'ng'iroq o'tkazildi",
      cancel: 'Bekor qilish',
    },
  },
  ru: {
    transfer: {
      button: 'Перевести',
      title: 'Перевести другому оператору',
      description: 'Звонок будет переадресован выбранному оператору',
      empty: 'Нет свободных операторов',
      done: 'Звонок переведён',
      cancel: 'Отмена',
    },
  },
});
