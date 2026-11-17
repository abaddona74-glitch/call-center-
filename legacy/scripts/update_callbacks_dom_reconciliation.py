with open('public/js/dashboard.js', 'r', encoding='utf-8') as f:
    content = f.read()

initial_lines = len(content.splitlines())
print('Initial lines:', initial_lines)

target = '''    let html = '';
    for (let index = 0; index < displayList.length; index++) {
        const item = displayList[index];
        const phone = item.phone || '';
        let cleanPhone = String(phone).replace(/[^\\d]/g, '');
        if (cleanPhone.length === 12 && cleanPhone.startsWith('998')) {
            cleanPhone = cleanPhone.slice(3);
        }
        let formattedPhone = cleanPhone || phone;

        const isIvr = (item.source === 'ivr_non_working');
        const isUnreachable = (adminCbTab === 'unreachable');
        const isResolved = (adminCbTab === 'resolved' || item.status === 'resolved');

        let statusText = isIvr ? t('callback_source_ivr', 'Ish vaqti emas') : t('callback_source_abandoned', 'Navbatdan chiqdi');
        if (isResolved) {
            let opRaw = item.last_outbound_operator || '';
            if (opRaw === 'NULL' || opRaw === 'null' || opRaw === '\\\\N') opRaw = '';
            let opDisplayName = '';
            if (opRaw && !/^\\d{2,4}$/.test(opRaw.trim())) {
                opDisplayName = opRaw.trim();
            } else {
                let ext = opRaw ? opRaw.trim() : '';
                if (!ext && item.dismissed_by) {
                    const m = item.dismissed_by.match(/(\\d{2,4})/);
                    if (m) ext = m[1];
                }
                if (ext) {
                    if (typeof currentOperators !== 'undefined' && Array.isArray(currentOperators)) {
                        const found = currentOperators.find(o => String(o.id || o.extension || o.ext) === ext);
                        if (found && found.name && found.name !== ext) {
                            opDisplayName = String(found.name).includes(`(${ext})`) ? found.name : `${found.name} (${ext})`;
                        }
                    }
                    if (!opDisplayName) opDisplayName = `Operator ${ext}`;
                }
            }
            statusText = opDisplayName ? `${opDisplayName} · Gaplashildi` : 'Gaplashildi';
        } else if (isUnreachable) {
            const outAttempts = item.outbound_attempts || 1;
            statusText = `Ulanilmadi (${outAttempts} marta)`;
        }

        let timeDisplay = item.call_time || '';
        if (timeDisplay.includes(' ')) {
            const parts = timeDisplay.split(' ');
            const dateP = parts[0];
            const timeP = parts[1].slice(0, 5);
            timeDisplay = (dateP === todayStr) ? timeP : `${dateP.slice(5)} ${timeP}`;
        }
        if (isResolved) {
            let resTimeDisplay = item.updated_at || item.dismissed_at || item.call_time || '';
            if (resTimeDisplay.includes(' ')) {
                const parts = resTimeDisplay.split(' ');
                timeDisplay = (parts[0] === todayStr) ? parts[1].slice(0, 5) : `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
            }
        }

        const activeCall = findActiveCallForPhone(phone, item.activeCall);
        const isActive = Boolean(activeCall);

        const relTime = getAdminCallbackRelativeTime(item.call_time);

        const isToday = Boolean(item.call_time && item.call_time.startsWith(todayStr));
        const attemptsCount = (typeof adminCbDateFilter !== 'undefined' && adminCbDateFilter === 'all')
            ? (Number(item.attempts_count || item.today_attempts) || 1)
            : (Number(item.today_attempts) || 1);
        const attemptBadge = attemptsCount > 1
            ? `<span class="cc-tag cc-tag-miss">${attemptsCount} marta</span>`
            : '';

        html += `
            <div class="cc-cb callback-card ${isActive ? 'callback-card-talking' : ''}" id="cb-card-${item.id}" onclick="copyCallbackPhone('${phone}', this, event)" title="Raqamni nusxalash: ${formattedPhone}">
                <div class="cc-cb-left">
                    <div class="cc-cb-num">
                        ${formattedPhone}
                        ${attemptBadge}
                        ${isActive ? `<span class="cc-tag cc-tag-ok" style="font-size: 11px; padding: 1px 7px;">${activeCall.operator}</span>` : ''}
                    </div>
                    <div class="cc-cb-sub">${isActive ? (activeCall.state === 'ringing' ? "Qo'ng'iroq qilinmoqda..." : "Suhbatlashmoqda...") : statusText}</div>
                </div>
                <div class="cc-cb-time">
                    <div>${timeDisplay}</div>
                    ${relTime ? `<div class="cc-cb-rel">${relTime}</div>` : ''}
                </div>
                <button type="button" class="cc-cb-del" onclick="event.stopPropagation(); deleteCallback(${item.id}, event)" title="${t('dyn_delete', 'O\\'chirish')}">
                    ${isax('close', '', 'width: 12px; height: 12px;')}
                </button>
            </div>
        `;
    }

    container.innerHTML = html;'''

