import { registerTranslations } from '@/shared/i18n';

/** Words about users shared by every screen. */
registerTranslations('user', {
  uz: {
    role: { operator: 'Operator', observer: 'Kuzatuvchi', executive: 'Mas’ul texnik xodim', superuser: 'Superuser' },
    inactive: 'O‘chirilgan',
  },
  ru: {
    role: {
      operator: 'Оператор',
      observer: 'Наблюдатель',
      executive: 'Ответственный технический сотрудник',
      superuser: 'Суперпользователь',
    },
    inactive: 'Отключён',
  },
});
