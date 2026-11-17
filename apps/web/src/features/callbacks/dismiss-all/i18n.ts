import { registerTranslations } from '@/shared/i18n';

registerTranslations('callbacksDismissAll', {
  uz: {
    tooltip: 'Barchasini tozalash',
    message: "Barcha ({{count}} ta) bog'lanishi kerak bo'lgan mijozlarni ro'yxatdan tozalashni tasdiqlaysizmi?",
    reasonPlaceholder: 'Sababi (majburiy)',
    ok: 'Ha, barchasini tozalash',
    cancel: "Yo'q, qolsin",
    done: 'Barcha mijozlar muvaffaqiyatli tozalandi',
    error: 'Xatolik yuz berdi',
  },
  ru: {
    tooltip: 'Очистить все',
    message: 'Убрать из списка всех клиентов, требующих связи ({{count}})?',
    reasonPlaceholder: 'Причина (обязательно)',
    ok: 'Да, очистить все',
    cancel: 'Нет, оставить',
    done: 'Все клиенты успешно удалены',
    error: 'Произошла ошибка',
  },
});
