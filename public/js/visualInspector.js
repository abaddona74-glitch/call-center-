/**
 * Visual AI Inspector (Lovable / v0 Style Visual Prompt Mode)
 * Faqat Superuser / Admin yoki Localhost uchun xavfsiz faollashadi.
 * Klaviatura kombinatsiyasi: Alt + Shift + D yoki Profil menyusi orqali.
 */

(function () {
    'use strict';

    let isInspectorActive = false;
    let hoveredElement = null;
    let selectedElement = null;
    let highlightBox = null;
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

        // Highlighting Box
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
            transition: all 0.08s cubic-bezier(0.16, 1, 0.3, 1);
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
        `;
        highlightBox.appendChild(tagBadge);

        // Top Control Floating Bar
        topBar = document.createElement('div');
        topBar.id = 'visualInspectorTopBar';
        topBar.style.cssText = `
            position: fixed;
            top: 14px;
            left: 50%;
            transform: translateX(-50%) translateY(-60px);
            opacity: 0;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(139, 92, 246, 0.45);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(139, 92, 246, 0.25);
            padding: 8px 18px;
            border-radius: 50px;
            display: flex;
            align-items: center;
            gap: 12px;
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
            font-size: 13px;
            font-weight: 600;
            pointer-events: auto;
            transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease;
            z-index: 10000001;
            user-select: none;
        `;
        topBar.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; color: #c084fc;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: #a855f7; box-shadow: 0 0 10px #a855f7; animation: pulseGlow 1.5s infinite;"></span>
                Visual AI Inspector
            </span>
            <span style="color: #64748b;">|</span>
            <span style="color: #cbd5e1; font-weight: 500; font-size: 12px;">UI elementni bosing</span>
            <span style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.15); padding: 2px 7px; border-radius: 6px; font-size: 11px; color: #94a3b8; font-family: monospace;">ESC: Chiqish</span>
            <button type="button" id="btnExitVisualInspector" style="background: none; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px; border-radius: 4px; transition: color 0.15s ease;" title="Yopish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;

        root.appendChild(highlightBox);
        root.appendChild(topBar);
        document.body.appendChild(root);

        document.getElementById('btnExitVisualInspector')?.addEventListener('click', stopVisualInspector);
    }

    // 3. Hover qilingan elementni hoshiyalash
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
        tagBadge.textContent = label;

        // Yuqori chegaradan chiqib ketmaslik
        if (rect.top < 30) {
            tagBadge.style.top = '4px';
            tagBadge.style.left = '4px';
        } else {
            tagBadge.style.top = '-26px';
            tagBadge.style.left = '0';
        }
    }

    // 4. Element bosilganda tanlash
    function handleClick(e) {
        if (!isInspectorActive) return;

        // Inspector elementlarini bosishiga to'sqinlik qilmaslik
        if (e.target.closest('#visualInspectorRoot') || e.target.closest('#visualInspectorModalContainer')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        selectedElement = hoveredElement || e.target;
        highlightBox.style.display = 'none';

        openPromptModalForElement(selectedElement);
    }

    // 5. Lovable / v0 uslubidagi Prompt oynasi
    function openPromptModalForElement(el) {
        closePromptModal();

        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const classes = Array.from(el.classList || []).join(' ');
        const textContent = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const compStyles = window.getComputedStyle(el);

        const container = document.createElement('div');
        container.id = 'visualInspectorModalContainer';
        container.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(3, 7, 18, 0.75);
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
            max-width: 520px;
            padding: 22px;
            color: #f8fafc;
            font-family: 'Inter', sans-serif;
            position: relative;
            animation: modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
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
                            <span style="font-size: 10.5px; padding: 2px 6px; background: rgba(139, 92, 246, 0.2); color: #c084fc; border-radius: 6px; font-weight: 600;">v0 / Lovable</span>
                        </h3>
                    </div>
                </div>
                <button type="button" id="btnVisualCloseModal" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 6px; transition: color 0.15s ease;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>

            <!-- Tanlangan element metadatalari -->
            <div style="background: #1e293b; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                    <span style="color: #a855f7; font-family: monospace; font-weight: 700;">&lt;${tag}${id}&gt;</span>
                    <span style="color: #64748b; font-size: 11px;">${Math.round(rect.width)} × ${Math.round(rect.height)} px</span>
                </div>
                ${classes ? `<div style="color: #94a3b8; font-family: monospace; font-size: 11px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">class: ${classes}</div>` : ''}
                ${textContent ? `<div style="color: #cbd5e1; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">"${textContent}"</div>` : ''}
            </div>

            <!-- Tezkor chip takliflari -->
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
                <button type="button" class="ai-chip-btn" data-chip="Rangini va fonini o'zgartir: ">🎨 Rangini o'zgartirish</button>
                <button type="button" class="ai-chip-btn" data-chip="O'lchami va bo'shliqlarini kattalashtir: ">📏 Kattalashtirish</button>
                <button type="button" class="ai-chip-btn" data-chip="Hover animatsiyasi va soya qo'sh: ">✨ Animatsiya</button>
                <button type="button" class="ai-chip-btn" data-chip="Bu elementni yashir yoki o'chir: ">👁️ Yashirish</button>
            </div>

            <!-- Prompt Textarea -->
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 6px;">
                    Ushbu elementga nima o'zgartirish kiritilsin?
                </label>
                <textarea id="visualAiPromptInput" rows="3" placeholder="Masalan: 'Tugma rangi ko'k bo'lsin, burchaklari yumaloqlansin va ustiga hover qilganda soya bersin...'" style="width: 100%; box-sizing: border-box; background: #030712; border: 1px solid #334155; border-radius: 10px; color: #f8fafc; padding: 10px 12px; font-family: 'Inter', sans-serif; font-size: 13px; resize: vertical; outline: none; transition: border-color 0.2s ease;"></textarea>
            </div>

            <!-- Tugmalar -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <button type="button" id="btnReselectElement" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; padding: 9px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
                    Boshqa element
                </button>
                <button type="button" id="btnCopyVisualPrompt" style="background: #7c3aed; border: none; color: #ffffff; padding: 9px 18px; border-radius: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4); transition: all 0.2s ease;">
                    <svg class="isax isax-magic-star" style="width: 15px; height: 15px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-magic-star"></use></svg>
                    <span>Promptni nusxalash</span>
                </button>
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
            btn.style.cssText = 'background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 11px; padding: 3px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;';
            btn.addEventListener('click', () => {
                if (txtInput) {
                    txtInput.value = btn.dataset.chip + txtInput.value;
                    txtInput.focus();
                }
            });
        });

        // Yopish tugmasi
        document.getElementById('btnVisualCloseModal')?.addEventListener('click', closePromptModal);
        
        // Boshqa element tanlash
        document.getElementById('btnReselectElement')?.addEventListener('click', () => {
            closePromptModal();
            if (highlightBox) highlightBox.style.display = 'block';
        });

        // Promptni nusxalash
        document.getElementById('btnCopyVisualPrompt')?.addEventListener('click', () => {
            const userTask = txtInput ? txtInput.value.trim() : '';
            const copyBtn = document.getElementById('btnCopyVisualPrompt');

            // Tayyor AI Prompt matni yaratish
            const fullPrompt = [
                `[VISUAL UI O'ZGARTIRISH TALABI]:`,
                `- Element: <${tag}${id}>`,
                classes ? `- Klasslar: ${classes}` : null,
                textContent ? `- Element matni: "${textContent}"` : null,
                `- Joriy o'lchami: ${Math.round(rect.width)}px × ${Math.round(rect.height)}px`,
                compStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `- Fon rangi: ${compStyles.backgroundColor}` : null,
                compStyles.color ? `- Matn rangi: ${compStyles.color}` : null,
                `- Joriy sahifa: ${location.pathname} (${document.title})`,
                ``,
                `🎯 VAZIFA:`,
                userTask ? userTask : `Ushbu elementning ko'rinishini yaxshilab ber.`
            ].filter(Boolean).join('\n');

            navigator.clipboard.writeText(fullPrompt).then(() => {
                if (copyBtn) {
                    copyBtn.style.background = '#10b981';
                    copyBtn.innerHTML = `<span>✅ Nusxalandi! Chatga tashlang</span>`;
                    setTimeout(() => {
                        closePromptModal();
                        stopVisualInspector();
                    }, 1100);
                }
            }).catch(err => {
                console.error('Nusxalashda xatolik:', err);
            });
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

    // 6. Inspector ni yoqish
    function startVisualInspector() {
        if (!isAllowedToInspect()) {
            console.warn('Visual AI Inspector faqat Superuser yoki Localhost uchun ruxsat etilgan.');
            return;
        }

        initInspectorDOMElements();
        isInspectorActive = true;

        document.body.classList.add('visual-inspector-on');
        if (topBar) {
            topBar.style.transform = 'translateX(-50%) translateY(0)';
            topBar.style.opacity = '1';
        }

        window.addEventListener('mousemove', handleMouseMove, true);
        window.addEventListener('click', handleClick, true);
    }

    // 7. Inspector ni o'chirish
    function stopVisualInspector() {
        isInspectorActive = false;
        document.body.classList.remove('visual-inspector-on');

        if (highlightBox) highlightBox.style.display = 'none';
        if (topBar) {
            topBar.style.transform = 'translateX(-50%) translateY(-60px)';
            topBar.style.opacity = '0';
        }
        closePromptModal();

        window.removeEventListener('mousemove', handleMouseMove, true);
        window.removeEventListener('click', handleClick, true);
    }

    function toggleVisualInspector() {
        if (isInspectorActive) {
            stopVisualInspector();
        } else {
            startVisualInspector();
        }
    }

    // 8. Klaviatura boshqaruvi (Alt + Shift + D yoki ESC)
    window.addEventListener('keydown', (e) => {
        // Alt + Shift + D
        if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            toggleVisualInspector();
            return;
        }

        // ESC bosilganda chiqish
        if (e.key === 'Escape') {
            if (promptModal) {
                closePromptModal();
            } else if (isInspectorActive) {
                stopVisualInspector();
            }
        }
    });

    // Global eksport
    window.toggleVisualInspector = toggleVisualInspector;
    window.startVisualInspector = startVisualInspector;
    window.stopVisualInspector = stopVisualInspector;

})();
