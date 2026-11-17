import { registerTranslations } from '@/shared/i18n';

registerTranslations('blacklistRemove', {
  uz: {
    tooltip: "Qora ro'yxatdan chiqarish",
    delete: "O'chirish",
    confirm: "Haqiqatan ham {{number}} raqamini qora ro'yxatdan chiqarmoqchimisiz?",
    ok: 'Ha, chiqarish',
    cancel: "Yo'q, qolsin",
    done: "{{number}} qora ro'yxatdan chiqarildi",
    error: "O'chirishda xatolik",
  },
  ru: {
    tooltip: 'Убрать из чёрного списка',
    delete: 'Удалить',
    confirm: 'Убрать номер {{number}} из чёрного списка?',
    ok: 'Да, убрать',
    cancel: 'Нет, оставить',
    done: '{{number}} убран из чёрного списка',
    error: 'Ошибка при удалении',
  },
});
