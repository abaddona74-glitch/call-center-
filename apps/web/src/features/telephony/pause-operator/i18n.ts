import { registerTranslations } from '@/shared/i18n';

// Shared namespace of the telephony action features; each slice adds its own keys.
registerTranslations('telephonyActions', {
  uz: {
    pause: {
      pause: 'Pauza',
      unpause: 'Pauzadan chiqish',
      reasons: { break: 'Tanaffus', lunch: 'Tushlik', meeting: "Yig'ilish", other: 'Boshqa' },
      paused: 'Pauzaga qo‘yildi',
      unpaused: 'Pauzadan chiqarildi',
    },
  },
  ru: {
    pause: {
      pause: 'Пауза',
      unpause: 'Снять с паузы',
      reasons: { break: 'Перерыв', lunch: 'Обед', meeting: 'Совещание', other: 'Другое' },
      paused: 'Поставлен на паузу',
      unpaused: 'Пауза снята',
    },
  },
});
