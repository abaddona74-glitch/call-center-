/**
 * Blacklist (Qora ro'yxat) boshqaruv moduli
 * Maxmudbek (114) operatori orqali parolli (@Abaddon2004) kirish
 */

(function () {
    const AUTH_KEY = 'cc_blacklist_auth';
    const EXPECTED_PASSWORD = '@Abaddon2004';
    let blacklistData = [];
    let isSubmitting = false;

    // 1. DOM yuklangandan so'ng modallarni va uslublarni initsializatsiya qilish
    function initBlacklistUI() {
        if (document.getElementById('blacklistAuthModal')) return;

        injectStyles();
        injectModals();
        bindGlobalKeys();
    }

    // 2. CSS uslublarini sahifaga qo'shish
    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'blacklistStyles';
        style.textContent = `
            /* Maxmudbek clickable avatar & name */
            .maxmudbek-clickable {
                cursor: pointer !important;
                position: relative;
                transition: transform 0.2s ease, filter 0.2s ease;
            }
            .maxmudbek-clickable:hover {
                filter: brightness(1.2);
            }
            .maxmudbek-name-clickable {
                cursor: pointer !important;
                text-decoration: underline dotted rgba(239, 68, 68, 0.4);
                text-underline-offset: 3px;
                transition: color 0.2s ease;
            }
            .maxmudbek-name-clickable:hover {
                color: #f87171 !important;
            }

            /* Blacklist Modal Backdrops */
            .bl-backdrop {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(4, 8, 18, 0.85);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                z-index: 10000;
                align-items: center;
                justify-content: center;
                padding: 16px;
                animation: blFadeIn 0.2s ease-out;
            }
            .bl-backdrop.active {
                display: flex !important;
            }

            @keyframes blFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes blSlideUp {
                from { transform: translateY(20px) scale(0.98); opacity: 0; }
                to { transform: translateY(0) scale(1); opacity: 1; }
            }
            @keyframes blShake {
                0%, 100% { transform: translateX(0); }
                20%, 60% { transform: translateX(-8px); }
                40%, 80% { transform: translateX(8px); }
            }

            /* Auth Box */
            .bl-auth-box {
                background: linear-gradient(145deg, #111827 0%, #0f172a 100%);
                border: 1px solid rgba(239, 68, 68, 0.35);
                box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 40px rgba(239, 68, 68, 0.15);
                border-radius: 16px;
                width: 100%;
                max-width: 420px;
                padding: 28px 24px;
                animation: blSlideUp 0.25s ease-out;
                position: relative;
            }
            .bl-auth-box.shake {
                animation: blShake 0.4s ease-in-out;
            }
            .bl-auth-icon-wrap {
                width: 56px;
                height: 56px;
                border-radius: 14px;
                background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(244, 63, 94, 0.1));
                border: 1px solid rgba(239, 68, 68, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 26px;
                margin: 0 auto 16px auto;
                color: #ef4444;
            }
            .bl-auth-title {
                text-align: center;
                color: #fff;
                font-size: 19px;
                font-weight: 700;
                margin: 0 0 6px 0;
            }
            .bl-auth-desc {
                text-align: center;
                color: #94a3b8;
                font-size: 13px;
                margin: 0 0 20px 0;
                line-height: 1.4;
            }
            .bl-input-wrap {
                position: relative;
                margin-bottom: 12px;
            }
            .bl-input-field {
                width: 100%;
                background: rgba(15, 23, 42, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                color: #fff;
                padding: 12px 42px 12px 14px;
                font-size: 14px;
                outline: none;
                box-sizing: border-box;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            .bl-input-field:focus {
                border-color: #ef4444;
                box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
            }
            .bl-eye-btn {
                position: absolute;
                right: 12px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
            }
            .bl-eye-btn:hover {
                color: #fff;
            }
            .bl-auth-error {
                display: none;
                color: #f87171;
                font-size: 12px;
                margin-bottom: 14px;
                text-align: center;
                font-weight: 600;
            }

            /* Manager Dialog */
            .bl-manager-box {
                background: #0b1120;
                border: 1px solid rgba(239, 68, 68, 0.3);
                box-shadow: 0 30px 80px rgba(0, 0, 0, 0.9), 0 0 50px rgba(239, 68, 68, 0.1);
                border-radius: 16px;
                width: 100%;
                max-width: 880px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: blSlideUp 0.25s ease-out;
            }
            .bl-header {
                padding: 16px 20px;
                background: linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(15, 23, 42, 0.8) 100%);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .bl-header-left {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .bl-header-icon {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
            }
            .bl-header-title {
                margin: 0;
                color: #fff;
                font-size: 17px;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .bl-header-sub {
                margin: 2px 0 0 0;
                color: #94a3b8;
                font-size: 12px;
            }
            .bl-count-badge {
                background: rgba(239, 68, 68, 0.2);
                border: 1px solid rgba(239, 68, 68, 0.4);
                color: #fca5a5;
                font-size: 11px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 20px;
            }
            .bl-btn-close {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #cbd5e1;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 15px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            .bl-btn-close:hover {
                background: rgba(239, 68, 68, 0.2);
                color: #fff;
                border-color: #ef4444;
            }

            /* Add Form Panel */
            .bl-add-panel {
                padding: 16px 20px;
                background: rgba(15, 23, 42, 0.7);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }
            .bl-add-title {
                font-size: 13px;
                font-weight: 700;
                color: #cbd5e1;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .bl-add-grid {
                display: grid;
                grid-template-columns: 1.5fr 2fr auto;
                gap: 10px;
                align-items: center;
            }
            @media (max-width: 680px) {
                .bl-add-grid {
                    grid-template-columns: 1fr;
                }
            }
            .bl-btn-primary {
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                border: 1px solid #f87171;
                color: #fff;
                font-weight: 700;
                padding: 10px 18px;
                border-radius: 10px;
                font-size: 13px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.2s;
                white-space: nowrap;
                box-shadow: 0 4px 14px rgba(239, 68, 68, 0.3);
            }
            .bl-btn-primary:hover {
                background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
                transform: translateY(-1px);
                box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4);
            }
            .bl-btn-secondary {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #cbd5e1;
                font-weight: 600;
                padding: 10px 16px;
                border-radius: 10px;
                font-size: 13px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
            }
            .bl-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.15);
                color: #fff;
            }

            .bl-quick-chips {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 8px;
                flex-wrap: wrap;
            }
            .bl-chip-label {
                font-size: 11px;
                color: #64748b;
            }
            .bl-chip {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #94a3b8;
                font-size: 11px;
                padding: 2px 8px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s;
            }
            .bl-chip:hover {
                background: rgba(239, 68, 68, 0.15);
                border-color: rgba(239, 68, 68, 0.3);
                color: #fca5a5;
            }

            /* Filter Bar */
            .bl-filter-bar {
                padding: 10px 20px;
                background: rgba(11, 17, 32, 0.6);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .bl-search-input {
                flex: 1;
                max-width: 320px;
                background: rgba(15, 23, 42, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #fff;
                padding: 7px 12px;
                font-size: 12px;
                outline: none;
            }
            .bl-search-input:focus {
                border-color: #ef4444;
            }

            /* Table Container */
            .bl-table-container {
                flex: 1;
                overflow-y: auto;
                padding: 0;
            }
            .bl-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
                text-align: left;
            }
            .bl-table th {
                background: rgba(15, 23, 42, 0.95);
                position: sticky;
                top: 0;
                z-index: 2;
                padding: 10px 16px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #94a3b8;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .bl-table td {
                padding: 12px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.04);
                color: #e2e8f0;
                vertical-align: middle;
            }
            .bl-table tr:hover td {
                background: rgba(239, 68, 68, 0.04);
            }
            .bl-phone-pill {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-weight: 700;
                color: #fca5a5;
                font-size: 13px;
            }
            .bl-tag-blocked {
                background: rgba(239, 68, 68, 0.15);
                border: 1px solid rgba(239, 68, 68, 0.3);
                color: #f87171;
                font-size: 11px;
                font-weight: 600;
                padding: 2px 7px;
                border-radius: 4px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .bl-tag-blocked::before {
                content: '';
                display: inline-block;
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #ef4444;
            }
            .bl-note-badge {
                color: #cbd5e1;
                font-size: 12px;
                max-width: 260px;
                word-break: break-word;
            }
            .bl-note-empty {
                color: #64748b;
                font-style: italic;
                font-size: 12px;
            }
            .bl-time {
                color: #94a3b8;
                font-size: 11px;
                white-space: nowrap;
            }
            .bl-btn-del {
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.25);
                color: #fca5a5;
                padding: 5px 10px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.15s;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .bl-btn-del:hover {
                background: #ef4444;
                color: #fff;
                border-color: #ef4444;
                box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
            }

            .bl-empty-state {
                padding: 40px 20px;
                text-align: center;
                color: #64748b;
            }
            .bl-empty-icon {
                font-size: 38px;
                margin-bottom: 10px;
                opacity: 0.7;
            }

            /* Toast Notification */
            .bl-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                background: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.15);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
                border-radius: 10px;
                padding: 12px 18px;
                color: #fff;
                font-size: 13px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
                z-index: 20000;
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.25s ease-out;
                pointer-events: none;
            }
            .bl-toast.show {
                opacity: 1;
                transform: translateY(0);
            }
            .bl-toast.success {
                border-color: #10b981;
                background: linear-gradient(135deg, #064e3b 0%, #0f172a 100%);
            }
            .bl-toast.error {
                border-color: #ef4444;
                background: linear-gradient(135deg, #7f1d1d 0%, #0f172a 100%);
            }
            .bl-toast.info {
                border-color: #38bdf8;
                background: linear-gradient(135deg, #075985 0%, #0f172a 100%);
            }
        `;
        document.head.appendChild(style);
    }

    // 3. HTML modallarni DOM ga qo'shish
    function injectModals() {
        const wrapper = document.createElement('div');
        wrapper.id = 'blacklistModalsRoot';
        wrapper.innerHTML = `
            <!-- 1. PAROL MODAL -->
            <div id="blacklistAuthModal" class="bl-backdrop">
                <div class="bl-auth-box" id="blAuthBox">
                    <button class="bl-btn-close" onclick="closeBlacklistAuthModal()" style="position: absolute; top: 16px; right: 16px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M18 6L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M6 6L18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></button>
                    <div class="bl-auth-icon-wrap">🛡️</div>
                    <h3 class="bl-auth-title">Xavfsizlik tekshiruvi</h3>
                    <p class="bl-auth-desc">Qora ro'yxat (Blacklist) sozlamalariga kirish uchun parolni kiriting</p>

                    <div class="bl-input-wrap">
                        <input type="password" id="blAuthInput" class="bl-input-field" placeholder="Parolni kiriting..." autocomplete="off">
                        <button type="button" class="bl-eye-btn" onclick="toggleAuthPasswordVisibility()" title="Parolni ko'rsatish/yashirish">👁️</button>
                    </div>

                    <div id="blAuthError" class="bl-auth-error">Noto'g'ri parol kiritildi! Qaytadan urinib ko'ring.</div>

                    <div style="display: flex; gap: 10px; margin-top: 16px;">
                        <button type="button" class="bl-btn-secondary" style="flex: 1;" onclick="closeBlacklistAuthModal()">Bekor qilish</button>
                        <button type="button" class="bl-btn-primary" style="flex: 1;" onclick="submitBlacklistAuth()">Kirish 🔓</button>
                    </div>
                </div>
            </div>

            <!-- 2. BLACKLIST BOSHQARUV MODALI -->
            <div id="blacklistManagerModal" class="bl-backdrop">
                <div class="bl-manager-box">
                    <!-- Modal Header -->
                    <div class="bl-header">
                        <div class="bl-header-left">
                            <div class="bl-header-icon"><svg style="width: 24px; height: 24px; color: #f87171;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.17 14.83L14.83 9.17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14.83 14.83L9.17 9.17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></div>
                            <div>
                                <h3 class="bl-header-title">
                                    Qora ro'yxat (Maxmudbek uchun)
                                    <span id="blTotalBadge" class="bl-count-badge">0 ta raqam</span>
                                </h3>
                                <p class="bl-header-sub">Bu raqamlar faqat sizga (114) tushmaydi, boshqa operatorlarga navbat bo'yicha tushaveradi</p>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button class="bl-btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="fetchBlacklist()" title="Ro'yxatni yangilash">
                                <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M22 12C22 17.52 17.52 22 12 22C6.48 22 3.11 16.44 3.11 16.44M3.11 16.44H7.64M3.11 16.44V21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M2 12C2 6.48 6.44 2 12 2C18.67 2 22 7.56 22 7.56M22 7.56V3M22 7.56H17.56" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg> Yangilash</span>
                            </button>
                            <button class="bl-btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="lockBlacklist()" title="Tizimdan chiqish (Qulflash)">
                                🔒 Qulflash
                            </button>
                            <button class="bl-btn-close" onclick="closeBlacklistModal()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M18 6L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M6 6L18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></button>
                        </div>
                    </div>

                    <!-- Add Number Form -->
                    <div class="bl-add-panel">
                        <div class="bl-add-title">➕ Yangi raqamni qora ro'yxatga kiritish:</div>
                        <div class="bl-add-grid">
                            <input type="text" id="blAddPhone" class="bl-input-field" placeholder="Telefon raqam (masalan: 901234567)" autocomplete="off">
                            <input type="text" id="blAddNote" class="bl-input-field" placeholder="Sababi / Izoh (masalan: Bezori, Spam...)" autocomplete="off">
                            <button type="button" id="blBtnSubmitAdd" class="bl-btn-primary" onclick="submitAddBlacklist()">
                                <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.17 14.83L14.83 9.17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14.83 14.83L9.17 9.17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg> Bloklash</span>
                            </button>
                        </div>
                        <div class="bl-quick-chips">
                            <span class="bl-chip-label">Tezkor izohlar:</span>
                            <span class="bl-chip" onclick="setQuickNote('Bezori / Halovatsiz')">Bezori</span>
                            <span class="bl-chip" onclick="setQuickNote('Spam / Reklama')">Spam</span>
                            <span class="bl-chip" onclick="setQuickNote('Qayta-qayta tashlab ketuvchi')">Tashlab ketuvchi</span>
                            <span class="bl-chip" onclick="setQuickNote('Noto\'g\'ri raqam')">Adashgan</span>
                        </div>
                    </div>

                    <!-- Search & Filter Bar -->
                    <div class="bl-filter-bar">
                        <input type="text" id="blSearchInput" class="bl-search-input" placeholder="🔍 Raqam yoki izoh bo'yicha qidirish..." oninput="handleBlacklistSearch(this.value)">
                        <span id="blFilteredCount" style="font-size: 12px; color: #94a3b8;"></span>
                    </div>

                    <!-- Table of blacklisted numbers -->
                    <div class="bl-table-container">
                        <table class="bl-table">
                            <thead>
                                <tr>
                                    <th style="width: 50px;">#</th>
                                    <th>Telefon raqam</th>
                                    <th>Holati</th>
                                    <th>Sababi / Izoh</th>
                                    <th>Qo'shilgan vaqti</th>
                                    <th style="text-align: right; width: 100px;">Amal</th>
                                </tr>
                            </thead>
                            <tbody id="blTableBody">
                                <tr>
                                    <td colspan="6" class="bl-empty-state">
                                        <div class="bl-empty-icon"><svg style="width: 32px; height: 32px;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 6V12L16 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></div>
                                        <div>Ma'lumotlar yuklanmoqda...</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Toast Container -->
            <div id="blacklistToast" class="bl-toast">
                <span id="blToastIcon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7.75 12L10.58 14.83L16.25 9.17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></span>
                <span id="blToastMsg">Muvaffaqiyatli</span>
            </div>
        `;
        document.body.appendChild(wrapper);
    }

    // 4. Klaviatura hodisalarini ulash
    function bindGlobalKeys() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const authModal = document.getElementById('blacklistAuthModal');
                const mgrModal = document.getElementById('blacklistManagerModal');
                if (authModal && authModal.classList.contains('active')) {
                    closeBlacklistAuthModal();
                } else if (mgrModal && mgrModal.classList.contains('active')) {
                    closeBlacklistModal();
                }
            }
        });

        // Parol kiritishda Enter bosilsa
        document.addEventListener('keydown', (e) => {
            const authInput = document.getElementById('blAuthInput');
            if (e.key === 'Enter' && document.activeElement === authInput) {
                submitBlacklistAuth();
            }

            const phoneInput = document.getElementById('blAddPhone');
            const noteInput = document.getElementById('blAddNote');
            if (e.key === 'Enter' && (document.activeElement === phoneInput || document.activeElement === noteInput)) {
                submitAddBlacklist();
            }
        });
    }

    // Toast chiqarish
    function showToast(message, type = 'success') {
        const toast = document.getElementById('blacklistToast');
        const icon = document.getElementById('blToastIcon');
        const msg = document.getElementById('blToastMsg');
        if (!toast) return;

        toast.className = `bl-toast ${type} show`;
        if (type === 'success') icon.innerHTML = typeof isax === 'function' ? isax('tick-circle') : '';
        else if (type === 'error') icon.textContent = '❌';
        else icon.textContent = 'ℹ️';

        msg.textContent = message;

        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3200);
    }

    // Parolni ko'rsatish/yashirish
    window.toggleAuthPasswordVisibility = function () {
        const input = document.getElementById('blAuthInput');
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
    };

    // Tezkor izoh tugmasi
    window.setQuickNote = function (note) {
        const input = document.getElementById('blAddNote');
        if (input) {
            input.value = note;
            input.focus();
        }
    };

    // Maxmudbek tugmasi bosilganda
    window.handleMaxmudbekClick = function (e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        initBlacklistUI();

        const storedAuth = sessionStorage.getItem(AUTH_KEY);
        if (storedAuth === EXPECTED_PASSWORD) {
            openBlacklistModal();
        } else {
            openBlacklistAuthModal();
        }
    };

    // Parol so'rash oynasini ochish
    window.openBlacklistAuthModal = function () {
        initBlacklistUI();
        const modal = document.getElementById('blacklistAuthModal');
        const input = document.getElementById('blAuthInput');
        const err = document.getElementById('blAuthError');
        const box = document.getElementById('blAuthBox');

        if (err) err.style.display = 'none';
        if (box) box.classList.remove('shake');
        if (input) {
            input.value = '';
            input.type = 'password';
        }

        if (modal) modal.classList.add('active');
        setTimeout(() => { if (input) input.focus(); }, 100);
    };

    window.closeBlacklistAuthModal = function () {
        const modal = document.getElementById('blacklistAuthModal');
        if (modal) modal.classList.remove('active');
    };

    // Parolni tekshirish va tasdiqlash
    window.submitBlacklistAuth = async function () {
        const input = document.getElementById('blAuthInput');
        const err = document.getElementById('blAuthError');
        const box = document.getElementById('blAuthBox');
        const entered = (input ? input.value : '').trim();

        if (entered !== EXPECTED_PASSWORD) {
            if (box) {
                box.classList.remove('shake');
                void box.offsetWidth;
                box.classList.add('shake');
            }
            if (err) {
                err.textContent = "Noto'g'ri parol kiritildi! Qaytadan urinib ko'ring.";
                err.style.display = 'block';
            }
            if (input) {
                input.focus();
                input.select();
            }
            return;
        }

        // Parol to'g'ri
        sessionStorage.setItem(AUTH_KEY, entered);
        closeBlacklistAuthModal();
        openBlacklistModal();
        showToast("Xush kelibsiz! Qora ro'yxat boshqaruvi ochildi.", 'success');
    };

    // Chiqish / Qulflash
    window.lockBlacklist = function () {
        sessionStorage.removeItem(AUTH_KEY);
        closeBlacklistModal();
        showToast("Qora ro'yxat boshqaruvi qulflandi", 'info');
    };

    // Blacklist boshqaruv oynasini ochish
    window.openBlacklistModal = function () {
        initBlacklistUI();
        const modal = document.getElementById('blacklistManagerModal');
        if (modal) modal.classList.add('active');

        const phoneInput = document.getElementById('blAddPhone');
        if (phoneInput) setTimeout(() => phoneInput.focus(), 150);

        fetchBlacklist();
    };

    window.closeBlacklistModal = function () {
        const modal = document.getElementById('blacklistManagerModal');
        if (modal) modal.classList.remove('active');
    };

    // Serverdan ro'yxatni olish
    window.fetchBlacklist = async function () {
        const auth = sessionStorage.getItem(AUTH_KEY) || EXPECTED_PASSWORD;
        const tbody = document.getElementById('blTableBody');
        const badge = document.getElementById('blTotalBadge');

        try {
            const res = await fetch('/api/blacklist', {
                headers: { 'x-blacklist-auth': auth }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                if (res.status === 401) {
                    sessionStorage.removeItem(AUTH_KEY);
                    closeBlacklistModal();
                    openBlacklistAuthModal();
                    showToast("Sessiya tugadi. Parolni qayta kiriting.", 'error');
                    return;
                }
                throw new Error(data.message || 'Xatolik yuz berdi');
            }

            blacklistData = data.data || [];
            if (badge) badge.textContent = `${blacklistData.length} ta raqam`;
            renderBlacklistTable(blacklistData);
        } catch (err) {
            console.error('Blacklist yuklashda xatolik:', err);
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="bl-empty-state" style="color: #f87171;">
                            <div class="bl-empty-icon">⚠️</div>
                            <div>Ma'lumotlarni yuklab bo'lmadi: ${err.message}</div>
                        </td>
                    </tr>
                `;
            }
        }
    };

    // Ro'yxatni jadvalda chizish
    function renderBlacklistTable(list) {
        const tbody = document.getElementById('blTableBody');
        if (!tbody) return;

        if (!list || list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="bl-empty-state">
                        <div class="bl-empty-icon">✨</div>
                        <div style="font-size: 15px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Qora ro'yxat bo'sh</div>
                        <div>Hozircha hech qanday raqam bloklanmagan.</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = list.map((item, idx) => {
            const raw = item.number;
            const formatted = item.formattedNumber || raw;
            const note = item.note ? String(item.note) : '';
            const dateStr = formatDate(item.createdAt);

            return `
                <tr>
                    <td style="color: #64748b; font-weight: 600;">${idx + 1}</td>
                    <td>
                        <span class="bl-phone-pill" title="Asterisk raqami: ${raw}">
                            <svg style="width: 14px; height: 14px;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21.97 18.33C21.97 18.69 21.89 19.06 21.72 19.42C21.55 19.78 21.33 20.12 21.04 20.44C20.55 20.98 20.01 21.37 19.4 21.62C18.8 21.87 18.15 22 17.45 22C16.43 22 15.34 21.76 14.19 21.27C13.04 20.78 11.89 20.12 10.75 19.28C9.6 18.44 8.51 17.48 7.47 16.41C6.44 15.34 5.51 14.22 4.7 13.04C3.9 11.87 3.26 10.7 2.78 9.53C2.31 8.36 2.07 7.26 2.07 6.22C2.07 5.54 2.2 4.89 2.44 4.29C2.69 3.69 3.06 3.14 3.57 2.64C4.22 2 4.95 1.68 5.76 1.68C6.07 1.68 6.38 1.75 6.66 1.89C6.95 2.03 7.21 2.23 7.42 2.51L9.46 5.39C9.66 5.66 9.8 5.91 9.9 6.14C10 6.36 10.05 6.57 10.05 6.76C10.05 7 9.97 7.24 9.82 7.48C9.67 7.72 9.45 7.97 9.17 8.24L8.45 8.98C8.34 9.09 8.29 9.22 8.29 9.38C8.29 9.46 8.31 9.54 8.34 9.62C8.38 9.7 8.42 9.77 8.45 9.83C8.82 10.5 9.32 11.23 9.95 12.02C10.58 12.81 11.27 13.58 12.02 14.33C12.77 15.08 13.54 15.77 14.33 16.4C15.12 17.03 15.85 17.53 16.52 17.9C16.58 17.93 16.65 17.97 16.73 18.01C16.81 18.04 16.89 18.06 16.98 18.06C17.15 18.06 17.29 18 17.41 17.88L18.12 17.18C18.4 16.89 18.66 16.67 18.9 16.52C19.15 16.36 19.39 16.28 19.63 16.28C19.82 16.28 20.03 16.33 20.26 16.43C20.49 16.53 20.74 16.68 21.02 16.88L21.94 17.54C22.23 17.75 22.44 17.99 22.56 18.26C22.67 18.53 22.73 18.8 22.73 19.07" stroke="currentColor" stroke-width="1.5" stroke-miterlimit="10"/>
</svg> ${formatted}
                        </span>
                    </td>
                    <td>
                        <span class="bl-tag-blocked">Bloklangan</span>
                    </td>
                    <td>
                        ${note ? `<span class="bl-note-badge">${escapeHtml(note)}</span>` : '<span class="bl-note-empty">Izoh kiritilmagan</span>'}
                    </td>
                    <td>
                        <span class="bl-time" title="${item.createdAt || ''}"><span style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer', '', 'width: 12px; height: 12px;')} ${dateStr}</span></span>
                    </td>
                    <td style="text-align: right;">
                        <button type="button" class="bl-btn-del" onclick="deleteBlacklistNumber('${raw}', '${formatted}')" title="Qora ro'yxatdan chiqarish" style="display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('trash', '', 'width: 13px; height: 13px;')} O'chirish
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Qidirish filtratsiyasi
    window.handleBlacklistSearch = function (query) {
        const q = String(query || '').trim().toLowerCase();
        const filterBadge = document.getElementById('blFilteredCount');

        if (!q) {
            if (filterBadge) filterBadge.textContent = '';
            renderBlacklistTable(blacklistData);
            return;
        }

        const filtered = blacklistData.filter(item => {
            const phone = (item.number || '').toLowerCase();
            const fmt = (item.formattedNumber || '').toLowerCase();
            const note = (item.note || '').toLowerCase();
            return phone.includes(q) || fmt.includes(q) || note.includes(q);
        });

        if (filterBadge) {
            filterBadge.textContent = `Topildi: ${filtered.length} ta`;
        }
        renderBlacklistTable(filtered);
    };

    // Yangi raqam qo'shish
    window.submitAddBlacklist = async function () {
        if (isSubmitting) return;

        const phoneInput = document.getElementById('blAddPhone');
        const noteInput = document.getElementById('blAddNote');
        const btn = document.getElementById('blBtnSubmitAdd');
        const rawPhone = (phoneInput ? phoneInput.value : '').trim();
        const note = (noteInput ? noteInput.value : '').trim();

        if (!rawPhone || rawPhone.replace(/\D/g, '').length < 3) {
            showToast("Iltimos, to'g'ri telefon raqam kiriting!", 'error');
            if (phoneInput) phoneInput.focus();
            return;
        }

        const auth = sessionStorage.getItem(AUTH_KEY) || EXPECTED_PASSWORD;
        isSubmitting = true;
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Qo\'shilmoqda...';
        }

        try {
            const res = await fetch('/api/blacklist', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-blacklist-auth': auth
                },
                body: JSON.stringify({ number: rawPhone, note })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Raqamni qo\'shib bo\'lmadi');
            }

            showToast(`Raqam muvaffaqiyatli qora ro'yxatga kiritildi!`, 'success');

            if (phoneInput) phoneInput.value = '';
            if (noteInput) noteInput.value = '';

            await fetchBlacklist();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            isSubmitting = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = (typeof isax === 'function' ? isax('close-circle') : '') + ' Bloklash';
            }
        }
    };

    // Raqamni o'chirish
    window.deleteBlacklistNumber = async function (number, formatted) {
        if (!confirm(`Haqiqatan ham ${formatted || number} raqamini qora ro'yxatdan chiqarmoqchimisiz?`)) {
            return;
        }

        const auth = sessionStorage.getItem(AUTH_KEY) || EXPECTED_PASSWORD;
        try {
            const res = await fetch(`/api/blacklist/${encodeURIComponent(number)}`, {
                method: 'DELETE',
                headers: { 'x-blacklist-auth': auth }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'O\'chirishda xatolik');
            }

            showToast(`${formatted || number} qora ro'yxatdan chiqarildi`, 'info');
            await fetchBlacklist();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    function formatDate(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();

            const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            if (isToday) {
                return `Bugun ${timeStr}`;
            }
            const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
            return `${dateStr} ${timeStr}`;
        } catch (e) {
            return isoStr;
        }
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Sahifa yuklanganda initsializatsiya
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlacklistUI);
    } else {
        initBlacklistUI();
    }
})();
