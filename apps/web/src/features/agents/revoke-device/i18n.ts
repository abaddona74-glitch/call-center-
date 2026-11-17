import { registerTranslations } from '@/shared/i18n';

registerTranslations('agentsRevoke', {
  uz: {
    revoke: 'Bekor qilish',
    confirm: '"{{name}}" kalitini bekor qilasizmi? Bu kompyuterdagi agent ma\'lumot yubora olmay qoladi.',
    ok: 'Ha, bekor qilish',
    cancel: "Yo'q",
    done: 'Kalit bekor qilindi',
  },
  ru: {
    revoke: 'Отозвать',
    confirm: 'Отозвать ключ «{{name}}»? Агент на этом компьютере перестанет отправлять данные.',
    ok: 'Да, отозвать',
    cancel: 'Нет',
    done: 'Ключ отозван',
  },
});
