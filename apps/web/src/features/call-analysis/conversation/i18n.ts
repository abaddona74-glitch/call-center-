import { registerTranslations } from '@/shared/i18n';

registerTranslations('callConversation', {
  uz: {
    title: 'Suhbat',
    notAnalysed: "Bu qo'ng'iroq hali tahlil qilinmagan.",
    pending: "Tahlil tayyor bo'lganda shu yerda paydo bo'ladi.",
    failed: "Tahlil qilib bo'lmadi",
    attempts: '{{n}}-urinish',
    error: "Tahlilni yuklab bo'lmadi",
    noTranscript: "Transkripsiya yo'q",
  },
  ru: {
    title: 'Диалог',
    notAnalysed: 'Этот звонок ещё не анализировался.',
    pending: 'Анализ появится здесь, когда будет готов.',
    failed: 'Не удалось проанализировать',
    attempts: 'попытка {{n}}',
    error: 'Не удалось загрузить анализ',
    noTranscript: 'Расшифровки нет',
  },
});
