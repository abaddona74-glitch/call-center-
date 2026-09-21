/**
 * Call Center Viewer — Operatorlar Faoliyati (Standalone Lightweight Frontend)
 * - Faqat Operatorlar paneli
 * - Audio butunlay yo'q
 * - Real-time WebSocket + REST API
 */

const EXCLUDED_OPERATOR_IDS = new Set(['1234', '1111', '1324', '1001', '1000', '402', '401', '207', '202', '201', '170', '161', '118', '115', '160', '66', '110', '213']);

let currentOperators = [];
let socket = null;
let reconnectTimer = null;
let refreshInterval = null;

let detailState = {
    type: 'operator',
    operatorExt: '',
    title: '',
    page: 1,
    limit: 50,
    search: '',
    totalPages: 1,
    total: 0,
    rawCalls: [],
    category: null,
    sortKey: null,
    sortDir: 'asc',
    currentOp: null
};
let detailSearchTimeout = null;

/* ==========================================================================
   Utility Helpers
   ========================================================================== */
function getCleanOperatorName(name, id) {
    if (!name) return `Operator ${id}`;
    let cleaned = String(name).replace(/\s*\(\d+\)\s*/g, '').trim();
    return cleaned || `Operator ${id}`;
}

function getPresenceRank(op) {
    const pres = op.presence || 'offline';
    const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
    const isRinging = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
    if (isRinging) return 1;
    if (pres === 'ready') return 2;
    if (pres === 'talking') return 3;
    if (pres === 'paused') return 4;
    return 5;
}

function formatSeconds(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return '00:00';
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${h}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
}

function formatCallerNumber(val) {
    if (!val) return 'Yashirin';
    return String(val);
}