repl = '''    // Agar oldin bo'sh placeholder bo'lsa, uni tozalash
    const emptyPlaceholder = container.querySelector('.empty-callbacks-placeholder');
    if (emptyPlaceholder) emptyPlaceholder.remove();

    // Mavjud kartalarni ID bo'yicha xaritalash (DOM Reconciliation — Hover holati buzilmasligi uchun)
    const existingCardsMap = new Map();
    container.querySelectorAll('.cc-cb.callback-card').forEach(el => {
        if (el.id) existingCardsMap.set(el.id, el);
    });

    const activeIds = new Set(displayList.map(item => `cb-card-${item.id}`));

    // Eskirgan, ro'yxatdan chiqqan kartalarni o'chirish
    existingCardsMap.forEach((el, id) => {
        if (!activeIds.has(id)) {
            el.remove();
        }
    });

    for (let index = 0; index < displayList.length; index++) {
        const item = displayList[index];
        const cardId = `cb-card-${item.id}`;
        const phone = item.phone || '';
        let cleanPhone = String(phone).replace(/[^\\d]/g, '');
        if (cleanPhone.length === 12 && cleanPhone.startsWith('998')) {
            cleanPhone = cleanPhone.slice(3);
        }
        let formattedPhone = cleanPhone || phone;

        const isIvr = (item.source === 'ivr_non_working');
        const isUnreachable = (adminCbTab === 'unreachable');
        const isResolved = (adminCbTab === 'resolved' || item.status === 'resolved');

        let statusText = isIvr ? t('callback_source_ivr', 'Ish vaqti emas') : t('callback_source_abandoned', 'Navbatdan chiqdi');
        if (isResolved) {
            let opRaw = item.last_outbound_operator || '';
            if (opRaw === 'NULL' || opRaw === 'null' || opRaw === '\\\\N') opRaw = '';
            let opDisplayName = '';
            if (opRaw && !/^\\d{2,4}$/.test(opRaw.trim())) {
                opDisplayName = opRaw.trim();
            } else {
                let ext = opRaw ? opRaw.trim() : '';
                if (!ext && item.dismissed_by) {
                    const m = item.dismissed_by.match(/(\\d{2,4})/);
                    if (m) ext = m[1];
                }
                if (ext) {
                    if (typeof currentOperators !== 'undefined' && Array.isArray(currentOperators)) {
                        const found = currentOperators.find(o => String(o.id || o.extension || o.ext) === ext);
                        if (found && found.name && found.name !== ext) {
                            opDisplayName = String(found.name).includes(`(${ext})`) ? found.name : `${found.name} (${ext})`;
                        }
                    }
                    if (!opDisplayName) opDisplayName = `Operator ${ext}`;
                }
            }
            statusText = opDisplayName ? `${opDisplayName} · Gaplashildi` : 'Gaplashildi';
        } else if (isUnreachable) {
            const outAttempts = item.outbound_attempts || 1;
            statusText = `Ulanilmadi (${outAttempts} marta)`;
        }

        let timeDisplay = item.call_time || '';
        if (timeDisplay.includes(' ')) {
            const parts = timeDisplay.split(' ');
            const dateP = parts[0];
            const timeP = parts[1].slice(0, 5);
            timeDisplay = (dateP === todayStr) ? timeP : `${dateP.slice(5)} ${timeP}`;
        }
        if (isResolved) {
            let resTimeDisplay = item.updated_at || item.dismissed_at || item.call_time || '';
            if (resTimeDisplay.includes(' ')) {
                const parts = resTimeDisplay.split(' ');
                timeDisplay = (parts[0] === todayStr) ? parts[1].slice(0, 5) : `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
            }
        }

        const activeCall = findActiveCallForPhone(phone, item.activeCall);
        const isActive = Boolean(activeCall);

        const relTime = getAdminCallbackRelativeTime(item.call_time);

        const attemptsCount = (typeof adminCbDateFilter !== 'undefined' && adminCbDateFilter === 'all')
            ? (Number(item.attempts_count || item.today_attempts) || 1)
            : (Number(item.today_attempts) || 1);
        const attemptBadge = attemptsCount > 1
            ? `<span class="cc-tag cc-tag-miss">${attemptsCount} marta</span>`
            : '';

        const targetClass = `cc-cb callback-card ${isActive ? 'callback-card-talking' : ''}`;
        const targetSubText = isActive ? (activeCall.state === 'ringing' ? "Qo'ng'iroq qilinmoqda..." : "Suhbatlashmoqda...") : statusText;

        const cardEl = existingCardsMap.get(cardId);
        if (cardEl) {
            // Mavjud kartani DOM dan o'chirmasdan in-place yangilash (Hover holati buzilmaydi!)
            if (cardEl.className !== targetClass) cardEl.className = targetClass;
            const subEl = cardEl.querySelector('.cc-cb-sub');
            if (subEl && subEl.textContent !== targetSubText) subEl.textContent = targetSubText;

            const timeContainer = cardEl.querySelector('.cc-cb-time');
            if (timeContainer) {
                const targetTimeHtml = `<div>${timeDisplay}</div>${relTime ? `<div class="cc-cb-rel">${relTime}</div>` : ''}`;
                if (timeContainer.innerHTML !== targetTimeHtml) {
                    timeContainer.innerHTML = targetTimeHtml;
                }
            }

            const currentChildren = Array.from(container.children);
            if (currentChildren[index] !== cardEl) {
                container.insertBefore(cardEl, currentChildren[index] || null);
            }
        } else {
            // Yangi karta
            const newCard = document.createElement('div');
            newCard.className = targetClass;
            newCard.id = cardId;
            newCard.setAttribute('onclick', `copyCallbackPhone('${phone}', this, event)`);
            newCard.setAttribute('title', `Raqamni nusxalash: ${formattedPhone}`);
            newCard.innerHTML = `
                <div class="cc-cb-left">
                    <div class="cc-cb-num">
                        ${formattedPhone}
                        ${attemptBadge}
                        ${isActive ? `<span class="cc-tag cc-tag-ok" style="font-size: 11px; padding: 1px 7px;">${activeCall.operator}</span>` : ''}
                    </div>
                    <div class="cc-cb-sub">${targetSubText}</div>
                </div>
                <div class="cc-cb-time">
                    <div>${timeDisplay}</div>
                    ${relTime ? `<div class="cc-cb-rel">${relTime}</div>` : ''}
                </div>
                <button type="button" class="cc-cb-del" onclick="event.stopPropagation(); deleteCallback(${item.id}, event)" title="${t('dyn_delete', 'O\\'chirish')}">
                    ${isax('close', '', 'width: 12px; height: 12px;')}
                </button>
            `;
            const currentChildren = Array.from(container.children);
            container.insertBefore(newCard, currentChildren[index] || null);
        }
    }'''

assert target in content, 'target not found in content'
assert content.count(target) == 1, 'target count != 1'

content = content.replace(target, repl)

final_lines = len(content.splitlines())
print('Final lines:', final_lines)

with open('public/js/dashboard.js', 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print('Successfully replaced with in-place reconciliation!')
