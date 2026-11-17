import { registerTranslations } from '@/shared/i18n';

registerTranslations('operator', {
  uz: {
    presence: {
      idle: 'Kutmoqda',
      ringing: 'Jiringlamoqda',
      talking: 'Hozir suhbatda',
      paused: 'Pauzada',
      offline: 'Oflayn',
    },
    group: { main: 'Asosiy', secondary: 'Zangiota', all: 'Barchasi' },
  },
  ru: {
    presence: {
      idle: 'Ожидает',
      ringing: 'Звонит',
      talking: 'Разговаривает',
      paused: 'На паузе',
      offline: 'Офлайн',
    },
    group: { main: 'Основная', secondary: 'Зангиота', all: 'Все' },
  },
});
