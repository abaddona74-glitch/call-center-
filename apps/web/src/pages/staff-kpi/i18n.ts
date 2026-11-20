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
    details: {
      personTitle: '{{name}}: {{title}}',
      regionTitle: '{{name}} · {{region}}: {{title}}',
      callSubtitle: 'Shu raqamni tashkil etgan qo‘ng‘iroqlar · {{range}}',
      qualitySubtitle: 'Shu raqamni tashkil etgan tahlil qilingan qo‘ng‘iroqlar · {{range}}',
      scopeWorking: 'Faqat ish vaqtida boshlangan qo‘ng‘iroqlar.',
      scopeAll: 'Barcha vaqt: ish vaqtidan tashqari boshlanganlari ham.',
      calls: {
        answered: {
          title: 'Qabul qilgan qo‘ng‘iroqlari',
          def: 'U oxirigacha gaplashgan kiruvchi qo‘ng‘iroqlar (unga o‘tkazilganlari bilan) — «Statistika»dagidek.',
        },
        missed: {
          title: 'O‘tkazib yuborgan qo‘ng‘iroqlari',
          def: 'Telefoni jiringlagan, lekin u gaplashmagan kiruvchi qo‘ng‘iroqlar; bir qo‘ng‘iroq bir marta.',
        },
        missedNoAnswer: { title: 'Ko‘tarmagan', def: '' },
        missedRejected: { title: 'Rad etgan', def: '' },
        outbound: {
          title: 'Chiquvchi qo‘ng‘iroqlari',
          def: 'U qilgan chiquvchi qo‘ng‘iroqlar: ulanganlari va barcha urinishlar.',
        },
        outboundAttempts: { title: 'Barcha urinishlar', def: '' },
        talked: {
          title: 'Gaplashgan qo‘ng‘iroqlari',
          def: 'U gaplashgan barcha qo‘ng‘iroqlar: suhbat vaqti va o‘rtacha suhbat shular bo‘yicha.',
        },
        rated: {
          title: 'Mijoz baholagan qo‘ng‘iroqlari',
          def: 'Qo‘ng‘iroqdan keyin mijoz baho qo‘ygan va baho shu operatorga yozilgan qo‘ng‘iroqlar.',
        },
        analysed: {
          title: 'AI tahlil qilgan qo‘ng‘iroqlari',
          def: 'Joriy prompt versiyasi bo‘yicha tahlil qilingan qo‘ng‘iroqlar: AI-sifat baholari shular bo‘yicha.',
        },
        flagged: {
          title: 'Qoidabuzarlik topilgan qo‘ng‘iroqlari',
          def: 'Tahlil qilinganlardan kamida bitta qoidabuzarlik topilganlari.',
        },
        handled: {
          title: 'Hal qilingan murojaatlar',
          def: 'Tahlil qilinganlardan murojaat hal qilingan, javob berilgan yoki ticket ochilganlari.',
        },
      },
      tickets: {
        created: { title: 'Ochgan ticketlari', def: 'Shu operator davrda ochgan ticketlar.' },
        callbacks: {
          title: 'Qayta qo‘ng‘iroq qilgan ticketlari',
          def: 'Hal qilingan ticketlar bo‘yicha u davrda fuqaroga qo‘ng‘iroq qilgan ticketlar (har biri bir marta).',
        },
        closed: { title: 'Yopgan ticketlari', def: 'Fuqaro bilan gaplashib, u davrda yopgan ticketlar.' },
        closedLate: {
          title: 'Kech yopgan ticketlari',
          def: 'U yopganlardan qayta qo‘ng‘iroq muddatidan keyin yopilganlari.',
        },
      },
      executive: {
        arrived: {
          title: 'Kelib tushgan ticketlar',
          def: 'Davrda hudud navbatiga tushgan ticketlar: shu yerda ochilgan yoki boshqa hududdan yuborilgan.',
        },
        taken: {
          title: 'Olgan ticketlari',
          def: 'U davrda o‘ziga olgan ticketlar; navbatda kutish vaqti shular bo‘yicha.',
        },
        done: { title: 'Bajargan ticketlari', def: 'U davrda «bajarildi» deb yopgan ticketlar.' },
        rejected: { title: 'Rad etgan ticketlari', def: 'U davrda rad etgan ticketlar.' },
        released: { title: 'Qaytargan ticketlari', def: 'U davrda hudud navbatiga qaytargan ticketlar.' },
        forwarded: { title: 'Yuborgan ticketlari', def: 'U davrda boshqa hududga yuborgan ticketlar.' },
        late: {
          title: 'Kechikib hal qilgan ticketlari',
          def: 'U davrda muddatidan ({{sla}} ish kuni) keyin bajargan yoki rad etgan ticketlar.',
        },
        resolved: {
          title: 'Hal qilgan ticketlari',
          def: 'U davrda bajargan yoki rad etgan ticketlar: muddatida ulushi va hal qilish vaqti shular bo‘yicha.',
        },
        holding: { title: 'Hozir ishdagi ticketlari', def: 'Hozir unda turgan ticketlar (olingan yoki jarayonda).' },
        overdueNow: {
          title: 'Hozir muddati o‘tgan ticketlari',
          def: 'Hozir unda turgan va muddati ({{sla}} ish kuni) o‘tgan ticketlar.',
        },
      },
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
    details: {
      personTitle: '{{name}}: {{title}}',
      regionTitle: '{{name}} · {{region}}: {{title}}',
      callSubtitle: 'Звонки, из которых сложилось число · {{range}}',
      qualitySubtitle: 'Проанализированные звонки, из которых сложилось число · {{range}}',
      scopeWorking: 'Только звонки, начавшиеся в рабочее время.',
      scopeAll: 'Всё время: и звонки вне рабочего времени.',
      calls: {
        answered: {
          title: 'Принятые звонки',
          def: 'Входящие, где он договорил до конца (вместе с переведёнными на него), — как в «Статистике».',
        },
        missed: {
          title: 'Пропущенные звонки',
          def: 'Входящие, где его телефон звонил, но разговора не было; один раз на звонок.',
        },
        missedNoAnswer: { title: 'Не взял', def: '' },
        missedRejected: { title: 'Отклонил', def: '' },
        outbound: { title: 'Исходящие звонки', def: 'Его исходящие: соединённые и все попытки.' },
        outboundAttempts: { title: 'Все попытки', def: '' },
        talked: {
          title: 'Звонки с разговором',
          def: 'Все звонки, где он разговаривал: время разговора и средний разговор считаются по ним.',
        },
        rated: {
          title: 'Звонки с оценкой клиента',
          def: 'Звонки, после которых клиент поставил оценку и она засчитана этому оператору.',
        },
        analysed: {
          title: 'Звонки, проанализированные ИИ',
          def: 'Проанализированные звонки текущей версии промпта: оценки ИИ-качества считаются по ним.',
        },
        flagged: { title: 'Звонки с нарушениями', def: 'Проанализированные звонки хотя бы с одним нарушением.' },
        handled: {
          title: 'Обработанные обращения',
          def: 'Проанализированные звонки, где запрос решён, дан ответ или открыт тикет.',
        },
      },
      tickets: {
        created: { title: 'Созданные тикеты', def: 'Тикеты, которые оператор создал за период.' },
        callbacks: {
          title: 'Тикеты с перезвоном',
          def: 'Решённые тикеты, по которым он звонил гражданину за период (каждый тикет один раз).',
        },
        closed: { title: 'Закрытые тикеты', def: 'Тикеты, которые он закрыл после разговора с гражданином.' },
        closedLate: { title: 'Закрытые поздно', def: 'Из закрытых им — закрытые после срока перезвона.' },
      },
      executive: {
        arrived: {
          title: 'Поступившие тикеты',
          def: 'Тикеты, попавшие в очередь области за период: созданы в ней или пересланы из другой области.',
        },
        taken: { title: 'Взятые тикеты', def: 'Тикеты, взятые им за период; время ожидания в очереди — по ним.' },
        done: { title: 'Выполненные тикеты', def: 'Тикеты, закрытые им как выполненные за период.' },
        rejected: { title: 'Отклонённые тикеты', def: 'Тикеты, отклонённые им за период.' },
        released: { title: 'Возвращённые тикеты', def: 'Тикеты, возвращённые им в очередь области за период.' },
        forwarded: { title: 'Пересланные тикеты', def: 'Тикеты, пересланные им в другую область за период.' },
        late: {
          title: 'Решённые с опозданием',
          def: 'Тикеты, выполненные или отклонённые им за период позже срока ({{sla}} раб. дня).',
        },
        resolved: {
          title: 'Решённые тикеты',
          def: 'Тикеты, выполненные или отклонённые им за период: доля в срок и время решения — по ним.',
        },
        holding: { title: 'Тикеты в работе сейчас', def: 'Тикеты, которые сейчас у него (взяты или в работе).' },
        overdueNow: {
          title: 'Просроченные сейчас',
          def: 'Тикеты, которые сейчас у него и уже просрочены (срок {{sla}} раб. дня).',
        },
      },
    },
    executives: {
      title: 'Ответственные',
      subtitle:
        'По истории тикетов: кто взял, решил, вернул или переслал — с областью на тот момент. Срок — {{n}} раб. дня. Чтобы увидеть области, нажмите кнопку рядом с именем.',
    },
  },
});
