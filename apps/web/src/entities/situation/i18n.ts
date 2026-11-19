import { registerTranslations } from '@/shared/i18n';

registerTranslations('situation', {
  uz: {
    live: {
      live: 'Jonli',
      connecting: 'Ulanmoqda…',
      lost: 'Aloqa uzildi, qayta ulanmoqda',
      stale: 'Yangilanish kechikmoqda',
      updated: 'yangilandi {{time}}',
      hint: 'Ma’lumotlar o‘zgarishi bilan darhol yangilanadi. Aloqa uzilsa, sahifa o‘zi qayta ulanadi.',
    },
  },
  ru: {
    live: {
      live: 'Вживую',
      connecting: 'Подключение…',
      lost: 'Связь прервана, переподключаемся',
      stale: 'Обновление задерживается',
      updated: 'обновлено {{time}}',
      hint: 'Данные обновляются сразу при изменении. Если связь прервётся, страница переподключится сама.',
    },
  },
});
