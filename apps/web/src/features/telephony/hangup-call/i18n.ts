import { registerTranslations } from '@/shared/i18n';

// Shared namespace of the telephony action features; each slice adds its own keys.
registerTranslations('telephonyActions', {
  uz: {
    hangup: {
      button: 'Tugatish',
      confirm: 'Ha, tugatish',
      done: "Qo'ng'iroq tugatildi",
    },
  },
  ru: {
    hangup: {
      button: 'Завершить',
      confirm: 'Да, завершить',
      done: 'Звонок завершён',
    },
  },
});
