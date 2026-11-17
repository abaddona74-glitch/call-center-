import { registerTranslations } from '@/shared/i18n';

registerTranslations('callbacksDismiss', {
  uz: {
    tooltip: "O'chirish",
    title: "Mijozni o'chirish",
    message: "{{phone}} raqamli mijozni ro'yxatdan o'chirishga ishonchingiz komilmi?",
    reasonPlaceholder: 'Sababi (majburiy): masalan, noto‘g‘ri raqam, spam…',
    ok: "Ha, o'chirish",
    cancel: "Yo'q, qolsin",
    done: "Mijoz ro'yxatdan o'chirildi",
    error: 'Xatolik yuz berdi',
  },
  ru: {
    tooltip: 'Удалить',
    title: 'Удаление клиента',
    message: 'Удалить клиента с номером {{phone}} из списка?',
    reasonPlaceholder: 'Причина (обязательно): например, ошибочный номер, спам…',
    ok: 'Да, удалить',
    cancel: 'Нет, оставить',
    done: 'Клиент удален из списка',
    error: 'Произошла ошибка',
  },
});
