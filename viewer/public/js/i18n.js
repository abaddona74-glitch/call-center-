/**
 * Call Center Multi-Language (i18n) Engine for Viewer
 * Supported languages: 'uz' (default - O'zbekcha), 'ru' (Русский)
 */

const I18N_TRANSLATIONS = {
    uz: {
        app_title: "Call Center",
        server_status: "Server Holati",
        server_status_title: "Server Resurslari",
        tab_dashboard: "Dashboard",
        tab_operators: "Operatorlar",
        tab_history: "Qo'ng'iroqlar Tarixi",
        tab_explorer: "Audio Explorer",
        live_monitor: "Jonli Monitor",
        live_clock_title: "Hozirgi aniq vaqt",
        header_client_directory: "Mijozlar bazasi",

        op_section_title: "Operatorlar",
        op_group_main: "Asosiy (100-199)",
        op_group_main_title: "100 dan 199 gacha bo'lgan asosiy operatorlar",
        op_group_sec: "Zangiota 42 (200+)",
        op_group_sec_title: "Zangiota 42 operatorlari (200+)",
        op_group_all: "Barchasi",
        op_group_all_title: "Barcha operatorlar",
        op_status_ready: "Qabul qilishga tayyor",
        op_status_talking: "Suhbatda",
        op_status_paused: "Pauzada",
        op_status_offline: "Oflayn",
        op_status_ringing: "Jiringlamoqda",
        op_status_agent_online: "Agent ulangan",
        op_badge_next: "NAVBATDAGI",
        op_badge_top1: "TOP 1",
        op_calls_accepted: "Qabul qildi",
        op_outbound_short: "Chiquvchi",
        op_denied_short: "Rad etildi",
        op_total_time: "Umumiy",
        op_avg_time: "O'rtacha",
        op_no_operators: "Hozircha operatorlar mavjud emas.",

        viewer_callback_title: "Bog'lanishi kerak bo'lgan mijozlar",
        viewer_callback_hint: "* Navbatdan chiqqan yoki ishdan tashqari vaqtda qo'ng'iroq qilgan mijozlar",
        filter_today: "Bugun",
        filter_all: "Hammasi",
        tab_callbacks_pending: "Kutilmoqda (Yangi)",
        tab_callbacks_unreachable: "Bog'lanib bo'lmadi",
        tab_callbacks_resolved: "Gaplashildi",
        viewer_callback_pending_hint: "* Hali operatorlar bog'lanmagan yangi mijozlar (Eng yangilari #1 dan boshlanadi)",
        viewer_callback_unreachable_hint: "* Operator qo'ng'iroq qilgan, ammo mijoz go'shakni ko'tarmagan",
        viewer_callback_resolved_hint: "* Operatorlar gaplashib bo'lgan mijozlar",
        cb_order_newest: "#1 Eng yangi",
        time_just_now: "hozirgina",
        time_min_ago: "daq oldin",
        time_hour_ago: "soat oldin",
        time_day_ago: "kun oldin",
        live_callbacks_empty: "Hozircha bog'lanishi kerak bo'lgan mijozlar yo'q",
        live_callbacks_pending_empty: "Hozircha kutilayotgan yangi mijozlar yo'q",
        live_callbacks_unreachable_empty: "Bog'lanib bo'lmagan mijozlar yo'q",
        live_callbacks_resolved_empty: "Hozircha gaplashilgan mijozlar yo'q",
        callback_source_ivr: "Ish vaqti emas",
        callback_source_abandoned: "Navbatdan chiqdi",

        status_answered: "Javob berilgan",
        status_accepted: "Qabul qilingan",
        status_abandoned: "Navbatdan chiqdi",
        status_busy: "Band",
        status_denied: "Rad etilgan",
        status_missed: "O'tkazib yuborilgan",
        status_no_answer: "Javobsiz",
        status_ready: "Qabul qilishga tayyor",
        status_talking: "Hozir suhbatda",
        status_paused: "Pauzada",
        status_offline: "Offline",

        dir_inbound: "Kiruvchi",
        dir_outbound: "Chiquvchi",
        dir_transfer: "Transfer",

        party_client: "Mijoz",
        party_operator: "Operator",
        party_not_answered: "Ko'tarilmadi",
        party_busy: "Band",
        party_no_answer: "Javobsiz",
        party_transfer: "Transfer (Operatorga)",
        party_unknown: "Noma'lum",
        op_not_connected: "Operatorga ulanmadi",
        unit_item: "ta",
        unit_pcs: "ta",

        col_num: "№",
        col_time: "VAQT",
        col_client_phone: "MIJOZ RAQAMI",
        col_direction: "YO'NALISH",
        col_operator: "OPERATOR",
        col_talk_wait: "SUHBAT / KUTISH VAQTI",
        col_wait_only: "KUTISH VAQTI",
        col_talk_only: "SUHBAT VAQTI",
        col_status: "HOLATI",
        col_hangup_party: "KIM TUGATDI?",
        col_audio: "AUDIO",

        detail_search: "Qidirish:",
        detail_search_placeholder: "Raqam yoki operator...",
        detail_per_page: "Sahifada:",
        detail_loading: "Ma'lumotlar yuklanmoqda...",
        detail_empty: "Ushbu parametrlar bo'yicha qo'ng'iroqlar topilmadi",
        detail_total_calls: "Jami: {total} ta qo'ng'iroq (Ko'rsatilmoqda: {count} ta)",
        detail_today_subtitle: "Bugungi kun bo'yicha saralangan qo'ng'iroqlar tafsiloti",

        online_active: "Saytda faol:",
        online_active_title: "Hozirgi vaqtda sahifani ochib turgan foydalanuvchilar",
        viewer_watching: "Kuzatilmoqda...",
        tools_title: "Asboblar",
        tools_badge: "Qo'shimcha vositalar",
        tool_status_active: "Faol",
        tool_tg_desc: "Maʼlumot shakli va Telegram arizalarini to'ldirish hamda monitoring qilish paneli.",
        tool_regions_title: "Viloyat mas'ullari",
        tool_regions_desc: "Viloyatlar bo'yicha mas'ul rahbarlar, ofis va telefon raqamlari jadvali.",
        tool_tashkent_title: "Toshkent shahar mas'ullari",
        tool_tashkent_desc: "Toshkent shahridagi tumanlarga biriktirilgan mas'ul xodimlar ro'yxati va telefon raqamlari.",
        tool_ministry_title: "Vazirlik mas'ullari",
        tool_ministry_desc: "Vazirliklarga biriktirilgan mas'ul xodimlar ro'yxati va telefon raqamlari.",
        tool_open: "Ochish",
        tool_open_here: "🖥️ Shu yerda ochish",
        tool_open_new_window: "Yangi oynada ochish ↗",
        tool_zoom_in: "🔍 Kattalashtirish",
        tool_zoom_out: "🔍 Kichraytirish",
        detail_modal_title: "Operator Tafsilotlari",
        detail_modal_subtitle: "Operatorning kunlik faolligi va intizomi",
        detail_op_title: "{name} — Tafsilotlar & Bugungi Suhbatlar",
        detail_subtitle_op_activity: "Operatorning kunlik faolligi va intizomi",
        detail_filter_total: "Jami: {total} ta qo'ng'iroq (Filtr: {count} ta)",
        detail_total_calls: "Jami: {total} ta qo'ng'iroq (Ko'rsatilmoqda: {count} ta)",
        detail_loading_full: "Ma'lumotlar yuklanmoqda...",
        detail_load_failed: "Yuklashda xatolik yuz berdi: {msg}",
        op_card_desktop_agent: "Desktop Agent:",
        op_card_desktop_name: "Desktop nomi:",
        op_card_unknown_host: "Aniqlanmagan",
        op_card_accepted: "Qabul qilingan:",
        op_card_outbound: "Chiquvchi:",
        op_card_transfer: "Transfer:",
        op_card_transfer_gave: "uzatgan",
        op_card_transfer_got: "olgan",
        op_card_missed: "O'tkazib yuborilgan:",
        op_card_total_talk: "Umumiy suhbat:",
        op_card_avg_talk: "O'rtacha suhbat:",
        op_card_agent_active: "Faol",
        op_card_agent_off: "O'chiq",
        op_card_exten: "Exten:",
        op_sum_answered: "Qabul qilingan",
        op_sum_internal: "Ichki raqam:",
        op_sum_line_status: "Liniya holati:",
        status_ringing: "Jiringlamoqda",
        wait_status: "Kutmoqda",
        op_mvp_system: "Operator darajasi tizimi",
        op_mvp_accepted_suffix: "ta jami qo'ng'iroq",
        op_diamond_title: "1-o'rin sohibi (Olmos MVP / Diamond Crown)",
        op_mvp_title: "1-o'rin sohibi (Olmos MVP / Diamond Crown)",
        op_gold_title: "2-o'rin sohibi (Oltin toj / Gold Crown)",
        op_silver_title: "3-o'rin sohibi (Kumush toj / Silver Crown)",
        op_bronze_title: "3-o'rin sohibi (Kumush toj / Silver Crown)",
        op_npc_badge: "🤖 NPC",
        op_npc_title: "1 ta yulduzli operator",
        next_call_ringing_title: "🎯 Qo'ng'iroq tushdi! (Jiringlamoqda)",
        next_call_waiting_title: "🎯 100% Keyingi qo'ng'iroq kutilmoqda (Fewest calls navbatida #1)",
        op_v2_calls_handled: "Jami qo'ng'iroq",
        op_v2_avg_talk: "O'rtacha vaqt",
        op_v2_score: "Samaradorlik",
        op_v2_csat_score: "Samaradorlik / Reyting ko'rsatkichi",
        op_card_click_detail: "{name} tafsilotlarini ko'rish uchun bosing",
        star_next_note: "Keyingi yulduzgacha: yana {n} ta qo'ng'iroq kerak",
        star_max: "🏆 Maksimal daraja (TOP operator)!",
        star_level_5: "Super Elita",
        star_level_4: "Yetakchi",
        star_level_3: "Tajribali",
        star_level_2: "O'rta daraja",
        star_level_1: "Boshlang'ich",
        filter_click_title: "Filtrlash uchun bosing",
        opt_50: "50 ta", opt_100: "100 ta", opt_200: "200 ta",
        talking_timer_title: "Hozirgi suhbat davomiyligi",
        ext_title: "Call Center — Operatorlar",
        chart_suffix_calls: "ta",

        talk_prefix: "Suhbat:",
        wait_prefix: "Kutgan:",
        audio_listen: "Tinglash",
        audio_not_available: "Mavjud emas",
        audio_download: "Yuklab olish",

        // Production Deploy & Auto-refresh Banner
        deploy_banner_title: "🚀 Tizim muvaffaqiyatli yangilandi! (Yangi versiya)",
        deploy_banner_countdown: "Sahifa {sec} soniyada avtomatik yangilanadi...",
        deploy_banner_paused: "Avtomatik yangilanish to'xtatildi. Iltimos, ish tugagach sahifani yangilang.",
        btn_deploy_reload: "Hozir yangilash",
        btn_deploy_cancel: "To'xtatish"
    },
    ru: {
        app_title: "Call Center",
        server_status: "Статус сервера",
        server_status_title: "Ресурсы сервера",
        tab_dashboard: "Дашборд",
        tab_operators: "Операторы",
        tab_history: "История звонков",
        tab_explorer: "Аудио записи",
        live_monitor: "Прямой эфир",
        live_clock_title: "Текущее точное время",
        header_client_directory: "База клиентов",

        op_section_title: "Операторы",
        op_group_main: "Основные (100-199)",
        op_group_main_title: "Основные операторы с 100 по 199",
        op_group_sec: "Зангиота 42 (200+)",
        op_group_sec_title: "Операторы Зангиота 42 (200+)",
        op_group_all: "Все",
        op_group_all_title: "Все операторы",
        op_status_ready: "Готов к приему",
        op_status_talking: "В разговоре",
        op_status_paused: "На паузе",
        op_status_offline: "Офлайн",
        op_status_ringing: "Звонит",
        op_status_agent_online: "Агент активен",
        op_badge_next: "СЛЕДУЮЩИЙ",
        op_badge_top1: "ТОП 1",
        op_calls_accepted: "Принято",
        op_outbound_short: "Исходящие",
        op_denied_short: "Отклонено",
        op_total_time: "Всего",
        op_avg_time: "Среднее",
        op_no_operators: "На данный момент операторы отсутствуют.",

        status_answered: "Отвечен",
        status_accepted: "Принят",
        status_abandoned: "Вышел из очереди",
        status_busy: "Занято",
        status_denied: "Отклонен",
        status_missed: "Пропущенный",
        status_no_answer: "Без ответа",
        status_ready: "Готов к приему",
        status_talking: "Сейчас на линии",
        status_paused: "На паузе",
        status_offline: "Офлайн",

        dir_inbound: "Входящий",
        dir_outbound: "Исходящий",
        dir_transfer: "Перевод",

        party_client: "Клиент",
        party_operator: "Оператор",
        party_not_answered: "Не отвечен",
        party_transfer: "Перевод (Оператору)",

        col_num: "№",
        col_time: "ВРЕМЯ",
        col_client_phone: "НОМЕР КЛИЕНТА",
        col_direction: "НАПРАВЛЕНИЕ",
        col_operator: "ОПЕРАТОР",
        col_talk_wait: "РАЗГОВОР / ОЖИДАНИЕ",
        col_wait_only: "ВРЕМЯ ОЖИДАНИЯ",
        col_talk_only: "ВРЕМЯ РАЗГОВОРА",
        col_status: "СТАТУС",
        col_hangup_party: "КТО ЗАВЕРШИЛ?",
        col_audio: "АУДИО",

        detail_search: "Поиск:",
        detail_search_placeholder: "Номер или оператор...",
        detail_per_page: "На странице:",
        detail_loading: "Загрузка данных...",
        detail_empty: "По данным параметрам звонков не найдено",
        detail_total_calls: "Всего: {total} звонков (Отображается: {count})",
        detail_today_subtitle: "Подробный список звонков за сегодняшний день",

        online_active: "Активны на сайте:",
        online_active_title: "Пользователи, открывшие страницу прямо сейчас",
        viewer_watching: "Наблюдение...",
        tools_title: "Инструменты",
        tools_badge: "Дополнительные инструменты",
        tool_status_active: "Активен",
        tool_tg_desc: "Панель для заполнения форм данных и заявок Telegram и мониторинга.",
        tool_open: "Открыть",
        tool_open_here: "🖥️ Открыть здесь",
        tool_open_new_window: "Открыть в новом окне ↗",
        viewer_callback_title: "Клиенты, требующие связи",
        viewer_callback_hint: "* Клиенты, вышедшие из очереди или звонившие в нерабочее время",
        filter_today: "Сегодня",
        filter_all: "Все",
        tab_callbacks_pending: "Ожидают (Новые)",
        tab_callbacks_unreachable: "Не дозвонились",
        tab_callbacks_resolved: "Разговор состоялся",
        viewer_callback_pending_hint: "* Новые клиенты, которым еще не звонили (Самые новые начинаются с #1)",
        viewer_callback_unreachable_hint: "* Оператор звонил, но клиент не ответил",
        viewer_callback_resolved_hint: "* Клиенты, с которыми операторы успешно поговорили",
        cb_order_newest: "#1 Самый новый",
        time_just_now: "только что",
        time_min_ago: "мин назад",
        time_hour_ago: "ч назад",
        time_day_ago: "дн назад",
        live_callbacks_empty: "Нет клиентов, требующих связи",
        live_callbacks_pending_empty: "Нет ожидающих новых клиентов",
        live_callbacks_unreachable_empty: "Нет недозвоненных клиентов",
        live_callbacks_resolved_empty: "Пока нет клиентов, с которыми связались",
        callback_source_ivr: "Нерабочее время",
        callback_source_abandoned: "Вышел из очереди",
        detail_modal_title: "Детали оператора",
        detail_modal_subtitle: "Ежедневная активность и дисциплина оператора",
        detail_op_title: "{name} — Детали и сегодняшние разговоры",
        detail_subtitle_op_activity: "Ежедневная активность и дисциплина оператора",
        detail_filter_total: "Всего: {total} звонков (Фильтр: {count})",
        detail_total_calls: "Всего: {total} звонков (Отображается: {count})",
        detail_loading_full: "Загрузка данных...",
        detail_load_failed: "Ошибка загрузки: {msg}",
        op_card_desktop_agent: "Desktop Agent:",
        op_card_desktop_name: "Имя компьютера:",
        op_card_unknown_host: "Не определено",
        op_card_accepted: "Принято:",
        op_card_outbound: "Исходящие:",
        op_card_transfer: "Перевод:",
        op_card_transfer_gave: "отдал",
        op_card_transfer_got: "получил",
        op_card_missed: "Пропущено:",
        op_card_total_talk: "Всего разговоров:",
        op_card_avg_talk: "Среднее время:",
        op_card_agent_active: "Активен",
        op_card_agent_off: "Не активен",
        op_card_exten: "Exten:",
        op_sum_answered: "Принятые",
        op_sum_internal: "Внутренний номер:",
        op_sum_line_status: "Статус линии:",
        status_ringing: "Звонит",
        wait_status: "Ожидает",
        op_mvp_system: "Система уровней операторов",
        op_mvp_accepted_suffix: "всего звонков",
        op_diamond_title: "Обладатель 1-го места (Алмазный MVP / Diamond Crown)",
        op_mvp_title: "Обладатель 1-го места (Алмазный MVP / Diamond Crown)",
        op_gold_title: "Обладатель 2-го места (Золотая корона / Gold Crown)",
        op_silver_title: "Обладатель 3-го места (Серебряная корона / Silver Crown)",
        op_bronze_title: "Обладатель 3-го места (Серебряная корона / Silver Crown)",
        op_npc_badge: "🤖 NPC",
        op_npc_title: "Оператор с 1 звездой",
        next_call_ringing_title: "🎯 Звонок поступил! (Звонит)",
        next_call_waiting_title: "🎯 Ожидается 100% следующий звонок (№1 в очереди Fewest calls)",
        op_v2_calls_handled: "Всего звонков",
        op_v2_avg_talk: "Ср. время",
        op_v2_score: "Эффективность",
        op_v2_csat_score: "Эффективность / Рейтинг",
        op_card_click_detail: "Нажмите, чтобы открыть детали {name}",
        star_next_note: "До следующей звезды осталось {n} звонков",
        star_max: "🏆 Максимальный уровень (TOP-оператор)!",
        star_level_5: "Супер Элита",
        star_level_4: "Лидер",
        star_level_3: "Опытный",
        star_level_2: "Средний уровень",
        star_level_1: "Начинающий",
        filter_click_title: "Нажмите для фильтрации",
        opt_50: "50", opt_100: "100", opt_200: "200",
        talking_timer_title: "Длительность текущего разговора",
        ext_title: "Call Center — Операторы",
        chart_suffix_calls: "шт",

        talk_prefix: "Разговор:",
        wait_prefix: "Ожидание:",
        audio_listen: "Слушать",
        audio_not_available: "Нет записи",
        audio_download: "Скачать",

        party_client: "Клиент",
        party_operator: "Оператор",
        party_not_answered: "Не отвечен",
        party_busy: "Занято",
        party_no_answer: "Без ответа",
        party_transfer: "Перевод (Оператору)",
        party_unknown: "Неизвестно",
        op_not_connected: "Не соединен с оператором",
        unit_item: "шт.",
        unit_pcs: "шт.",

        // Production Deploy & Auto-refresh Banner
        deploy_banner_title: "🚀 Система успешно обновлена! (Новая версия)",
        deploy_banner_countdown: "Страница обновится автоматически через {sec} сек...",
        deploy_banner_paused: "Автообновление приостановлено. Пожалуйста, обновите страницу после завершения.",
        btn_deploy_reload: "Обновить сейчас",
        btn_deploy_cancel: "Остановить",

        tools_title: "Инструменты",
        tools_badge: "Дополнительные сервисы",
        tool_status_active: "Активен",
        tool_tg_desc: "Форма данных и панель мониторинга/заполнения заявок Telegram.",
        tool_regions_title: "Ответственные по областям",
        tool_regions_desc: "Таблица ответственных руководителей, офисных и контактных номеров по регионам.",
        tool_tashkent_title: "Ответственные по г. Ташкент",
        tool_tashkent_desc: "Список ответственных сотрудников и контактных телефонов по районам г. Ташкента.",
        tool_ministry_title: "Ответственные по министерствам",
        tool_ministry_desc: "Список ответственных сотрудников и контактов, прикрепленных к министерствам.",
        tool_open: "Открыть",
        tool_open_here: "🖥️ Открыть здесь",
        tool_open_new_window: "Открыть в новом окне ↗",
        tool_zoom_in: "🔍 Увеличить",
        tool_zoom_out: "🔍 Уменьшить"
    }
};

