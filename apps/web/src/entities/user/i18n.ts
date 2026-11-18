import { registerTranslations } from '@/shared/i18n';

/** Words about users shared by every screen: roles and operator-group restriction flags. */
registerTranslations('user', {
  uz: {
    role: { operator: 'Operator', observer: 'Kuzatuvchi', executive: 'Rahbar', superuser: 'Superuser' },
    permission: {
      canSeeContacts: 'Mijozlar ma’lumotini ko‘rish',
      canEditContacts: 'Mijozlarni tahrirlash',
      canUseRemoteDesktop: 'Masofaviy boshqaruv (RustDesk)',
      canRequestHelp: 'Yordam so‘rash (qo‘ng‘iroqcha)',
      canUseTools: 'Qo‘shimcha asboblar (konverter va boshq.)',
    },
    inactive: 'O‘chirilgan',
    noGroup: 'Guruhsiz',
  },
  ru: {
    role: { operator: 'Оператор', observer: 'Наблюдатель', executive: 'Руководитель', superuser: 'Суперпользователь' },
    permission: {
      canSeeContacts: 'Видеть данные клиентов',
      canEditContacts: 'Редактировать клиентов',
      canUseRemoteDesktop: 'Удалённый доступ (RustDesk)',
      canRequestHelp: 'Запрос помощи (колокольчик)',
      canUseTools: 'Доп. инструменты (конвертер и др.)',
    },
    inactive: 'Отключён',
    noGroup: 'Без группы',
  },
});
