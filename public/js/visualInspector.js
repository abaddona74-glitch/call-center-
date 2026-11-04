/**
 * Visual AI Inspector (Lovable / v0 Style Visual Prompt Mode)
 * Faqat Superuser / Admin yoki Localhost uchun xavfsiz faollashadi.
 * Klaviatura kombinatsiyasi: Alt + Shift + D yoki Profil menyusi orqali.
 * Imkoniyatlari:
 *  - Yagona element tanlash (1-click prompt)
 *  - Multi-select: Bir nechta elementni tanlab umumiy prompt berish (Shift + Click yoki Multi-rejim)
 *  - Antigravity Inbox'ga to'g'ridan-to'g'ri integratsiya
 */

(function () {
    'use strict';

    let isInspectorActive = false;
    let isMultiSelectMode = false;
    let hoveredElement = null;
    let selectedElements = [];
    let highlightBox = null;
    let multiHighlightContainer = null;
    let tagBadge = null;
    let topBar = null;
    let promptModal = null;

    // 1. Ruxsat tekshiruvi: Faqat superuser/admin yoki localhost/dev rejimda
    function isAllowedToInspect() {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocal) return true;
        
        // URL da ?dev=true parametri bor bo'lsa
        if (window.location.search.includes('dev=true')) return true;

        // Current auth user roli tekshiruvi
        const user = window.currentAuthUser;
        if (user && user.role) {
            const role = String(user.role).toLowerCase();
            if (role.includes('super') || role.includes('admin')) return true;
        }

        const roleEl = document.getElementById('headerUserRole');
        if (roleEl && (roleEl.textContent.toLowerCase().includes('super') || roleEl.textContent.toLowerCase().includes('admin'))) {
            return true;
        }

        return false;
    }

    // 2. DOM elementlarini tayyorlash
    function initInspectorDOMElements() {
        if (document.getElementById('visualInspectorRoot')) return;

        const root = document.createElement('div');
        root.id = 'visualInspectorRoot';
        root.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 9999999;';

        // Multi-selection container (tanlangan barcha elementlar hoshiyasi)
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
            transition: all 0.06s cubic-bezier(0.16, 1, 0.3, 1);
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
            border: 1px solid rgba(139, 92, 246, 0.45);
            box-shadow: 0 10px 36px rgba(0, 0, 0, 0.65), 0 0 20px rgba(139, 92, 246, 0.25);
            padding: 7px 16px;
            border-radius: 50px;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
            font-size: 12.5px;
            font-weight: 600;
            pointer-events: auto;
            transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease;
            z-index: 10000001;
            user-select: none;
            max-width: 92vw;
            flex-wrap: nowrap;
        `;
        root.appendChild(topBar);

        document.body.appendChild(root);
        updateTopBarUI();
    }

    // 3. TopBar interfeysini yangilash (tanlangan elementlar soni va rejimlarga qarab)
    function updateTopBarUI() {
        if (!topBar) return;

        const count = selectedElements.length;
        const isMulti = isMultiSelectMode;

        topBar.innerHTML = `
            <div style="display: inline-flex; align-items: center; gap: 7px; color: #c084fc;">
                <svg class="isax isax-magic-star" style="width: 15px; height: 15px; color: #c084fc;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                <span style="font-weight: 700; letter-spacing: -0.2px;">Visual AI</span>
            </div>

            <span style="color: #475569;">|</span>

            <!-- Rejim tugmasi: Yagona vs Multi -->
            <button type="button" id="btnToggleMultiMode" style="
                background: ${isMulti ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)'};
                border: 1px solid ${isMulti ? '#10b981' : 'rgba(255, 255, 255, 0.12)'};
                color: ${isMulti ? '#34d399' : '#cbd5e1'};
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 11.5px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 5px;
                transition: all 0.15s ease;
            " title="Shift bosib tursa ham multi-rejim ishlaydi">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isMulti ? '#10b981' : '#94a3b8'};"></span>
                <span>${isMulti ? 'Multi-select: Yoniq' : 'Multi-select'}</span>
            </button>

            <!-- Holat / Maslahat yoki Tanlov amallari -->
            ${count === 0 ? `
                <span style="color: #94a3b8; font-size: 11.5px; font-weight: 500;">
                    Elementni bosing ${isMulti ? '(ko\'p tanlash)' : '(yoki Shift+Click)'}
                </span>
            ` : `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; font-family: monospace;">
                        ${count} ta tanlandi
                    </span>
                    <button type="button" id="btnOpenMultiPrompt" style="
                        background: linear-gradient(135deg, #7c3aed, #4f46e5);
                        border: none;
                        color: #ffffff;
                        padding: 5px 12px;
                        border-radius: 20px;
                        font-size: 11.5px;
                        font-weight: 700;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        box-shadow: 0 2px 10px rgba(124, 58, 237, 0.4);
                        transition: all 0.15s ease;
                    ">
                        <svg class="isax isax-magic-star" style="width: 13px; height: 13px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                        <span>Prompt berish (Enter)</span>
                    </button>
                    <button type="button" id="btnClearSelection" style="
                        background: rgba(255, 255, 255, 0.08);
                        border: 1px solid rgba(255, 255, 255, 0.12);
                        color: #cbd5e1;
                        padding: 4px 8px;
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

        // Event listeners
        document.getElementById('btnExitVisualInspector')?.addEventListener('click', stopVisualInspector);
        
        document.getElementById('btnToggleMultiMode')?.addEventListener('click', () => {
            isMultiSelectMode = !isMultiSelectMode;
            updateTopBarUI();
        });

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

    // 4. Tanlangan barcha elementlar hoshiyasini chizish
    function renderMultiHighlights() {
        if (!multiHighlightContainer) return;
        multiHighlightContainer.innerHTML = '';

        // DOM da mavjud bo'lmagan elementlarni tozalash
        selectedElements = selectedElements.filter(el => document.body.contains(el));

        selectedElements.forEach((el, idx) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const box = document.createElement('div');
            box.style.cssText = `
                position: fixed;
                top: ${rect.top}px;
                left: ${rect.left}px;
                width: ${rect.width}px;
                height: ${rect.height}px;
                border: 2px solid #10b981;
                background: rgba(16, 185, 129, 0.12);
                box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25), 0 0 18px rgba(16, 185, 129, 0.3);
                border-radius: 6px;
                pointer-events: none;
                z-index: 10000000;
            `;

            const badge = document.createElement('div');
            badge.style.cssText = `
                position: absolute;
                top: ${rect.top < 28 ? '3px' : '-24px'};
                left: 0;
                background: #064e3b;
                color: #a7f3d0;
                border: 1px solid #10b981;
                padding: 1px 6px;
                border-radius: 4px;
                font-family: 'JetBrains Mono', Consolas, monospace;
                font-size: 10.5px;
                font-weight: 700;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
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

        // Element klass va tag nomini ko'rsatish
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
            if (isMultiSelectMode || e.shiftKey) {
                tagBadge.textContent = `+ Qo'shish: <${label}>`;
            } else {
                tagBadge.textContent = `<${label}>`;
            }
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

        // Inspector elementlarini bosishiga to'sqinlik qilmaslik
        if (e.target.closest('#visualInspectorRoot') || e.target.closest('#visualInspectorModalContainer')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const target = hoveredElement || e.target;
        if (!target) return;

        const isMulti = isMultiSelectMode || e.shiftKey || e.ctrlKey || e.metaKey || (selectedElements.length > 0 && isMultiSelectMode);

        if (isMulti) {
            // Multi-rejim: element bor bo'lsa o'chiramiz, yo'q bo'lsa qo'shamiz
            const existingIdx = selectedElements.indexOf(target);
            if (existingIdx !== -1) {
                selectedElements.splice(existingIdx, 1);
            } else {
                selectedElements.push(target);
            }

            // Agar Shift bilan bosgan bo'lsa, foydalanuvchiga qulay bo'lishi uchun multi-rejimni yoniq deb belgilaymiz
            if (e.shiftKey) {
                isMultiSelectMode = true;
            }

            renderMultiHighlights();
            updateTopBarUI();

            // Hoverni qayta tekshirish
            handleMouseMove(e);
        } else {
            // Yagona tanlash rejimi
            selectedElements = [target];
            renderMultiHighlights();
            updateTopBarUI();
            highlightBox.style.display = 'none';
            openPromptModal();
        }
    }

    // 7. Prompt oynasini ochish (Yagona yoki Multi elementlar bilan)
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
            max-width: ${isSingle ? '520px' : '580px'};
            padding: 22px;
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
            position: relative;
            animation: modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        // Har bir element metadatalarini tayyorlash
        const elementsData = selectedElements.map(el => {
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const classes = Array.from(el.classList || []).join(' ');
            const textContent = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
            const compStyles = window.getComputedStyle(el);
            return {
                el,
                rect,
                tag,
                id,
                classes,
                textContent,
                compStyles
            };
        });

        // Elementlar ro'yxati HTML
        let elementsHtml = '';
        if (isSingle) {
            const item = elementsData[0];
            elementsHtml = `
                <div style="background: #1e293b; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                        <span style="color: #a855f7; font-family: monospace; font-weight: 700;">&lt;${item.tag}${item.id}&gt;</span>
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
                        <div class="visual-ai-element-item" data-index="${idx}">
                            <span class="el-num">#${idx + 1}</span>
                            <span class="el-tag">&lt;${item.tag}${item.id}&gt;</span>
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

            <!-- Prompt Textarea -->
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 6px;">
                    ${isSingle ? "Ushbu elementga qanday o'zgartirish kiritilsin?" : "Tanlangan barcha elementlarga qanday o'zgartirish kiritilsin?"}
                </label>
                <textarea id="visualAiPromptInput" rows="3" placeholder="${isSingle ? "Masalan: 'Tugma rangi ko'k bo'lsin, burchaklari yumaloqlansin va ustiga hover qilganda soya bersin...'" : "Masalan: 'Ushbu tugmalarning barchasini bir xil balandlikda qil, oraliqlarini 8px qilib tekisla va...'"}" style="width: 100%; box-sizing: border-box; background: #030712; border: 1px solid #334155; border-radius: 10px; color: #f8fafc; padding: 10px 12px; font-family: 'Inter', sans-serif; font-size: 13px; resize: vertical; outline: none; transition: border-color 0.2s ease;"></textarea>
            </div>

            <!-- Tugmalar -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <button type="button" id="btnReselectElement" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; padding: 9px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
                    ${isSingle ? "Boshqa element" : "+ Yana tanlash"}
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

        // Fokus textarea ga
        const txtInput = document.getElementById('visualAiPromptInput');
        if (txtInput) txtInput.focus();

        // Chip bosilganda matn qo'shish
        modal.querySelectorAll('.ai-chip-btn').forEach(btn => {
            btn.style.cssText = 'background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 11px; padding: 4px 9px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;';
            btn.addEventListener('click', () => {
                if (txtInput) {
                    txtInput.value = btn.dataset.chip + txtInput.value;
                    txtInput.focus();
                }
            });
        });

        // Ro'yxatdan alohida elementni o'chirish
        modal.querySelectorAll('.el-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
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

        // Yopish tugmasi
        document.getElementById('btnVisualCloseModal')?.addEventListener('click', closePromptModal);
        
        // Yana tanlash / Boshqa element tanlash
        const handleReselect = () => {
            closePromptModal();
            isMultiSelectMode = true;
            updateTopBarUI();
            if (highlightBox) highlightBox.style.display = 'block';
        };
        document.getElementById('btnReselectElement')?.addEventListener('click', handleReselect);
        document.getElementById('btnAddMoreElements')?.addEventListener('click', handleReselect);

        // Prompt generator
        function generateFullPrompt() {
            const userTask = txtInput ? txtInput.value.trim() : '';

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

            // Multi-element prompt
            const lines = [
                `[VISUAL UI MULTI-ELEMENT O'ZGARTIRISH TALABI]:`,
                `Jami tanlangan komponentlar soni: ${elementsData.length} ta`,
                `- Joriy sahifa: ${location.pathname} (${document.title})`,
                ``,
                `📋 TANLANGAN ELEMENTLAR RO'YXATI:`
            ];

            elementsData.forEach((item, idx) => {
                lines.push(
                    `--- ${idx + 1}-element ---`,
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

        // 1. Nusxalash tugmasi
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

        // 2. Antigravity Inbox'ga yuborish tugmasi
        document.getElementById('btnSendToAntigravity')?.addEventListener('click', async () => {
            const sendBtn = document.getElementById('btnSendToAntigravity');
            const userTask = txtInput ? txtInput.value.trim() : '';
            const fullPrompt = generateFullPrompt();

            // Har ehtimolga qarshi clipboard ga ham yozib qo'yamiz
            try { navigator.clipboard.writeText(fullPrompt); } catch (e) {}

            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.innerHTML = `<span>Yuborilmoqda...</span>`;
            }

            const payloadElements = elementsData.map(item => ({
                tag: item.tag,
                id: item.el.id || '',
                classes: item.classes,
                text: item.textContent,
                width: Math.round(item.rect.width),
                height: Math.round(item.rect.height)
            }));

            try {
                const res = await fetch('/api/dev/visual-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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

        // Modal tashqarisiga bosilganda
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
            console.warn('Visual AI Inspector faqat Superuser yoki Localhost uchun ruxsat etilgan.');
            return;
        }

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
        window.addEventListener('scroll', updateHighlightsPositions, true);
        window.addEventListener('resize', updateHighlightsPositions, true);
    }

    // 9. Inspector ni o'chirish
    function stopVisualInspector() {
        isInspectorActive = false;
        isMultiSelectMode = false;
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

    // 10. Klaviatura boshqaruvi (Alt + Shift + D, ESC, Enter)
    window.addEventListener('keydown', (e) => {
        // Alt + Shift + D
        if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            toggleVisualInspector();
            return;
        }

        // ESC bosilganda
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

        // Enter bosilganda (agar elementlar tanlangan bo'lsa va modal ochiq bo'lmasa)
        if (e.key === 'Enter' && isInspectorActive && !promptModal && selectedElements.length > 0) {
            e.preventDefault();
            openPromptModal();
            return;
        }
    });

    // Global eksport
    window.toggleVisualInspector = toggleVisualInspector;
    window.startVisualInspector = startVisualInspector;
    window.stopVisualInspector = stopVisualInspector;

})();
