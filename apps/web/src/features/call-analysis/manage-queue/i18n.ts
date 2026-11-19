import { registerTranslations } from '@/shared/i18n';

registerTranslations('analysisQueueActions', {
  uz: {
    retry: 'Xatoliklarni qayta navbatga',
    retryConfirm: "Xatolik bilan tugagan barcha qo'ng'iroqlar qayta tahlil navbatiga qo'yilsinmi?",
    retried: "Qayta navbatga qo'yildi: {{n}}",
    backfill: "Navbatga qo'shish",
    backfillTitle: "Davr bo'yicha navbatga qo'shish",
    backfillHint: "Tanlangan kunlardagi javob berilgan, yozuvi bor qo'ng'iroqlar tahlil navbatiga qo'shiladi.",
    backfillConfirm:
      "{{from}} — {{to}} oralig'idagi qo'ng'iroqlar navbatga qo'shilsinmi? Ko'p qo'ng'iroqlar AI serverlarini uzoq band qiladi.",
    backfilled: "Mos keldi: {{eligible}} · qo'shildi: {{enqueued}} · avval bor: {{existing}}",
    from: 'Boshlanish',
    to: 'Tugash',
    confirm: 'Tasdiqlash',
    cancel: 'Bekor qilish',
    error: 'Xatolik: {{message}}',
  },
  ru: {
    retry: 'Ошибки — снова в очередь',
    retryConfirm: 'Поставить все звонки с ошибкой анализа снова в очередь?',
    retried: 'Снова в очереди: {{n}}',
    backfill: 'Добавить в очередь',
    backfillTitle: 'Добавить период в очередь',
    backfillHint: 'Отвеченные звонки с записью за выбранные дни будут поставлены в очередь на анализ.',
    backfillConfirm: 'Поставить в очередь звонки за {{from}} — {{to}}? Много звонков надолго займут AI-серверы.',
    backfilled: 'Подходит: {{eligible}} · добавлено: {{enqueued}} · уже были: {{existing}}',
    from: 'Начало',
    to: 'Конец',
    confirm: 'Подтвердить',
    cancel: 'Отмена',
    error: 'Ошибка: {{message}}',
  },
});
