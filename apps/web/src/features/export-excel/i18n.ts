import { registerTranslations } from '@/shared/i18n';

registerTranslations('exportExcel', {
  uz: {
    button: 'Excel Export',
    title: 'Hisobotni yuklab olish',
    subtitle: "Excel (XLSX) formatida, sana oralig'i bo'yicha",
    quick: 'Tezkor tanlash:',
    from: 'Boshlanish sanasi',
    to: 'Tugash sanasi',
    group: 'Operatorlar guruhi',
    lang: 'Hisobot tili',
    options: {
      all: {
        title: 'Umumiy barcha operatorlar',
        badge: 'Barchasi',
        desc: "Barcha guruhdagi operatorlar birlashgan to'liq hisoboti",
      },
      main: { title: 'Asosiy operatorlar', desc: 'Faqat asosiy operatorlar hisoboti' },
      secondary: { title: 'Zangiota 42 operatorlari', desc: 'Faqat Zangiota 42 operatorlari hisoboti' },
    },
    download: 'Yuklab olish',
    downloading: 'Yuklanmoqda...',
    cancel: 'Bekor qilish',
    failed: "Hisobotni yuklab bo'lmadi",
  },
  ru: {
    button: 'Экспорт Excel',
    title: 'Экспорт отчета',
    subtitle: 'В формате Excel (XLSX) по диапазону дат',
    quick: 'Быстрый выбор диапазона:',
    from: 'Дата начала',
    to: 'Дата окончания',
    group: 'Группа операторов',
    lang: 'Язык отчета',
    options: {
      all: {
        title: 'Общий по всем операторам',
        badge: 'Все',
        desc: 'Полный объединенный отчет по всем группам операторов',
      },
      main: { title: 'Основные операторы', desc: 'Отчет только по основным операторам' },
      secondary: { title: 'Операторы Зангиота 42', desc: 'Отчет только по операторам Зангиота 42' },
    },
    download: 'Скачать',
    downloading: 'Загрузка...',
    cancel: 'Отмена',
    failed: 'Не удалось скачать отчет',
  },
});
