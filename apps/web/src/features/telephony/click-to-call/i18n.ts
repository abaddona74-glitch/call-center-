import { registerTranslations } from '@/shared/i18n';

// Shared namespace of the telephony action features; each slice adds its own keys.
registerTranslations('telephonyActions', {
  uz: {
    call: {
      placeholder: '90 123 45 67',
      button: "Qo'ng'iroq qilish",
      from: 'Qaysi operatordan',
      started: "Telefoningiz jiringlaydi — go'shakni ko'taring",
      title: 'Raqam terish',
    },
  },
  ru: {
    call: {
      placeholder: '90 123 45 67',
      button: 'Позвонить',
      from: 'С какого оператора',
      started: 'Ваш телефон зазвонит — снимите трубку',
      title: 'Набрать номер',
    },
  },
});
