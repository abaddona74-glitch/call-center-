/**
 * Visual AI Inspector (Lovable / v0 Style Visual Prompt Mode)
 * Faqat Superuser / Admin yoki Localhost uchun xavfsiz faollashadi.
 * Klaviatura kombinatsiyasi: Alt + Shift + D yoki Profil menyusi orqali.
 * 
 * Asosiy imkoniyatlar:
 *  - Ko'p elementlarni uzluksiz tanlash (har bir element alohida rang va #1, #2... deb belgilanadi)
 *  - Matnda # yoki @ bosilganda komponentlar avtomatik ro'yxati (Autocomplete podskazka)
 *  - Otmetka qilingan elementlarni maxsus rangli va yaltiragan chip (Pill) ko'rinishida ko'rsatish
 *  - Tezkor otmetka tugmalari (bitta bosishda matnga #1, #2 kiritish)
 *  - Antigravity Inbox'ga to'g'ridan-to'g'ri uzatish
 */

(function () {
    'use strict';

    let isInspectorActive = false;
    let hoveredElement = null;
    let selectedElements = [];
    let highlightBox = null;
    let multiHighlightContainer = null;
    let tagBadge = null;
    let topBar = null;
    let promptModal = null;

    // Har bir element uchun maxsus ranglar palitrasi
    const COLOR_PALETTE = [
        { text: '#38bdf8', bg: 'rgba(56, 189, 248, 0.18)', border: 'rgba(56, 189, 248, 0.5)', solid: '#38bdf8', badgeBg: '#082f49' }, // Cyan
        { text: '#34d399', bg: 'rgba(16, 185, 129, 0.18)', border: 'rgba(16, 185, 129, 0.5)', solid: '#10b981', badgeBg: '#064e3b' }, // Emerald
        { text: '#c084fc', bg: 'rgba(168, 85, 247, 0.18)', border: 'rgba(168, 85, 247, 0.5)', solid: '#a855f7', badgeBg: '#3b0764' }, // Purple
        { text: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', border: 'rgba(251, 191, 36, 0.5)', solid: '#f59e0b', badgeBg: '#451a03' }, // Amber
        { text: '#fb7185', bg: 'rgba(251, 113, 133, 0.18)', border: 'rgba(251, 113, 133, 0.5)', solid: '#f43f5e', badgeBg: '#4c0519' }, // Rose
        { text: '#818cf8', bg: 'rgba(99, 102, 241, 0.18)', border: 'rgba(99, 102, 241, 0.5)', solid: '#6366f1', badgeBg: '#1e1b4b' }   // Indigo
    ];

    function getElementColor(index) {
        return COLOR_PALETTE[index % COLOR_PALETTE.length];
    }

    let cachedAuthUser = null;
    let authCheckPromise = null;

    async function fetchAuthUser() {
        if (window.currentAuthUser) { cachedAuthUser = window.currentAuthUser; return cachedAuthUser; }
        if (window.currentViewerUser) { cachedAuthUser = window.currentViewerUser; return cachedAuthUser; }
        if (cachedAuthUser) return cachedAuthUser;
        if (!authCheckPromise) {
            const token = localStorage.getItem('cc_token') || localStorage.getItem('auth_token') || localStorage.getItem('cc_session');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            authCheckPromise = fetch('/api/auth/me', { headers })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data && data.user) {
                        cachedAuthUser = data.user;
                        return data.user;
                    }
                    return null;
                })
                .catch(() => null);
        }
        return authCheckPromise;
    }

    // Sahifa yuklanganda fon rejimida foydalanuvchini aniqlab qo'yish
    fetchAuthUser();

    // 1. Ruxsat tekshiruvi: Superuser / Admin yoki Tools / Localhost
    function isAllowedToInspect() {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) return true;

        const user = window.currentAuthUser || window.currentViewerUser || cachedAuthUser;
        const role = user?.role || window.myUserRole;
        const username = user?.username || window.myUsername;
        const email = user?.email;

        if (user || role || username || email) {
            const roleStr = String(role || '').toLowerCase().trim();
            const usernameStr = String(username || '').toLowerCase().trim();
            const emailStr = String(email || '').toLowerCase().trim();

            const isSuper = (roleStr === 'superuser') ||
                            (roleStr === 'admin') ||
                            (usernameStr === 'superuser') ||
                            (usernameStr === 'admin') ||
                            (emailStr === 'abaddona74@gmail.com');
            return isSuper;
        }

        const roleEl = document.getElementById('headerUserRole') || document.getElementById('headerUserProfileRole');
        if (roleEl) {
            const txt = roleEl.textContent.toLowerCase().trim();
            if (txt === 'superuser' || txt === 'admin') return true;
            return false;
        }

        // Tools sahifasida (masalan, /tools/managers.html) bo'lsa yoki token bo'lsa ruxsat berish
        const path = window.location.pathname;
        if (path.includes('/tools/')) return true;

        const hasToken = localStorage.getItem('cc_token') || localStorage.getItem('auth_token') || document.cookie.includes('cc_session');
        if (hasToken) return true;

        return false;
    }

    function ensureInspectorStyles() {
        if (document.getElementById('visualInspectorStyles')) return;
        const style = document.createElement('style');
        style.id = 'visualInspectorStyles';
        style.textContent = `
            body.visual-inspector-on, body.visual-inspector-on * {
                cursor: crosshair !important;
            }
            @keyframes pulseGlow {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(1.3); }
            }
            @keyframes modalPopIn {
                0% { opacity: 0; transform: scale(0.92) translateY(8px); }
                100% { opacity: 1; transform: scale(1) translateY(0); }
            }
            .visual-ai-modal-box textarea:focus {
                border-color: #a855f7 !important;
                box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.25) !important;
            }
            .visual-ai-modal-box .ai-chip-btn:hover {
                background: rgba(168, 85, 247, 0.15) !important;
                border-color: rgba(168, 85, 247, 0.4) !important;
                color: #e9d5ff !important;
            }
            .visual-ai-elements-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                max-height: 190px;
                overflow-y: auto;
                padding-right: 4px;
                margin-bottom: 12px;
            }
            .visual-ai-elements-list::-webkit-scrollbar { width: 5px; }
            .visual-ai-elements-list::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.25);
                border-radius: 4px;
            }
            .visual-ai-element-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                background: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                padding: 7px 10px;
                font-size: 11.5px;
                transition: all 0.15s ease;
            }
            .visual-ai-element-item:hover {
                border-color: rgba(16, 185, 129, 0.35);
                background: #243247;
            }
            .visual-ai-element-item .el-num {
                background: rgba(16, 185, 129, 0.2);
                color: #34d399;
                border: 1px solid rgba(16, 185, 129, 0.4);
                border-radius: 4px;
                padding: 1px 6px;
                font-size: 10px;
                font-weight: 700;
                font-family: monospace;
            }
            .visual-ai-element-item .el-tag {
                color: #a855f7;
                font-family: monospace;
                font-weight: 700;
            }
            .visual-ai-element-item .el-text {
                color: #cbd5e1;
                font-style: italic;
                max-width: 140px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .visual-ai-element-item .el-size {
                color: #64748b;
                font-size: 10.5px;
                margin-left: auto;
            }
            .visual-ai-element-item .el-remove-btn {
                background: none;
                border: none;
                color: #64748b;
                cursor: pointer;
                padding: 2px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.15s ease, background 0.15s ease;
            }
            .visual-ai-element-item .el-remove-btn:hover {
                color: #ef4444;
                background: rgba(239, 68, 68, 0.15);
            }
            .visual-ai-editor {
                min-height: 72px;
                max-height: 140px;
                overflow-y: auto;
                background: #030712;
                border: 1px solid #334155;
                border-radius: 10px;
                color: #f8fafc;
                padding: 10px 12px;
                font-family: 'Inter', sans-serif;
                font-size: 13px;
                line-height: 1.55;
                outline: none;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
                word-break: break-word;
                white-space: pre-wrap;
            }
            .visual-ai-editor:focus {
                border-color: #a855f7 !important;
                box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.25) !important;
            }
            .visual-ai-editor:empty:before {
                content: attr(data-placeholder);
                color: #64748b;
                pointer-events: none;
                display: block;
            }
            .ai-mention-pill {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: rgba(56, 189, 248, 0.18);
                color: #38bdf8;
                border: 1px solid rgba(56, 189, 248, 0.45);
                border-radius: 6px;
                padding: 1px 7px;
                font-size: 11.5px;
                font-weight: 700;
                font-family: 'JetBrains Mono', Consolas, monospace;
                user-select: none;
                vertical-align: baseline;
                margin: 0 2px;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
                transition: all 0.15s ease;
            }
            .ai-mention-pill:hover {
                background: rgba(56, 189, 248, 0.28);
                border-color: #38bdf8;
            }
            .ai-mention-pill.pill-emerald {
                background: rgba(16, 185, 129, 0.18);
                color: #34d399;
                border-color: rgba(16, 185, 129, 0.45);
            }
            .ai-mention-pill.pill-purple {
                background: rgba(168, 85, 247, 0.18);
                color: #c084fc;
                border-color: rgba(168, 85, 247, 0.45);
            }
            .visual-mention-dropdown {
                position: absolute;
                background: #0f172a;
                border: 1px solid rgba(139, 92, 246, 0.5);
                border-radius: 10px;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 20px rgba(139, 92, 246, 0.25);
                width: 290px;
                max-height: 220px;
                overflow-y: auto;
                z-index: 10000020;
                padding: 5px;
                animation: modalPopIn 0.15s ease-out;
            }
            .visual-mention-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                color: #cbd5e1;
                transition: background 0.12s ease;
            }
            .visual-mention-item:hover, .visual-mention-item.active {
                background: rgba(139, 92, 246, 0.2);
                color: #f8fafc;
            }
            .visual-mention-item .vmi-num {
                background: rgba(16, 185, 129, 0.25);
                color: #34d399;
                border: 1px solid rgba(16, 185, 129, 0.4);
                border-radius: 4px;
                padding: 1px 5px;
                font-size: 10.5px;
                font-weight: 700;
                font-family: monospace;
            }
            .visual-mention-item .vmi-tag {
                font-family: monospace;
                font-weight: 700;
                color: #c084fc;
            }
            .visual-mention-item .vmi-text {
                font-style: italic;
                font-size: 11px;
                color: #94a3b8;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 120px;
                margin-left: auto;
            }
            .visual-quick-mentions {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 6px;
                margin-bottom: 8px;
            }
            .mention-insert-btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                background: rgba(56, 189, 248, 0.1);
                color: #38bdf8;
                border: 1px solid rgba(56, 189, 248, 0.25);
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 11px;
                font-weight: 600;
                font-family: 'JetBrains Mono', Consolas, monospace;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .mention-insert-btn:hover {
                background: rgba(56, 189, 248, 0.22);
                border-color: #38bdf8;
                transform: translateY(-1px);
            }
        `;
        document.head.appendChild(style);
    }

    // 2. DOM elementlarini tayyorlash
    function initInspectorDOMElements() {
        if (document.getElementById('visualInspectorRoot')) return;

        const root = document.createElement('div');
        root.id = 'visualInspectorRoot';
        root.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 9999999;';

        // Multi-selection container
        multiHighlightContainer = document.createElement('div');
        multiHighlightContainer.id = 'visualInspectorMultiContainer';
        multiHighlightContainer.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 9999999;';
        root.appendChild(multiHighlightContainer);

        // Hover Highlighting Box
        highlightBox = document.createElement('div');
        highlightBox.id = 'visualInspectorHighlight';
        highlightBox.style.cssText = `
            position: fixed;
            display: none;
            pointer-events: none;
            border: 2px solid #8b5cf6;
            background: rgba(139, 92, 246, 0.12);
            box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2), 0 0 24px rgba(139, 92, 246, 0.35);
            border-radius: 6px;
            transition: all 0.05s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 10000000;
        `;

        // Tag info badge
        tagBadge = document.createElement('div');
        tagBadge.id = 'visualInspectorTagBadge';
        tagBadge.style.cssText = `
            position: absolute;
            top: -26px;
            left: 0;
            background: #1e1b4b;
            color: #c4b5fd;
            border: 1px solid #6366f1;
            padding: 2px 7px;
            border-radius: 4px;
            font-family: 'JetBrains Mono', Consolas, monospace;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
            pointer-events: none;
            display: flex;
            align-items: center;
            gap: 5px;
        `;
        highlightBox.appendChild(tagBadge);
        root.appendChild(highlightBox);

        // Top Control Floating Bar
        topBar = document.createElement('div');
        topBar.id = 'visualInspectorTopBar';
        topBar.style.cssText = `
            position: fixed;
            top: 14px;
            left: 50%;
            transform: translateX(-50%) translateY(-70px);
            opacity: 0;
            background: rgba(15, 23, 42, 0.96);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(139, 92, 246, 0.5);
            box-shadow: 0 10px 36px rgba(0, 0, 0, 0.65), 0 0 24px rgba(139, 92, 246, 0.3);
            padding: 8px 18px;
            border-radius: 50px;
            display: flex;
            align-items: center;
            gap: 12px;
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
            font-size: 12.5px;
            font-weight: 600;
            pointer-events: auto;
            transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease;
            z-index: 10000001;
            user-select: none;
            max-width: 94vw;
            flex-wrap: nowrap;
        `;
        root.appendChild(topBar);

        document.body.appendChild(root);
        updateTopBarUI();
    }

    // 3. TopBar interfeysini yangilash
    function updateTopBarUI() {
        if (!topBar) return;

        const count = selectedElements.length;

        topBar.innerHTML = `
            <div style="display: inline-flex; align-items: center; gap: 7px; color: #c084fc;">
                <svg class="isax isax-magic-star" style="width: 16px; height: 16px; color: #c084fc;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                <span style="font-weight: 700; letter-spacing: -0.2px;">Visual AI</span>
            </div>

            <span style="color: #475569;">|</span>

            ${count === 0 ? `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="color: #cbd5e1; font-size: 12px; font-weight: 500;">
                        Elementlarni ketma-ket bosing
                    </span>
                    <span style="background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 7px; border-radius: 10px; font-size: 10.5px; font-weight: 600;">
                        Multi-select faol
                    </span>
                </div>
            ` : `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.5); padding: 3px 9px; border-radius: 12px; font-size: 11.5px; font-weight: 700; font-family: monospace;">
                        ${count} ta tanlandi
                    </span>
                    <button type="button" id="btnOpenMultiPrompt" style="
                        background: linear-gradient(135deg, #7c3aed, #4f46e5);
                        border: none;
                        color: #ffffff;
                        padding: 6px 14px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: 700;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        box-shadow: 0 4px 14px rgba(124, 58, 237, 0.45);
                        animation: pulseGlow 2s infinite;
                        transition: all 0.15s ease;
                    ">
                        <svg class="isax isax-magic-star" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                        <span>Prompt berish (Enter)</span>
                    </button>
                    <button type="button" id="btnClearSelection" style="
                        background: rgba(255, 255, 255, 0.08);
                        border: 1px solid rgba(255, 255, 255, 0.14);
                        color: #cbd5e1;
                        padding: 5px 9px;
                        border-radius: 14px;
                        font-size: 11px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    " title="Tanlovni tozalash">
                        <svg class="isax isax-trash" style="width: 12px; height: 12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-trash"></use></svg>
                        <span>Tozalash</span>
                    </button>
                </div>
            `}

            <span style="color: #475569;">|</span>
            <span style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); padding: 2px 7px; border-radius: 6px; font-size: 10.5px; color: #94a3b8; font-family: monospace;">ESC</span>
            <button type="button" id="btnExitVisualInspector" style="background: none; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 3px; border-radius: 4px; transition: color 0.15s ease;" title="Yopish">
                <svg class="isax isax-close" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-close"></use></svg>
            </button>
        `;

        document.getElementById('btnExitVisualInspector')?.addEventListener('click', stopVisualInspector);

        document.getElementById('btnOpenMultiPrompt')?.addEventListener('click', () => {
            if (selectedElements.length > 0) {
                openPromptModal();
            }
        });

        document.getElementById('btnClearSelection')?.addEventListener('click', () => {
            selectedElements = [];
            renderMultiHighlights();
            updateTopBarUI();
        });
    }

    // 4. Tanlangan barcha elementlar hoshiyasini chizish (har biri o'ziga xos rangda)
    function renderMultiHighlights() {
        if (!multiHighlightContainer) return;
        multiHighlightContainer.innerHTML = '';

        selectedElements = selectedElements.filter(el => document.body.contains(el));

        selectedElements.forEach((el, idx) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const color = getElementColor(idx);

            const box = document.createElement('div');
            box.style.cssText = `
                position: fixed;
                top: ${rect.top}px;
                left: ${rect.left}px;
                width: ${rect.width}px;
                height: ${rect.height}px;
                border: 2px solid ${color.solid};
                background: ${color.bg};
                box-shadow: 0 0 0 2px ${color.border}, 0 0 18px ${color.bg};
                border-radius: 6px;
                pointer-events: none;
                z-index: 10000000;
            `;

            const badge = document.createElement('div');
            badge.style.cssText = `
                position: absolute;
                top: ${rect.top < 28 ? '3px' : '-24px'};
                left: 0;
                background: ${color.badgeBg};
                color: ${color.text};
                border: 1px solid ${color.solid};
                padding: 1px 7px;
                border-radius: 4px;
                font-family: 'JetBrains Mono', Consolas, monospace;
                font-size: 11px;
                font-weight: 700;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
            `;
            let name = el.tagName.toLowerCase();
            if (el.id) name += `#${el.id}`;
            else if (el.classList && el.classList.length > 0) name += `.${el.classList[0]}`;
            badge.textContent = `#${idx + 1} <${name}>`;

            box.appendChild(badge);
            multiHighlightContainer.appendChild(box);
        });
    }

    // Scroll va Resize bo'lganda koordinatalarni yangilash
    function updateHighlightsPositions() {
        if (!isInspectorActive) return;
        renderMultiHighlights();

        if (hoveredElement && highlightBox && highlightBox.style.display !== 'none') {
            const rect = hoveredElement.getBoundingClientRect();
            highlightBox.style.top = `${rect.top}px`;
            highlightBox.style.left = `${rect.left}px`;
            highlightBox.style.width = `${rect.width}px`;
            highlightBox.style.height = `${rect.height}px`;
        }
    }

    // 5. Hover qilingan elementni hoshiyalash
    function handleMouseMove(e) {
        if (!isInspectorActive || promptModal) return;

        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (!target || target.closest('#visualInspectorRoot') || target.closest('#visualInspectorModalContainer')) {
            return;
        }

        hoveredElement = target;
        const rect = target.getBoundingClientRect();

        highlightBox.style.display = 'block';
        highlightBox.style.top = `${rect.top}px`;
        highlightBox.style.left = `${rect.left}px`;
        highlightBox.style.width = `${rect.width}px`;
        highlightBox.style.height = `${rect.height}px`;

        let label = target.tagName.toLowerCase();
        if (target.id) {
            label += `#${target.id}`;
        } else if (target.classList && target.classList.length > 0) {
            label += `.${Array.from(target.classList).slice(0, 2).join('.')}`;
        }

        const isAlreadySelected = selectedElements.includes(target);
        if (isAlreadySelected) {
            const idx = selectedElements.indexOf(target);
            highlightBox.style.borderColor = '#ef4444';
            tagBadge.style.background = '#450a0a';
            tagBadge.style.borderColor = '#ef4444';
            tagBadge.style.color = '#fca5a5';
            tagBadge.textContent = `✓ #${idx + 1} Tanlangan (O'chirish uchun bosing)`;
        } else {
            highlightBox.style.borderColor = '#8b5cf6';
            tagBadge.style.background = '#1e1b4b';
            tagBadge.style.borderColor = '#6366f1';
            tagBadge.style.color = '#c4b5fd';
            tagBadge.textContent = `+ Qo'shish: <${label}>`;
        }

        if (rect.top < 30) {
            tagBadge.style.top = '4px';
            tagBadge.style.left = '4px';
        } else {
            tagBadge.style.top = '-26px';
            tagBadge.style.left = '0';
        }
    }

    // 6. Element bosilganda tanlash
    function handleClick(e) {
        if (!isInspectorActive) return;

        if (e.target.closest('#visualInspectorRoot') || e.target.closest('#visualInspectorModalContainer')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const target = hoveredElement || e.target;
        if (!target) return;

        const existingIdx = selectedElements.indexOf(target);
        if (existingIdx !== -1) {
            selectedElements.splice(existingIdx, 1);
        } else {
            selectedElements.push(target);
        }

        renderMultiHighlights();
        updateTopBarUI();
        handleMouseMove(e);
    }

    // 2 marta tez bosish (double-click) darhol prompt ochadi
    function handleDblClick(e) {
        if (!isInspectorActive) return;
        if (e.target.closest('#visualInspectorRoot') || e.target.closest('#visualInspectorModalContainer')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const target = hoveredElement || e.target;
        if (target && !selectedElements.includes(target)) {
            selectedElements.push(target);
            renderMultiHighlights();
            updateTopBarUI();
        }

        if (selectedElements.length > 0) {
            openPromptModal();
        }
    }

    // 7. Prompt oynasini ochish (Mention / Podskazka bilan)
    function openPromptModal() {
        closePromptModal();
        if (selectedElements.length === 0) return;

        const count = selectedElements.length;
        const isSingle = count === 1;

        const container = document.createElement('div');
        container.id = 'visualInspectorModalContainer';
        container.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(3, 7, 18, 0.78);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000005;
            padding: 16px;
        `;

        const modal = document.createElement('div');
        modal.className = 'visual-ai-modal-box';
        modal.style.cssText = `
            background: #0f172a;
            border: 1px solid rgba(139, 92, 246, 0.45);
            border-radius: 16px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(139, 92, 246, 0.25);
            width: 100%;
            max-width: ${isSingle ? '520px' : '590px'};
            padding: 22px;
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
            position: relative;
            animation: modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        // Har bir element metadatalari
        const elementsData = selectedElements.map((el, idx) => {
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const classes = Array.from(el.classList || []).join(' ');
            const textContent = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
            const compStyles = window.getComputedStyle(el);
            const color = getElementColor(idx);
            return {
                el,
                rect,
                tag,
                id,
                classes,
                textContent,
                compStyles,
                color
            };
        });

        // Elementlar ro'yxati HTML
        let elementsHtml = '';
        if (isSingle) {
            const item = elementsData[0];
            elementsHtml = `
                <div style="background: #1e293b; border: 1px solid ${item.color.border}; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                        <span style="color: ${item.color.text}; font-family: monospace; font-weight: 700;">#1 &lt;${item.tag}${item.id}&gt;</span>
                        <span style="color: #64748b; font-size: 11px;">${Math.round(item.rect.width)} × ${Math.round(item.rect.height)} px</span>
                    </div>
                    ${item.classes ? `<div style="color: #94a3b8; font-family: monospace; font-size: 11px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">class: ${item.classes}</div>` : ''}
                    ${item.textContent ? `<div style="color: #cbd5e1; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">"${item.textContent}"</div>` : ''}
                </div>
            `;
        } else {
            elementsHtml = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 11.5px; font-weight: 600; color: #94a3b8;">Tanlangan komponentlar (${count} ta):</span>
                    <button type="button" id="btnAddMoreElements" style="background: none; border: none; color: #38bdf8; font-size: 11.5px; font-weight: 600; cursor: pointer; padding: 2px;">
                        + Yana qo'shish
                    </button>
                </div>
                <div class="visual-ai-elements-list" id="modalElementsList">
                    ${elementsData.map((item, idx) => `
                        <div class="visual-ai-element-item" data-index="${idx}" style="border-left: 3px solid ${item.color.solid};">
                            <span class="el-num" style="background: ${item.color.bg}; color: ${item.color.text}; border-color: ${item.color.border};">#${idx + 1}</span>
                            <span class="el-tag" style="color: ${item.color.text};">&lt;${item.tag}${item.id}&gt;</span>
                            ${item.textContent ? `<span class="el-text">"${item.textContent}"</span>` : ''}
                            <span class="el-size">${Math.round(item.rect.width)}×${Math.round(item.rect.height)}</span>
                            <button type="button" class="el-remove-btn" data-remove-idx="${idx}" title="O'chirish">
                                <svg class="isax isax-close" style="width: 12px; height: 12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-close"></use></svg>
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // Tezkor chip takliflari
        const chipsHtml = isSingle ? `
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
                <button type="button" class="ai-chip-btn" data-chip="Rangini va fonini o'zgartir: ">Rangini o'zgartirish</button>
                <button type="button" class="ai-chip-btn" data-chip="O'lchami va bo'shliqlarini kattalashtir: ">Kattalashtirish</button>
                <button type="button" class="ai-chip-btn" data-chip="Hover animatsiyasi va soya qo'sh: ">Animatsiya</button>
                <button type="button" class="ai-chip-btn" data-chip="Bu elementni yashir yoki o'chir: ">Yashirish</button>
            </div>
        ` : `
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
                <button type="button" class="ai-chip-btn" data-chip="Ushbu elementlarning barchasini bir xil o'lcham va oraliqda qil: ">Bir xil o'lcham va oraliq</button>
                <button type="button" class="ai-chip-btn" data-chip="Barchasining rang va shriftlarini mosla: ">Rang va shriftlar</button>
                <button type="button" class="ai-chip-btn" data-chip="Ushbu elementlarni bir qatorga tekisla: ">Bir qatorga tekislash</button>
                <button type="button" class="ai-chip-btn" data-chip="Barchasiga bir xil hover effekti ber: ">Bir xil hover</button>
                <button type="button" class="ai-chip-btn" data-chip="Barchasini yashir yoki o'chir: ">Yashirish</button>
            </div>
        `;

        // Tezkor Otmetka Tugmalari (Tugmani bitta bosib matnga #1, #2 pill qo'shish)
        const quickMentionsHtml = `
            <div class="visual-quick-mentions">
                <span style="font-size: 11px; color: #94a3b8; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    <span style="color: #38bdf8; font-weight: 700;">#</span> Otmetka qilish:
                </span>
                ${elementsData.map((item, idx) => `
                    <button type="button" class="mention-insert-btn" data-insert-idx="${idx}" style="color: ${item.color.text}; background: ${item.color.bg}; border-color: ${item.color.border};" title="Matnga #${idx + 1} ni kiritish">
                        <span style="font-weight: 700;">#${idx + 1}</span>
                        <span>&lt;${item.tag}${item.id}&gt;</span>
                    </button>
                `).join('')}
            </div>
        `;

        modal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 28px; height: 28px; border-radius: 8px; background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.4); display: flex; align-items: center; justify-content: center; color: #c084fc;">
                        <svg class="isax isax-magic-star" style="width: 16px; height: 16px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
                            Visual AI Prompt
                            <span style="font-size: 10.5px; padding: 2px 7px; background: ${isSingle ? 'rgba(139, 92, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: ${isSingle ? '#c084fc' : '#34d399'}; border-radius: 6px; font-weight: 600;">
                                ${isSingle ? '1 ta element' : `Multi (${count} ta)`}
                            </span>
                        </h3>
                    </div>
                </div>
                <button type="button" id="btnVisualCloseModal" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 6px; transition: color 0.15s ease;">
                    <svg class="isax isax-close" style="width: 16px; height: 16px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-close"></use></svg>
                </button>
            </div>

            <!-- Tanlangan element(lar) ro'yxati -->
            ${elementsHtml}

            <!-- Tezkor chip takliflari -->
            ${chipsHtml}

            <!-- Tezkor Otmetka Pill Tugmalari -->
            ${quickMentionsHtml}

            <!-- Prompt Rich Editor (Contenteditable with Mention Pills) -->
            <div style="margin-bottom: 16px; position: relative;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #94a3b8;">
                        ${isSingle ? "Ushbu elementga qanday o'zgartirish kiritilsin?" : "Tanlangan barcha elementlarga qanday o'zgartirish kiritilsin?"}
                    </label>
                    <span style="font-size: 10.5px; color: #64748b; font-family: monospace;"># yoki @: podskazka</span>
                </div>

                <!-- Rich Input Box -->
                <div id="visualAiPromptInput" class="visual-ai-editor" contenteditable="true" data-placeholder="${isSingle ? "Masalan: 'Tugma rangi ko'k bo'lsin, burchaklari yumaloqlansin...'" : "Masalan: '#1 dagi soatni #2 ning ichiga joylashtirib ber... (yoki # yozing)'"}"></div>

                <!-- Autocomplete Dropdown (Yashirin boshlanadi) -->
                <div id="visualMentionDropdown" class="visual-mention-dropdown" style="display: none;"></div>
            </div>

            <!-- Tugmalar -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <button type="button" id="btnReselectElement" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; padding: 9px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
                    + Yana element tanlash
                </button>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button type="button" id="btnCopyVisualPrompt" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); color: #f1f5f9; padding: 9px 13px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease;">
                        <svg class="isax isax-clipboard-text" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-clipboard-text"></use></svg>
                        <span>Nusxalash</span>
                    </button>
                    <button type="button" id="btnSendToAntigravity" style="background: linear-gradient(135deg, #7c3aed, #4f46e5); border: none; color: #ffffff; padding: 9px 16px; border-radius: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 7px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4); transition: all 0.2s ease;">
                        <svg class="isax isax-magic-star" style="width: 15px; height: 15px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                        <span>Antigravity'ga yuborish</span>
                    </button>
                </div>
            </div>
        `;

        container.appendChild(modal);
        document.body.appendChild(container);
        promptModal = container;

        const editor = document.getElementById('visualAiPromptInput');
        const mentionDropdown = document.getElementById('visualMentionDropdown');
        if (editor) editor.focus();

        // --- MENTION / TAGGING LOGIKASI ---

        // 1. Maxsus rangli mention pill yaratish va kiritish
        function insertMentionPill(itemIndex, removeTrigger = false) {
            const item = elementsData[itemIndex];
            if (!item || !editor) return;

            const color = item.color;
            const pill = document.createElement('span');
            pill.className = 'ai-mention-pill';
            pill.contentEditable = 'false';
            pill.dataset.mention = `#${itemIndex + 1}`;
            pill.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: ${color.bg};
                color: ${color.text};
                border: 1px solid ${color.border};
                border-radius: 6px;
                padding: 1px 7px;
                font-size: 11.5px;
                font-weight: 700;
                font-family: 'JetBrains Mono', Consolas, monospace;
                vertical-align: baseline;
                margin: 0 2px;
                box-shadow: 0 0 10px ${color.bg};
            `;
            pill.innerHTML = `<span>#${itemIndex + 1}</span><span style="font-weight: 500; font-size: 10px; opacity: 0.85;">&lt;${item.tag}${item.id}&gt;</span>`;

            editor.focus();
            const sel = window.getSelection();

            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                if (editor.contains(range.commonAncestorContainer)) {
                    // Agar # yoki @ yozilgan bo'lsa, uni o'chiramiz
                    if (removeTrigger && range.startContainer.nodeType === Node.TEXT_NODE) {
                        const txt = range.startContainer.textContent;
                        const pos = range.startOffset;
                        if (pos > 0 && (txt[pos - 1] === '#' || txt[pos - 1] === '@')) {
                            range.setStart(range.startContainer, pos - 1);
                            range.deleteContents();
                        }
                    }

                    range.insertNode(pill);
                    range.collapse(false);

                    // Orqasiga bo'shliq qo'yish
                    const space = document.createTextNode('\u00A0');
                    range.insertNode(space);
                    range.setStartAfter(space);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    hideMentionDropdown();
                    return;
                }
            }

            // Fallback: oxiriga qo'shish
            editor.appendChild(pill);
            const space = document.createTextNode('\u00A0');
            editor.appendChild(space);
            const range = document.createRange();
            range.setStartAfter(space);
            range.collapse(true);
            const sel2 = window.getSelection();
            sel2.removeAllRanges();
            sel2.addRange(range);
            hideMentionDropdown();
        }

        // 2. Tezkor Otmetka tugmalari bosilganda
        modal.querySelectorAll('.mention-insert-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.insertIdx, 10);
                if (!isNaN(idx)) {
                    insertMentionPill(idx, false);
                }
            });
        });

        // 3. Autocomplete Dropdown ko'rsatish
        let activeDropdownIndex = 0;
        let isDropdownVisible = false;

        function showMentionDropdown(filterQuery = '') {
            if (!mentionDropdown) return;

            const filtered = elementsData.map((item, idx) => ({ item, idx }))
                .filter(({ item, idx }) => {
                    if (!filterQuery) return true;
                    const q = filterQuery.toLowerCase();
                    const numStr = String(idx + 1);
                    return numStr.includes(q) || item.tag.includes(q) || item.id.toLowerCase().includes(q) || item.textContent.toLowerCase().includes(q);
                });

            if (filtered.length === 0) {
                hideMentionDropdown();
                return;
            }

            mentionDropdown.innerHTML = `
                <div style="font-size: 10.5px; font-weight: 700; color: #94a3b8; padding: 4px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
                    <span>Komponentni tanlang</span>
                    <span style="font-size: 10px; color: #64748b;">↑↓ va Enter</span>
                </div>
                ${filtered.map(({ item, idx }, i) => `
                    <div class="visual-mention-item ${i === 0 ? 'active' : ''}" data-idx="${idx}">
                        <span class="vmi-num" style="background: ${item.color.bg}; color: ${item.color.text}; border-color: ${item.color.border};">#${idx + 1}</span>
                        <span class="vmi-tag" style="color: ${item.color.text};">&lt;${item.tag}${item.id}&gt;</span>
                        ${item.textContent ? `<span class="vmi-text">"${item.textContent}"</span>` : ''}
                    </div>
                `).join('')}
            `;

            activeDropdownIndex = 0;
            mentionDropdown.style.display = 'block';
            isDropdownVisible = true;

            // Element bosilganda tanlash
            mentionDropdown.querySelectorAll('.visual-mention-item').forEach(elItem => {
                elItem.addEventListener('click', () => {
                    const idx = parseInt(elItem.dataset.idx, 10);
                    if (!isNaN(idx)) {
                        insertMentionPill(idx, true);
                    }
                });
            });
        }

        function hideMentionDropdown() {
            if (mentionDropdown) {
                mentionDropdown.style.display = 'none';
                isDropdownVisible = false;
            }
        }

        // Dropdown tugmalarini boshqarish (Arrow keys, Enter, Esc)
        if (editor) {
            editor.addEventListener('keydown', (e) => {
                if (isDropdownVisible) {
                    const items = mentionDropdown.querySelectorAll('.visual-mention-item');
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        activeDropdownIndex = (activeDropdownIndex + 1) % items.length;
                        items.forEach((it, i) => it.classList.toggle('active', i === activeDropdownIndex));
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        activeDropdownIndex = (activeDropdownIndex - 1 + items.length) % items.length;
                        items.forEach((it, i) => it.classList.toggle('active', i === activeDropdownIndex));
                        return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        if (items[activeDropdownIndex]) {
                            const idx = parseInt(items[activeDropdownIndex].dataset.idx, 10);
                            insertMentionPill(idx, true);
                        }
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        hideMentionDropdown();
                        return;
                    }
                }

                // Ctrl + Enter bo'lsa Antigravity'ga yuborish
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    document.getElementById('btnSendToAntigravity')?.click();
                }
            });

            // Input voqeasida # yoki @ tekshiruvi
            editor.addEventListener('input', () => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) {
                    hideMentionDropdown();
                    return;
                }
                const range = sel.getRangeAt(0);
                if (range.startContainer.nodeType === Node.TEXT_NODE) {
                    const txt = range.startContainer.textContent.slice(0, range.startOffset);
                    const match = txt.match(/(?:^|\s|[^\w])([#@])(\w*)$/);
                    if (match) {
                        showMentionDropdown(match[2]);
                        return;
                    }
                }
                hideMentionDropdown();
            });
        }

        // Chip bosilganda matn qo'shish
        modal.querySelectorAll('.ai-chip-btn').forEach(btn => {
            btn.style.cssText = 'background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 11px; padding: 4px 9px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;';
            btn.addEventListener('click', () => {
                if (editor) {
                    const textNode = document.createTextNode(btn.dataset.chip + ' ');
                    editor.prepend(textNode);
                    editor.focus();
                }
            });
        });

        // Ro'yxatdan alohida elementni o'chirish
        modal.querySelectorAll('.el-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.removeIdx, 10);
                if (!isNaN(idx) && selectedElements[idx]) {
                    selectedElements.splice(idx, 1);
                    renderMultiHighlights();
                    updateTopBarUI();
                    if (selectedElements.length === 0) {
                        closePromptModal();
                    } else {
                        openPromptModal();
                    }
                }
            });
        });

        document.getElementById('btnVisualCloseModal')?.addEventListener('click', closePromptModal);
        
        const handleReselect = () => {
            closePromptModal();
            updateTopBarUI();
            if (highlightBox) highlightBox.style.display = 'block';
        };
        document.getElementById('btnReselectElement')?.addEventListener('click', handleReselect);
        document.getElementById('btnAddMoreElements')?.addEventListener('click', handleReselect);

        // Editordan toza matnni ajratib olish (Mention pill larni #1 ko'rinishida chiqarish)
        function getEditorCleanText() {
            if (!editor) return '';
            const clone = editor.cloneNode(true);
            clone.querySelectorAll('.ai-mention-pill').forEach(pill => {
                const mention = pill.dataset.mention || pill.textContent;
                pill.replaceWith(document.createTextNode(` ${mention} `));
            });
            return (clone.textContent || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        }

        function generateFullPrompt() {
            const userTask = getEditorCleanText();

            if (selectedElements.length === 1) {
                const item = elementsData[0];
                return [
                    `[VISUAL UI O'ZGARTIRISH TALABI]:`,
                    `- Element: <${item.tag}${item.id}>`,
                    item.classes ? `- Klasslar: ${item.classes}` : null,
                    item.textContent ? `- Element matni: "${item.textContent}"` : null,
                    `- Joriy o'lchami: ${Math.round(item.rect.width)}px × ${Math.round(item.rect.height)}px`,
                    item.compStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `- Fon rangi: ${item.compStyles.backgroundColor}` : null,
                    item.compStyles.color ? `- Matn rangi: ${item.compStyles.color}` : null,
                    `- Joriy sahifa: ${location.pathname} (${document.title})`,
                    ``,
                    `🎯 VAZIFA:`,
                    userTask ? userTask : `Ushbu elementning ko'rinishini yaxshilab ber.`
                ].filter(Boolean).join('\n');
            }

            const lines = [
                `[VISUAL UI MULTI-ELEMENT O'ZGARTIRISH TALABI]:`,
                `Jami tanlangan komponentlar soni: ${elementsData.length} ta`,
                `- Joriy sahifa: ${location.pathname} (${document.title})`,
                ``,
                `📋 TANLANGAN ELEMENTLAR RO'YXATI:`
            ];

            elementsData.forEach((item, idx) => {
                lines.push(
                    `--- ${idx + 1}-element (#${idx + 1}) ---`,
                    `- Teg: <${item.tag}${item.id}>`,
                    item.classes ? `- Klasslar: ${item.classes}` : null,
                    item.textContent ? `- Matn: "${item.textContent}"` : null,
                    `- O'lcham: ${Math.round(item.rect.width)}px × ${Math.round(item.rect.height)}px`,
                    item.compStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `- Fon rangi: ${item.compStyles.backgroundColor}` : null,
                    item.compStyles.color ? `- Matn rangi: ${item.compStyles.color}` : null
                );
            });

            lines.push(
                ``,
                `🎯 VAZIFA (Barcha tanlangan komponentlarga qo'llansin):`,
                userTask ? userTask : `Ushbu komponentlarning bir-biriga mosligini va dizaynini yaxshilab ber.`
            );

            return lines.filter(Boolean).join('\n');
        }

        document.getElementById('btnCopyVisualPrompt')?.addEventListener('click', () => {
            const copyBtn = document.getElementById('btnCopyVisualPrompt');
            const fullPrompt = generateFullPrompt();

            navigator.clipboard.writeText(fullPrompt).then(() => {
                if (copyBtn) {
                    copyBtn.innerHTML = `
                        <svg class="isax isax-tick-circle" style="width: 14px; height: 14px; color: #34d399;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-tick-circle"></use></svg>
                        <span>Nusxalandi!</span>
                    `;
                    setTimeout(() => {
                        closePromptModal();
                        stopVisualInspector();
                    }, 800);
                }
            }).catch(err => {
                console.error('Nusxalashda xatolik:', err);
            });
        });

        document.getElementById('btnSendToAntigravity')?.addEventListener('click', async () => {
            const sendBtn = document.getElementById('btnSendToAntigravity');
            const userTask = getEditorCleanText();
            const fullPrompt = generateFullPrompt();

            try { navigator.clipboard.writeText(fullPrompt); } catch (e) {}

            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.innerHTML = `<span>Yuborilmoqda...</span>`;
            }

            const payloadElements = elementsData.map((item, idx) => ({
                num: idx + 1,
                tag: item.tag,
                id: item.el.id || '',
                classes: item.classes,
                text: item.textContent,
                width: Math.round(item.rect.width),
                height: Math.round(item.rect.height)
            }));

            try {
                const token = localStorage.getItem('cc_token') || localStorage.getItem('auth_token') || localStorage.getItem('cc_session');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch('/api/dev/visual-prompt', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        prompt: fullPrompt,
                        task: userTask,
                        elements: payloadElements,
                        element: payloadElements[0] || {}
                    })
                });

                if (res.ok) {
                    if (sendBtn) {
                        sendBtn.style.background = '#10b981';
                        sendBtn.innerHTML = `
                            <svg class="isax isax-tick-circle" style="width: 15px; height: 15px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-tick-circle"></use></svg>
                            <span>Qabul qilindi!</span>
                        `;
                    }
                    setTimeout(() => {
                        closePromptModal();
                        stopVisualInspector();
                    }, 1000);
                } else {
                    if (sendBtn) {
                        sendBtn.style.background = '#10b981';
                        sendBtn.innerHTML = `
                            <svg class="isax isax-tick-circle" style="width: 15px; height: 15px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-tick-circle"></use></svg>
                            <span>Nusxalandi! Chatga tashlang</span>
                        `;
                    }
                    setTimeout(() => {
                        closePromptModal();
                        stopVisualInspector();
                    }, 1200);
                }
            } catch (err) {
                console.error('Yuborishda xatolik:', err);
                if (sendBtn) {
                    sendBtn.style.background = '#10b981';
                    sendBtn.innerHTML = `
                        <svg class="isax isax-tick-circle" style="width: 15px; height: 15px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-tick-circle"></use></svg>
                        <span>Nusxalandi! Chatga tashlang</span>
                    `;
                }
                setTimeout(() => {
                    closePromptModal();
                    stopVisualInspector();
                }, 1200);
            }
        });

        container.addEventListener('click', (e) => {
            if (e.target === container) closePromptModal();
        });
    }

    function closePromptModal() {
        if (promptModal) {
            promptModal.remove();
            promptModal = null;
        }
    }

    // 8. Inspector ni yoqish
    function startVisualInspector() {
        if (!isAllowedToInspect()) {
            return;
        }

        ensureInspectorStyles();
        initInspectorDOMElements();
        isInspectorActive = true;
        selectedElements = [];

        document.body.classList.add('visual-inspector-on');
        if (topBar) {
            topBar.style.transform = 'translateX(-50%) translateY(0)';
            topBar.style.opacity = '1';
        }

        updateTopBarUI();
        renderMultiHighlights();

        window.addEventListener('mousemove', handleMouseMove, true);
        window.addEventListener('click', handleClick, true);
        window.addEventListener('dblclick', handleDblClick, true);
        window.addEventListener('scroll', updateHighlightsPositions, true);
        window.addEventListener('resize', updateHighlightsPositions, true);
    }

    // 9. Inspector ni o'chirish
    function stopVisualInspector() {
        isInspectorActive = false;
        selectedElements = [];
        document.body.classList.remove('visual-inspector-on');

        if (highlightBox) highlightBox.style.display = 'none';
        if (multiHighlightContainer) multiHighlightContainer.innerHTML = '';
        if (topBar) {
            topBar.style.transform = 'translateX(-50%) translateY(-70px)';
            topBar.style.opacity = '0';
        }
        closePromptModal();

        window.removeEventListener('mousemove', handleMouseMove, true);
        window.removeEventListener('click', handleClick, true);
        window.removeEventListener('dblclick', handleDblClick, true);
        window.removeEventListener('scroll', updateHighlightsPositions, true);
        window.removeEventListener('resize', updateHighlightsPositions, true);
    }

    function toggleVisualInspector() {
        if (isInspectorActive) {
            stopVisualInspector();
        } else {
            startVisualInspector();
        }
    }

    // 10. Klaviatura boshqaruvi (Ctrl + Shift + D, Alt + Shift + D, Ctrl + Alt + D) - Faqat Superuser uchun
    window.addEventListener('keydown', async (e) => {
        const isTrigger = (
            (e.ctrlKey && e.shiftKey) ||
            (e.altKey && e.shiftKey) ||
            (e.ctrlKey && e.altKey) ||
            (e.metaKey && e.shiftKey) ||
            (e.metaKey && e.altKey)
        ) && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD');
        if (isTrigger) {
            e.preventDefault();
            if (!cachedAuthUser && !window.currentAuthUser && !window.currentViewerUser) {
                await fetchAuthUser();
            }
            if (isAllowedToInspect()) {
                toggleVisualInspector();
            }
            return;
        }

        if (e.key === 'Escape') {
            if (promptModal) {
                closePromptModal();
            } else if (selectedElements.length > 0) {
                selectedElements = [];
                renderMultiHighlights();
                updateTopBarUI();
            } else if (isInspectorActive) {
                stopVisualInspector();
            }
            return;
        }

        if (e.key === 'Enter' && isInspectorActive && !promptModal && selectedElements.length > 0) {
            e.preventDefault();
            openPromptModal();
            return;
        }
    });

    window.toggleVisualInspector = toggleVisualInspector;
    window.startVisualInspector = startVisualInspector;
    window.stopVisualInspector = stopVisualInspector;

})();
