import { registerTranslations } from '@/shared/i18n';

registerTranslations('agentsCreate', {
  uz: {
    name: 'Kompyuter nomi (masalan: 101-xona PK)',
    extension: 'Exten',
    issue: 'Kalit berish',
    invalid: 'Nom va 2–6 xonali exten kiriting',
    keyTitle: '{{name}} ({{ext}}) uchun API kalit',
    keyOnce: "Kalit faqat hozir ko'rsatiladi — serverda faqat uning xeshi saqlanadi.",
    keyHowTo: "Agent sozlamalarida x-agent-key sifatida kiriting. Kalit faqat shu exten nomidan ma'lumot yubora oladi.",
    copy: 'Nusxalash',
    copied: 'Kalit nusxalandi',
  },
  ru: {
    name: 'Имя компьютера (например: ПК каб. 101)',
    extension: 'Exten',
    issue: 'Выдать ключ',
    invalid: 'Введите имя и exten из 2–6 цифр',
    keyTitle: 'API-ключ для {{name}} ({{ext}})',
    keyOnce: 'Ключ показывается только сейчас — на сервере хранится лишь его хеш.',
    keyHowTo: 'Укажите его в настройках агента как x-agent-key. Ключ может отправлять данные только от этого exten.',
    copy: 'Скопировать',
    copied: 'Ключ скопирован',
  },
});
