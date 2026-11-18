import { registerTranslations } from '@/shared/i18n';

registerTranslations('tools', {
  uz: {
    zone: {
      admin: { title: 'Adminkalar / Tizim Kabinetlari', badge: 'Boshqaruv kabinetlari' },
      primary: { title: 'Asosiy vositalar', badge: 'Tezkor va kundalik' },
      secondary: { title: 'Kerakli vositalar', badge: "Qo'shimcha va arxiv" },
    },
    empty: {
      admin: "Bu bo'limda hozircha kabinetlar yo'q",
      adminHint: "Boshqa bo'limdan kartalarni shu yerga sudrab olib kelishingiz mumkin",
      primary: "Asosiy vositalar ro'yxati bo'sh",
      primaryHint: "Quyidagi kerakli vositalardan bu yerga sudrab olib o'ting",
      secondary: "Kerakli vositalar ro'yxati bo'sh",
      secondaryHint: "Asosiy vositalardan bu yerga sudrab olib o'ting",
    },
    dragHint: 'Kartalarni sudrab joylashtiring (Drag & Drop)',
    count: '{{n}} ta vosita',
    open: 'Ochish',
    openHere: '🖥️ Shu yerda ochish',
    newWindow: 'Yangi oynada ochish ↗',
    close: 'Yopish',
    active: 'Faol',
    card: {
      edo_cabinet: {
        title: 'EDO Kabineti',
        desc: "Tashkilotlar, foydalanuvchilar va tizim ma'murlari boshqaruv kabineti.",
      },
      ehuquq_cabinet: {
        title: 'E-Huquqshunos Kabineti',
        desc: "E-Huquqshunos tizimi ma'murlari va tashkilotlar boshqaruv kabineti.",
      },
      operator_manual: {
        title: "Operator Yo'riqnomasi",
        pill: "Qo'llanma",
        desc: "Call Center operatorlari uchun odob-axloq, salomlashish standarti, qo'ng'iroqlarni qabul qilish va transfer qilish tartibi.",
      },
      systems_tree: {
        title: 'Tizimlar va Rollar Daraxti',
        pill: 'Daraxt',
        desc: 'Qaysi tizim nima uchun va kim qaysi rolda — interaktiv daraxt: tugunni bosing, rollar ochiladi.',
      },
      managers: {
        title: "Mas'ullar va E-XAT",
        desc: "Toshkent shahri, Vazirliklar, Viloyatlar va E-XAT (Unicon.uz) bo'yicha mas'ul xodimlar, ofis va telefon raqamlari ma'lumotnomasi.",
      },
      converter: {
        title: 'Universal Fayl Konvertor',
        desc: 'Hujjat va rasmlarni tezkor konvertatsiya qilish (PDF, DOCX, DOC, TXT, JPG, PNG, WEBP). Zero-storage xavfsiz tizim.',
      },
      uzcrypto: {
        title: 'Uzcrypto Dasturi',
        pill: 'Latest v{{version}}',
        desc: 'EDO.IJRO.UZ tizimi uchun ERI (E-imzo) kalitlari bilan ishlash dasturi. Yangi versiya chiqqanda avtomatik yangilanadi.',
        download: 'Yuklab olish (.zip)',
        downloadTitle: "Eng so'nggi rasmiy Windows versiyasini yuklab olish",
        welcome: 'EDO Welcome',
        welcomeTitle: 'EDO rasmiy yuklash sahifasi',
      },
      telegram: {
        title: 'Telegram Form Dashboard',
        desc: "Maʼlumot shakli va Telegram arizalarini to'ldirish hamda monitoring qilish paneli.",
        notConfigured: 'Sozlanmagan',
        notConfiguredTitle: 'Manzil sozlanmagan (TOOLS_TELEGRAM_FORM_URL) — administratorga murojaat qiling',
      },
      ijro_letter: {
        title: 'Ijro ERI Xat Generatori',
        desc: 'Ijro.uz uchun rasmiy xat va bildirishnomalarni generatsiya qilish hamda ERI biriktirish tizimi.',
      },
      uzb2026: {
        title: "Yangi O'zbek Alifbosi (2026)",
        desc: "Yangi lotin alifbosi (ş, ç, ö, ğ) klaviatura drayveri, o'rnatish paketi va foydalanish yo'riqnomasi.",
      },
    },
  },
  ru: {
    zone: {
      admin: { title: 'Кабинеты администраторов', badge: 'Панели управления' },
      primary: { title: 'Основные инструменты', badge: 'Быстрые и ежедневные' },
      secondary: { title: 'Необходимые инструменты', badge: 'Дополнительные сервисы' },
    },
    empty: {
      admin: 'В этом разделе пока нет кабинетов',
      adminHint: 'Перетащите сюда карточки из другого раздела',
      primary: 'Список основных инструментов пуст',
      primaryHint: 'Перетащите сюда карточки из необходимых инструментов ниже',
      secondary: 'Список необходимых инструментов пуст',
      secondaryHint: 'Перетащите сюда карточки из основных инструментов',
    },
    dragHint: 'Перетаскивайте карточки (Drag & Drop)',
    count: 'Инструментов: {{n}}',
    open: 'Открыть',
    openHere: '🖥️ Открыть здесь',
    newWindow: 'Открыть в новом окне ↗',
    close: 'Закрыть',
    active: 'Активен',
    card: {
      edo_cabinet: {
        title: 'Кабинет ЭДО',
        desc: 'Кабинет управления организациями, пользователями и администраторами системы.',
      },
      ehuquq_cabinet: {
        title: 'Кабинет E-Huquqshunos',
        desc: 'Кабинет администраторов системы и организаций E-Huquqshunos.',
      },
      operator_manual: {
        title: 'Руководство оператора',
        pill: 'Руководство',
        desc: 'Этика, стандарт приветствия, порядок приёма и перевода звонков для операторов call-центра.',
      },
      systems_tree: {
        title: 'Дерево систем и ролей',
        pill: 'Дерево',
        desc: 'Какая система для чего и кто в какой роли — интерактивное дерево: нажмите на узел, чтобы раскрыть роли.',
      },
      managers: {
        title: 'Ответственные и E-XAT',
        desc: 'Справочник ответственных сотрудников, офисных и контактных телефонов по г. Ташкенту, министерствам, областям и E-XAT (Unicon.uz).',
      },
      converter: {
        title: 'Универсальный конвертер файлов',
        desc: 'Быстрая конвертация документов и изображений (PDF, DOCX, DOC, TXT, JPG, PNG, WEBP). Безопасно, файлы не хранятся.',
      },
      uzcrypto: {
        title: 'Программа Uzcrypto',
        pill: 'Latest v{{version}}',
        desc: 'Программа для работы с ключами ЭЦП (E-imzo) в системе EDO.IJRO.UZ. При выходе новой версии ссылка обновляется автоматически.',
        download: 'Скачать (.zip)',
        downloadTitle: 'Скачать последнюю официальную версию для Windows',
        welcome: 'EDO Welcome',
        welcomeTitle: 'Официальная страница загрузки EDO',
      },
      telegram: {
        title: 'Telegram Form Dashboard',
        desc: 'Панель для заполнения форм данных и заявок Telegram и мониторинга.',
        notConfigured: 'Не настроено',
        notConfiguredTitle: 'Адрес не настроен (TOOLS_TELEGRAM_FORM_URL) — обратитесь к администратору',
      },
      ijro_letter: {
        title: 'Генератор писем Ijro (ЭЦП)',
        desc: 'Генерация официальных писем и уведомлений для Ijro.uz с подписью ЭЦП.',
      },
      uzb2026: {
        title: 'Новый узбекский алфавит (2026)',
        desc: 'Драйвер раскладки нового латинского алфавита (ş, ç, ö, ğ), инсталлятор и инструкция.',
      },
    },
  },
});
