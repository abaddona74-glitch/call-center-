import { registerTranslations } from '@/shared/i18n';

registerTranslations('contactsDelete', {
  uz: {
    tooltip: "O'chirish",
    message: "{{phone}} raqamli mijozni ro'yxatdan o'chirmoqchimisiz?",
    ok: "Ha, o'chirilsin",
    cancel: "Yo'q, qolsin",
    done: "Mijoz o'chirildi!",
    error: "Mijozni o'chirib bo'lmadi",
  },
  ru: {
    tooltip: 'Удалить',
    message: 'Удалить клиента с номером {{phone}}?',
    ok: 'Да, удалить',
    cancel: 'Нет, оставить',
    done: 'Клиент удален!',
    error: 'Не удалось удалить клиента',
  },
});
