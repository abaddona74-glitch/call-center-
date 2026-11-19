import { registerTranslations } from '@/shared/i18n';

registerTranslations('operatorsPage', {
  uz: {
    title: 'Operatorlar',
    density: 'Qatorlar',
    callFrom: "Operator telefonidan qo'ng'iroq qilish",
    rating: {
      next: "Keyingi yulduzgacha: yana {{n}} ta qo'ng'iroq kerak",
      max: '🏆 Maksimal daraja (TOP operator)!',
      stars: '{{n}} ta yulduz',
      medal: { diamond: '💎 MVP', gold: '🥇 #2', silver: '🥈 #3' },
    },
    card: {
      total: 'Jami',
      count: '{{n}} ta',
      sip: 'Telefon (SIP)',
      active: 'Faol',
      inactive: 'Nofaol',
      queue: 'Navbat (callsTaken)',
      answered: 'Qabul qilingan',
      outbound: 'Chiquvchi',
      missed: "O'tkazib yuborilgan",
      missedTitle: "Ko'tarmagan: {{noAnswer}} ta / Rad etgan: {{rejected}} ta",
      talkTotal: 'Umumiy suhbat',
      talkAvg: "O'rtacha suhbat",
    },
  },
  ru: {
    title: 'Операторы',
    density: 'Строки',
    callFrom: 'Позвонить с телефона оператора',
    rating: {
      next: 'До следующей звезды: ещё {{n}} звонков',
      max: '🏆 Максимальный уровень (TOP оператор)!',
      stars: '{{n}} звёзд',
      medal: { diamond: '💎 MVP', gold: '🥇 #2', silver: '🥈 #3' },
    },
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
      missedTitle: 'Не взял: {{noAnswer}} / Отклонил: {{rejected}}',
      talkTotal: 'Всего разговор',
      talkAvg: 'Средний разговор',
    },
  },
});