function generateStarRatingHtml(answered, operatorName) {
    if (!answered || answered < 1) return '';

    let stars = '';
    let currentLevel = 0;
    let nextStarNeeded = 0;

    if (answered >= 40) {
        stars = '⭐⭐⭐⭐⭐';
        currentLevel = 5;
    } else if (answered >= 30) {
        stars = '⭐⭐⭐⭐';
        currentLevel = 4;
        nextStarNeeded = 40 - answered;
    } else if (answered >= 20) {
        stars = '⭐⭐⭐';
        currentLevel = 3;
        nextStarNeeded = 30 - answered;
    } else if (answered >= 10) {
        stars = '⭐⭐';
        currentLevel = 2;
        nextStarNeeded = 20 - answered;
    } else if (answered >= 1) {
        stars = '⭐';
        currentLevel = 1;
        nextStarNeeded = 10 - answered;
    }

    const progressText = nextStarNeeded > 0
        ? `<div class="star-progress-note">Keyingi yulduzgacha: yana <b>${nextStarNeeded} ta</b> qo'ng'iroq kerak</div>`
        : `<div class="star-progress-note" style="color: #10b981;">🏆 Maksimal daraja (TOP operator)!</div>`;

    return `
        <div class="star-rating-box" onclick="event.stopPropagation();">
            <span>${stars}</span>
            <div class="star-rating-tooltip">
                <div class="star-tooltip-header">
                    <span>⭐</span>
                    <span>Operator darajasi tizimi</span>
                </div>
                <div class="star-tooltip-current">
                    <b>${operatorName || 'Operator'}:</b> ${answered} ta qabul qilingan
                    ${progressText}
                </div>
                <div class="star-tooltip-divider"></div>
                <div class="star-tooltip-levels">
                    <div class="star-level-row ${currentLevel === 5 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐⭐⭐</span>
                        <span class="level-range">40+ ta</span>
                        <span class="level-desc">Super Elita</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 4 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐⭐</span>
                        <span class="level-range">30 - 39 ta</span>
                        <span class="level-desc">Yetakchi</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 3 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐</span>
                        <span class="level-range">20 - 29 ta</span>
                        <span class="level-desc">Tajribali</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 2 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐</span>
                        <span class="level-range">10 - 19 ta</span>
                        <span class="level-desc">O'rta daraja</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 1 ? 'current-level' : ''}">
                        <span class="level-stars">⭐</span>
                        <span class="level-range">1 - 9 ta</span>
                        <span class="level-desc">Boshlang'ich</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/* ==========================================================================
   Operator Cards Rendering & Live Talking Timer
   ========================================================================== */
const operatorTalkingSinceMap = new Map();
const operatorReadySinceMap = new Map();

function updateAllTalkingTimers() {
    const timerEls = document.querySelectorAll('.talking-live-timer[data-talking-since]');
    if (!timerEls.length) return;
    const now = Date.now();
    timerEls.forEach(el => {
        const since = parseInt(el.getAttribute('data-talking-since'), 10);
        if (!since || isNaN(since)) return;
        const diffSec = Math.max(0, Math.floor((now - since) / 1000));
        
        const m = Math.floor(diffSec / 60);
        const s = diffSec % 60;
        const h = Math.floor(m / 60);
        const display = h > 0 
            ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        
        const digitsEl = el.querySelector('.timer-digits');
        if (digitsEl) {
            digitsEl.textContent = display;
        } else {
            el.textContent = `⏱️ ${display}`;
        }

        if (diffSec >= 420) { // >= 7 daqiqa: Qizil pulsatsiyalanuvchi ogohlantirish (uzoq suhbat)
            el.classList.remove('timer-warning');
            el.classList.add('timer-danger');
        } else if (diffSec >= 180) { // >= 3 daqiqa: Sariq ogohlantirish
            el.classList.remove('timer-danger');
            el.classList.add('timer-warning');
        } else {
            el.classList.remove('timer-warning', 'timer-danger');
        }
    });
}

// 1-rasm: 3 yulduzli oltin lavr chambari + MVP SVG nishoni
function getMvpWreathBadgeHtml() {
    return `
        <span class="mvp-wreath-badge" title="Bugungi eng faol yetakchi operator (MVP)">
            <svg class="mvp-wreath-svg" viewBox="0 0 140 75" width="56" height="30" aria-hidden="true">
                <defs>
                    <linearGradient id="mvpGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#fff8cc" />
                        <stop offset="35%" stop-color="#fbbf24" />
                        <stop offset="75%" stop-color="#f59e0b" />
                        <stop offset="100%" stop-color="#b45309" />
                    </linearGradient>
                    <linearGradient id="mvpStarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="60%" stop-color="#fcd34d" />
                        <stop offset="100%" stop-color="#f59e0b" />
                    </linearGradient>
                </defs>
                <!-- 3 Oltin Yulduz -->
                <polygon points="70,3 72.8,9.5 80,9.8 74.5,14.2 76.8,21 70,16.8 63.2,21 65.5,14.2 60,9.8 67.2,9.5" fill="url(#mvpStarGrad)" />
                <polygon points="49,8 51,12.8 56.5,13 52.3,16.2 54,21 49,18 44,21 45.7,16.2 41.5,13 47,12.8" fill="url(#mvpStarGrad)" />
                <polygon points="91,8 93,12.8 98.5,13 94.3,16.2 96,21 91,18 86,21 87.7,16.2 83.5,13 89,12.8" fill="url(#mvpStarGrad)" />
                <!-- Chap Lavr Chambari -->
                <g fill="url(#mvpGoldGrad)">
                    <path d="M 66 69 C 48 68 26 56 24 37 C 23 27 28 19 33 16" fill="none" stroke="url(#mvpGoldGrad)" stroke-width="2" stroke-linecap="round" />
                    <path d="M 61 68 C 55 70 48 66 50 61 C 52 57 58 61 61 68 Z" />
                    <path d="M 52 64 C 44 65 40 59 44 55 C 47 51 52 56 52 64 Z" />
                    <path d="M 42 57 C 34 57 31 50 35 45 C 39 42 43 48 42 57 Z" />
                    <path d="M 33 48 C 24 46 23 39 28 35 C 32 32 36 39 33 48 Z" />
                    <path d="M 27 37 C 19 33 20 25 26 23 C 30 21 32 29 27 37 Z" />
                    <path d="M 27 26 C 22 20 25 14 31 15 C 35 16 34 23 27 26 Z" />
                    <path d="M 33 16 C 30 10 36 6 41 8 C 44 11 41 17 33 16 Z" />
                    <path d="M 55 58 C 50 56 51 50 55 50 C 58 50 58 55 55 58 Z" />
                    <path d="M 45 50 C 40 47 42 42 46 42 C 49 42 49 47 45 50 Z" />
                    <path d="M 37 40 C 33 36 35 31 39 32 C 42 33 41 38 37 40 Z" />
                </g>
                <!-- O'ng Lavr Chambari (Mirror) -->
                <g fill="url(#mvpGoldGrad)" transform="translate(140, 0) scale(-1, 1)">
                    <path d="M 66 69 C 48 68 26 56 24 37 C 23 27 28 19 33 16" fill="none" stroke="url(#mvpGoldGrad)" stroke-width="2" stroke-linecap="round" />
                    <path d="M 61 68 C 55 70 48 66 50 61 C 52 57 58 61 61 68 Z" />
                    <path d="M 52 64 C 44 65 40 59 44 55 C 47 51 52 56 52 64 Z" />
                    <path d="M 42 57 C 34 57 31 50 35 45 C 39 42 43 48 42 57 Z" />
                    <path d="M 33 48 C 24 46 23 39 28 35 C 32 32 36 39 33 48 Z" />
                    <path d="M 27 37 C 19 33 20 25 26 23 C 30 21 32 29 27 37 Z" />
                    <path d="M 27 26 C 22 20 25 14 31 15 C 35 16 34 23 27 26 Z" />
                    <path d="M 33 16 C 30 10 36 6 41 8 C 44 11 41 17 33 16 Z" />
                    <path d="M 55 58 C 50 56 51 50 55 50 C 58 50 58 55 55 58 Z" />
                    <path d="M 45 50 C 40 47 42 42 46 42 C 49 42 49 47 45 50 Z" />
                    <path d="M 37 40 C 33 36 35 31 39 32 C 42 33 41 38 37 40 Z" />
                </g>
                <!-- Pastki bog'lam / tugun -->
                <circle cx="70" cy="69" r="2.5" fill="url(#mvpGoldGrad)" />
                <path d="M 66 70 Q 70 74 74 70" fill="none" stroke="url(#mvpGoldGrad)" stroke-width="1.8" />
                <!-- MVP Matni -->
                <text x="70" y="52" 
                      text-anchor="middle" 
                      font-family="'Inter', -apple-system, sans-serif" 
                      font-size="24" 
                      font-weight="900" 
                      letter-spacing="1.5" 
                      fill="url(#mvpGoldGrad)"
                      style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">MVP</text>
            </svg>
        </span>
    `;
}

function renderOperators(operators) {
    if (!Array.isArray(operators)) return;
    currentOperators = operators
        .filter(op => !EXCLUDED_OPERATOR_IDS.has(String(op.id)))
        .slice().sort((a, b) => {
            const rA = getPresenceRank(a);
            const rB = getPresenceRank(b);
            if (rA !== rB) return rA - rB;
            return parseInt(a.id, 10) - parseInt(b.id, 10);
        });

    const grid = document.getElementById('operatorsGrid');
    if (!grid) return;

    if (currentOperators.length === 0) {
        grid.innerHTML = `
            <div style="color: var(--text-muted); font-size: 14px; padding: 24px; grid-column: 1 / -1; text-align: center;">
                Hozircha operatorlar faoliyati aniqlanmadi.
            </div>
        `;
        return;
    }

    const sortedByScore = [...currentOperators]
        .filter(op => (op.answered || 0) > 0 || (op.totalDurationSec || 0) > 0)
        .sort((a, b) => (b.answered || 0) - (a.answered || 0) || (b.totalDurationSec || 0) - (a.totalDurationSec || 0));
    const top1Id = sortedByScore[0] ? sortedByScore[0].id : null;

    // Navbatdagi keyingi qo'ng'iroqni qabul qiluvchi operatorni aniqlash (Fewest calls strategiyasi bo'yicha)
    currentOperators.forEach(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const isRinging = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
        if (pres === 'ready' && !isRinging) {
            if (!operatorReadySinceMap.has(op.id)) {
                operatorReadySinceMap.set(op.id, Date.now());
            }
        } else {
            operatorReadySinceMap.delete(op.id);
        }
    });

    const readyOps = currentOperators.filter(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const isRinging = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
        return pres === 'ready' && !isRinging;
    });

    // Hozir jiringlayotgan operator bormi?
    const ringingOp = currentOperators.find(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        return (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
    });

    let predictedNextOpId = null;
    if (ringingOp) {
        // Jiringlash animatsiyasi tugaguncha (suhbat boshlanguncha) oltin belgi aynan shu operator kartasida qoladi
        predictedNextOpId = ringingOp.id;
    } else if (readyOps.length > 0) {
        readyOps.sort((a, b) => {
            // Asterisk QueueMember dan kelgan jonli callsTaken bo'lsa, o'shani olamiz (Asterisk RAM bilan 100% bir xil bo'ladi)
            const callsA = (a.callsTaken !== null && a.callsTaken !== undefined) ? Number(a.callsTaken) : (Number(a.answered) || 0);
            const callsB = (b.callsTaken !== null && b.callsTaken !== undefined) ? Number(b.callsTaken) : (Number(b.answered) || 0);
            if (callsA !== callsB) return callsA - callsB;

            // Asterisk fewestcalls tie-breaker: agar qo'ng'iroqlar soni teng bo'lsa, oxirgi qo'ng'irog'i eng eski (eng ko'p kutgan) operatorga tushadi
            const lastA = (a.lastCall !== null && a.lastCall !== undefined) ? Number(a.lastCall) : 0;
            const lastB = (b.lastCall !== null && b.lastCall !== undefined) ? Number(b.lastCall) : 0;
            if (lastA > 0 && lastB > 0 && lastA !== lastB) return lastA - lastB;

            const readySinceA = operatorReadySinceMap.get(a.id) || 0;
            const readySinceB = operatorReadySinceMap.get(b.id) || 0;
            if (readySinceA !== readySinceB) return readySinceA - readySinceB;
            return parseInt(a.id, 10) - parseInt(b.id, 10);
        });
        predictedNextOpId = readyOps[0].id;
    }

    grid.innerHTML = currentOperators.map(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';

        let cardClass = 'operator-card clickable-card';
        let statusBadge = '';
        let avatarBg = '';
        let talkingTimerHtml = '';

        if (ringingNow) {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = '<span class="status-badge badge-ringing"><span class="badge-dot pulse-ring"></span> Jiringlamoqda</span>';
            avatarBg = 'linear-gradient(135deg, #ec4899, #be185d)';
            cardClass += ' status-ringing status-active call-ringing';
        } else if (pres === 'talking') {
            statusBadge = '<span class="status-badge badge-talking"><span class="badge-dot pulse"></span> Suhbatda</span>';
            avatarBg = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
            cardClass += ' status-talking status-active call-talking';

            // Suhbatda holati uchun aniq boshlangan vaqt
            let talkingSince = op.talkingSince;
            if (!talkingSince) {
                if (operatorTalkingSinceMap.has(op.id)) {
                    talkingSince = operatorTalkingSinceMap.get(op.id);
                } else {
                    talkingSince = Date.now();
                    operatorTalkingSinceMap.set(op.id, talkingSince);
                }
            } else {
                operatorTalkingSinceMap.set(op.id, talkingSince);
            }

            talkingTimerHtml = `
                <div class="talking-live-timer" data-talking-since="${talkingSince}" title="Hozirgi suhbat davomiyligi">
                    <span class="timer-icon">⏱️</span>
                    <span class="timer-digits">00:00</span>
                </div>
            `;
        } else if (pres === 'offline') {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = '<span class="status-badge badge-offline"><span class="badge-dot"></span> Offline</span>';
            avatarBg = 'linear-gradient(135deg, #64748b, #475569)';
            cardClass += ' status-offline';
        } else {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = '<span class="status-badge badge-ready"><span class="badge-dot"></span> Kutmoqda</span>';
            avatarBg = 'linear-gradient(135deg, #10b981, #059669)';
            cardClass += ' status-ready status-active';
        }

        const answered = op.answered || 0;

        let stars = '';
        if (answered >= 40) stars = '⭐⭐⭐⭐⭐';
        else if (answered >= 30) stars = '⭐⭐⭐⭐';
        else if (answered >= 20) stars = '⭐⭐⭐';
        else if (answered >= 10) stars = '⭐⭐';
        else if (answered >= 1) stars = '⭐';

        let mvpBadge = '';
        if (op.id === top1Id && answered > 0) {
            mvpBadge = getMvpWreathBadgeHtml();
            cardClass += ' mvp-gold';
            avatarBg = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else if (stars === '⭐') {
            mvpBadge = `<span class="mvp-badge npc" title="1 ta yulduzli operator">🤖 NPC</span>`;
        }

        const isNextInLine = (op.id === predictedNextOpId);
        if (isNextInLine) {
            cardClass += ' next-in-line';
        }
        const nextInLineBadgeHtml = isNextInLine ? `
            <div class="next-call-corner-badge ${ringingNow ? 'is-ringing' : ''}" title="${ringingNow ? '🎯 Qo\'ng\'iroq tushdi! (Jiringlamoqda)' : '🎯 100% Keyingi qo\'ng\'iroq kutilmoqda (Fewest calls navbatida #1)'}">
                <svg class="next-call-gold-icon" viewBox="0 0 100 100" width="24" height="24">
                    <defs>
                        <linearGradient id="goldRimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#fff099" />
                            <stop offset="35%" stop-color="#f59e0b" />
                            <stop offset="70%" stop-color="#d97706" />
                            <stop offset="100%" stop-color="#78350f" />
                        </linearGradient>
                        <linearGradient id="goldArrowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stop-color="#fff3b0" />
                            <stop offset="100%" stop-color="#f59e0b" />
                        </linearGradient>
                    </defs>
                    <circle cx="50" cy="50" r="47" fill="url(#goldRimGrad)" stroke="#fef08a" stroke-width="2" />
                    <circle cx="50" cy="50" r="33" fill="#1e2430" />
                    <path d="M 50 23 L 69 42 L 58 42 L 58 73 L 42 73 L 42 42 L 31 42 Z" fill="none" stroke="url(#goldArrowGrad)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" />
                </svg>
            </div>
        ` : '';

        const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

        return `
            <div class="${cardClass}" onclick="openOperatorDetail('${op.id}')" title="${cleanName} tafsilotlarini ko'rish uchun bosing">
                ${ringingNow ? '<div class="call-live-strip ringing"></div>' : (pres === 'talking' ? '<div class="call-live-strip talking"></div>' : '')}
                ${nextInLineBadgeHtml}
                <div class="operator-head">
                    <div class="operator-avatar" style="background: ${avatarBg};">${op.id}</div>
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <h4 style="font-size: 15px; font-weight: 700; margin: 0;">${cleanName}</h4>
                                ${mvpBadge}
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
                                ${statusBadge}
                                ${talkingTimerHtml}
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                            <span style="font-size: 11px; color: var(--text-dim);">Exten: ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
                            ${generateStarRatingHtml(answered, cleanName)}
                        </div>
                    </div>
                </div>

                <div class="op-stat-row">
                    <span>Desktop Agent:</span>
                    <span class="op-stat-val" style="font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'}; ${op.agentConnected ? 'box-shadow: 0 0 6px #10b981;' : ''}"></span>
                        <span style="color: ${op.agentConnected ? 'var(--success)' : 'var(--text-dim)'};">${op.agentConnected ? 'Faol' : 'O\'chiq'}</span>
                        ${op.agentConnected ? `<span class="agent-ver-badge">v${op.agentVersion || '1.0.4'}</span>` : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>Desktop nomi:</span>
                    <span class="op-stat-val" style="font-size: 11px; font-weight: 600; color: ${op.agentHostname ? '#93c5fd' : 'var(--text-dim)'}; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${op.agentHostname || 'Aniqlanmagan'}">
                        ${op.agentHostname || '—'}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>Qabul qilingan:</span>
                    <span class="op-stat-val" style="color: var(--success); font-weight: 700;">${op.answered || 0} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>Chiquvchi:</span>
                    <span class="op-stat-val" style="color: ${(op.outbound || 0) > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">${op.outbound || 0} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>Transfer:</span>
                    <span class="op-stat-val" style="color: ${((op.transferredOut || 0) + (op.transferredIn || 0)) > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">
                        ${((op.transferredOut || 0) + (op.transferredIn || 0)) === 0 
                            ? '0 ta' 
                            : `${op.transferredOut || 0} ta <span style="font-size: 10px; color: #94a3b8; font-weight: 500;">(uzatgan)</span> / ${op.transferredIn || 0} ta <span style="font-size: 10px; color: #94a3b8; font-weight: 500;">(olgan)</span>`}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>O'tkazib yuborilgan:</span>
                    <span class="op-stat-val" style="color: ${(op.missed || 0) > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-weight: 700;">${op.missed || 0} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>Umumiy suhbat:</span>
                    <span class="op-stat-val" style="font-weight: 700; color: ${(op.totalDurationSec || 0) > 7200 ? '#fcd34d' : 'var(--text-main)'};">
                        ${formatSeconds(op.totalDurationSec || 0)} ${(op.totalDurationSec || 0) > 7200 ? '🔥' : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>O'rtacha suhbat:</span>
                    <span class="op-stat-val">${formatSeconds(op.avgDurationSec || 0)}</span>
                </div>
            </div>
        `;
    }).join('');

    // Yangi kartalardagi jonli taymerlarni darhol hisoblab ko'rsatish
    updateAllTalkingTimers();
}

/* ==========================================================================
   Detail Modal Logic (Operator Tafsilotlari & Tarixi — Audio Butunlay Yo'q)
   ========================================================================== */
function openOperatorDetail(operatorId) {
    const modal = document.getElementById('detailModal');
    const titleEl = document.getElementById('detailModalTitle');
    const subTitleEl = document.getElementById('detailModalSubtitle');
    const searchInput = document.getElementById('detailSearchInput');

    detailState.type = 'operator';
    detailState.operatorExt = operatorId;
    detailState.page = 1;
    detailState.search = '';
    detailState.category = null;
    detailState.sortKey = null;
    detailState.sortDir = 'asc';

    if (searchInput) searchInput.value = '';

    const op = currentOperators.find(o => String(o.id) === String(operatorId)) || { id: operatorId, name: `Operator ${operatorId}` };
    detailState.currentOp = op;
    const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

    if (titleEl) titleEl.innerHTML = `👤 ${cleanName} — Tafsilotlar & Bugungi Suhbatlar`;
    if (subTitleEl) subTitleEl.innerText = `Operatorning kunlik faolligi va intizomi`;

    renderOperatorSummaryPills();

    if (modal) modal.style.display = 'flex';
    fetchAndRenderDetailCalls();
}
window.openOperatorDetail = openOperatorDetail;

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
}
window.closeDetailModal = closeDetailModal;

function renderOperatorSummaryPill(label, valueHtml, colorRgb, borderRgb, category) {
    const isActive = category && detailState.category === category;
    const clickable = !!category;
    const activeStyle = isActive ? `box-shadow: 0 0 0 2px rgba(${colorRgb}, 0.7); background: rgba(${colorRgb}, 0.28);` : '';
    return `
        <div ${clickable ? `onclick="filterDetailByCategory('${category}')" title="Filtrlash uchun bosing"` : ''}
             style="background: rgba(${colorRgb}, 0.15); border: 1px solid rgba(${borderRgb}, 0.3); padding: 6px 12px; border-radius: var(--radius-sm); ${clickable ? 'cursor: pointer;' : ''} transition: box-shadow 0.15s, background 0.15s; ${activeStyle}">
            <span style="font-size: 11px; color: var(--text-muted); display: block;">${label}:</span>
            ${valueHtml}
        </div>
    `;
}

function renderOperatorSummaryPills() {
    const summaryEl = document.getElementById('detailOperatorSummary');
    const op = detailState.currentOp;
    if (!summaryEl || !op) return;

    const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-right: 20px;">
            <div class="operator-avatar" style="width: 48px; height: 48px; font-size: 15px; background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
                ${op.id}
            </div>
            <div>
                <h4 style="font-size: 16px; font-weight: 700; color: #fff; margin: 0;">${cleanName}</h4>
                <span style="font-size: 12px; color: var(--text-dim);">Ichki raqam: ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
            </div>
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
            ${renderOperatorSummaryPill('Qabul qilingan', `<b style="font-size: 14px; color: var(--success);">${op.answered || 0} ta</b>`, '16, 185, 129', '16, 185, 129', 'answered')}
            ${renderOperatorSummaryPill('Chiquvchi', `<b style="font-size: 14px; color: #38bdf8;">${op.outbound || 0} ta</b>`, '56, 189, 248', '56, 189, 248', 'outbound')}
            ${renderOperatorSummaryPill('Rad etilgan', `<b style="font-size: 14px; color: var(--danger);">${op.denied || 0} ta</b>`, '239, 68, 68', '239, 68, 68', 'denied')}
            <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Umumiy suhbat:</span>
                <b style="font-size: 14px; color: #fff;">${formatSeconds(op.totalDurationSec || 0)}</b>
            </div>
            <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">O'rtacha suhbat:</span>
                <b style="font-size: 14px; color: #fbbf24;">${formatSeconds(op.avgDurationSec || 0)}</b>
            </div>
            <div style="background: rgba(148, 163, 184, 0.1); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Liniya holati:</span>
                <b style="font-size: 12px; color: ${op.presence === 'ready' ? 'var(--success)' : (op.presence === 'talking' ? '#38bdf8' : 'var(--danger)')};">
                    ${op.presence === 'ready' ? '🟢 Qabul qilishga tayyor' : (op.presence === 'talking' ? '🔵 Hozir suhbatda' : '🔴 Offline')}
                </b>
            </div>
        </div>
    `;
}

function filterDetailByCategory(cat) {
    detailState.category = (detailState.category === cat) ? null : cat;
    renderDetailTableBody();
    renderOperatorSummaryPills();
}
window.filterDetailByCategory = filterDetailByCategory;

function sortArrow(key) {
    if (detailState.sortKey !== key) return '';
    return detailState.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function sortableTh(label, key, extraStyle = '') {
    return `<th style="cursor: pointer; user-select: none; ${extraStyle}" onclick="sortDetailTable('${key}')" title="Saralash uchun bosing">${label}${sortArrow(key)}</th>`;
}

function sortDetailTable(key) {
    if (detailState.sortKey === key) {
        detailState.sortDir = detailState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        detailState.sortKey = key;
        detailState.sortDir = 'asc';
    }
    renderDetailTableBody();
}
window.sortDetailTable = sortDetailTable;

function getFilteredSortedDetailCalls() {
    let calls = detailState.rawCalls.slice();

    if (detailState.category === 'answered') {
        calls = calls.filter(c => c.direction !== 'outbound' && c.status === 'ANSWERED');
    } else if (detailState.category === 'outbound') {
        calls = calls.filter(c => c.direction === 'outbound' && c.status === 'ANSWERED');
    } else if (detailState.category === 'denied') {
        calls = calls.filter(c => c.status !== 'ANSWERED');
    }

    if (detailState.sortKey) {
        const key = detailState.sortKey;
        const dir = detailState.sortDir === 'desc' ? -1 : 1;
        calls.sort((a, b) => {
            let va, vb;
            if (key === 'time') {
                va = new Date(a.time).getTime() || 0;
                vb = new Date(b.time).getTime() || 0;
            } else if (key === 'duration') {
                va = a.duration || a.waitSec || 0;
                vb = b.duration || b.waitSec || 0;
            } else {
                va = String(a[key] || '').toLowerCase();
                vb = String(b[key] || '').toLowerCase();
            }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
    }

    return calls;
}

function renderDetailTableBody() {
    const bodyEl = document.getElementById('detailModalBody');
    const countBadge = document.getElementById('detailCountBadge');
    if (!bodyEl) return;

    const calls = getFilteredSortedDetailCalls();

    if (countBadge) {
        const filtered = calls.length !== detailState.rawCalls.length;
        countBadge.innerText = filtered
            ? `Jami: ${detailState.total} ta qo'ng'iroq (Filtr: ${calls.length} ta)`
            : `Jami: ${detailState.total} ta qo'ng'iroq (Ko'rsatilmoqda: ${calls.length} ta)`;
    }

    if (calls.length === 0) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                Ushbu turkum bo'yicha hech qanday qo'ng'iroq topilmadi.
            </div>
        `;
        return;
    }

    bodyEl.innerHTML = `
        <table class="detail-table">
            <thead>
                <tr>
                    <th style="width: 45px; text-align: center;">№</th>
                    ${sortableTh('Vaqt', 'time')}
                    ${sortableTh('Mijoz Raqami', 'callerId')}
                    ${sortableTh("Yo'nalish", 'direction')}
                    ${sortableTh('Operator', 'operator')}
                    ${sortableTh('Suhbat / Kutish Vaqti', 'duration')}
                    ${sortableTh('Holati', 'status')}
                    <th>Kim tugatdi?</th>
                </tr>
            </thead>
            <tbody>
                ${calls.map((c, index) => {
                    const rowNum = index + 1;
                    const isAns = c.status === 'ANSWERED';
                    const isOut = c.direction === 'outbound';

                    let durText = '';
                    if (isOut) {
                        durText = isAns
                            ? `<span style="font-weight: 700; color: #34d399;">Suhbat: ${formatSeconds(c.duration)}</span>`
                            : `<span style="font-weight: 500; color: #f87171;">Chaqiruv: ${formatSeconds(c.waitSec || c.duration || 0)}</span>`;
                    } else {
                        durText = isAns
                            ? `<span style="font-weight: 700; color: #34d399;">Suhbat: ${formatSeconds(c.duration)}</span>`
                            : `<span style="font-weight: 500; color: #fbbf24;">Kutgan: ${formatSeconds(c.waitSec || c.duration || 0)}</span>`;
                    }

                    let statusBadge = '';
                    if (isOut) {
                        if (isAns) {
                            statusBadge = `<span class="badge badge-success" style="font-size: 10px;">✅ Muvaffaqiyatli</span>`;
                        } else if (c.status === 'BUSY') {
                            statusBadge = `<span class="badge badge-danger" style="font-size: 10px;">🚫 Band</span>`;
                        } else {
                            statusBadge = `<span class="badge badge-danger" style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 Javobsiz</span>`;
                        }
                    } else {
                        if (isAns) {
                            statusBadge = `<span class="badge badge-success" style="font-size: 10px;">✅ Javob berilgan</span>`;
                        } else if (c.status === 'BUSY') {
                            statusBadge = `<span class="badge badge-danger" style="font-size: 10px;">🚫 Band</span>`;
                        } else {
                            statusBadge = `<span class="badge badge-warning" style="font-size: 10px;">⏳ Navbatdan chiqdi</span>`;
                        }
                    }

                    const directionBadge = isOut
                        ? `<span class="badge badge-purple" style="font-size: 10px;"><i class="badge-dir-icon outbound"></i> chiquvchi</span>`
                        : `<span class="badge badge-info" style="font-size: 10px;"><i class="badge-dir-icon inbound"></i> kiruvchi</span>`;

                    let rowStyle = '';
                    if (isOut) {
                        rowStyle = 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
                    } else if (!isAns) {
                        rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
                    }

                    const timeStr = c.time ? new Date(c.time).toLocaleTimeString() : '-';

                    return `
                        <tr style="${rowStyle}">
                            <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                            <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${timeStr}</td>
                            <td style="white-space: nowrap;">
                                <div class="phone-cell ${isOut ? 'outbound' : ''}">
                                    <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                                    <span>${formatCallerNumber(c.callerId)}</span>
                                </div>
                            </td>
                            <td style="white-space: nowrap;">${directionBadge}</td>
                            <td style="white-space: nowrap;">
                                <span style="font-weight: 600; color: var(--text-main);">${c.operator || '-'}</span>
                            </td>
                            <td style="white-space: nowrap;">${durText}</td>
                            <td style="white-space: nowrap;">${statusBadge}</td>
                            <td style="white-space: nowrap; font-size: 12px; font-weight: 500; color: ${c.hangupParty === 'Operator' ? 'var(--warning)' : (c.hangupParty === 'Mijoz' ? '#38bdf8' : 'var(--text-dim)')}">${c.hangupParty || '-'}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function fetchAndRenderDetailCalls() {
    const bodyEl = document.getElementById('detailModalBody');
    const pageInd = document.getElementById('detailPageIndicator');
    const prevBtn = document.getElementById('detailPrevPage');
    const nextBtn = document.getElementById('detailNextPage');

    if (bodyEl) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <div class="modal-spinner-ring" style="margin: 0 auto 12px;"></div>
                <div>Ma'lumotlar yuklanmoqda...</div>
            </div>
        `;
    }

    try {
        const queryParams = new URLSearchParams({
            type: detailState.type,
            operator: detailState.operatorExt,
            page: detailState.page,
            limit: detailState.limit,
            search: detailState.search
        });

        const res = await fetch(`/api/calls/details?${queryParams.toString()}`);
        const json = await res.json();
        const calls = json.data || [];
        detailState.totalPages = json.totalPages || 1;
        detailState.total = json.total || calls.length;
        detailState.rawCalls = calls;
        detailState.sortKey = null;
        detailState.sortDir = 'asc';

        if (pageInd) pageInd.innerText = `${json.page || detailState.page} / ${detailState.totalPages}`;
        if (prevBtn) prevBtn.disabled = detailState.page <= 1;
        if (nextBtn) nextBtn.disabled = detailState.page >= detailState.totalPages;

        renderDetailTableBody();
        renderOperatorSummaryPills();
    } catch (err) {
        if (bodyEl) {
            bodyEl.innerHTML = `<div style="color: var(--danger); padding: 20px;">Yuklashda xatolik yuz berdi: ${err.message}</div>`;
        }
    }
}

function handleDetailSearch(val) {
    clearTimeout(detailSearchTimeout);
    detailSearchTimeout = setTimeout(() => {
        detailState.search = String(val || '').trim();
        detailState.page = 1;
        fetchAndRenderDetailCalls();
    }, 250);
}
window.handleDetailSearch = handleDetailSearch;

function initDetailModalEvents() {
    const btnClose = document.getElementById('btnCloseDetailModal');
    const modal = document.getElementById('detailModal');
    const limitSelect = document.getElementById('detailLimitSelect');
    const searchInput = document.getElementById('detailSearchInput');
    const prevBtn = document.getElementById('detailPrevPage');
    const nextBtn = document.getElementById('detailNextPage');

    if (btnClose) btnClose.onclick = closeDetailModal;
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closeDetailModal();
        };
    }

    if (limitSelect) {
        limitSelect.onchange = (e) => {
            detailState.limit = parseInt(e.target.value, 10) || 50;
            detailState.page = 1;
            fetchAndRenderDetailCalls();
        };
    }

    if (searchInput) {
        searchInput.oninput = (e) => handleDetailSearch(e.target.value);
        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                clearTimeout(detailSearchTimeout);
                detailState.search = e.target.value.trim();
                detailState.page = 1;
                fetchAndRenderDetailCalls();
            }
        };
    }

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (detailState.page > 1) {
                detailState.page--;
                fetchAndRenderDetailCalls();
            }
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (detailState.page < detailState.totalPages) {
                detailState.page++;
                fetchAndRenderDetailCalls();
            }
        };
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDetailModal();
            closeToolModal();
        }
    });

    const toolModal = document.getElementById('toolIframeModal');
    if (toolModal) {
        toolModal.onclick = (e) => {
            if (e.target === toolModal) closeToolModal();
        };
    }
}