let currentLang = 'uz';

function initI18n() {
    try {
        const saved = localStorage.getItem('callcenter_lang');
        if (saved && (saved === 'uz' || saved === 'ru')) {
            currentLang = saved;
        } else {
            currentLang = 'uz';
        }
    } catch (e) {
        currentLang = 'uz';
    }
    applyTranslations();
}

function getCurrentLang() {
    return currentLang;
}

function t(key, fallback = '') {
    const dict = I18N_TRANSLATIONS[currentLang] || I18N_TRANSLATIONS.uz;
    if (dict && dict[key] !== undefined) {
        return dict[key];
    }
    const defDict = I18N_TRANSLATIONS.uz;
    if (defDict && defDict[key] !== undefined) {
        return defDict[key];
    }
    return fallback || key;
}

/**
 * Translate with placeholder substitution, e.g. tf('detail_op_title', { name: 'Ali' })
 */
function tf(key, params, fallback = '') {
    let str = t(key, fallback);
    if (params && typeof params === 'object') {
        Object.keys(params).forEach(k => {
            str = str.split('{' + k + '}').join(params[k]);
        });
    }
    return str;
}

function switchLanguage(lang) {
    if (lang !== 'uz' && lang !== 'ru') return;
    currentLang = lang;
    try {
        localStorage.setItem('callcenter_lang', lang);
    } catch (e) {}

    applyTranslations();
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

function applyTranslations() {
    document.documentElement.setAttribute('lang', currentLang);

    document.querySelectorAll('.lang-btn').forEach(btn => {
        if (btn.getAttribute('data-lang') === currentLang) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = t(key);
        if (text) {
            if (el.getAttribute('data-i18n-html') === 'true') {
                el.innerHTML = text;
            } else {
                el.textContent = text;
            }
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const text = t(key);
        if (text) el.placeholder = text;
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const text = t(key);
        if (text) el.title = text;
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
} else {
    initI18n();
}
