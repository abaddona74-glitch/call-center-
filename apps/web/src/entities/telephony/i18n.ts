import { registerTranslations } from '@/shared/i18n';

registerTranslations('telephony', {
  uz: {
    hidden: 'Yashirin raqam',
    ami: {
      connected: 'Ulangan',
      connecting: 'Ulanmoqda…',
      disconnected: 'Uzilgan',
      auth_failed: 'Login xato',
      disabled: 'Sozlanmagan',
    },
    direction: { inbound: 'Kiruvchi', outbound: 'Chiquvchi', internal: 'Ichki' },
    callState: {
      ivr: 'IVR',
      queued: 'Navbatda',
      ringing: 'Chaqirilmoqda',
      dialing: 'Chiquvchi',
      talking: 'Suhbatda',
    },
    errors: {
      generic: 'Amal bajarilmadi',
    },
  },
  ru: {
    hidden: 'Скрытый номер',
    ami: {
      connected: 'Подключено',
      connecting: 'Подключение…',
      disconnected: 'Нет связи',
      auth_failed: 'Ошибка входа',
      disabled: 'Не настроено',
    },
    direction: { inbound: 'Входящий', outbound: 'Исходящий', internal: 'Внутренний' },
    callState: {
      ivr: 'IVR',
      queued: 'В очереди',
      ringing: 'Вызов',
      dialing: 'Исходящий',
      talking: 'Разговор',
    },
    errors: {
      generic: 'Не удалось выполнить действие',
    },
  },
});