/* ==========================================================================
   Tool Iframe Modal Logic
   ========================================================================== */
function openToolInModal(url, title) {
    const modal = document.getElementById('toolIframeModal');
    const iframe = document.getElementById('toolIframe');
    const titleEl = document.getElementById('toolModalTitle');
    const extLink = document.getElementById('toolModalExternalLink');

    if (!modal || !iframe) return;

    if (titleEl) titleEl.innerHTML = `🛠️ ${title || 'Tool'}`;
    if (extLink) extLink.href = url;
    iframe.src = url;
    modal.style.display = 'flex';
}
window.openToolInModal = openToolInModal;

function closeToolModal() {
    const modal = document.getElementById('toolIframeModal');
    const iframe = document.getElementById('toolIframe');
    if (modal) modal.style.display = 'none';
    if (iframe) iframe.src = '';
}
window.closeToolModal = closeToolModal;

/* ==========================================================================
   Header Live Clock
   ========================================================================== */
function initHeaderClock() {
    const el = document.getElementById('liveClockDisplay');
    if (!el) return;
    function tick() {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        el.innerText = `${hh}:${mm}:${ss}`;
    }
    tick();
    setInterval(tick, 1000);
}

/* ==========================================================================
   WebSocket Connection & Initialization
   ========================================================================== */
