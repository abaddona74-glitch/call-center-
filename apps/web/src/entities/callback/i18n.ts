import { registerTranslations } from '@/shared/i18n';

registerTranslations('callback', {
  uz: {
    time: { justNow: 'hozirgina', minAgo: '{{n}} daq oldin', hourAgo: '{{n}} soat oldin', dayAgo: '{{n}} kun oldin' },
    source: { abandoned: 'Navbatdan chiqdi', after_hours: 'Ish vaqti emas', operator_missed: 'Operator javob bermadi' },
    cause: {
      no_answer: 'Javob bermadi',
      busy: 'Mijoz band',
      rejected: 'Rad etildi',
      unavailable: 'Aloqa doirasidan tashqarida',
      short_call: 'Qisqa suhbat',
    },
  },
  ru: {
    time: { justNow: 'только что', minAgo: '{{n}} мин назад', hourAgo: '{{n}} ч назад', dayAgo: '{{n}} дн назад' },
    source: { abandoned: 'Вышел из очереди', after_hours: 'Нерабочее время', operator_missed: 'Оператор не ответил' },
    cause: {
      no_answer: 'Не ответил',
      busy: 'Занято',
      rejected: 'Отклонён',
      unavailable: 'Вне зоны доступа',
      short_call: 'Короткий разговор',
    },
  },
});
