import { registerTranslations } from '@/shared/i18n';

registerTranslations('staffKpiPage', {
  uz: {
    title: 'KPI xodimlar',
    description: 'Umumiy ball hisoblanmaydi: har bir ko‘rsatkich alohida — istalgan ustun bo‘yicha saralang.',
    views: { operators: 'Operatorlar', executives: 'Mas’ul shaxslar' },
    viewLabel: 'Kimlar bo‘yicha',
    periodLabel: 'Davr',
    periods: { today: 'Bugun', yesterday: 'Kecha', week: 'Oxirgi 7 kun', month: 'Shu oy', range: 'Oraliq' },
    range: 'Sana oralig‘i',
    rangeSubtitle: 'Ko‘rsatkichlar uchun davrni tanlang',
    presets: { today: 'Bugun', yesterday: 'Kecha', week: 'Oxirgi 7 kun', month: 'Shu oy', prevMonth: 'O‘tgan oy' },
    quick: 'Tezkor tanlash',
    from: 'Boshlanish',
    to: 'Tugash',
    rangeSummary: '{{from}} — {{to}} ({{days}} kun)',
    apply: 'Qo‘llash',
    cancel: 'Bekor qilish',
    refresh: 'Yangilash',
    updated: 'Yangilandi: {{time}}',
    error: 'Ma’lumotni yuklab bo‘lmadi. Birozdan so‘ng «Yangilash»ni bosing.',
    operators: {
      title: 'Operatorlar',
      subtitle: 'Qo‘ng‘iroqlar va baholar «Statistika» sahifasidagi bilan bir xil hisoblanadi',
      scopeLabel: 'Qo‘ng‘iroqlar va onlayn vaqt',
      scope: { working: 'Ish vaqti', all: 'Barcha vaqt' },
      groupLabel: 'Ustunlar',
      pbxDown:
        'ATS bazasi javob bermayapti: qo‘ng‘iroqlar, mijoz baholari va suhbat ulushi ko‘rsatilmadi. Birozdan so‘ng «Yangilash»ni bosing.',
      qualityNone:
        'AI-sifat: bu davrda tahlil qilingan qo‘ng‘iroq yo‘q, shuning uchun bu ustunlar bo‘sh. Hozircha AI faqat ayrim kunlarni tahlil qiladi.',
      quality:
        'AI-sifat — faqat AI tahlil qilgan qo‘ng‘iroqlar bo‘yicha: {{n}} ta (javob berilganlarning {{share}}). Tahlil qilingan kunlar: {{days}}.',
      qualityNoShare:
        'AI-sifat — faqat AI tahlil qilgan qo‘ng‘iroqlar bo‘yicha: {{n}} ta. Tahlil qilingan kunlar: {{days}}.',
      daysMore: '{{list}} va yana {{n}} kun',
      version: 'Prompt: {{v}}',
      presenceNone: 'Onlayn va pauza vaqti hali yozilmagan: tarix bu funksiya ishga tushgan paytdan boshlanadi.',
      presencePartial:
        'Onlayn va pauza vaqti {{since}} dan beri yoziladi: davrning undan oldingi qismi hisobga olinmagan.',
    },
    executives: {
      title: 'Mas’ul shaxslar',
      subtitle:
        'Ticket tarixidagi harakatlar bo‘yicha: kim olgan, hal qilgan, qaytargan yoki boshqa hududga yuborgan — o‘sha paytdagi hududiga yoziladi. Muddat — {{n}} ish kuni. Hududlarni ko‘rish uchun ism yonidagi tugmani bosing.',
    },
  },
  ru: {
    title: 'KPI сотрудников',
    description: 'Общий балл не считается: каждый показатель отдельно — сортируйте по любому столбцу.',
    views: { operators: 'Операторы', executives: 'Ответственные' },
    viewLabel: 'По кому',
    periodLabel: 'Период',
    periods: { today: 'Сегодня', yesterday: 'Вчера', week: 'Последние 7 дней', month: 'Этот месяц', range: 'Период' },
    range: 'Период',
    rangeSubtitle: 'Выберите период для показателей',
    presets: {
      today: 'Сегодня',
      yesterday: 'Вчера',
      week: 'Последние 7 дней',
      month: 'Этот месяц',
      prevMonth: 'Прошлый месяц',
    },
    quick: 'Быстрый выбор',
    from: 'Начало',
    to: 'Конец',
    rangeSummary: '{{from}} — {{to}} ({{days}} дн.)',
    apply: 'Применить',
    cancel: 'Отмена',
    refresh: 'Обновить',
    updated: 'Обновлено: {{time}}',
    error: 'Не удалось загрузить данные. Нажмите «Обновить» чуть позже.',
    operators: {
      title: 'Операторы',
      subtitle: 'Звонки и оценки считаются так же, как на странице «Статистика»',
      scopeLabel: 'Звонки и время онлайн',
      scope: { working: 'Рабочее время', all: 'Всё время' },
      groupLabel: 'Столбцы',
      pbxDown:
        'База АТС не отвечает: звонки, оценки клиентов и доля разговора не показаны. Нажмите «Обновить» чуть позже.',
      qualityNone:
        'ИИ-качество: за этот период нет проанализированных звонков, поэтому столбцы пустые. Пока ИИ анализирует только отдельные дни.',
      quality:
        'ИИ-качество — только по звонкам, которые проанализировал ИИ: {{n}} ({{share}} отвеченных). Дни с анализом: {{days}}.',
      qualityNoShare: 'ИИ-качество — только по звонкам, которые проанализировал ИИ: {{n}}. Дни с анализом: {{days}}.',
      daysMore: '{{list}} и ещё {{n}} дн.',
      version: 'Промпт: {{v}}',
      presenceNone: 'Время онлайн и пауз ещё не записывалось: история начинается с запуска этой функции.',
      presencePartial: 'Время онлайн и пауз записывается с {{since}}: более ранняя часть периода не учтена.',
    },
    executives: {
      title: 'Ответственные',
      subtitle:
        'По истории тикетов: кто взял, решил, вернул или переслал — с областью на тот момент. Срок — {{n}} раб. дня. Чтобы увидеть области, нажмите кнопку рядом с именем.',
    },
  },
});
