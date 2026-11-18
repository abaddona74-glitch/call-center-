import { registerTranslations } from '@/shared/i18n';

const uz = {
  title: 'Ticketlar hisoboti',
  subtitle: 'Tanlangan davrda ochilgan ticketlar: hududlar, toifalar, holatlar va ijrochilar kesimida',
  from: 'Dan',
  to: 'Gacha',
  preset: { today: 'Bugun', week: '7 kun', month: '30 kun', quarter: '90 kun' },
  kpi: {
    total: 'Jami ticketlar',
    resolved: 'Hudud javob bergan',
    closed: 'Yopilgan',
    overdue: 'Hudud muddati o‘tgan',
    callbackOverdue: 'Qayta qo‘ng‘iroq kechikkan',
    avg: 'O‘rtacha hal qilish vaqti',
  },
  hours: '{{n}} soat',
  none: '—',
  byRegion: 'Hududlar bo‘yicha',
  byCategory: 'Toifalar bo‘yicha',
  byStatus: 'Holatlar bo‘yicha',
  byExecutive: 'Ijrochilar bo‘yicha',
  col: {
    name: 'Nomi',
    total: 'Jami',
    resolved: 'Javob berilgan',
    overdue: 'Hudud muddati o‘tgan',
    callbackOverdue: 'Qo‘ng‘iroq kechikkan',
    avg: 'O‘rtacha (soat)',
  },
  empty: 'Bu davrda ticketlar yo‘q',
  back: 'Ticketlarga qaytish',
  error: 'Xatolik: {{message}}',
};

const ru: typeof uz = {
  title: 'Отчёт по тикетам',
  subtitle: 'Тикеты, открытые за период: по областям, категориям, статусам и исполнителям',
  from: 'С',
  to: 'По',
  preset: { today: 'Сегодня', week: '7 дней', month: '30 дней', quarter: '90 дней' },
  kpi: {
    total: 'Всего тикетов',
    resolved: 'Регион ответил',
    closed: 'Закрыто',
    overdue: 'Просрочено областью',
    callbackOverdue: 'Просрочен перезвон',
    avg: 'Среднее время решения',
  },
  hours: '{{n}} ч',
  none: '—',
  byRegion: 'По областям',
  byCategory: 'По категориям',
  byStatus: 'По статусам',
  byExecutive: 'По исполнителям',
  col: {
    name: 'Название',
    total: 'Всего',
    resolved: 'С ответом',
    overdue: 'Просрочено областью',
    callbackOverdue: 'Просрочен перезвон',
    avg: 'Среднее (ч)',
  },
  empty: 'За этот период тикетов нет',
  back: 'К тикетам',
  error: 'Ошибка: {{message}}',
};

registerTranslations('ticketReports', { uz, ru });