async function loadOperators() {
    try {
        const res = await fetch('/api/operators');
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || []);
        if (list.length > 0) {
            renderOperators(list);
        }
    } catch (e) {
        console.warn('Failed to load operators via HTTP:', e.message);
    }
}

/* ==========================================================================
   Active Viewers (Online Foydalanuvchilar)
   ========================================================================== */
let myClientIp = null;

function renderActiveViewers(data) {
    const countEl = document.getElementById('onlineViewersCount');
    const pillsEl = document.getElementById('onlineViewersPills');
    if (!countEl || !pillsEl) return;

    const viewers = (data && Array.isArray(data.viewers)) ? data.viewers : [];
    countEl.innerText = `${viewers.length} ta`;

    if (viewers.length === 0) {
        pillsEl.innerHTML = '<span class="viewer-empty-hint">Hozircha hech kim kirmagan</span>';
        return;
    }

    const html = viewers.map(v => {
        const isSelf = myClientIp && (v.ip === myClientIp);
        let pillClass = 'viewer-pill';
        let icon = '👤';
        if (v.isOperator) {
            pillClass += ' operator';
            icon = '🎧';
        } else if (v.name && (v.name.includes('Admin') || v.ip === '127.0.0.1' || v.ip === '192.168.0.2')) {
            pillClass += ' admin';
            icon = '🛡️';
        } else {
            pillClass += ' guest';
            icon = '💻';
        }
        if (isSelf) pillClass += ' self';

        const extenBadge = v.exten ? `<span class="viewer-pill-exten">${v.exten}</span>` : '';
        const youBadge = isSelf ? `<span class="viewer-pill-you">Siz</span>` : '';
        const tabsText = v.tabsCount > 1 ? ` • ${v.tabsCount} ta oyna ochiq` : '';
        const title = `${v.name} ${v.exten ? `(${v.exten})` : ''} • IP: ${v.ip}${tabsText}`;

        return `
            <div class="${pillClass}" title="${title}">
                <span>${icon}</span>
                ${extenBadge}
                <span>${v.name}</span>
                ${youBadge}
            </div>
        `;
    }).join('');

    pillsEl.innerHTML = html;
}

