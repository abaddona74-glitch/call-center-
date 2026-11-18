import { registerTranslations } from '@/shared/i18n';

registerTranslations('uzbKeyboardGuide', {
  uz: {
    title: "Yangi O'zbek Alifbosi (2026) Klaviaturasi",
    subtitle: "Operatorlar uchun rasmiy klaviatura drayveri, o'rnatish paketi va foydalanish yo'riqnomasi",
    download: 'Paketni yuklab olish (.zip)',
    rule: "<b>Muhim qoida:</b> Yangi alifbo harflarini yozish uchun klaviaturaning <b>O'NG tomonidagi Alt (AltGr)</b> tugmasi bosiladi! Chap Alt esa Windows'da tizim menyulari va dastur qisqartmalari uchun ajratilgan. Agar klaviaturangizda o'ng Alt bo'lmasa, <b>Ctrl + chap Alt</b> kombinatsiyasi ham xuddi shunday ishlaydi.",
    cheat: {
      title: 'Tugmalar birikmasi (Cheat Sheet)',
      badge: 'Tezkor',
      rightAlt: "O'ng Alt",
      shift: 'Shift',
      copyTitle: 'Nusxa olish uchun bosing',
      copyLabel: '«{{ch}}» belgisidan nusxa olish',
    },
    playground: {
      label: "Jonli sinov maydoni (Shu yerda yozib ko'ring):",
      chars: '{{n}} belgi',
      placeholder: "Tilni UZB ga o'tkazib, O'ng Alt + s, c, g, o tugmalarini bosib yozib ko'ring...",
      quick: 'Tezkor kiritish:',
      insertLabel: '«{{ch}}» belgisini kiritish',
      copy: 'Matnni nusxalash',
    },
    toast: {
      char: '"{{ch}}" nusxalandi!',
      empty: 'Matn kiritilmagan!',
      all: 'Barcha matn nusxalandi!',
      failed: "Nusxa olib bo'lmadi",
    },
    guide: {
      title: "O'rnatish yo'riqnomasi (4 qadam)",
      badge: 'Oddiy & Tezkor',
      s1Title: 'Paketni yuklab oling va oching',
      s1Text:
        'Yuqoridagi <b>"Paketni yuklab olish (.zip)"</b> tugmasini bosing va yuklangan <code>{{file}}</code> faylini arxivdan chiqaring.',
      s2Title: "O'rnatishni ishga tushiring",
      s2Text:
        "Arxiv ichidagi <code>setup.exe</code> faylini ikki marta bosib ishga tushiring. O'rnatish avtomatik tarzda 5-10 soniya ichida yakunlanadi.",
      s3Title: 'Tizimdan chiqib qayta kiring (Sign out)',
      s3Text:
        "Windows yangi klaviatura drayverini to'liq yuklashi uchun <code>Start → Sign out</code> qiling yoki kompyuterni qayta yoqing (Restart).",
      s4Title: "Tilni UZB ga o'tkazib yozishni boshlang",
      s4Text:
        "Pastki o'ng burchakdagi til panelidan yoki <code>Win + Bo'sh joy</code> tugmalari bilan <b>UZB</b> ga o'tkazing. Klaviaturadagi <b>O'ng Alt</b> tugmasi orqali yangi harflarni yozing!",
    },
    why: {
      title: "Nega aynan O'ng Alt (AltGr)?",
      text: "Windows arxitekturasida chap <code>Alt</code> faqat menyular (masalan, Fayl, Sozlamalar) va tizim buyruqlari uchun ajratilgan. Shuning uchun barcha xalqaro standartlarda (Turkcha, Nemischa, Polsha) qo'shimcha milliy harflar aynan <b>O'ng Alt</b> ga biriktiriladi. Bu yozishda dastur qisqartmalari bilan to'qnashuv bo'lmasligini ta'minlaydi.",
    },
  },
  ru: {
    title: 'Клавиатура нового узбекского алфавита (2026)',
    subtitle: 'Официальный драйвер клавиатуры для операторов, установочный пакет и инструкция по использованию',
    download: 'Скачать пакет (.zip)',
    rule: '<b>Важное правило:</b> чтобы набирать буквы нового алфавита, нажимайте <b>ПРАВЫЙ Alt (AltGr)</b>! Левый Alt в Windows зарезервирован для системных меню и сочетаний клавиш программ. Если на клавиатуре нет правого Alt, так же работает сочетание <b>Ctrl + левый Alt</b>.',
    cheat: {
      title: 'Сочетания клавиш (шпаргалка)',
      badge: 'Быстро',
      rightAlt: 'Правый Alt',
      shift: 'Shift',
      copyTitle: 'Нажмите, чтобы скопировать',
      copyLabel: 'Скопировать символ «{{ch}}»',
    },
    playground: {
      label: 'Поле для проверки (попробуйте набрать здесь):',
      chars: 'Символов: {{n}}',
      placeholder: 'Переключите язык на UZB и наберите текст, нажимая правый Alt + s, c, g, o...',
      quick: 'Быстрая вставка:',
      insertLabel: 'Вставить символ «{{ch}}»',
      copy: 'Скопировать текст',
    },
    toast: {
      char: '«{{ch}}» скопирован!',
      empty: 'Текст не введён!',
      all: 'Весь текст скопирован!',
      failed: 'Не удалось скопировать',
    },
    guide: {
      title: 'Инструкция по установке (4 шага)',
      badge: 'Просто и быстро',
      s1Title: 'Скачайте и распакуйте пакет',
      s1Text: 'Нажмите кнопку <b>«Скачать пакет (.zip)»</b> выше и распакуйте скачанный файл <code>{{file}}</code>.',
      s2Title: 'Запустите установку',
      s2Text:
        'Дважды щёлкните файл <code>setup.exe</code> из архива. Установка завершится автоматически за 5–10 секунд.',
      s3Title: 'Выйдите из системы и войдите снова (Sign out)',
      s3Text:
        'Чтобы Windows полностью загрузила новый драйвер клавиатуры, выполните <code>Start → Sign out</code> или перезагрузите компьютер (Restart).',
      s4Title: 'Переключите язык на UZB и начинайте печатать',
      s4Text:
        'Переключите язык на <b>UZB</b> на языковой панели в правом нижнем углу или клавишами <code>Win + Пробел</code>. Новые буквы набираются с помощью <b>правого Alt</b>!',
    },
    why: {
      title: 'Почему именно правый Alt (AltGr)?',
      text: 'В Windows левый <code>Alt</code> зарезервирован только для меню (например, «Файл», «Настройки») и системных команд. Поэтому во всех международных раскладках (турецкой, немецкой, польской) дополнительные национальные буквы назначаются именно на <b>правый Alt</b>. Так набор текста не конфликтует с сочетаниями клавиш программ.',
    },
  },
});
