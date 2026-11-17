import { registerTranslations } from '@/shared/i18n';

/** Labels of call directions/statuses (legacy wording, docs/rewrite/legacy/frontend.md). Namespace "call". */
registerTranslations('call', {
  uz: {
    direction: { inbound: 'Kiruvchi', outbound: 'Chiquvchi', internal: 'Ichki', transfer: 'Transfer' },
    status: {
      answered: 'Qabul qilingan',
      abandoned: 'Navbatdan chiqdi',
      ivr: "IVR'da tugadi",
      after_hours: 'Ish vaqtidan tashqari',
      no_answer: 'Javobsiz',
      busy: 'Band',
      failed: 'Ulanmadi',
      missed: 'Javobsiz / Chiqdi',
      transferred: 'Transfer qilingan',
      outboundConnected: "Chiquvchi (Bog'langan)",
    },
    hidden: 'Yashirin raqam',
    hangup: { unknown: '—', client: 'Mijoz', operator: 'Operator' },
  },
  ru: {
    direction: { inbound: 'Входящий', outbound: 'Исходящий', internal: 'Внутренний', transfer: 'Перевод' },
    status: {
      answered: 'Отвечен',
      abandoned: 'Вышел из очереди',
      ivr: 'Завершён в IVR',
      after_hours: 'Нерабочее время',
      no_answer: 'Без ответа',
      busy: 'Занято',
      failed: 'Не соединён',
      missed: 'Без ответа / Вышел',
      transferred: 'Переведён',
      outboundConnected: 'Исходящий (соединён)',
    },
    hidden: 'Скрытый номер',
    hangup: { unknown: '—', client: 'Клиент', operator: 'Оператор' },
  },
});