async function fetchActiveViewers() {
    try {
        const res = await fetch('/api/viewers/active');
        const json = await res.json();
        renderActiveViewers(json);
    } catch (e) {}
}

function initWebSocket() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('✅ Viewer WebSocket connected to', wsUrl);
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'client_identity' && msg.data) {
                    myClientIp = msg.data.ip;
                } else if (msg.type === 'active_viewers_update' && msg.data) {
                    renderActiveViewers(msg.data);
                } else if (msg.type === 'initial_state' && msg.data && msg.data.operators) {
                    renderOperators(msg.data.operators);
                } else if (msg.type === 'operators_update' && Array.isArray(msg.data)) {
                    renderOperators(msg.data);
                } else if (msg.type === 'agent_operators_update' && Array.isArray(msg.data)) {
                    renderOperators(msg.data);
                }
            } catch (err) {
                console.warn('WS parse error:', err.message);
            }
        };

        socket.onclose = () => {
            console.warn('⚠️ Viewer WebSocket disconnected. Reconnecting in 3s...');
            reconnectTimer = setTimeout(initWebSocket, 3000);
        };

        socket.onerror = (err) => {
            console.warn('WS error:', err);
            socket.close();
        };
    } catch (e) {
        reconnectTimer = setTimeout(initWebSocket, 3000);
    }
}

function initViewer() {
    initHeaderClock();
    initDetailModalEvents();
    loadOperators();
    fetchActiveViewers();
    initWebSocket();

    // Avtomatik zaxira so'rovi (har 6 soniyada)
    refreshInterval = setInterval(() => {
        loadOperators();
        fetchActiveViewers();
    }, 6000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewer);
} else {
    initViewer();
}
