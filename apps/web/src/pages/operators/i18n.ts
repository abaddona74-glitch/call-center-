import { registerTranslations } from '@/shared/i18n';

registerTranslations('operatorsPage', {
  uz: {
    title: 'Operatorlar',
    density: 'Qatorlar',
    callFrom: "Operator telefonidan qo'ng'iroq qilish",
    card: {
      total: 'Jami',
      count: '{{n}} ta',
      sip: 'SIP telefon',
      active: 'Faol',
      inactive: 'Nofaol',
      queue: 'Navbat (callsTaken)',
      answered: 'Qabul qilingan',
      outbound: 'Chiquvchi',
      missed: "O'tkazib yuborilgan",
      talkTotal: 'Umumiy suhbat',
      talkAvg: "O'rtacha suhbat",
    },
  },
  ru: {
    title: 'Операторы',
    density: 'Строки',
    callFrom: 'Позвонить с телефона оператора',
    card: {
      total: 'Всего',
      count: '{{n}}',
      sip: 'SIP-телефон',
      active: 'Активен',
      inactive: 'Неактивен',
      queue: 'Очередь (callsTaken)',
      answered: 'Принято',
      outbound: 'Исходящие',
      missed: 'Пропущено',
      talkTotal: 'Всего разговор',
      talkAvg: 'Средний разговор',
    },
  },
});
