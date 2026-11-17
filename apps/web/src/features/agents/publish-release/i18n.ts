import { registerTranslations } from '@/shared/i18n';

registerTranslations('agentsRelease', {
  uz: {
    placeholder: 'Versiya (masalan: 1.0.1)',
    notes: "O'zgarishlar (ixtiyoriy)",
    publish: "E'lon Qilish",
    hint: "* Versiya e'lon qilinganda, barcha onlayn operatorlar agenti fon rejimida avtomatik yangilanadi.",
    required: 'Iltimos, yangi versiya raqamini kiriting! (Masalan: 1.0.1)',
    confirm:
      "Haqiqatan ham yangi v{{v}} versiyasini e'lon qilmoqchimisiz? Barcha ulangan operatorlarning agentlari fon rejimida ushbu versiyaga yangilanadi.",
    ok: "Ha, e'lon qilish",
    cancel: 'Bekor qilish',
    done: "v{{v}} versiyasi muvaffaqiyatli e'lon qilindi!",
  },
  ru: {
    placeholder: 'Версия (например: 1.0.1)',
    notes: 'Изменения (необязательно)',
    publish: 'Опубликовать',
    hint: '* При публикации версии агент всех онлайн-операторов автоматически обновится в фоне.',
    required: 'Пожалуйста, введите номер новой версии! (Например: 1.0.1)',
    confirm: 'Опубликовать новую версию v{{v}}? Агенты всех подключённых операторов обновятся в фоне.',
    ok: 'Да, опубликовать',
    cancel: 'Отмена',
    done: 'Версия v{{v}} опубликована!',
  },
});
