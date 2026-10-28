/**
 * Call Center Viewer — Operatorlar Faoliyati (Standalone Lightweight Frontend)
 * - Faqat Operatorlar paneli
 * - Audio butunlay yo'q
 * - Real-time WebSocket + REST API
 */

// URL'dagi token parametrini tozalash (xavfsizlik va chiroyli URL uchun)
(function sanitizeTokenFromUrl() {
    try {
        if (window.location.search && window.location.search.includes('token=')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('token');
            const cleanUrl = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    } catch (_) {}
})();

// Tizimdan chiqish (Logout)
async function handleViewerLogout(event) {
    if (event) event.preventDefault();
    try {
        const res = await fetch('/api/auth/logout', { method: 'POST' });
        const data = await res.json().catch(() => null);
        if (data && data.redirect) {
            window.location.href = data.redirect;
            return;
        }
    } catch (_) {}
    window.location.href = '/logout';
}
window.handleViewerLogout = handleViewerLogout;

let EXCLUDED_OPERATOR_IDS = new Set();
async function loadExcludedOperatorsCache() {
    try {
        const res = await fetch('/api/settings/exclude-list');
        const data = await res.json();
        if (data && data.success && Array.isArray(data.excluded)) {
            EXCLUDED_OPERATOR_IDS = new Set(data.excluded.map(String));
            if (window._rawLastOperators || (typeof currentViewerOperators !== 'undefined' && currentViewerOperators.length)) {
                renderOperators(window._rawLastOperators || currentViewerOperators);
            }
        }
    } catch (e) {}
}
loadExcludedOperatorsCache();

// Operator guruhi holati (main: 100-199 | secondary: 200+ | all: barchasi)
let currentOperatorGroup = 'main';
try {
    const savedGroup = localStorage.getItem('callcenter_viewer_op_group');
    if (savedGroup && ['main', 'secondary', 'all'].includes(savedGroup)) {
        currentOperatorGroup = savedGroup;
    }
} catch (e) {}

function switchOperatorGroup(group) {
    if (!['main', 'secondary', 'all'].includes(group)) return;
    currentOperatorGroup = group;
    try {
        localStorage.setItem('callcenter_viewer_op_group', group);
    } catch (e) {}

    document.querySelectorAll('.op-group-btn').forEach(btn => {
        if (btn.getAttribute('data-group') === group) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (window._rawLastOperators) {
        renderOperators(window._rawLastOperators);
    }
}

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
    const isRinging = (pres === 'ringing') && pres !== 'talking';
    if (isRinging) return 1;

    const activeConv = (typeof currentViewerConversations !== 'undefined' && Array.isArray(currentViewerConversations))
        ? currentViewerConversations.find(c => String(c.operatorExten) === String(op.id))
        : ((typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null);

    if (pres === 'talking' || activeConv) return 2;
    if (pres === 'ready') return 3;
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

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatHangupParty(party, isXfer) {
    if (isXfer) {
        return `<span style="color: #38bdf8; font-weight: 600;">${t('party_transfer', 'Transfer')}</span>`;
    }
    if (!party || party === '-' || party === "Noma'lum" || party === 'Неизвестно' || party === 'Unknown' || party === 'Normal') {
        return `<span style="color: var(--text-dim);">${t('party_unknown', "Noma'lum")}</span>`;
    }
    const p = String(party).trim();
    const pLower = p.toLowerCase();
    if (pLower === 'mijoz' || pLower === 'client' || pLower === 'клиент') {
        return `<span style="color: var(--secondary); font-weight: 500;">${t('party_client', 'Mijoz')}</span>`;
    }
    if (pLower === "ko'tarilmadi" || pLower === "kotarilmadi" || pLower === 'not answered' || pLower === 'не отвечен' || pLower === 'не поднят') {
        return `<span style="color: var(--text-dim); font-weight: 500;">${t('party_not_answered', "Ko'tarilmadi")}</span>`;
    }
    if (pLower === 'band' || pLower === 'busy' || pLower === 'занято') {
        return `<span style="color: var(--danger); font-weight: 500;">${t('party_busy', 'Band')}</span>`;
    }
    if (pLower === 'javobsiz' || pLower === 'no answer' || pLower === 'без ответа') {
        return `<span style="color: var(--text-dim); font-weight: 500;">${t('party_no_answer', 'Javobsiz')}</span>`;
    }
    if (p.startsWith('Operator') || p.startsWith('Оператор')) {
        const extMatch = p.match(/\(([^)]+)\)/);
        const label = extMatch ? `${t('party_operator', 'Operator')} (${extMatch[1]})` : t('party_operator', 'Operator');
        return `<span style="color: var(--warning); font-weight: 500;">${label}</span>`;
    }
    if (p.includes('Transfer') || p.includes('Перевод')) {
        return `<span style="color: #38bdf8; font-weight: 600;">${t('party_transfer', 'Transfer')}</span>`;
    }
    return `<span style="font-weight: 500;">${p}</span>`;
}

function generateStarRatingHtml(totalScore, operatorName) {
    const score = parseInt(totalScore, 10) || 0;
    if (score < 1) return '';

    let currentLevel = 0;
    let nextStarNeeded = 0;
    let starsClusterHtml = '';

    if (score >= 40) {
        currentLevel = 5;
        // 5 ta yulduz: Kamalaksimon (Arch)
        // Markaziy yulduz: Diamond (olmos ko'k) rangda va kattaroq
        starsClusterHtml = `
            <div class="stars-cluster stars-count-5" title="5 ta yulduz (Diamond)">
                <div class="star-row star-row-top">
                    <span class="star-item star-peak star-diamond" title="Diamond Star">
                        <svg class="diamond-star-svg" viewBox="0 0 24 24">
                            <defs>
                                <linearGradient id="diamondStarGradViewer" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#ffffff"/>
                                    <stop offset="35%" stop-color="#7dd3fc"/>
                                    <stop offset="70%" stop-color="#38bdf8"/>
                                    <stop offset="100%" stop-color="#0284c7"/>
                                </linearGradient>
                            </defs>
                            <path d="M12 1.8L15.09 8.26L22.18 9.27L17.09 14.14L18.29 21.2L12 17.85L5.71 21.2L6.91 14.14L1.82 9.27L8.91 8.26L12 1.8Z" fill="url(#diamondStarGradViewer)" stroke="#bae6fd" stroke-width="0.75" stroke-linejoin="round"/>
                        </svg>
                    </span>
                </div>
                <div class="star-row star-row-bottom">
                    <div class="star-wing wing-left">
                        <span class="star-item star-outer">⭐</span>
                        <span class="star-item star-inner">⭐</span>
                    </div>
                    <div class="star-wing wing-right">
                        <span class="star-item star-inner">⭐</span>
                        <span class="star-item star-outer">⭐</span>
                    </div>
                </div>
            </div>
        `;
    } else if (score >= 30) {
        currentLevel = 4;
        nextStarNeeded = 40 - score;
        // 4 ta yulduz: Romb (Diamond) shakli (x / x x / x)
        starsClusterHtml = `
            <div class="stars-cluster stars-count-4" title="4 ta yulduz (Romb)">
                <div class="star-row star-row-top">
                    <span class="star-item">⭐</span>
                </div>
                <div class="star-row star-row-mid">
                    <span class="star-item">⭐</span>
                    <span class="star-item">⭐</span>
                </div>
                <div class="star-row star-row-bottom">
                    <span class="star-item">⭐</span>
                </div>
            </div>
        `;
    } else if (score >= 20) {
        currentLevel = 3;
        nextStarNeeded = 30 - score;
        // 3 ta yulduz: Tepada 1, pastda 2
        //   x
        // x   x
        starsClusterHtml = `
            <div class="stars-cluster stars-count-3" title="3 ta yulduz">
                <div class="star-row star-row-top">
                    <span class="star-item star-peak">⭐</span>
                </div>
                <div class="star-row star-row-bottom">
                    <span class="star-item">⭐</span>
                    <span class="star-item">⭐</span>
                </div>
            </div>
        `;
    } else if (score >= 10) {
        currentLevel = 2;
        nextStarNeeded = 20 - score;
        // 2 ta yulduz: Yonma-yon
        starsClusterHtml = `
            <div class="stars-cluster stars-count-2" title="2 ta yulduz">
                <div class="star-row">
                    <span class="star-item">⭐</span>
                    <span class="star-item">⭐</span>
                </div>
            </div>
        `;
    } else if (score >= 1) {
        currentLevel = 1;
        nextStarNeeded = 10 - score;
        // 1 ta yulduz
        starsClusterHtml = `
            <div class="stars-cluster stars-count-1" title="1 ta yulduz">
                <span class="star-item star-single">⭐</span>
            </div>
        `;
    }

    const progressText = nextStarNeeded > 0
        ? `<div class="star-progress-note">${tf('star_next_note', { n: `<b>${nextStarNeeded} ta</b>` }, `Keyingi yulduzgacha: yana ${nextStarNeeded} ta qo'ng'iroq kerak`)}</div>`
        : `<div class="star-progress-note" style="color: #10b981;">${t('star_max', '🏆 Maksimal daraja (TOP operator)!')}</div>`;

    return `
        <div class="star-rating-box" onclick="event.stopPropagation();">
            ${starsClusterHtml}
            <div class="star-rating-tooltip">
                <div class="star-tooltip-header">
                    <span>⭐</span>
                    <span>${t('op_mvp_system', 'Operator darajasi tizimi')}</span>
                </div>
                <div class="star-tooltip-current">
                    <b>${operatorName || 'Operator'}:</b> ${score} ${t('op_mvp_accepted_suffix', 'ta jami qo\'ng\'iroq')}
                    ${progressText}
                </div>
                <div class="star-tooltip-divider"></div>
                <div class="star-tooltip-levels">
                    <div class="star-level-row ${currentLevel === 5 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐⭐⭐</span>
                        <span class="level-range">40+ ta</span>
                        <span class="level-desc">${t('star_level_5', 'Super Elita')}</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 4 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐⭐</span>
                        <span class="level-range">30 - 39 ta</span>
                        <span class="level-desc">${t('star_level_4', 'Yetakchi')}</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 3 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐</span>
                        <span class="level-range">20 - 29 ta</span>
                        <span class="level-desc">${t('star_level_3', 'Tajribali')}</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 2 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐</span>
                        <span class="level-range">10 - 19 ta</span>
                        <span class="level-desc">${t('star_level_2', "O'rta daraja")}</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 1 ? 'current-level' : ''}">
                        <span class="level-stars">⭐</span>
                        <span class="level-range">1 - 9 ta</span>
                        <span class="level-desc">${t('star_level_1', "Boshlang'ich")}</span>
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
            el.textContent = display;
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

// Jonli suhbat taymerlarini har soniyada silliq oshirib borish (00:00 qotib qolmasligi uchun)
setInterval(updateAllTalkingTimers, 1000);

// 1-rasm: 3 yulduzli olmos lavr chambari + MVP SVG nishoni
function getDiamondWreathBadgeHtml() {
    return `
        <span class="mvp-wreath-badge diamond-wreath" title="${t('op_diamond_title', '1-o\'rin sohibi (Olmos MVP / Diamond Crown)')}">
            <svg class="mvp-wreath-svg" viewBox="0 0 140 75" width="56" height="30" aria-hidden="true">
                <defs>
                    <linearGradient id="mvpDiamondGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="35%" stop-color="#bae6fd" />
                        <stop offset="70%" stop-color="#38bdf8" />
                        <stop offset="100%" stop-color="#0284c7" />
                    </linearGradient>
                    <linearGradient id="diamondStarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="60%" stop-color="#7dd3fc" />
                        <stop offset="100%" stop-color="#0284c7" />
                    </linearGradient>
                </defs>
                <!-- 3 Olmos Yulduz -->
                <polygon points="70,3 72.8,9.5 80,9.8 74.5,14.2 76.8,21 70,16.8 63.2,21 65.5,14.2 60,9.8 67.2,9.5" fill="url(#diamondStarGrad)" />
                <polygon points="49,8 51,12.8 56.5,13 52.3,16.2 54,21 49,18 44,21 45.7,16.2 41.5,13 47,12.8" fill="url(#diamondStarGrad)" />
                <polygon points="91,8 93,12.8 98.5,13 94.3,16.2 96,21 91,18 86,21 87.7,16.2 83.5,13 89,12.8" fill="url(#diamondStarGrad)" />
                <!-- Chap Lavr Chambari -->
                <g fill="url(#mvpDiamondGrad)">
                    <path d="M 66 69 C 48 68 26 56 24 37 C 23 27 28 19 33 16" fill="none" stroke="url(#mvpDiamondGrad)" stroke-width="2" stroke-linecap="round" />
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
                <g fill="url(#mvpDiamondGrad)" transform="translate(140, 0) scale(-1, 1)">
                    <path d="M 66 69 C 48 68 26 56 24 37 C 23 27 28 19 33 16" fill="none" stroke="url(#mvpDiamondGrad)" stroke-width="2" stroke-linecap="round" />
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
                <circle cx="70" cy="69" r="2.5" fill="url(#mvpDiamondGrad)" />
                <path d="M 66 70 Q 70 74 74 70" fill="none" stroke="url(#mvpDiamondGrad)" stroke-width="1.8" />
                <!-- MVP Matni -->
                <text x="70" y="52" 
                      text-anchor="middle" 
                      font-family="'Inter', -apple-system, sans-serif" 
                      font-size="24" 
                      font-weight="900" 
                      letter-spacing="1.5" 
                      fill="url(#mvpDiamondGrad)"
                      style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">MVP</text>
            </svg>
        </span>
    `;
}
function getMvpWreathBadgeHtml() {
    return getDiamondWreathBadgeHtml();
}

// 2-rasm: 2 yulduzli oltin lavr chambari + TOP 2 SVG nishoni
function getGoldWreathBadgeHtml() {
    return `
        <span class="mvp-wreath-badge gold-wreath" title="${t('op_gold_title', '2-o\'rin sohibi (Oltin toj / Gold Crown)')}">
            <svg class="mvp-wreath-svg" viewBox="0 0 140 75" width="56" height="30" aria-hidden="true">
                <defs>
                    <linearGradient id="mvpGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#fff8cc" />
                        <stop offset="35%" stop-color="#fbbf24" />
                        <stop offset="75%" stop-color="#f59e0b" />
                        <stop offset="100%" stop-color="#b45309" />
                    </linearGradient>
                    <linearGradient id="goldStarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="60%" stop-color="#fcd34d" />
                        <stop offset="100%" stop-color="#f59e0b" />
                    </linearGradient>
                </defs>
                <!-- 2 Oltin Yulduz -->
                <polygon points="56,8 58,12.8 63.5,13 59.3,16.2 61,21 56,18 51,21 52.7,16.2 48.5,13 54,12.8" fill="url(#goldStarGrad)" />
                <polygon points="84,8 86,12.8 91.5,13 87.3,16.2 89,21 84,18 79,21 80.7,16.2 76.5,13 82,12.8" fill="url(#goldStarGrad)" />
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
                <!-- TOP 2 Matni -->
                <text x="70" y="52" 
                      text-anchor="middle" 
                      font-family="'Inter', -apple-system, sans-serif" 
                      font-size="21" 
                      font-weight="900" 
                      letter-spacing="1" 
                      fill="url(#mvpGoldGrad)"
                      style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">#2</text>
            </svg>
        </span>
    `;
}

// 3-rasm: 1 yulduzli kumush lavr chambari + TOP 3 SVG nishoni
function getSilverWreathBadgeHtml() {
    return `
        <span class="mvp-wreath-badge silver-wreath" title="${t('op_silver_title', '3-o\'rin sohibi (Kumush toj / Silver Crown)')}">
            <svg class="mvp-wreath-svg" viewBox="0 0 140 75" width="56" height="30" aria-hidden="true">
                <defs>
                    <linearGradient id="mvpSilverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="35%" stop-color="#e2e8f0" />
                        <stop offset="75%" stop-color="#94a3b8" />
                        <stop offset="100%" stop-color="#64748b" />
                    </linearGradient>
                    <linearGradient id="silverStarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="60%" stop-color="#cbd5e1" />
                        <stop offset="100%" stop-color="#94a3b8" />
                    </linearGradient>
                </defs>
                <!-- 1 Kumush Yulduz -->
                <polygon points="70,5 72.8,11.5 80,11.8 74.5,16.2 76.8,23 70,18.8 63.2,23 65.5,16.2 60,11.8 67.2,11.5" fill="url(#silverStarGrad)" />
                <!-- Chap Lavr Chambari -->
                <g fill="url(#mvpSilverGrad)">
                    <path d="M 66 69 C 48 68 26 56 24 37 C 23 27 28 19 33 16" fill="none" stroke="url(#mvpSilverGrad)" stroke-width="2" stroke-linecap="round" />
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
                <g fill="url(#mvpSilverGrad)" transform="translate(140, 0) scale(-1, 1)">
                    <path d="M 66 69 C 48 68 26 56 24 37 C 23 27 28 19 33 16" fill="none" stroke="url(#mvpSilverGrad)" stroke-width="2" stroke-linecap="round" />
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
                <circle cx="70" cy="69" r="2.5" fill="url(#mvpSilverGrad)" />
                <path d="M 66 70 Q 70 74 74 70" fill="none" stroke="url(#mvpSilverGrad)" stroke-width="1.8" />
                <!-- TOP 3 Matni -->
                <text x="70" y="52" 
                      text-anchor="middle" 
                      font-family="'Inter', -apple-system, sans-serif" 
                      font-size="21" 
                      font-weight="900" 
                      letter-spacing="1" 
                      fill="url(#mvpSilverGrad)"
                      style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">#3</text>
            </svg>
        </span>
    `;
}
function getBronzeWreathBadgeHtml() {
    return getSilverWreathBadgeHtml();
}

function sortOperatorsWithPriority(operators, sortedByScoreList, activeConversationsList) {
    if (!Array.isArray(operators) || operators.length === 0) return [];

    // 1. Reyting (o'rin) xaritasi: 1 = Diamond (Top 1), 2 = Gold (Top 2), 3 = Silver (Top 3), 4, 5...
    const rankMap = new Map();
    if (Array.isArray(sortedByScoreList)) {
        sortedByScoreList.forEach((op, idx) => {
            rankMap.set(String(op.id), idx + 1);
        });
    }

    const isOpOnline = (op) => {
        if (!op) return false;
        if (activeConversationsList && Array.isArray(activeConversationsList)) {
            const hasActive = activeConversationsList.some(c => String(c.operatorExten) === String(op.id));
            if (hasActive) return true;
        }
        const pres = String(op.presence || '').toLowerCase();
        // 'talking', 'ringing', 'ready', 'paused' — onlayn
        if (pres && pres !== 'offline' && pres !== 'unavailable') {
            return true;
        }
        return false;
    };

    return [...operators].sort((a, b) => {
        const onA = isOpOnline(a);
        const onB = isOpOnline(b);

        // 1-QOIDA: Onlaynlar DOIM boshida bo'lsin! (Onlayn > Oflayn)
        if (onA !== onB) {
            return onA ? -1 : 1;
        }

        // 2-QOIDA: Har bir guruh ichida (Onlaynlar ichida ham, Oflaynlar ichida ham)
        // Reytingga kirganlar (Diamond = 1, Gold = 2, Silver = 3...) oldinga joylashtiriladi.
        // Qancha reytingi yaxshi bo'lsa, shuncha boshida bo'ladi.
        const rankA = rankMap.get(String(a.id)) || 999999;
        const rankB = rankMap.get(String(b.id)) || 999999;

        if (rankA !== rankB) {
            return rankA - rankB;
        }

        // 3-QOIDA: Agar reytingi teng bo'lsa (yoki ikkalasi ham reyting olmagan bo'lsa):
        if (onA) {
            // Onlaynlar ichida holat bo'yicha (ringing/talking > ready > paused)
            const prA = getPresenceRank(a);
            const prB = getPresenceRank(b);
            if (prA !== prB) return prA - prB;
        }

        // 4-QOIDA: Qo'shimcha tie-breaker — qo'ng'iroqlar soni, so'ngra ID bo'yicha
        const scoreA = Number((a.grandTotal !== undefined && a.grandTotal !== null) ? a.grandTotal : (a.answered || 0)) || 0;
        const scoreB = Number((b.grandTotal !== undefined && b.grandTotal !== null) ? b.grandTotal : (b.answered || 0)) || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;

        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });
}

function renderOperators(operators) {
    if (operators && Array.isArray(operators)) {
        window._rawLastOperators = operators;
    }
    const rawList = operators || window._rawLastOperators || [];

    const allFiltered = rawList
        .filter(op => !EXCLUDED_OPERATOR_IDS.has(String(op.id)))
        .slice().sort((a, b) => {
            const rA = getPresenceRank(a);
            const rB = getPresenceRank(b);
            if (rA !== rB) return rA - rB;
            return parseInt(a.id, 10) - parseInt(b.id, 10);
        });

    // 100-199 (Asosiy) va 200+ (Zangiota 42) guruhlarga ajratish
    const mainOps = allFiltered.filter(op => {
        const num = parseInt(op.id, 10);
        return !isNaN(num) && num >= 100 && num < 200;
    });
    const secondaryOps = allFiltered.filter(op => {
        const num = parseInt(op.id, 10);
        return !isNaN(num) && num >= 200;
    });

    // Switch tugmalaridagi hisoblagichlarni yangilash
    const elCountMain = document.getElementById('countMainOps');
    const elCountSec = document.getElementById('countSecondaryOps');
    const elCountAll = document.getElementById('countAllOps');
    if (elCountMain) elCountMain.textContent = mainOps.length;
    if (elCountSec) elCountSec.textContent = secondaryOps.length;
    if (elCountAll) elCountAll.textContent = allFiltered.length;

    // Tugma active holatini sinxronlashtirish
    document.querySelectorAll('.op-group-btn').forEach(btn => {
        if (btn.getAttribute('data-group') === currentOperatorGroup) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Tanlangan guruh bo'yicha joriy ro'yxatni belgilash
    if (currentOperatorGroup === 'secondary') {
        currentOperators = secondaryOps;
    } else if (currentOperatorGroup === 'all') {
        currentOperators = allFiltered;
    } else {
        currentOperators = mainOps; // Default: Asosiy (100-199)
    }

    const grid = document.getElementById('operatorsGrid');
    if (!grid) return;

    if (currentOperators.length === 0) {
        grid.innerHTML = `
            <div style="color: var(--text-muted); font-size: 14px; padding: 24px; grid-column: 1 / -1; text-align: center;">
                Hozircha tanlangan guruhda operatorlar faoliyati aniqlanmadi.
            </div>
        `;
        return;
    }

    const sortedByScore = [...currentOperators]
        .filter(op => ((op.grandTotal ?? op.answered ?? 0) > 0) || (op.totalDurationSec || 0) > 0)
        .sort((a, b) => ((b.grandTotal ?? b.answered ?? 0) - (a.grandTotal ?? a.answered ?? 0)) || ((b.totalDurationSec || 0) - (a.totalDurationSec || 0)));
    const top1Id = sortedByScore[0] ? sortedByScore[0].id : null;
    const top2Id = sortedByScore[1] ? sortedByScore[1].id : null;
    const top3Id = sortedByScore[2] ? sortedByScore[2].id : null;
    const maxCalls = Math.max(1, ...currentOperators.map(o => {
        const val = (o.grandTotal !== undefined && o.grandTotal !== null) ? o.grandTotal : (o.answered || 0);
        return Number(val) || 0;
    }));

    // Navbatdagi keyingi qo'ng'iroqni qabul qiluvchi operatorni aniqlash (Fewest calls strategiyasi bo'yicha)
    currentOperators.forEach(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const isRinging = (pres === 'ringing') && pres !== 'talking';
        if (pres === 'ready' && !isRinging) {
            if (!operatorReadySinceMap.has(op.id)) {
                operatorReadySinceMap.set(op.id, Date.now());
            }
        } else {
            operatorReadySinceMap.delete(op.id);
        }
    });

    const candidateNextOps = currentOperators.filter(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const isRinging = (pres === 'ringing') && pres !== 'talking';
        return pres === 'ready' && !isRinging;
    });

    let predictedNextOpId = null;
    if (candidateNextOps.length > 0) {
        candidateNextOps.sort((a, b) => {
            // 1. Asosiy mezon: Asterisk navbatidagi haqiqiy hisob (callsTaken) — Asterisk fewestcalls aynan shunga qaraydi!
            const callsA = (a.callsTaken !== null && a.callsTaken !== undefined) ? Number(a.callsTaken) : 0;
            const callsB = (b.callsTaken !== null && b.callsTaken !== undefined) ? Number(b.callsTaken) : 0;
            if (callsA !== callsB) return callsA - callsB;

            // 2. Tie-breaker: Agar callsTaken teng bo'lsa, umumiy kunlik qabul qilinganlar (answered) soni bo'yicha
            const answeredA = (a.answered !== null && a.answered !== undefined) ? Number(a.answered) : 0;
            const answeredB = (b.answered !== null && b.answered !== undefined) ? Number(b.answered) : 0;
            if (answeredA !== answeredB) return answeredA - answeredB;

            // 3. Tie-breaker: Oxirgi qo'ng'iroq vaqti (eng ko'p kutgan operator)
            const lastA = (a.lastCall !== null && a.lastCall !== undefined) ? Number(a.lastCall) : 0;
            const lastB = (b.lastCall !== null && b.lastCall !== undefined) ? Number(b.lastCall) : 0;
            if (lastA > 0 && lastB > 0 && lastA !== lastB) return lastA - lastB;

            // 4. Tie-breaker: Kim birinchi bo'lib 'ready' (kutish) holatiga o'tgan
            const readySinceA = operatorReadySinceMap.get(a.id) || 0;
            const readySinceB = operatorReadySinceMap.get(b.id) || 0;
            if (readySinceA !== readySinceB && readySinceA > 0 && readySinceB > 0) return readySinceA - readySinceB;

            return parseInt(a.id, 10) - parseInt(b.id, 10);
        });
        predictedNextOpId = candidateNextOps[0].id;
    }

    // Operatorlarni 3 ta qat'iy guruhga ajratish: Suhbatda, Kutmoqda (Tayyor) va Oflayn
    const talkingOps = [];
    const readyOps = [];
    const offlineOps = [];

    currentOperators.forEach(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing') && pres !== 'talking';
        const activeConv = (typeof currentActiveConversations !== 'undefined' && Array.isArray(currentActiveConversations))
            ? currentActiveConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;

        if (pres === 'talking' || Boolean(activeConv) || ringingNow) {
            talkingOps.push(op);
        } else if (pres === 'offline') {
            offlineOps.push(op);
        } else {
            readyOps.push(op);
        }
    });

    // 1. Suhbatdagi operatorlarni saralash (eng yuqori natijadorlar oldinda)
    talkingOps.sort((a, b) => {
        const scoreA = (a.grandTotal !== undefined && a.grandTotal !== null) ? Number(a.grandTotal) : Number(a.answered || 0);
        const scoreB = (b.grandTotal !== undefined && b.grandTotal !== null) ? Number(b.grandTotal) : Number(b.answered || 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        const durA = Number(a.totalDurationSec || 0);
        const durB = Number(b.totalDurationSec || 0);
        if (durB !== durA) return durB - durA;
        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });

    // 2. Kutayotgan operatorlarni saralash (navbatdagi/predictedNextOpId oldinda)
    readyOps.sort((a, b) => {
        if (predictedNextOpId) {
            if (String(a.id) === String(predictedNextOpId)) return -1;
            if (String(b.id) === String(predictedNextOpId)) return 1;
        }
        const scoreA = (a.grandTotal !== undefined && a.grandTotal !== null) ? Number(a.grandTotal) : Number(a.answered || 0);
        const scoreB = (b.grandTotal !== undefined && b.grandTotal !== null) ? Number(b.grandTotal) : Number(b.answered || 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        const durA = Number(a.totalDurationSec || 0);
        const durB = Number(b.totalDurationSec || 0);
        if (durB !== durA) return durB - durA;
        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });

    // 3. Oflayn operatorlarni saralash
    offlineOps.sort((a, b) => {
        const scoreA = (a.grandTotal !== undefined && a.grandTotal !== null) ? Number(a.grandTotal) : Number(a.answered || 0);
        const scoreB = (b.grandTotal !== undefined && b.grandTotal !== null) ? Number(b.grandTotal) : Number(b.answered || 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });

    function renderViewerCard(op) {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing') && pres !== 'talking';
        const isOutbound = ringingCallerStr.startsWith('📤') || (op.ringingCaller && String(op.ringingCaller).startsWith('📤'));

        const activeConv = (typeof currentActiveConversations !== 'undefined' && Array.isArray(currentActiveConversations))
            ? currentActiveConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;

        let cardClass = 'operator-card clickable-card op-v2-card';
        let statusBadge = '';
        let avatarBg = '';
        let talkingTimerHtml = '';

        if (ringingNow) {
            operatorTalkingSinceMap.delete(op.id);
            const ringLabel = isOutbound ? "Chiquvchi chaqiruv..." : t('status_ringing', 'Jiringlamoqda');
            statusBadge = `<span class="status-badge badge-ringing" style="${isOutbound ? 'background: rgba(14, 165, 233, 0.15); border-color: rgba(14, 165, 233, 0.4); color: #38bdf8;' : ''}"><span class="badge-dot pulse-ring" style="${isOutbound ? 'background: #38bdf8; box-shadow: 0 0 6px #38bdf8;' : ''}"></span> ${ringLabel}</span>`;
            avatarBg = isOutbound ? 'linear-gradient(135deg, #0284c7, #0369a1)' : 'linear-gradient(135deg, #ec4899, #be185d)';
            cardClass += isOutbound ? ' status-ringing status-active call-outbound-ringing' : ' status-ringing status-active call-ringing';
        } else if (pres === 'talking') {
            statusBadge = `<span class="status-badge badge-talking"><span class="badge-dot pulse"></span> ${t('status_talking', 'Suhbatda')}</span>`;
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

            const initialDiffSec = Math.max(0, Math.floor((Date.now() - talkingSince) / 1000));
            const initM = Math.floor(initialDiffSec / 60);
            const initS = initialDiffSec % 60;
            const initH = Math.floor(initM / 60);
            const initialDisplay = initH > 0 
                ? `${initH}:${String(initM % 60).padStart(2, '0')}:${String(initS).padStart(2, '0')}`
                : `${String(initM).padStart(2, '0')}:${String(initS).padStart(2, '0')}`;
            let initWarnClass = '';
            if (initialDiffSec >= 420) initWarnClass = 'timer-danger';
            else if (initialDiffSec >= 180) initWarnClass = 'timer-warning';

            talkingTimerHtml = `
                <div class="talking-live-timer ${initWarnClass}" data-talking-since="${talkingSince}" title="${t('talking_timer_title', 'Hozirgi suhbat davomiyligi')}">
                    <span class="timer-icon">⏱️</span>
                    <span class="timer-digits">${initialDisplay}</span>
                </div>
            `;
        } else if (pres === 'offline') {
            operatorTalkingSinceMap.delete(op.id);
            if (activeConv) {
                // Oflayn (ish vaqti tugagan bo'lishi mumkin), lekin suhbat hali davom etmoqda!
                const convSince = activeConv.startTime ? new Date(activeConv.startTime).getTime() : Date.now();
                const initialDiffSec = Math.max(0, Math.floor((Date.now() - convSince) / 1000));
                const initM = Math.floor(initialDiffSec / 60);
                const initS = initialDiffSec % 60;
                const initH = Math.floor(initM / 60);
                const initialDisplay = initH > 0 
                    ? `${initH}:${String(initM % 60).padStart(2, '0')}:${String(initS).padStart(2, '0')}`
                    : `${String(initM).padStart(2, '0')}:${String(initS).padStart(2, '0')}`;
                let initWarnClass = '';
                if (initialDiffSec >= 420) initWarnClass = 'timer-danger';
                else if (initialDiffSec >= 180) initWarnClass = 'timer-warning';

                statusBadge = `<span class="status-badge" style="background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.4); color: #6ee7b7;"><span class="badge-dot pulse" style="background: #10b981; box-shadow: 0 0 6px #10b981;"></span> Suhbat davom etmoqda</span>`;
                avatarBg = 'linear-gradient(135deg, #059669, #065f46)';
                cardClass += ' status-talking status-active call-talking';
                talkingTimerHtml = `
                    <div class="talking-live-timer ${initWarnClass}" data-talking-since="${convSince}" title="${t('talking_timer_title', 'Hozirgi suhbat davomiyligi')}">
                        <span class="timer-icon">⏱️</span>
                        <span class="timer-digits">${initialDisplay}</span>
                    </div>
                `;
            } else {
                statusBadge = `<span class="status-badge badge-offline"><span class="badge-dot"></span> ${t('status_offline', 'Offline')}</span>`;
            }
            avatarBg = avatarBg || 'linear-gradient(135deg, #64748b, #475569)';
            cardClass += activeConv ? '' : ' status-offline';
        } else if (pres === 'paused' || op.paused) {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = `<span class="status-badge badge-paused"><span class="badge-dot pulse-pause"></span> ${t('status_paused', 'Pauzada')}</span>`;
            avatarBg = 'linear-gradient(135deg, #d97706, #b45309)';
            cardClass += ' status-paused';
        } else {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = `<span class="status-badge badge-ready"><span class="badge-dot"></span> ${t('wait_status', 'Kutmoqda')}</span>`;
            avatarBg = 'linear-gradient(135deg, #10b981, #059669)';
            cardClass += ' status-ready status-active';
        }

        const answered = op.answered || 0;
        const outbound = op.outbound || 0;
        const transferredIn = op.transferredIn || 0;
        const transferredOut = op.transferredOut || 0;
        const transferredTotal = transferredIn + transferredOut;
        const grandTotal = (op.grandTotal !== undefined && op.grandTotal !== null) ? op.grandTotal : answered;
        const totalScore = grandTotal;

        const rankIndex = sortedByScore.findIndex(o => o.id === op.id);

        let scorePercent = 0;
        if (grandTotal > 0) {
            scorePercent = Math.min(100, Math.max(12, Math.round((grandTotal / maxCalls) * 100)));
        }

        let rankPillHtml = '';
        let cornerTierIcon = '';
        let crownHtml = '';
        let avatarRingClass = 'ring-regular';
        let progressFillClass = 'fill-emerald';

        if (rankIndex === 0 && totalScore > 0) {
            cardClass += ' mvp-diamond';
            avatarRingClass = 'ring-diamond';
            crownHtml = `<div class="op-mockup-crown crown-diamond"></div>`;
            rankPillHtml = `<div class="op-mockup-pill pill-diamond"><span class="pill-top">MVP</span><span class="pill-bottom">Diamond #1</span></div>`;
            cornerTierIcon = `<svg class="corner-svg svg-diamond" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#00f2fe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="${t('op_diamond_title', '1-o\'rin (MVP Diamond #1)')}"><path d="M6 3h12l4 6-10 12L2 9z"></path><path d="M2 9h20"></path><path d="M10 3l-2 6 4 12 4-12-2-6"></path></svg>`;
            progressFillClass = 'fill-diamond';
        } else if (rankIndex === 1 && totalScore > 0) {
            cardClass += ' mvp-gold';
            avatarRingClass = 'ring-gold';
            crownHtml = `<div class="op-mockup-crown crown-gold"></div>`;
            rankPillHtml = `<div class="op-mockup-pill pill-gold">#2 Gold</div>`;
            cornerTierIcon = `<svg class="corner-svg svg-gold" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="${t('op_gold_title', '2-o\'rin (#2 Gold)')}"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>`;
            progressFillClass = 'fill-gold';
        } else if ((rankIndex === 2 || rankIndex === 3) && totalScore > 0) {
            cardClass += ' mvp-silver';
            avatarRingClass = 'ring-silver';
            crownHtml = `<div class="op-mockup-crown crown-silver"></div>`;
            rankPillHtml = `<div class="op-mockup-pill pill-silver">#${rankIndex + 1} Silver</div>`;
            cornerTierIcon = `<svg class="corner-svg svg-silver" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="${t('op_silver_title', `${rankIndex + 1}-o'rin (#${rankIndex + 1} Silver)`)}"><circle cx="12" cy="8" r="6"></circle><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"></path></svg>`;
            progressFillClass = 'fill-silver';
        } else if (rankIndex >= 4 && totalScore > 0) {
            rankPillHtml = `<div class="op-mockup-pill pill-regular">#${rankIndex + 1}</div>`;
        } else {
            rankPillHtml = `<div class="op-mockup-pill pill-regular">EXT: ${op.id}</div>`;
        }

        const isNextInLine = (op.id === predictedNextOpId) && (pres === 'ready') && !ringingNow;
        if (isNextInLine) {
            cardClass += ' next-in-line';
        }
        const nextInLineBadgeHtml = isNextInLine ? `
            <div class="next-call-corner-badge" title="${t('next_call_waiting_title', '🎯 100% Keyingi qo\'ng\'iroq kutilmoqda (Fewest calls navbatida #1)')}">
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
        const isTalking = (pres === 'talking' || activeConv);
        const isFree = (pres === 'ready');
        const isSelf = myOperatorId && (String(op.id) === String(myOperatorId));
        const safeCleanName = cleanName.replace(/'/g, "\\'");
        const bellBtnHtml = (isFree && !isSelf) ? `
            <button type="button" class="op-bell-btn" onclick="requestOperatorHelp(event, '${op.id}', '${safeCleanName}')" title="${tf('op_request_help_title', { name: cleanName }, `${cleanName} ga yordam so'rab qo'ng'iroq qilish`)}">
                <svg class="isax isax-notification-bing" viewBox="0 0 24 24" fill="none"><path d="M12.02 2.91C8.71 2.91 6.02 5.6 6.02 8.91V11.8C6.02 12.41 5.76 13.34 5.45 13.86L4.3 15.77C3.59 16.95 4.08 18.26 5.38 18.26H18.66C19.96 18.26 20.45 16.95 19.74 15.77L18.59 13.86C18.28 13.34 18.02 12.41 18.02 11.8V8.91C18.02 5.61 15.32 2.91 12.02 2.91Z" stroke="currentColor" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"/><path d="M13.87 3.2C13.56 3.11 13.24 3.04 12.91 3C11.95 2.88 11.03 2.99 10.17 3.28C10.42 2.52 11.15 1.97 12.02 1.97C12.89 1.97 13.62 2.52 13.87 3.2Z" stroke="currentColor" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.02 19.06C15.02 20.71 13.67 22.06 12.02 22.06C11.2 22.06 10.44 21.72 9.9 21.18C9.36 20.64 9.02 19.88 9.02 19.06" stroke="currentColor" stroke-width="1.5" stroke-miterlimit="10"/></svg>
            </button>
        ` : '';
        const isMaxmudbek = (String(op.id) === '114' || cleanName.toLowerCase().includes('maxmudbek'));
        const avatarClickAttr = isMaxmudbek 
            ? `onclick="if(window.handleMaxmudbekClick){handleMaxmudbekClick(event);}" class="op-mockup-avatar-wrap maxmudbek-clickable" title="Maxmudbek • Qora ro'yxat (Blacklist) boshqaruvi"` 
            : `class="op-mockup-avatar-wrap"`;
        const nameClickAttr = isMaxmudbek 
            ? `onclick="if(window.handleMaxmudbekClick){handleMaxmudbekClick(event);}" class="op-mockup-name maxmudbek-name-clickable" title="Maxmudbek • Qora ro'yxat (Blacklist) boshqaruvi"` 
            : `class="op-mockup-name" title="${cleanName}"`;

        return `
            <div class="${cardClass}" onclick="openOperatorDetail('${op.id}')" title="${tf('op_card_click_detail', { name: cleanName }, `${cleanName} tafsilotlarini ko'rish uchun bosing`)}">
                ${ringingNow ? `<div class="call-live-strip ${isOutbound ? 'outbound-ringing' : 'ringing'}"></div>` : (isTalking ? '<div class="call-live-strip talking"></div>' : '')}
                ${nextInLineBadgeHtml}
                <div class="op-mockup-body">
                    <!-- Chap taraf: Profil (Toj + Avatar + Pill) -->
                    <div class="op-mockup-profile">
                        <div ${avatarClickAttr}>
                            ${crownHtml}
                            <div class="op-mockup-avatar ${avatarRingClass}">
                                <span class="op-mockup-ext">${op.id}</span>
                            </div>
                        </div>
                        ${rankPillHtml}
                    </div>

                    <!-- O'ng taraf: Ma'lumotlar ustuni -->
                    <div class="op-mockup-content">
                        <div class="op-mockup-header" style="flex-direction: column; align-items: stretch; gap: 4px;">
                            <!-- 1-qator: Ism va Holat (Kutmoqda / Suhbatda / etc) -->
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                                <h4 ${nameClickAttr} style="margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cleanName}</h4>
                                <div style="flex-shrink: 0; display: flex; align-items: center; gap: 5px;">
                                    ${statusBadge}
                                    ${bellBtnHtml}
                                </div>
                            </div>
                            <!-- 2-qator: Tier/MVP nishoni (chapda) va Talking Timer (o'ngda) -->
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; min-height: 22px;">
                                <div class="op-mockup-corner-icon" style="display: flex; align-items: center;">
                                    ${cornerTierIcon}
                                </div>
                                <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                                    ${talkingTimerHtml}
                                </div>
                            </div>
                        </div>

                        <div class="op-mockup-meta">
                            <span class="op-mockup-ext-sub">Ext: ${op.id}</span>
                            <span class="op-mockup-sep">•</span>
                            <span class="op-mockup-desktop" title="${op.agentHostname || (op.agentConnected ? 'Desktop Agent Faol' : 'Desktop Agent O\'chiq')}">
                                <span class="op-mockup-dot ${op.agentConnected ? 'online' : 'offline'}"></span>
                                ${op.agentConnected ? (op.agentHostname || t('op_card_agent_active', 'Faol')) : t('op_card_agent_off', "O'chiq")}
                            </span>
                            ${generateStarRatingHtml(totalScore, cleanName)}
                        </div>

                        <!-- 3 ta ixcham ko'rsatkich qatorlari -->
                        <div class="op-mockup-stats">
                            <!-- 1. Calls Handled -->
                            <div class="op-mockup-row" title="Kiruvchi: ${answered} ta | Chiquvchi: ${outbound} ta | Kiruvchi transfer: ${transferredIn} ta | Chiquvchi transfer: ${transferredOut} ta">
                                <span class="op-mockup-label">${t('op_v2_calls_handled', 'Calls Handled')}</span>
                                <span class="op-mockup-val val-calls">${grandTotal}</span>
                            </div>

                            <!-- 2. Avg. Talk Time -->
                            <div class="op-mockup-row" title="${t('op_card_total_talk', 'Umumiy suhbat:')} ${formatSeconds(op.totalDurationSec || 0)}">
                                <span class="op-mockup-label">
                                    <svg class="op-mockup-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                    ${t('op_v2_avg_talk', 'Avg. Talk Time')}
                                </span>
                                <span class="op-mockup-val val-time">${formatSeconds(op.avgDurationSec || 0)}s</span>
                            </div>

                            <!-- 3. CSAT Score -->
                            <div class="op-mockup-row" title="${t('op_v2_csat_score', 'Samaradorlik / Reyting ko\'rsatkichi')}">
                                <span class="op-mockup-label">
                                    <svg class="op-mockup-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                        <circle cx="9" cy="7" r="4"></circle>
                                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                    </svg>
                                    ${t('op_v2_score', 'CSAT Score')}
                                </span>
                                <span class="op-mockup-val val-score">${scorePercent}%</span>
                            </div>
                        </div>

                        <!-- Progress Bar va 5-Bar Equalizer -->
                        <div class="op-mockup-progress-wrap">
                            <div class="op-mockup-bar-track">
                                <div class="op-mockup-bar-fill ${progressFillClass}" style="width: ${scorePercent}%;"></div>
                            </div>
                            <div class="op-mockup-eq ${isTalking ? 'is-talking' : ''}" title="${isTalking ? 'Suhbat davom etmoqda' : 'Liniya faol'}">
                                <span class="eq-b b-1"></span>
                                <span class="eq-b b-2"></span>
                                <span class="eq-b b-3"></span>
                                <span class="eq-b b-4"></span>
                                <span class="eq-b b-5"></span>
                            </div>
                        </div>

                        ${activeConv ? (() => {
                            const callerRaw = activeConv.callerId || '';
                            const contact = getClientContact(callerRaw);
                            const formattedPhone = formatCallerNumber(callerRaw);
                            if (contact) {
                                const hasName = Boolean(contact.name && contact.name.trim());
                                const hasOrg = Boolean(contact.organization && contact.organization.trim());
                                const titleInfo = (hasName && hasOrg) ? `${contact.name} • ${contact.organization}` : (hasOrg ? contact.organization : (hasName ? contact.name : 'Mijoz'));
                                return `
                                <div class="op-mockup-active-talk has-client-info" 
                                     onclick="event.stopPropagation(); openEditContactModal('${escapeAttr(callerRaw)}', event);"
                                     title="Mijoz: ${escapeAttr(titleInfo)} (O'zgartirish uchun bosing)">
                                    <div class="op-mockup-active-talk-head">
                                        <span class="op-mockup-pulse-dot"></span>
                                        <span class="op-mockup-talk-num" style="display: inline-flex; align-items: center; gap: 4px;">${isax('call')} ${formattedPhone}</span>
                                        <span class="op-contact-edit-icon" title="Tahrirlash" style="display: inline-flex; align-items: center;">${isax('edit', '', 'width: 12px; height: 12px;')}</span>
                                    </div>
                                    <div class="op-mockup-active-talk-sub">
                                        ${hasName ? `<span class="op-client-name" title="${escapeAttr(contact.name)}" style="display: inline-flex; align-items: center; gap: 4px;">${isax('user', '', 'width: 12px; height: 12px;')} ${escapeHtml(contact.name)}</span>` : ''}
                                        ${hasOrg ? `<span class="op-client-org" style="${!hasName ? 'font-size: 11.5px; font-weight: 700; color: #f59e0b;' : ''}" title="${escapeAttr(contact.organization)}" style="display: inline-flex; align-items: center; gap: 3px;">${isax('location', '', 'width: 11px; height: 11px;')} ${escapeHtml(contact.organization)}</span>` : ''}
                                        ${contact.language ? `<span class="op-client-lang-badge" style="display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); text-transform: uppercase;">${isax('global', '', 'width: 10px; height: 10px;')} ${escapeHtml(contact.language)}</span>` : ''}
                                    </div>
                                </div>
                                `;
                            } else {
                                return `
                                <div class="op-mockup-active-talk no-client-info" 
                                     onclick="event.stopPropagation(); openAddContactModal('${escapeAttr(callerRaw)}', event);"
                                     title="Ushbu raqamga mijoz ismi va manzilini biriktirish">
                                    <div class="op-mockup-active-talk-head">
                                        <span class="op-mockup-pulse-dot"></span>
                                        <span class="op-mockup-talk-num" style="display: inline-flex; align-items: center; gap: 4px;">${isax('call')} ${formattedPhone}</span>
                                    </div>
                                    <div class="op-mockup-active-talk-sub add-badge-sub">
                                        <span class="op-contact-add-badge">➕ Ism / Qayerdan saqlash</span>
                                    </div>
                                </div>
                                `;
                            }
                        })() : (ringingNow && op.ringingCaller ? (() => {
                            const callerRaw = String(op.ringingCaller).replace(/^📤\s*/, '').trim();
                            const contact = getClientContact(callerRaw);
                            const formattedPhone = formatCallerNumber(callerRaw);
                            if (contact) {
                                const hasName = Boolean(contact.name && contact.name.trim());
                                const hasOrg = Boolean(contact.organization && contact.organization.trim());
                                const titleInfo = (hasName && hasOrg) ? `${contact.name} • ${contact.organization}` : (hasOrg ? contact.organization : (hasName ? contact.name : 'Mijoz'));
                                return `
                                <div class="op-mockup-active-talk is-ringing has-client-info"
                                     onclick="event.stopPropagation(); openEditContactModal('${escapeAttr(callerRaw)}', event);"
                                     title="Mijoz: ${escapeAttr(titleInfo)}">
                                    <div class="op-mockup-active-talk-head">
                                        <span class="op-mockup-pulse-dot ringing"></span>
                                        <span class="op-mockup-talk-num">🔔 ${formattedPhone}</span>
                                        <span class="op-contact-edit-icon" title="Tahrirlash" style="display: inline-flex; align-items: center;">${isax('edit', '', 'width: 12px; height: 12px;')}</span>
                                    </div>
                                    <div class="op-mockup-active-talk-sub">
                                        ${hasName ? `<span class="op-client-name" title="${escapeAttr(contact.name)}" style="display: inline-flex; align-items: center; gap: 4px;">${isax('user', '', 'width: 12px; height: 12px;')} ${escapeHtml(contact.name)}</span>` : ''}
                                        ${hasOrg ? `<span class="op-client-org" style="${!hasName ? 'font-size: 11.5px; font-weight: 700; color: #f59e0b;' : ''}" title="${escapeAttr(contact.organization)}" style="display: inline-flex; align-items: center; gap: 3px;">${isax('location', '', 'width: 11px; height: 11px;')} ${escapeHtml(contact.organization)}</span>` : ''}
                                    </div>
                                </div>
                                `;
                            } else {
                                return `
                                <div class="op-mockup-active-talk is-ringing no-client-info"
                                     onclick="event.stopPropagation(); openAddContactModal('${escapeAttr(callerRaw)}', event);"
                                     title="Raqamga mijoz ma'lumotlarini kiritish">
                                    <div class="op-mockup-active-talk-head">
                                        <span class="op-mockup-pulse-dot ringing"></span>
                                        <span class="op-mockup-talk-num">🔔 ${formattedPhone}</span>
                                    </div>
                                    <div class="op-mockup-active-talk-sub add-badge-sub">
                                        <span class="op-contact-add-badge">➕ Ism / Qayerdan saqlash</span>
                                    </div>
                                </div>
                                `;
                            }
                        })() : '')}
                    </div>
                </div>
            </div>
        `;
    }

    let finalHtml = '';

    // 1-BLOK: Hozir suhbatda bo'lgan operatorlar (liniyasiz, eng tepada)
    if (talkingOps.length > 0) {
        finalHtml += talkingOps.map(renderViewerCard).join('');
    }

    // 1-LINIYA (Divider): Kutmoqda (Tayyor)
    if (readyOps.length > 0) {
        finalHtml += `
            <div class="op-grid-divider divider-ready" title="${t('op_status_ready_group', 'Qabul qilishga tayyor operatorlar')}">
                <div class="op-divider-line"></div>
                <div class="op-divider-label">
                    <span class="op-divider-dot"></span>
                    <span>${t('op_status_ready_group', 'Kutmoqda (Tayyor)')}</span>
                    <span style="background: rgba(34, 197, 94, 0.2); border-radius: 10px; padding: 1px 7px; font-size: 11px; margin-left: 2px;">${readyOps.length}</span>
                </div>
                <div class="op-divider-line"></div>
            </div>
        `;
        // 2-BLOK: Kutmoqda (Tayyor) operatorlar
        finalHtml += readyOps.map(renderViewerCard).join('');
    }

    // 2-LINIYA (Divider) & 3-BLOK: Oflayn operatorlar
    if (offlineOps.length > 0) {
        finalHtml += `
            <div class="op-grid-divider" title="${t('op_status_offline_group', 'Oflayn operatorlar')}">
                <div class="op-divider-line"></div>
                <div class="op-divider-label">
                    <span class="op-divider-dot"></span>
                    <span>${t('op_status_offline_group', 'Oflayn operatorlar')}</span>
                    <span style="background: rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 1px 7px; font-size: 11px; margin-left: 2px;">${offlineOps.length}</span>
                </div>
                <div class="op-divider-line"></div>
            </div>
        `;
        finalHtml += offlineOps.map(renderViewerCard).join('');
    }

    grid.innerHTML = finalHtml;

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

    if (titleEl) titleEl.innerHTML = `${isax('user')} ` + tf('detail_op_title', { name: cleanName }, `${cleanName} — Tafsilotlar & Bugungi Suhbatlar`);
    if (subTitleEl) subTitleEl.innerText = t('detail_subtitle_op_activity', 'Operatorning kunlik faolligi va intizomi');

    renderOperatorSummaryPills();

    if (modal) modal.style.display = 'flex';
    fetchAndRenderDetailCalls();
}
window.openOperatorDetail = openOperatorDetail;

function smoothCloseModal(modal, cleanup) {
    if (!modal || modal.style.display === 'none') return;
    if (modal.classList.contains('modal-closing')) return;
    modal.classList.add('modal-closing');
    setTimeout(() => {
        modal.classList.remove('modal-closing');
        modal.style.display = 'none';
        if (typeof cleanup === 'function') cleanup();
    }, 180);
}
window.smoothCloseModal = smoothCloseModal;

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    smoothCloseModal(modal);
}
window.closeDetailModal = closeDetailModal;

function renderOperatorSummaryPill(label, valueHtml, colorRgb, borderRgb, category) {
    const isActive = category && detailState.category === category;
    const clickable = !!category;
    const activeStyle = isActive ? `box-shadow: 0 0 0 2px rgba(${colorRgb}, 0.7); background: rgba(${colorRgb}, 0.28);` : '';
    return `
        <div ${clickable ? `onclick="filterDetailByCategory('${category}')" title="${t('filter_click_title', 'Filtrlash uchun bosing')}"` : ''}
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
                <span style="font-size: 12px; color: var(--text-dim);">${t('op_sum_internal', 'Ichki raqam:')} ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
            </div>
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
            ${renderOperatorSummaryPill(t('op_sum_answered', 'Qabul qilingan'), `<b style="font-size: 14px; color: var(--success);">${op.answered || 0} ta</b>`, '16, 185, 129', '16, 185, 129', 'answered')}
            ${renderOperatorSummaryPill(t('dir_outbound', 'Chiquvchi'), `<b style="font-size: 14px; color: #38bdf8;">${op.outbound || 0} ta</b>`, '56, 189, 248', '56, 189, 248', 'outbound')}
            ${renderOperatorSummaryPill(t('status_denied', 'Rad etilgan'), `<b style="font-size: 14px; color: var(--danger);">${op.denied || 0} ta</b>`, '239, 68, 68', '239, 68, 68', 'denied')}
            <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Umumiy suhbat:</span>
                <b style="font-size: 14px; color: #fff;">${formatSeconds(op.totalDurationSec || 0)}</b>
            </div>
            <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">O'rtacha suhbat:</span>
                <b style="font-size: 14px; color: #fbbf24;">${formatSeconds(op.avgDurationSec || 0)}</b>
            </div>
            <div style="background: rgba(148, 163, 184, 0.1); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">${t('op_sum_line_status', 'Liniya holati:')}</span>
                <b style="font-size: 12px; color: ${op.presence === 'ready' ? 'var(--success)' : (op.presence === 'talking' ? '#38bdf8' : (op.presence === 'paused' || op.paused ? '#fbbf24' : 'var(--danger)'))};">
                    ${op.presence === 'ready' ? '🟢 ' + t('op_status_ready', 'Qabul qilishga tayyor') : (op.presence === 'talking' ? '🔵 ' + t('status_talking', 'Hozir suhbatda') : (op.presence === 'paused' || op.paused ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('pause', '', 'width: 12px; height: 12px;')} Pauzada (Tanaffus)</span>` : '🔴 ' + t('op_status_offline', 'Offline')))}
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
            ? tf('detail_filter_total', { total: detailState.total, count: calls.length }, `Jami: ${detailState.total} ta qo'ng'iroq (Filtr: ${calls.length} ta)`)
            : tf('detail_total_calls', { total: detailState.total, count: calls.length }, `Jami: ${detailState.total} ta qo'ng'iroq (${t('detail_per_page', 'Ko\'rsatilmoqda')}: ${calls.length} ta)`);
    }

    if (calls.length === 0) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                ${t('detail_empty', "Ushbu turkum bo'yicha hech qanday qo'ng'iroq topilmadi.")}
            </div>
        `;
        return;
    }

    const durHeaderTitle = detailState.type === 'abandoned'
        ? t('col_wait_only', 'KUTISH VAQTI')
        : (detailState.type === 'answered'
            ? t('col_talk_only', 'SUHBAT VAQTI')
            : t('col_talk_wait', 'SUHBAT / KUTISH VAQTI'));

    bodyEl.innerHTML = `
        <table class="detail-table">
            <thead>
                <tr>
                    <th style="width: 45px; text-align: center;">${t('col_num', '№')}</th>
                    ${sortableTh(t('col_time', 'Vaqt'), 'time')}
                    ${sortableTh(t('col_client_phone', 'Mijoz Raqami'), 'callerId')}
                    ${sortableTh(t('col_direction', "Yo'nalish"), 'direction')}
                    ${sortableTh(t('col_operator', 'Operator'), 'operator')}
                    ${sortableTh(durHeaderTitle, 'duration')}
                    ${sortableTh(t('col_status', 'Holati'), 'status')}
                    <th>${t('col_hangup_party', 'Kim tugatdi?')}</th>
                </tr>
            </thead>
            <tbody>
                ${calls.map((c, index) => {
                    const rowNum = index + 1;
                    const isAns = c.status === 'ANSWERED';
                    const isOut = c.direction === 'outbound';

                    let durText = '';
                    if (detailState.type === 'abandoned') {
                        durText = `<span style="font-weight: 700; color: #fbbf24; font-family: monospace; font-size: 13px;">${formatSeconds(c.waitSec || c.duration || 0)}</span>`;
                    } else if (isOut) {
                        durText = isAns
                            ? `<span style="font-weight: 700; color: #34d399;">${t('talk_prefix', 'Suhbat:')} ${formatSeconds(c.duration)}</span>`
                            : `<span style="font-weight: 500; color: #f87171;">${t('wait_prefix', 'Chaqiruv:')} ${formatSeconds(c.waitSec || c.duration || 0)}</span>`;
                    } else {
                        durText = isAns
                            ? `<span style="font-weight: 700; color: #34d399;">${t('talk_prefix', 'Suhbat:')} ${formatSeconds(c.duration)}</span>`
                            : `<span style="font-weight: 500; color: #fbbf24;">${t('wait_prefix', 'Kutgan:')} ${formatSeconds(c.waitSec || c.duration || 0)}</span>`;
                    }

                    let statusBadge = '';
                    if (isOut) {
                        if (isAns) {
                            statusBadge = `<span class="badge badge-success" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('status_answered', 'Muvaffaqiyatli')}</span>`;
                        } else if (c.status === 'BUSY') {
                            statusBadge = `<span class="badge badge-danger" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('status_busy', 'Band')}</span>`;
                        } else {
                            statusBadge = `<span class="badge badge-danger" style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;">${isax('call-slash', '', 'width: 11px; height: 11px;')} ${t('status_no_answer', 'Javobsiz')}</span>`;
                        }
                    } else {
                        if (isAns) {
                            statusBadge = `<span class="badge badge-success" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('status_answered', 'Javob berilgan')}</span>`;
                        } else {
                            statusBadge = `<span class="badge badge-warning" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('status_abandoned', 'Navbatdan chiqdi')}</span>`;
                        }
                    }

                    const directionBadge = isOut
                        ? `<span class="badge badge-purple" style="font-size: 10px;"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>`
                        : `<span class="badge badge-info" style="font-size: 10px;"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`;

                    let rowStyle = '';
                    if (isOut) {
                        rowStyle = !isAns
                            ? 'background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444;'
                            : 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
                    } else if (!isAns) {
                        rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
                    }

                    const timeStr = c.time ? new Date(c.time).toLocaleTimeString('uz-UZ', { hour12: false, timeZone: 'Asia/Tashkent' }) : '-';

                    let hangupDisplay = formatHangupParty(c.hangupParty, c.direction === 'transfer');

                    return `
                        <tr style="${rowStyle}">
                            <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                            <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${timeStr}</td>
                            <td style="white-space: nowrap;">
                                <div class="phone-cell ${isOut ? 'outbound' : ''}">
                                    <span class="phone-icon">${isOut ? isax('export') : isax('call')}</span>
                                    <span>${formatCallerNumber(c.callerId)}</span>
                                </div>
                            </td>
                            <td style="white-space: nowrap;">${directionBadge}</td>
                            <td style="white-space: nowrap;">
                                <span style="font-weight: 600; color: var(--text-main);">${c.operator || '-'}</span>
                            </td>
                            <td style="white-space: nowrap;">${durText}</td>
                            <td style="white-space: nowrap;">${statusBadge}</td>
                            <td style="white-space: nowrap; font-size: 12px;">${hangupDisplay}</td>
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
                <div>${t('detail_loading_full', "Ma'lumotlar yuklanmoqda...")}</div>
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
            bodyEl.innerHTML = `<div style="color: var(--danger); padding: 20px;">${tf('detail_load_failed', { msg: err.message }, `Yuklashda xatolik yuz berdi: ${err.message}`)}</div>`;
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
            if (typeof closeViewerHistoryModal === 'function') closeViewerHistoryModal();
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
   Tool Modal Logic (Iframe & Image Lightbox)
   ========================================================================== */
let toolZoomState = {
    scale: 1.0
};

function getToolImageBaseWidth(img) {
    if (!img) return 850;
    const nat = img.naturalWidth || 800;
    // For narrow images like ministry-managers (575px), ensure a clear large baseline for zoom
    return Math.max(nat, 800);
}

function resetToolImageZoom() {
    const img = document.getElementById('toolImage');
    const zoomBtn = document.getElementById('toolModalZoomBtn');
    const badge = document.getElementById('toolZoomBadge');
    if (!img) return;

    toolZoomState.scale = 1.0;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.width = 'auto';
    img.style.height = 'auto';
    img.style.cursor = 'zoom-in';

    if (badge) badge.innerText = '100%';
    if (zoomBtn) {
        zoomBtn.innerHTML = `<span>${typeof t === 'function' ? t('tool_zoom_in', '🔍 Kattalashtirish') : '🔍 Kattalashtirish'}</span>`;
    }
}
window.resetToolImageZoom = resetToolImageZoom;

function setToolImageZoom(newScale) {
    const img = document.getElementById('toolImage');
    const zoomBtn = document.getElementById('toolModalZoomBtn');
    const badge = document.getElementById('toolZoomBadge');
    if (!img) return;

    // Clamp scale between 1.0 and 3.0
    newScale = Math.max(1.0, Math.min(3.0, Math.round(newScale * 10) / 10));
    toolZoomState.scale = newScale;

    if (newScale <= 1.05) {
        resetToolImageZoom();
        return;
    }

    const baseWidth = getToolImageBaseWidth(img);
    const targetWidth = Math.round(baseWidth * newScale);

    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.width = `${targetWidth}px`;
    img.style.height = 'auto';
    img.style.cursor = 'zoom-out';

    if (badge) badge.innerText = `${Math.round(newScale * 100)}%`;
    if (zoomBtn) {
        zoomBtn.innerHTML = `<span>${typeof t === 'function' ? t('tool_zoom_out', '🔍 Kichraytirish') : '🔍 Kichraytirish'}</span>`;
    }
}
window.setToolImageZoom = setToolImageZoom;

function toggleToolImageZoom() {
    if (!toolZoomState.scale || toolZoomState.scale <= 1.05) {
        setToolImageZoom(1.8);
    } else {
        resetToolImageZoom();
    }
}
window.toggleToolImageZoom = toggleToolImageZoom;

function changeToolZoomStep(delta) {
    const current = toolZoomState.scale || 1.0;
    let next = current + delta;
    if (next < 1.05 && delta < 0) {
        resetToolImageZoom();
    } else {
        setToolImageZoom(next);
    }
}
window.changeToolZoomStep = changeToolZoomStep;

function handleToolImageWheel(event) {
    if (!event) return;
    if (event.ctrlKey || event.altKey) {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.25 : -0.25;
        changeToolZoomStep(delta);
    }
}
window.handleToolImageWheel = handleToolImageWheel;

function openToolInModal(url, title, type = 'auto') {
    const modal = document.getElementById('toolIframeModal');
    const iframe = document.getElementById('toolIframe');
    const imgContainer = document.getElementById('toolImageContainer');
    const img = document.getElementById('toolImage');
    const zoomBtn = document.getElementById('toolModalZoomBtn');
    const zoomControls = document.getElementById('toolImageZoomControls');
    const titleEl = document.getElementById('toolModalTitle');
    const extLink = document.getElementById('toolModalExternalLink');

    if (!modal) return;

    const isImage = (type === 'image') || (typeof url === 'string' && url.match(/\.(jpg|jpeg|png|webp|svg|gif)(\?.*)?$/i));

    if (extLink) extLink.href = url;

    const resolvedTitle = (typeof t === 'function' && title) ? t(title, title) : (title || (typeof t === 'function' ? t('tool_regions_title', "Viloyat mas'ullari") : "Viloyat mas'ullari"));

    if (isImage) {
        if (titleEl) titleEl.innerHTML = `${isax('clipboard-text')} ${resolvedTitle}`;
        if (iframe) {
            iframe.style.display = 'none';
            iframe.src = '';
        }
        if (imgContainer && img) {
            imgContainer.style.display = 'flex';
            img.src = url;
            resetToolImageZoom();
        }
        if (zoomBtn) zoomBtn.style.display = 'inline-flex';
        if (zoomControls) zoomControls.style.display = 'inline-flex';
    } else {
        if (titleEl) titleEl.innerHTML = `🛠️ ${resolvedTitle || 'Tool'}`;
        if (imgContainer && img) {
            imgContainer.style.display = 'none';
            img.src = '';
            resetToolImageZoom();
        }
        if (zoomBtn) zoomBtn.style.display = 'none';
        if (zoomControls) zoomControls.style.display = 'none';
        if (iframe) {
            iframe.style.display = 'block';
            iframe.src = url;
        }
    }

    modal.style.display = 'flex';
}
window.openToolInModal = openToolInModal;

function closeToolModal() {
    const modal = document.getElementById('toolIframeModal');
    const iframe = document.getElementById('toolIframe');
    const img = document.getElementById('toolImage');
    const imgContainer = document.getElementById('toolImageContainer');
    const zoomBtn = document.getElementById('toolModalZoomBtn');
    const zoomControls = document.getElementById('toolImageZoomControls');

    smoothCloseModal(modal, () => {
        if (iframe) {
            iframe.style.display = 'none';
            iframe.src = '';
        }
        if (img) {
            img.src = '';
            resetToolImageZoom();
        }
        if (imgContainer) imgContainer.style.display = 'none';
        if (zoomBtn) zoomBtn.style.display = 'none';
        if (zoomControls) zoomControls.style.display = 'none';
    });
}
window.closeToolModal = closeToolModal;

// Modal backdrop click and ESC key listeners
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('toolIframeModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeToolModal();
            }
        });
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('toolIframeModal');
        if (modal && modal.style.display === 'flex') {
            closeToolModal();
        }
    }
});

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
let myUserRole = null;
let myUsername = null;

function checkSuperuserPrivileges() {
    const btnHistory = document.getElementById('btnViewerHistory');
    if (btnHistory) {
        if (myUserRole === 'superuser') {
            btnHistory.style.display = 'inline-flex';
        } else {
            btnHistory.style.display = 'none';
        }
    }
}

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
        let isSelf = false;
        if (v.isOperator) {
            isSelf = myOperatorId && (String(v.id || v.exten) === String(myOperatorId));
        } else if (myUsername && myUsername !== 'anon') {
            isSelf = (v.name && v.name.includes(myUsername)) || (v.username === myUsername);
        } else {
            isSelf = myClientIp && (v.ip === myClientIp);
        }

        let pillClass = 'viewer-pill';
        let icon = isax('user');
        if (v.isOperator) {
            pillClass += ' operator';
            icon = isax('headphone');
        } else if (v.name && (v.name.includes('Admin') || v.ip === '127.0.0.1' || v.ip === '192.168.0.2')) {
            pillClass += ' admin';
            icon = isax('flash');
        } else {
            pillClass += ' guest';
            icon = isax('global');
        }
        if (isSelf) {
            pillClass += ' self';
            if (v.isOperator && !myOperatorId) {
                setMyOperator(v.id || v.exten, v.name);
            }
        }

        const canSwitch = isSelf && !isOperatorLocked;
        const extenBadge = v.exten ? `<span class="viewer-pill-exten">${v.exten}</span>` : '';
        const youBadge = isSelf ? `<span class="viewer-pill-you" title="${isOperatorLocked ? 'Akkauntingizga qotirilgan profil' : 'Profilni o\'zgartirish'}">Siz</span>` : '';
        const tabsText = v.tabsCount > 1 ? ` • ${v.tabsCount} ta oyna ochiq` : '';
        const title = `${v.name} ${v.exten ? `(${v.exten})` : ''} • IP: ${v.ip}${tabsText}${canSwitch ? ' (Profilni tanlash uchun bosing)' : (isSelf && isOperatorLocked ? ' (Akkauntingizga qotirilgan profil)' : '')}`;
        const clickAttr = canSwitch 
            ? `onclick="openOperatorSelectSelfModal()" style="cursor: pointer;"` 
            : (isSelf && isOperatorLocked ? `onclick="showLockedProfileNotice()" style="cursor: pointer;"` : '');

        return `
            <div class="${pillClass}" title="${title}" ${clickAttr}>
                <span>${icon}</span>
                ${extenBadge}
                <span>${v.name}</span>
                ${youBadge}
            </div>
        `;
    }).join('');

    pillsEl.innerHTML = html;
}

/* ==========================================================================
   Viewer Access History Modal Controller (Faqat Superuser uchun)
   ========================================================================== */
let cachedViewerHistoryList = [];
let currentViewerHistoryFilter = 'all';

async function openViewerHistoryModal() {
    if (myUserRole !== 'superuser') {
        alert("Kechirasiz, ushbu ma'lumot faqat Superuser uchun ruxsat etilgan!");
        return;
    }
    const modal = document.getElementById('viewerHistoryModal');
    if (modal) modal.style.display = 'flex';
    await loadViewerHistoryData();
}

function closeViewerHistoryModal() {
    const modal = document.getElementById('viewerHistoryModal');
    smoothCloseModal(modal);
}

async function loadViewerHistoryData() {
    const tbody = document.getElementById('viewerHistoryTableBody');
    const countLabel = document.getElementById('viewerHistoryCountLabel');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 25px; color: #94a3b8;">Yangilanmoqda...</td></tr>';
    }
    if (countLabel) countLabel.innerText = 'Yuklanmoqda...';

    try {
        const resp = await fetch('/api/viewers/history');
        if (resp.status === 403) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 25px; color: #ef4444;">Kirish taqiqlangan: Faqat Superuser ko\'ra oladi!</td></tr>';
            return;
        }
        const json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
            cachedViewerHistoryList = json.data;
            renderViewerHistoryTable();
        } else {
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 25px; color: #ef4444;">Ma\'lumotlarni olishda xatolik yuz berdi</td></tr>';
        }
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: #ef4444;">Xatolik: ${e.message}</td></tr>`;
    }
}

function setViewerHistoryFilter(type, btn) {
    currentViewerHistoryFilter = type;
    document.querySelectorAll('.vh-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderViewerHistoryTable();
}

function filterViewerHistoryTable() {
    renderViewerHistoryTable();
}

function formatDurationSeconds(sec) {
    if (!sec || sec < 1) return '1 soniya';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s} soniya`;
    const h = Math.floor(m / 60);
    const mRemain = m % 60;
    if (h === 0) return `${m} daq ${s} son`;
    return `${h} soat ${mRemain} daq`;
}

function formatHistoryDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    return `${day}.${month} ${hour}:${min}:${sec}`;
}

function renderViewerHistoryTable() {
    const tbody = document.getElementById('viewerHistoryTableBody');
    const countLabel = document.getElementById('viewerHistoryCountLabel');
    const searchVal = (document.getElementById('viewerHistorySearch')?.value || '').toLowerCase().trim();

    if (!tbody) return;

    let filtered = cachedViewerHistoryList.filter(item => {
        if (currentViewerHistoryFilter === 'online' && item.status !== 'online') return false;
        if (currentViewerHistoryFilter === 'offline' && item.status !== 'offline') return false;
        if (searchVal) {
            const str = `${item.ip} ${item.username} ${item.operatorName} ${item.operatorId} ${item.role}`.toLowerCase();
            if (!str.includes(searchVal)) return false;
        }
        return true;
    });

    if (countLabel) {
        countLabel.innerText = `Ko'rsatilmoqda: ${filtered.length} ta (Jami: ${cachedViewerHistoryList.length})`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;">Mos keluvchi yozuvlar topilmadi</td></tr>';
        return;
    }

    const rows = filtered.map(item => {
        const isOnline = item.status === 'online';
        const statusBadge = isOnline
            ? '<span class="vh-badge online"><span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%; display: inline-block;"></span> Faol</span>'
            : '<span class="vh-badge offline">Chiqdi</span>';

        const displayName = item.operatorName 
            ? `<strong>${item.operatorName}</strong> <span style="font-size: 11px; color: #94a3b8;">(${item.operatorId})</span>`
            : `<span>${item.username || 'Mehmon'}</span>`;

        let roleBadgeColor = '#94a3b8';
        if (item.role === 'superuser' || item.role === 'admin') roleBadgeColor = '#f59e0b';
        else if (item.operatorId) roleBadgeColor = '#38bdf8';

        const roleText = item.role === 'superuser' ? 'Superuser' : (item.operatorId ? 'Operator' : 'Kuzatuvchi');
        const roleBadge = `<span style="font-size: 11px; font-weight: 700; color: ${roleBadgeColor}; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 5px;">${roleText}</span>`;

        const connectedStr = formatHistoryDateTime(item.connectedAt);
        const disconnectedStr = isOnline ? '<span style="color: #34d399; font-weight: 600;">Hozir ham saytda</span>' : formatHistoryDateTime(item.disconnectedAt);
        
        const durationStr = isOnline 
            ? formatDurationSeconds(Math.round((Date.now() - item.connectedAt) / 1000)) + ' (davom etmoqda)'
            : formatDurationSeconds(item.durationSeconds);

        return `
            <tr>
                <td>${statusBadge}</td>
                <td>${displayName}</td>
                <td>${roleBadge}</td>
                <td><code style="font-size: 12px; color: #cbd5e1; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">${item.ip}</code></td>
                <td>${connectedStr}</td>
                <td>${disconnectedStr}</td>
                <td style="color: #cbd5e1;">${durationStr}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;
}
window.openViewerHistoryModal = openViewerHistoryModal;
window.closeViewerHistoryModal = closeViewerHistoryModal;
window.loadViewerHistoryData = loadViewerHistoryData;
window.setViewerHistoryFilter = setViewerHistoryFilter;
window.filterViewerHistoryTable = filterViewerHistoryTable;

/* ==========================================================================
   Operator Assistance (Ring Bell / Yordam so'rash tizimi)
   ========================================================================== */
let myOperatorId = localStorage.getItem('viewer_my_operator_id') || null;
let myOperatorName = localStorage.getItem('viewer_my_operator_name') || null;
let isOperatorLocked = false;
let currentOutgoingRequest = null;
let currentIncomingRequest = null;
let outgoingTimeoutTimer = null;
let titleBlinkTimer = null;
window.defaultPageTitle = 'Call Center — Operatorlar';

const KNOWN_OPERATOR_NAMES = {
    '101': 'Oybek',
    '102': 'Dilnoza',
    '103': 'Feruza',
    '104': 'Zuhra',
    '105': 'Shaxnoza',
    '106': 'Gulchehra',
    '107': 'Madina',
    '108': 'Xurshida',
    '109': 'Sitora',
    '111': 'Nozima',
    '112': 'Nargiza',
    '113': 'Malika',
    '114': 'Maxmudbek',
    '115': 'Nilufar',
    '117': 'Zarnigor',
    '119': 'Muattar',
    '120': 'Navruzoy'
};

function updateHeaderUserProfile(opName, opId, username, role) {
    const badge = document.getElementById('headerUserProfileBadge');
    const nameEl = document.getElementById('headerUserNameText');
    if (!badge || !nameEl) return;

    let displayName = '';
    const cleanOpId = String(opId || myOperatorId || '').trim();

    // 1. Agar operator nomi to'g'ridan-to'g'ri berilgan bo'lsa
    if (opName && !/^operator\s*\d+$/i.test(String(opName).trim())) {
        displayName = String(opName).replace(/\s*\(\d+\)\s*/g, '').replace('Ubaydullayeva ', '').trim();
    }

    // 2. Agar operator ID bo'yicha ma'lum bo'lsa (masalan 101 -> Oybek)
    if (!displayName && cleanOpId && KNOWN_OPERATOR_NAMES[cleanOpId]) {
        displayName = KNOWN_OPERATOR_NAMES[cleanOpId];
    }

    // 3. Agar hozirgi faol operatorlar ro'yxatida bo'lsa
    if (!displayName && cleanOpId && window._rawLastOperators) {
        const found = window._rawLastOperators.find(o => String(o.id || o.exten) === cleanOpId);
        if (found && (found.realName || found.name)) {
            displayName = getCleanOperatorName(found.realName || found.name, cleanOpId).replace('Ubaydullayeva ', '').trim();
        }
    }

    // 4. Superuser yoki username bo'yicha fallback
    const effectiveRole = role || myUserRole;
    const effectiveUser = username || myUsername;
    if (!displayName) {
        if (cleanOpId) {
            displayName = `Operator ${cleanOpId}`;
        } else if (effectiveRole === 'superuser' || effectiveUser === 'superuser') {
            displayName = 'Superuser';
        } else if (effectiveUser && effectiveUser !== 'anon' && effectiveUser !== 'Mehmon') {
            displayName = effectiveUser;
        } else {
            displayName = 'Operator';
        }
    }

    nameEl.textContent = displayName;
    const titleText = cleanOpId ? `Joriy profil: ${displayName} (${cleanOpId})` : `Joriy profil: ${displayName}`;
    badge.setAttribute('title', titleText);
    badge.style.display = 'inline-flex';
}
window.updateHeaderUserProfile = updateHeaderUserProfile;

async function initViewerProfileIdentity() {
    if (myOperatorId || myOperatorName) {
        updateHeaderUserProfile(myOperatorName, myOperatorId, myUsername, myUserRole);
    }
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data && data.user) {
                window.currentViewerUser = data.user;
                if (data.user.role) myUserRole = data.user.role;
                if (data.user.username) myUsername = data.user.username;
                if (data.user.operatorId) {
                    myOperatorId = String(data.user.operatorId);
                    myOperatorName = String(data.user.operatorName || '');
                    localStorage.setItem('viewer_my_operator_id', myOperatorId);
                    localStorage.setItem('viewer_my_operator_name', myOperatorName);
                }
                updateHeaderUserProfile(data.user.operatorName, data.user.operatorId, data.user.username, data.user.role);
                const gmailDot = document.getElementById('headerUserGmailDot');
                if (gmailDot) {
                    gmailDot.style.display = data.user.email ? 'inline-block' : 'none';
                }
                checkSuperuserPrivileges();
            }
        }
    } catch (_) {}
}

let viewerProfileTimerInterval = null;
let viewerProfilePendingEmail = '';

function updateViewerProfileEmailBadge(inputEmail) {
    const statusBadge = document.getElementById('viewerProfileEmailStatusBadge');
    if (!statusBadge) return;
    const currentEmail = (window.currentViewerUser && window.currentViewerUser.email) || '';
    const cleanInput = String(inputEmail || '').trim().toLowerCase();
    const cleanCurrent = String(currentEmail || '').trim().toLowerCase();

    if (cleanCurrent && cleanInput === cleanCurrent) {
        statusBadge.textContent = 'Ulangan';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        statusBadge.style.color = '#34d399';
        statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
    } else if (cleanInput) {
        statusBadge.textContent = 'Tasdiqlanmagan';
        statusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        statusBadge.style.color = '#fbbf24';
        statusBadge.style.border = '1px solid rgba(245, 158, 11, 0.3)';
    } else {
        statusBadge.textContent = 'Ulanmagan';
        statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        statusBadge.style.color = '#f87171';
        statusBadge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
    }
}

function startViewerProfileTimer(seconds = 120) {
    if (viewerProfileTimerInterval) {
        clearInterval(viewerProfileTimerInterval);
        viewerProfileTimerInterval = null;
    }
    let remaining = seconds;
    const timerEl = document.getElementById('viewerProfileTimer');
    const resendBtn = document.getElementById('btnResendViewerProfileCode');

    if (resendBtn) {
        resendBtn.disabled = true;
        resendBtn.style.color = '#64748b';
        resendBtn.style.cursor = 'not-allowed';
    }

    const render = () => {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        const text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        if (timerEl) timerEl.textContent = text;
    };
    render();

    viewerProfileTimerInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(viewerProfileTimerInterval);
            viewerProfileTimerInterval = null;
            if (timerEl) timerEl.textContent = '00:00';
            if (resendBtn) {
                resendBtn.disabled = false;
                resendBtn.style.color = '#38bdf8';
                resendBtn.style.cursor = 'pointer';
            }
        } else {
            render();
        }
    }, 1000);
}

function resetViewerProfileEmailEdit() {
    if (viewerProfileTimerInterval) {
        clearInterval(viewerProfileTimerInterval);
        viewerProfileTimerInterval = null;
    }
    const verifySection = document.getElementById('viewerProfileVerifySection');
    const emailInput = document.getElementById('viewerProfileEmailInput');
    const btnSend = document.getElementById('btnSendViewerProfileCode');
    const btnVerify = document.getElementById('btnVerifyViewerProfileCode');
    const msgEl = document.getElementById('viewerProfileEmailMsg');

    if (verifySection) verifySection.style.display = 'none';
    if (emailInput) {
        emailInput.readOnly = false;
        emailInput.focus();
    }
    if (btnSend) {
        btnSend.style.display = 'inline-flex';
        btnSend.disabled = false;
    }
    if (btnVerify) {
        btnVerify.style.display = 'none';
    }
    if (msgEl) msgEl.textContent = '';
}
window.resetViewerProfileEmailEdit = resetViewerProfileEmailEdit;

function openViewerProfileModal() {
    const modal = document.getElementById('modalViewerProfile');
    if (!modal) return;

    const u = window.currentViewerUser || {};
    const unameEl = document.getElementById('viewerProfileModalUsername');
    const roleBadge = document.getElementById('viewerProfileModalRoleBadge');
    const opNameEl = document.getElementById('viewerProfileModalOpName');
    const emailInput = document.getElementById('viewerProfileEmailInput');
    const msgEl = document.getElementById('viewerProfileEmailMsg');
    const codeInput = document.getElementById('viewerProfileCodeInput');

    if (unameEl) unameEl.textContent = u.username || myUsername || 'operator';
    if (roleBadge) {
        const isSuper = (u.role === 'superuser' || myUserRole === 'superuser');
        roleBadge.textContent = isSuper ? 'Superuser' : 'Operator';
        roleBadge.style.color = isSuper ? '#60a5fa' : '#34d399';
        roleBadge.style.background = isSuper ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)';
    }
    if (opNameEl) {
        const nameText = myOperatorName || u.operatorName || (myOperatorId ? `Operator ${myOperatorId}` : '');
        opNameEl.textContent = nameText;
    }
    if (emailInput) {
        emailInput.value = u.email || '';
        emailInput.readOnly = false;
        if (!emailInput._hasInputListener) {
            emailInput.addEventListener('input', () => updateViewerProfileEmailBadge(emailInput.value));
            emailInput._hasInputListener = true;
        }
    }
    if (codeInput) {
        codeInput.value = '';
        if (!codeInput._hasAutoSubmit) {
            codeInput.addEventListener('input', () => {
                const val = codeInput.value.replace(/\D/g, '').slice(0, 6);
                codeInput.value = val;
                if (val.length === 6) {
                    verifyViewerProfileCode();
                }
            });
            codeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    verifyViewerProfileCode();
                }
            });
            codeInput._hasAutoSubmit = true;
        }
    }

    updateViewerProfileEmailBadge(u.email);
    resetViewerProfileEmailEdit();
    if (msgEl) msgEl.textContent = '';

    modal.style.display = 'flex';
    setTimeout(() => {
        if (emailInput) emailInput.focus();
    }, 100);
}
window.openViewerProfileModal = openViewerProfileModal;

function closeViewerProfileModal() {
    if (viewerProfileTimerInterval) {
        clearInterval(viewerProfileTimerInterval);
        viewerProfileTimerInterval = null;
    }
    const modal = document.getElementById('modalViewerProfile');
    smoothCloseModal(modal);
}
window.closeViewerProfileModal = closeViewerProfileModal;

async function sendViewerProfileCode(event) {
    if (event) event.preventDefault();
    const emailInput = document.getElementById('viewerProfileEmailInput');
    const btnSend = document.getElementById('btnSendViewerProfileCode');
    const btnSendText = document.getElementById('btnSendViewerProfileCodeText');
    const btnVerify = document.getElementById('btnVerifyViewerProfileCode');
    const msgEl = document.getElementById('viewerProfileEmailMsg');
    const verifySection = document.getElementById('viewerProfileVerifySection');
    const codeInput = document.getElementById('viewerProfileCodeInput');

    const email = emailInput?.value?.trim().toLowerCase() || '';
    if (!email) {
        if (msgEl) {
            msgEl.textContent = 'Iltimos, Gmail manzilingizni kiriting';
            msgEl.style.color = '#f87171';
        }
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (msgEl) {
            msgEl.textContent = "Email formati noto'g'ri (masalan: ism@gmail.com)";
            msgEl.style.color = '#f87171';
        }
        return;
    }

    if (btnSend) btnSend.disabled = true;
    if (btnSendText) btnSendText.textContent = 'Kod yuborilmoqda...';
    if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.color = '#94a3b8';
    }

    try {
        const res = await fetch('/api/auth/profile/email/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data && data.success) {
            viewerProfilePendingEmail = email;
            if (emailInput) emailInput.readOnly = true;
            if (verifySection) verifySection.style.display = 'block';
            if (btnSend) btnSend.style.display = 'none';
            if (btnVerify) {
                btnVerify.style.display = 'inline-flex';
                btnVerify.disabled = false;
            }
            if (msgEl) {
                msgEl.textContent = data.message || `6 xonali tasdiqlash kodi ${email} manziliga yuborildi`;
                msgEl.style.color = '#38bdf8';
            }
            startViewerProfileTimer(data.expiresInSeconds || 120);
            if (codeInput) {
                codeInput.value = '';
                setTimeout(() => codeInput.focus(), 150);
            }
        } else {
            if (msgEl) {
                msgEl.textContent = data.error || 'Tasdiqlash kodini yuborishda xatolik yuz berdi';
                msgEl.style.color = '#f87171';
            }
        }
    } catch (e) {
        if (msgEl) {
            msgEl.textContent = 'Server bilan aloqa xatosi: ' + e.message;
            msgEl.style.color = '#f87171';
        }
    } finally {
        if (btnSend) btnSend.disabled = false;
        if (btnSendText) btnSendText.textContent = 'Tasdiqlash kodini olish';
    }
}
window.sendViewerProfileCode = sendViewerProfileCode;

async function resendViewerProfileCode() {
    const resendBtn = document.getElementById('btnResendViewerProfileCode');
    if (resendBtn && resendBtn.disabled) return;
    await sendViewerProfileCode();
}
window.resendViewerProfileCode = resendViewerProfileCode;

async function verifyViewerProfileCode(event) {
    if (event) event.preventDefault();
    const codeInput = document.getElementById('viewerProfileCodeInput');
    const btnVerify = document.getElementById('btnVerifyViewerProfileCode');
    const btnVerifyText = document.getElementById('btnVerifyViewerProfileCodeText');
    const msgEl = document.getElementById('viewerProfileEmailMsg');
    const statusBadge = document.getElementById('viewerProfileEmailStatusBadge');
    const gmailDot = document.getElementById('headerUserGmailDot');
    const emailInput = document.getElementById('viewerProfileEmailInput');

    const email = viewerProfilePendingEmail || emailInput?.value?.trim().toLowerCase() || '';
    const code = codeInput?.value?.trim().replace(/\D/g, '') || '';

    if (!code || code.length !== 6) {
        if (msgEl) {
            msgEl.textContent = "Iltimos, 6 xonali tasdiqlash kodini to'liq kiriting";
            msgEl.style.color = '#f87171';
        }
        if (codeInput) codeInput.focus();
        return;
    }

    if (btnVerify) btnVerify.disabled = true;
    if (btnVerifyText) btnVerifyText.textContent = 'Tasdiqlanmoqda...';
    if (msgEl) msgEl.textContent = '';

    try {
        const res = await fetch('/api/auth/profile/email/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (data && data.success) {
            if (viewerProfileTimerInterval) {
                clearInterval(viewerProfileTimerInterval);
                viewerProfileTimerInterval = null;
            }
            if (window.currentViewerUser) {
                window.currentViewerUser.email = data.email;
            }
            if (statusBadge) {
                statusBadge.textContent = 'Ulangan';
                statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                statusBadge.style.color = '#34d399';
                statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            }
            if (gmailDot) {
                gmailDot.style.display = 'inline-block';
            }
            if (emailInput) {
                emailInput.value = data.email;
                emailInput.readOnly = false;
            }
            const verifySection = document.getElementById('viewerProfileVerifySection');
            if (verifySection) verifySection.style.display = 'none';

            const btnSend = document.getElementById('btnSendViewerProfileCode');
            if (btnSend) btnSend.style.display = 'inline-flex';
            if (btnVerify) btnVerify.style.display = 'none';

            if (msgEl) {
                msgEl.textContent = data.message || "Gmail manzilingiz muvaffaqiyatli tasdiqlandi va bog'landi!";
                msgEl.style.color = '#34d399';
            }
            setTimeout(() => {
                closeViewerProfileModal();
            }, 1400);
        } else {
            if (msgEl) {
                msgEl.textContent = data.error || "Tasdiqlash kodi noto'g'ri";
                msgEl.style.color = '#f87171';
            }
            if (codeInput) {
                codeInput.focus();
                codeInput.select();
            }
        }
    } catch (e) {
        if (msgEl) {
            msgEl.textContent = 'Server bilan aloqa xatosi: ' + e.message;
            msgEl.style.color = '#f87171';
        }
    } finally {
        if (btnVerify) btnVerify.disabled = false;
        if (btnVerifyText) btnVerifyText.textContent = 'Tasdiqlash va Bog\'lash';
    }
}
window.verifyViewerProfileCode = verifyViewerProfileCode;
window.saveViewerProfileEmail = sendViewerProfileCode;

function setMyOperator(id, name) {
    myOperatorId = String(id || '').trim();
    myOperatorName = String(name || '').trim();
    if (myOperatorId) {
        localStorage.setItem('viewer_my_operator_id', myOperatorId);
        localStorage.setItem('viewer_my_operator_name', myOperatorName);
        registerMyOperatorWithServer();
    } else {
        localStorage.removeItem('viewer_my_operator_id');
        localStorage.removeItem('viewer_my_operator_name');
    }
    if (currentViewerOperators && currentViewerOperators.length > 0) {
        renderOperators(currentViewerOperators);
    }
    if (window.TicketsApp && typeof window.TicketsApp.setOperatorIdentity === 'function') {
        window.TicketsApp.setOperatorIdentity(myOperatorId, myOperatorName);
    }
    updateHeaderUserProfile(myOperatorName, myOperatorId, myUsername, myUserRole);
}

function registerMyOperatorWithServer() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!myOperatorId) return;
    try {
        socket.send(JSON.stringify({
            type: 'register_operator',
            data: {
                operatorId: myOperatorId,
                operatorName: myOperatorName
            }
        }));
    } catch (e) {}
}

class OperatorRingtonePlayer {
    constructor() {
        this.ctx = null;
        this.interval = null;
        this.isPlaying = false;
    }

    init() {
        try {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.ctx = new AudioCtx();
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        } catch (e) {}
    }

    _playTone(freq, startTime, duration, volume) {
        try {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(volume || 0.28, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + duration);
        } catch (e) {}
    }

    playChime() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this._playTone(784, now, 0.35, 0.3);         // G5
        this._playTone(1046.5, now + 0.12, 0.45, 0.35); // C6
        this._playTone(1318.5, now + 0.28, 0.55, 0.4);  // E6
    }

    startIncomingLoop() {
        this.stop();
        this.init();
        this.isPlaying = true;
        this.playChime();
        this.interval = setInterval(() => {
            if (this.isPlaying) {
                this.playChime();
            }
        }, 1600);
    }

    playAcceptedTone() {
        this.stop();
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this._playTone(523.25, now, 0.18, 0.25); // C5
        this._playTone(659.25, now + 0.12, 0.18, 0.25); // E5
        this._playTone(783.99, now + 0.24, 0.22, 0.3); // G5
        this._playTone(1046.50, now + 0.36, 0.45, 0.35); // C6
    }

    playRejectedTone() {
        this.stop();
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this._playTone(440, now, 0.22, 0.25); // A4
        this._playTone(349.23, now + 0.18, 0.35, 0.25); // F4
    }

    stop() {
        this.isPlaying = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
const operatorAudio = new OperatorRingtonePlayer();

document.addEventListener('click', () => {
    operatorAudio.init();
}, { once: true });

function startTitleBlink(text) {
    stopTitleBlink();
    let isBlink = false;
    titleBlinkTimer = setInterval(() => {
        document.title = isBlink ? text : (window.defaultPageTitle || 'Call Center — Operatorlar');
        isBlink = !isBlink;
    }, 700);
}

function stopTitleBlink() {
    if (titleBlinkTimer) {
        clearInterval(titleBlinkTimer);
        titleBlinkTimer = null;
    }
    document.title = window.defaultPageTitle || 'Call Center — Operatorlar';
}

function notifyDesktop(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        try {
            const notif = new Notification(title, {
                body,
                icon: '/images/title-icon.png'
            });
            notif.onclick = () => {
                window.focus();
                notif.close();
            };
        } catch (e) {}
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// ==================== VOICE PUSH-TO-TALK (PTT) STATE ====================
let pttMediaStream = null;
let pttMediaRecorder = null;
let pttAudioChunks = [];
let pttRecordedBlob = null;
let pttRecordedBase64 = null;
let pttRecordedDurationSec = 0;
let pttRecordTimer = null;
let pttStartTime = 0;
let pttPreviewAudio = null;
let incomingVoiceAudio = null;
let pendingHelpTarget = null;
let isPttRecording = false;

function isMicrophoneSupported() {
    return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

function requestOperatorHelp(event, toId, toName) {
    if (event) {
        event.stopPropagation();
    }
    operatorAudio.init();

    if (!myOperatorId) {
        openOperatorSelectSelfModal((selectedId, selectedName) => {
            requestOperatorHelp(null, toId, toName);
        });
        return;
    }

    if (String(myOperatorId) === String(toId)) {
        alert("O'zingizga yordam so'rovi yubora olmaysiz.");
        return;
    }

    pendingHelpTarget = {
        toId: String(toId),
        toName: String(toName)
    };

    resetRecordedVoice();

    const modal = document.getElementById('outgoingHelpModal');
    const recordState = document.getElementById('outgoingHelpRecordState');
    const callingState = document.getElementById('outgoingHelpCallingState');
    const targetNameEl = document.getElementById('outgoingTargetOpName');
    const warnBanner = document.getElementById('outgoingHttpWarningBanner');
    const switchLink = document.getElementById('btnSwitchHttpsLink');

    if (targetNameEl) targetNameEl.innerText = toName;
    if (recordState) recordState.style.display = 'block';
    if (callingState) callingState.style.display = 'none';

    // HTTPS vs HTTP warning
    const isHttps = (location.protocol === 'https:');
    const hasMic = isMicrophoneSupported();

    if (warnBanner && switchLink) {
        if (!hasMic || !isHttps) {
            warnBanner.style.display = 'block';
            switchLink.href = `https://${location.hostname}:${location.port || '3005'}${location.pathname}`;
        } else {
            warnBanner.style.display = 'none';
        }
    }

    if (modal) modal.style.display = 'flex';
}

async function startPttRecord(event) {
    if (event) event.preventDefault();
    if (isPttRecording) return;

    if (!isMicrophoneSupported()) {
        const isHttps = (location.protocol === 'https:');
        if (!isHttps) {
            if (confirm("Brauzerda mikrofondan foydalanish uchun HTTPS kerak. Xavfsiz HTTPS rejimiga o'tilsinmi?")) {
                window.location.href = `https://${location.hostname}:${location.port || '3005'}${location.pathname}`;
            }
        } else {
            alert("Brauzeringizda mikrofon aniqlanmadi yoki ruxsat berilmagan.");
        }
        return;
    }

    try {
        if (!pttMediaStream) {
            pttMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } catch (micErr) {
        alert("Mikrofon ruxsati berilmadi. Iltimos brauzer sozlamalaridan mikrofonga ruxsat bering.");
        return;
    }

    isPttRecording = true;
    pttAudioChunks = [];
    pttRecordedBlob = null;
    pttRecordedBase64 = null;
    pttRecordedDurationSec = 0;

    const micBtn = document.getElementById('btnPttMic');
    const statusLabel = document.getElementById('pttStatusLabel');
    if (micBtn) micBtn.classList.add('recording');
    if (statusLabel) statusLabel.innerHTML = '<span style="color: #ef4444;">🔴 Yozilmoqda: 00:00 / 00:15</span>';

    try {
        const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
            ? 'audio/webm;codecs=opus'
            : ((window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : 'audio/ogg');
        pttMediaRecorder = new MediaRecorder(pttMediaStream, { mimeType });
    } catch (e) {
        pttMediaRecorder = new MediaRecorder(pttMediaStream);
    }

    pttMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            pttAudioChunks.push(e.data);
        }
    };

    pttMediaRecorder.onstop = () => {
        clearInterval(pttRecordTimer);
        const mime = pttMediaRecorder.mimeType || 'audio/webm';
        pttRecordedBlob = new Blob(pttAudioChunks, { type: mime });

        const reader = new FileReader();
        reader.onloadend = () => {
            pttRecordedBase64 = reader.result;
            showRecordedPreview();
        };
        reader.readAsDataURL(pttRecordedBlob);
    };

    pttStartTime = Date.now();
    pttMediaRecorder.start(100);

    clearInterval(pttRecordTimer);
    pttRecordTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - pttStartTime) / 1000);
        pttRecordedDurationSec = elapsed;
        if (statusLabel) {
            const secStr = elapsed < 10 ? `0${elapsed}` : `${elapsed}`;
            statusLabel.innerHTML = `<span style="color: #ef4444;">🔴 Yozilmoqda: 00:${secStr} / 00:15</span>`;
        }
        if (elapsed >= 15) {
            stopPttRecord();
        }
    }, 500);
}

function stopPttRecord(event) {
    if (event) event.preventDefault();
    if (!isPttRecording) return;
    isPttRecording = false;

    clearInterval(pttRecordTimer);
    const micBtn = document.getElementById('btnPttMic');
    if (micBtn) micBtn.classList.remove('recording');

    if (pttMediaRecorder && pttMediaRecorder.state !== 'inactive') {
        pttMediaRecorder.stop();
    }
}

function showRecordedPreview() {
    const previewContainer = document.getElementById('recordedPreviewContainer');
    const sendBtn = document.getElementById('btnSendVoiceHelp');
    const statusLabel = document.getElementById('pttStatusLabel');
    const durationEl = document.getElementById('recordedVoiceDuration');

    if (previewContainer) previewContainer.style.display = 'flex';
    if (sendBtn) sendBtn.style.display = 'inline-flex';
    if (statusLabel) statusLabel.innerHTML = '<span style="color: #10b981;">✅ Ovoz tayyor! "Yuborish"ni bosing</span>';
    if (durationEl) {
        const dur = Math.max(1, pttRecordedDurationSec);
        durationEl.innerText = `00:${dur < 10 ? '0' + dur : dur}`;
    }
}

function resetRecordedVoice() {
    if (pttPreviewAudio) {
        pttPreviewAudio.pause();
        pttPreviewAudio = null;
    }
    pttAudioChunks = [];
    pttRecordedBlob = null;
    pttRecordedBase64 = null;
    pttRecordedDurationSec = 0;

    const previewContainer = document.getElementById('recordedPreviewContainer');
    const sendBtn = document.getElementById('btnSendVoiceHelp');
    const statusLabel = document.getElementById('pttStatusLabel');

    if (previewContainer) previewContainer.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'none';
    if (statusLabel) statusLabel.innerHTML = '<span>Bosib turib gapiring</span>';
}

function toggleRecordedVoicePlay() {
    if (!pttRecordedBase64) return;
    const playIcon = document.getElementById('recordedVoicePlayIcon');

    if (!pttPreviewAudio) {
        pttPreviewAudio = new Audio(pttRecordedBase64);
        pttPreviewAudio.onended = () => {
            if (playIcon) playIcon.innerHTML = `<svg class="isax isax-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 16px; height: 16px;"><path d="M4 12V6.67C4 3.58 6.18 2.32 8.86 3.87L13.48 6.54L18.1 9.21C20.78 10.76 20.78 13.29 18.1 14.84L13.48 17.51L8.86 20.18C6.18 21.73 4 20.47 4 17.38V12Z"/></svg>`;
        };
    }

    if (pttPreviewAudio.paused) {
        pttPreviewAudio.play();
        if (playIcon) playIcon.innerHTML = `<svg class="isax isax-pause" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 16px; height: 16px;"><path d="M10.65 19.11V4.89C10.65 3.54 10.08 3 8.64 3H5.97C4.53 3 3.96 3.54 3.96 4.89V19.11C3.96 20.46 4.53 21 5.97 21H8.64C10.08 21 10.65 20.46 10.65 19.11Z"/><path d="M20.04 19.11V4.89C20.04 3.54 19.47 3 18.03 3H15.36C13.92 3 13.35 3.54 13.35 4.89V19.11C13.35 20.46 13.92 21 15.36 21H18.03C19.47 21 20.04 20.46 20.04 19.11Z"/></svg>`;
    } else {
        pttPreviewAudio.pause();
        if (playIcon) playIcon.innerHTML = `<svg class="isax isax-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 16px; height: 16px;"><path d="M4 12V6.67C4 3.58 6.18 2.32 8.86 3.87L13.48 6.54L18.1 9.21C20.78 10.76 20.78 13.29 18.1 14.84L13.48 17.51L8.86 20.18C6.18 21.73 4 20.47 4 17.38V12Z"/></svg>`;
    }
}

let currentHelpMode = 'voice'; // 'voice' | 'text'

function switchHelpMode(mode) {
    currentHelpMode = mode;
    const tabVoice = document.getElementById('tabHelpVoice');
    const tabText = document.getElementById('tabHelpText');
    const secVoice = document.getElementById('outgoingHelpVoiceSection');
    const secText = document.getElementById('outgoingHelpTextSection');
    const stateTitle = document.getElementById('outgoingHelpStateTitle');
    const micDesc = document.getElementById('outgoingHelpMicDesc');

    if (mode === 'text') {
        if (tabVoice) tabVoice.classList.remove('active');
        if (tabText) tabText.classList.add('active');
        if (secVoice) secVoice.style.display = 'none';
        if (secText) secText.style.display = 'block';
        if (stateTitle) stateTitle.innerText = "Yozma xabar qoldiring";
        if (micDesc) micDesc.innerText = "Yordam so'rovi sababini yozing (operator ekranda ko'radi)";
        const inp = document.getElementById('helpTextMessageInput');
        if (inp) setTimeout(() => inp.focus(), 100);
    } else {
        if (tabVoice) tabVoice.classList.add('active');
        if (tabText) tabText.classList.remove('active');
        if (secVoice) secVoice.style.display = 'block';
        if (secText) secText.style.display = 'none';
        if (stateTitle) stateTitle.innerText = "Ovozli xabar qoldiring";
        if (micDesc) micDesc.innerText = "Tugmani bosib turib gapiring (maks. 15 soniya)";
    }
}

function updateHelpTextCounter() {
    const inp = document.getElementById('helpTextMessageInput');
    const cnt = document.getElementById('helpTextCounter');
    if (inp && cnt) {
        cnt.innerText = `${inp.value.length} / 300`;
    }
}

function setHelpQuickText(text) {
    const inp = document.getElementById('helpTextMessageInput');
    if (inp) {
        inp.value = text;
        updateHelpTextCounter();
        inp.focus();
    }
}

function sendTextHelpRequest() {
    if (!pendingHelpTarget) return;
    const inp = document.getElementById('helpTextMessageInput');
    const text = (inp ? inp.value : '').trim();
    if (!text) {
        alert("Iltimos, avval xabar matnini yozing yoki tezkor savollardan birini tanlang.");
        if (inp) inp.focus();
        return;
    }
    executeHelpRequest(pendingHelpTarget.toId, pendingHelpTarget.toName, null, 0, text);
}

function sendVoiceHelpRequest() {
    if (!pendingHelpTarget) return;
    executeHelpRequest(pendingHelpTarget.toId, pendingHelpTarget.toName, pttRecordedBase64, pttRecordedDurationSec, null);
}

function sendDirectRingHelpRequest() {
    if (!pendingHelpTarget) return;
    executeHelpRequest(pendingHelpTarget.toId, pendingHelpTarget.toName, null, 0, null);
}

function executeHelpRequest(toId, toName, audioBase64, durationSec, textMessage) {
    const reqId = 'help_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    currentOutgoingRequest = {
        requestId: reqId,
        toId: String(toId),
        toName: String(toName),
        hasVoice: Boolean(audioBase64),
        textMessage: textMessage || null
    };

    const recordState = document.getElementById('outgoingHelpRecordState');
    const callingState = document.getElementById('outgoingHelpCallingState');
    const ringEl = document.getElementById('outgoingHelpIconRing');
    const titleEl = document.getElementById('outgoingHelpTitle');
    const subEl = document.getElementById('outgoingHelpSubtitle');
    const actEl = document.getElementById('outgoingHelpActions');

    if (recordState) recordState.style.display = 'none';
    if (callingState) callingState.style.display = 'block';

    if (ringEl) {
        ringEl.className = 'help-icon-ring ringing';
        ringEl.innerHTML = `<svg class="isax isax-notification-bing" viewBox="0 0 24 24" fill="none">${(window.ICONS_SAX && window.ICONS_SAX['notification-bing']) || ''}</svg>`;
    }
    const typeLabel = audioBase64 ? 'ovozli xabar ' : (textMessage ? 'yozma xabar ' : '');
    if (titleEl) titleEl.innerText = `${toName} ga ${typeLabel}yuborildi...`;
    if (subEl) subEl.innerText = textMessage ? `"${textMessage.slice(0, 45)}${textMessage.length > 45 ? '...' : ''}"` : "Operator javobi kutilmoqda...";
    if (actEl) {
        actEl.innerHTML = `
            <button type="button" class="btn-help-single" onclick="cancelOutgoingHelp()">
                <span>Bekor qilish</span>
            </button>
        `;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'help_request',
            data: {
                requestId: reqId,
                fromId: myOperatorId,
                fromName: myOperatorName || `Operator ${myOperatorId}`,
                toId: String(toId),
                toName: String(toName),
                audioBase64: audioBase64 || null,
                durationSec: durationSec || 0,
                hasVoice: Boolean(audioBase64),
                textMessage: textMessage || null
            }
        }));
    }

    clearTimeout(outgoingTimeoutTimer);
    outgoingTimeoutTimer = setTimeout(() => {
        if (currentOutgoingRequest && currentOutgoingRequest.requestId === reqId) {
            cancelOutgoingHelp(true);
        }
    }, 45000);
}

function cancelOutgoingHelp(isTimeout) {
    clearTimeout(outgoingTimeoutTimer);
    if (currentOutgoingRequest && socket && socket.readyState === WebSocket.OPEN && !isTimeout) {
        socket.send(JSON.stringify({
            type: 'help_cancel',
            data: {
                requestId: currentOutgoingRequest.requestId,
                fromId: myOperatorId,
                toId: currentOutgoingRequest.toId
            }
        }));
    }

    if (isTimeout && currentOutgoingRequest) {
        const ringEl = document.getElementById('outgoingHelpIconRing');
        const titleEl = document.getElementById('outgoingHelpTitle');
        const subEl = document.getElementById('outgoingHelpSubtitle');
        const actEl = document.getElementById('outgoingHelpActions');

        if (ringEl) {
            ringEl.className = 'help-icon-ring rejected';
            ringEl.innerHTML = `<svg class="isax isax-close-circle" viewBox="0 0 24 24" fill="none">${(window.ICONS_SAX && window.ICONS_SAX['close-circle']) || ''}</svg>`;
        }
        if (titleEl) titleEl.innerText = `${currentOutgoingRequest.toName} javob bermadi`;
        if (subEl) subEl.innerText = "Qo'ng'iroq vaqti tugadi. Keyinroq yana urinib ko'ring.";
        if (actEl) {
            actEl.innerHTML = `
                <button type="button" class="btn-help-single" onclick="closeOutgoingHelpModal()">
                    <span>OK</span>
                </button>
            `;
        }
        currentOutgoingRequest = null;
        return;
    }

    closeOutgoingHelpModal();
}

function closeOutgoingHelpModal() {
    clearTimeout(outgoingTimeoutTimer);
    resetRecordedVoice();
    const inp = document.getElementById('helpTextMessageInput');
    if (inp) inp.value = '';
    updateHelpTextCounter();
    switchHelpMode('voice');
    currentOutgoingRequest = null;
    const modal = document.getElementById('outgoingHelpModal');
    smoothCloseModal(modal);
}

function handleHelpRequestStatus(data) {
    if (!currentOutgoingRequest || currentOutgoingRequest.requestId !== data.requestId) return;

    if (data.status === 'offline') {
        clearTimeout(outgoingTimeoutTimer);
        const ringEl = document.getElementById('outgoingHelpIconRing');
        const titleEl = document.getElementById('outgoingHelpTitle');
        const subEl = document.getElementById('outgoingHelpSubtitle');
        const actEl = document.getElementById('outgoingHelpActions');

        if (ringEl) {
            ringEl.className = 'help-icon-ring rejected';
            ringEl.innerHTML = `<svg class="isax isax-close-circle" viewBox="0 0 24 24" fill="none">${(window.ICONS_SAX && window.ICONS_SAX['close-circle']) || ''}</svg>`;
        }
        if (titleEl) titleEl.innerText = `${data.toName || 'Operator'} tizimda emas`;
        if (subEl) subEl.innerText = data.message || "Operator hozir viewer sahifasini ochmagan.";
        if (actEl) {
            actEl.innerHTML = `
                <button type="button" class="btn-help-single primary" onclick="closeOutgoingHelpModal()">
                    <span>OK</span>
                </button>
            `;
        }
        currentOutgoingRequest = null;
    }
}

function handleHelpResponseReceived(data) {
    if (!currentOutgoingRequest || currentOutgoingRequest.requestId !== data.requestId) return;
    clearTimeout(outgoingTimeoutTimer);

    const ringEl = document.getElementById('outgoingHelpIconRing');
    const titleEl = document.getElementById('outgoingHelpTitle');
    const subEl = document.getElementById('outgoingHelpSubtitle');
    const actEl = document.getElementById('outgoingHelpActions');

    if (data.accepted) {
        operatorAudio.playAcceptedTone();
        if (ringEl) {
            ringEl.className = 'help-icon-ring success';
            ringEl.innerHTML = `<svg class="isax isax-tick-circle" viewBox="0 0 24 24" fill="none">${(window.ICONS_SAX && window.ICONS_SAX['tick-circle']) || ''}</svg>`;
        }
        if (titleEl) titleEl.innerText = `${data.toName} yordam berishga rozi bo'ldi!`;
        if (subEl) subEl.innerText = "Operator hozir bo'sh, uning yoniga borishingiz yoki gaplashishingiz mumkin.";
        if (actEl) {
            actEl.innerHTML = `
                <button type="button" class="btn-help-single primary" onclick="closeOutgoingHelpModal()">
                    <span>OK</span>
                </button>
            `;
        }
    } else {
        operatorAudio.playRejectedTone();
        if (ringEl) {
            ringEl.className = 'help-icon-ring rejected';
            ringEl.innerHTML = `<svg class="isax isax-close-circle" viewBox="0 0 24 24" fill="none">${(window.ICONS_SAX && window.ICONS_SAX['close-circle']) || ''}</svg>`;
        }
        if (titleEl) titleEl.innerText = `${data.toName} hozir band`;
        if (subEl) subEl.innerText = "Operator hozir yordam bera olmasligini bildirdi. Boshqa bo'sh operatordan so'rab ko'ring.";
        if (actEl) {
            actEl.innerHTML = `
                <button type="button" class="btn-help-single" onclick="closeOutgoingHelpModal()">
                    <span>OK</span>
                </button>
            `;
        }
    }

    currentOutgoingRequest = null;
}

function handleIncomingHelpRequest(data) {
    currentIncomingRequest = data;
    operatorAudio.startIncomingLoop();
    startTitleBlink(`🔔 ${data.fromName} yordam so'ramoqda!`);
    const notifMsg = data.textMessage ? `${data.fromName}: "${data.textMessage}"` : `${data.fromName} sizdan yordam so'ramoqda.`;
    notifyDesktop("Operator yordam so'ramoqda!", notifMsg);

    const modal = document.getElementById('incomingHelpModal');
    const titleEl = document.getElementById('incomingHelpTitle');
    const subEl = document.getElementById('incomingHelpSubtitle');
    const textContainer = document.getElementById('incomingTextContainer');
    const textMsgEl = document.getElementById('incomingTextMessage');
    const voiceContainer = document.getElementById('incomingVoicePlayerContainer');
    const durationEl = document.getElementById('incomingVoiceDuration');
    const progressBar = document.getElementById('incomingVoiceProgressBar');
    const playIcon = document.getElementById('incomingVoicePlayIcon');

    if (titleEl) titleEl.innerText = `${data.fromName} yordam so'ramoqda!`;
    if (subEl) {
        if (data.textMessage && data.audioBase64) {
            subEl.innerText = "Operator ovozli va yozma xabar qoldirdi:";
        } else if (data.textMessage) {
            subEl.innerText = "Operator sizga yozma xabar qoldirdi:";
        } else if (data.audioBase64) {
            subEl.innerText = "Operator sizga ovozli xabar qoldirdi:";
        } else {
            subEl.innerText = "Operator siz bilan maslahatlashmoqchi yoki o'rganmoqchi.";
        }
    }

    if (data.textMessage && textContainer && textMsgEl) {
        textMsgEl.innerText = data.textMessage;
        textContainer.style.display = 'block';
    } else if (textContainer) {
        textContainer.style.display = 'none';
    }

    if (incomingVoiceAudio) {
        incomingVoiceAudio.pause();
        incomingVoiceAudio = null;
    }

    if (data.audioBase64 && voiceContainer) {
        voiceContainer.style.display = 'flex';
        const dur = Math.max(1, data.durationSec || 3);
        if (durationEl) durationEl.innerText = `00:${dur < 10 ? '0' + dur : dur}`;
        if (progressBar) progressBar.style.width = '0%';
        if (playIcon) playIcon.innerHTML = `<svg class="isax isax-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 18px; height: 18px;"><path d="M4 12V6.67C4 3.58 6.18 2.32 8.86 3.87L13.48 6.54L18.1 9.21C20.78 10.76 20.78 13.29 18.1 14.84L13.48 17.51L8.86 20.18C6.18 21.73 4 20.47 4 17.38V12Z"/></svg>`;

        incomingVoiceAudio = new Audio(data.audioBase64);
        incomingVoiceAudio.ontimeupdate = () => {
            if (incomingVoiceAudio && incomingVoiceAudio.duration) {
                const pct = (incomingVoiceAudio.currentTime / incomingVoiceAudio.duration) * 100;
                if (progressBar) progressBar.style.width = `${pct}%`;
            }
        };
        incomingVoiceAudio.onended = () => {
            if (playIcon) playIcon.innerHTML = `<svg class="isax isax-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 18px; height: 18px;"><path d="M4 12V6.67C4 3.58 6.18 2.32 8.86 3.87L13.48 6.54L18.1 9.21C20.78 10.76 20.78 13.29 18.1 14.84L13.48 17.51L8.86 20.18C6.18 21.73 4 20.47 4 17.38V12Z"/></svg>`;
            if (progressBar) progressBar.style.width = '100%';
        };

        try {
            incomingVoiceAudio.play().then(() => {
                if (playIcon) playIcon.innerHTML = `<svg class="isax isax-pause" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 18px; height: 18px;"><path d="M10.65 19.11V4.89C10.65 3.54 10.08 3 8.64 3H5.97C4.53 3 3.96 3.54 3.96 4.89V19.11C3.96 20.46 4.53 21 5.97 21H8.64C10.08 21 10.65 20.46 10.65 19.11Z"/><path d="M20.04 19.11V4.89C20.04 3.54 19.47 3 18.03 3H15.36C13.92 3 13.35 3.54 13.35 4.89V19.11C13.35 20.46 13.92 21 15.36 21H18.03C19.47 21 20.04 20.46 20.04 19.11Z"/></svg>`;
            }).catch(() => {});
        } catch (e) {}
    } else if (voiceContainer) {
        voiceContainer.style.display = 'none';
    }

    if (modal) modal.style.display = 'flex';
}

function toggleIncomingVoicePlay() {
    if (!incomingVoiceAudio) return;
    const playIcon = document.getElementById('incomingVoicePlayIcon');
    if (incomingVoiceAudio.paused) {
        incomingVoiceAudio.play();
        if (playIcon) playIcon.innerHTML = `<svg class="isax isax-pause" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 18px; height: 18px;"><path d="M10.65 19.11V4.89C10.65 3.54 10.08 3 8.64 3H5.97C4.53 3 3.96 3.54 3.96 4.89V19.11C3.96 20.46 4.53 21 5.97 21H8.64C10.08 21 10.65 20.46 10.65 19.11Z"/><path d="M20.04 19.11V4.89C20.04 3.54 19.47 3 18.03 3H15.36C13.92 3 13.35 3.54 13.35 4.89V19.11C13.35 20.46 13.92 21 15.36 21H18.03C19.47 21 20.04 20.46 20.04 19.11Z"/></svg>`;
    } else {
        incomingVoiceAudio.pause();
        if (playIcon) playIcon.innerHTML = `<svg class="isax isax-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 18px; height: 18px;"><path d="M4 12V6.67C4 3.58 6.18 2.32 8.86 3.87L13.48 6.54L18.1 9.21C20.78 10.76 20.78 13.29 18.1 14.84L13.48 17.51L8.86 20.18C6.18 21.73 4 20.47 4 17.38V12Z"/></svg>`;
    }
}

function acceptIncomingHelp() {
    if (incomingVoiceAudio) {
        incomingVoiceAudio.pause();
        incomingVoiceAudio = null;
    }
    operatorAudio.stop();
    stopTitleBlink();
    const modal = document.getElementById('incomingHelpModal');
    if (modal) modal.style.display = 'none';

    if (currentIncomingRequest && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'help_response',
            data: {
                requestId: currentIncomingRequest.requestId,
                fromId: currentIncomingRequest.fromId,
                toId: myOperatorId,
                toName: myOperatorName || `Operator ${myOperatorId}`,
                accepted: true
            }
        }));
    }
    currentIncomingRequest = null;
}

function rejectIncomingHelp() {
    if (incomingVoiceAudio) {
        incomingVoiceAudio.pause();
        incomingVoiceAudio = null;
    }
    operatorAudio.stop();
    stopTitleBlink();
    const modal = document.getElementById('incomingHelpModal');
    if (modal) modal.style.display = 'none';

    if (currentIncomingRequest && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'help_response',
            data: {
                requestId: currentIncomingRequest.requestId,
                fromId: currentIncomingRequest.fromId,
                toId: myOperatorId,
                toName: myOperatorName || `Operator ${myOperatorId}`,
                accepted: false
            }
        }));
    }
    currentIncomingRequest = null;
}

function handleHelpCancelled(data) {
    if (currentIncomingRequest && currentIncomingRequest.requestId === data.requestId) {
        if (incomingVoiceAudio) {
            incomingVoiceAudio.pause();
            incomingVoiceAudio = null;
        }
        operatorAudio.stop();
        stopTitleBlink();
        const modal = document.getElementById('incomingHelpModal');
        if (modal) modal.style.display = 'none';
        currentIncomingRequest = null;
    }
}

let selectSelfCallback = null;

function showLockedProfileNotice() {
    alert(`Sizning profilingiz akkauntingizga (${myOperatorId ? `Operator ${myOperatorId}` : 'Operator'}) qat'iy biriktirilgan va qotirilgan. O'zgartirish faqat Administrator orqali amalga oshiriladi.`);
}
window.showLockedProfileNotice = showLockedProfileNotice;

function openOperatorSelectSelfModal(cb) {
    if (isOperatorLocked) {
        showLockedProfileNotice();
        if (cb && myOperatorId) cb(myOperatorId, myOperatorName);
        return;
    }
    selectSelfCallback = cb || null;
    const modal = document.getElementById('operatorSelectSelfModal');
    const listEl = document.getElementById('operatorSelectSelfList');
    if (!modal || !listEl) return;

    const ops = currentViewerOperators || [];
    if (ops.length === 0) {
        listEl.innerHTML = '<p style="color: #94a3b8; font-size: 13px;">Operatorlar ro\'yxati yuklanmoqda...</p>';
    } else {
        listEl.innerHTML = ops.map(op => {
            const cleanName = getCleanOperatorName(op.realName || op.name, op.id);
            const isCurrent = myOperatorId && String(op.id) === String(myOperatorId);
            return `
                <div onclick="selectMyOperator('${op.id}', '${cleanName.replace(/'/g, "\\'")}')" 
                     style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: ${isCurrent ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)'}; border: 1px solid ${isCurrent ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 10px; cursor: pointer; transition: all 0.2s ease;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-weight: 700; color: #38bdf8; font-size: 13px;">${op.id}</span>
                        <span style="font-weight: 600; color: #ffffff; font-size: 13px;">${cleanName}</span>
                    </div>
                    ${isCurrent ? `<span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; background: #38bdf8; color: #0f172a; font-weight: 700;">Tanlangan</span>` : ''}
                </div>
            `;
        }).join('');
    }

    modal.style.display = 'flex';
}

function selectMyOperator(opId, opName) {
    setMyOperator(opId, opName);
    closeOperatorSelectSelfModal();
    if (selectSelfCallback) {
        selectSelfCallback(opId, opName);
        selectSelfCallback = null;
    }
}

function closeOperatorSelectSelfModal() {
    const modal = document.getElementById('operatorSelectSelfModal');
    smoothCloseModal(modal);
    selectSelfCallback = null;
}

window.requestOperatorHelp = requestOperatorHelp;
window.cancelOutgoingHelp = cancelOutgoingHelp;
window.closeOutgoingHelpModal = closeOutgoingHelpModal;
window.acceptIncomingHelp = acceptIncomingHelp;
window.rejectIncomingHelp = rejectIncomingHelp;
window.openOperatorSelectSelfModal = openOperatorSelectSelfModal;
window.selectMyOperator = selectMyOperator;
window.closeOperatorSelectSelfModal = closeOperatorSelectSelfModal;
window.switchHelpMode = switchHelpMode;
window.updateHelpTextCounter = updateHelpTextCounter;
window.setHelpQuickText = setHelpQuickText;
window.sendTextHelpRequest = sendTextHelpRequest;
window.sendVoiceHelpRequest = sendVoiceHelpRequest;
window.sendDirectRingHelpRequest = sendDirectRingHelpRequest;
window.toggleIncomingVoicePlay = toggleIncomingVoicePlay;

/* ==========================================================================
   Client Contacts & Phonebook (Mijozlar bazasi / Telefon kitobi)
   ========================================================================== */
let clientContactsMap = new Map(); // normalized 9-digit key -> contact object
let isContactsLoaded = false;

function normalizeContactLookupKey(raw) {
    if (!raw) return '';
    let digits = String(raw).replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('998')) {
        digits = digits.slice(3);
    }
    return digits || String(raw).trim();
}

function setClientContactsList(list) {
    if (!Array.isArray(list)) return;
    clientContactsMap.clear();
    for (const c of list) {
        if (c && c.phone) {
            const key = normalizeContactLookupKey(c.phone);
            if (key) clientContactsMap.set(key, c);
        }
    }
    isContactsLoaded = true;
    updateHeaderContactsCount();
}

function getClientContact(phone) {
    if (!phone) return null;
    const key = normalizeContactLookupKey(phone);
    if (!key) return null;
    if (clientContactsMap.has(key)) return clientContactsMap.get(key);
    for (const [k, v] of clientContactsMap.entries()) {
        if (k === key || (k.length >= 9 && key.endsWith(k)) || (key.length >= 9 && k.endsWith(key))) {
            return v;
        }
    }
    return null;
}

function updateHeaderContactsCount() {
    const el = document.getElementById('headerContactsCount');
    if (el) el.innerText = clientContactsMap.size;
    const badge = document.getElementById('directoryCountBadge');
    if (badge) badge.innerText = `${clientContactsMap.size} ta mijoz`;
}

async function loadClientContacts() {
    try {
        const res = await fetch('/api/contacts');
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || []);
        setClientContactsList(list);
        if (currentViewerOperators && currentViewerOperators.length > 0) {
            renderOperators(currentViewerOperators);
        }
        if (currentViewerCallbacks) {
            renderViewerCallbacks(currentViewerCallbacks);
        }
    } catch (e) {
        console.warn('loadClientContacts error:', e.message);
    }
}

function handleWsClientContactUpdate(data) {
    if (!data) return;
    if (data.action === 'upsert' && data.contact) {
        const key = normalizeContactLookupKey(data.contact.phone);
        if (key) clientContactsMap.set(key, data.contact);
    } else if (data.action === 'delete' && data.phone) {
        const key = normalizeContactLookupKey(data.phone);
        if (key) clientContactsMap.delete(key);
    }
    updateHeaderContactsCount();
    if (currentViewerOperators && currentViewerOperators.length > 0) {
        renderOperators(currentViewerOperators);
    }
    if (currentViewerCallbacks) {
        renderViewerCallbacks(currentViewerCallbacks);
    }
    const dirModal = document.getElementById('clientDirectoryModal');
    if (dirModal && dirModal.style.display !== 'none') {
        const searchVal = document.getElementById('directorySearchInput')?.value || '';
        renderClientDirectory(searchVal);
    }
}

/* Modal logic */
function openAddContactModal(prefillPhone = '', event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('clientContactModal');
    const titleEl = document.getElementById('contactModalTitle');
    const origPhoneEl = document.getElementById('contactOriginalPhone');
    const phoneInput = document.getElementById('contactPhoneInput');
    const nameInput = document.getElementById('contactNameInput');
    const orgInput = document.getElementById('contactOrgInput');
    const langSelect = document.getElementById('contactLangSelect');
    const notesInput = document.getElementById('contactNotesInput');
    const btnDelete = document.getElementById('btnDeleteContact');
    const statusEl = document.getElementById('contactFormStatus');

    if (!modal) return;
    titleEl.innerText = "Yangi mijoz qo'shish";
    origPhoneEl.value = '';
    phoneInput.value = prefillPhone ? formatCallerNumber(prefillPhone) : '';
    phoneInput.readOnly = false;
    nameInput.value = '';
    orgInput.value = '';
    if (langSelect) langSelect.value = '';
    notesInput.value = '';
    btnDelete.style.display = 'none';
    statusEl.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(() => {
        if (!prefillPhone) phoneInput.focus();
        else nameInput.focus();
    }, 100);
}

function openEditContactModal(phone, event) {
    if (event) event.stopPropagation();
    const contact = getClientContact(phone);
    if (!contact) {
        return openAddContactModal(phone, event);
    }

    const modal = document.getElementById('clientContactModal');
    const titleEl = document.getElementById('contactModalTitle');
    const origPhoneEl = document.getElementById('contactOriginalPhone');
    const phoneInput = document.getElementById('contactPhoneInput');
    const nameInput = document.getElementById('contactNameInput');
    const orgInput = document.getElementById('contactOrgInput');
    const langSelect = document.getElementById('contactLangSelect');
    const notesInput = document.getElementById('contactNotesInput');
    const btnDelete = document.getElementById('btnDeleteContact');
    const statusEl = document.getElementById('contactFormStatus');

    if (!modal) return;
    titleEl.innerText = "Mijoz ma'lumotlarini tahrirlash";
    origPhoneEl.value = contact.phone || phone;
    phoneInput.value = contact.phone || phone;
    phoneInput.readOnly = false;
    nameInput.value = contact.name || '';
    orgInput.value = contact.organization || '';
    if (langSelect) langSelect.value = contact.language || '';
    notesInput.value = contact.notes || '';
    btnDelete.style.display = 'inline-block';
    statusEl.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(() => nameInput.focus(), 100);
}

function openContactModal(phone, event) {
    if (event) event.stopPropagation();
    const contact = getClientContact(phone);
    if (contact) {
        openEditContactModal(phone, event);
    } else {
        openAddContactModal(phone, event);
    }
}

function closeContactModal() {
    const modal = document.getElementById('clientContactModal');
    smoothCloseModal(modal);
}

async function handleSaveContactSubmit(e) {
    e.preventDefault();
    const phoneInput = document.getElementById('contactPhoneInput');
    const nameInput = document.getElementById('contactNameInput');
    const orgInput = document.getElementById('contactOrgInput');
    const langSelect = document.getElementById('contactLangSelect');
    const notesInput = document.getElementById('contactNotesInput');
    const statusEl = document.getElementById('contactFormStatus');
    const btnSave = document.getElementById('btnSaveContact');

    const phone = phoneInput.value.trim();
    const name = nameInput.value.trim();
    const organization = orgInput.value.trim();
    const language = langSelect ? langSelect.value.trim().toLowerCase() : '';
    const notes = notesInput.value.trim();

    if (!phone) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#f87171';
        statusEl.innerText = 'Iltimos, telefon raqamini kiriting!';
        return;
    }

    if (!name && !organization) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#f87171';
        statusEl.innerText = 'Iltimos, mijoz ismi yoki tashkilot/qayerdanligidan kamida birini kiriting!';
        return;
    }

    try {
        btnSave.disabled = true;
        btnSave.innerText = 'Saqlanmoqda...';
        const res = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, name, organization, notes, language })
        });
        const json = await res.json();
        if (json.success && json.data) {
            const key = normalizeContactLookupKey(json.data.phone);
            if (key) clientContactsMap.set(key, json.data);
            updateHeaderContactsCount();
            if (currentViewerOperators && currentViewerOperators.length > 0) {
                renderOperators(currentViewerOperators);
            }
            if (currentViewerCallbacks) {
                renderViewerCallbacks(currentViewerCallbacks);
            }
            closeContactModal();
            showViewerToast(`${name || organization} saqlandi!`);
        } else {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
            statusEl.style.color = '#f87171';
            statusEl.innerText = json.message || 'Saqlashda xatolik yuz berdi';
        }
    } catch (err) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#f87171';
        statusEl.innerText = err.message;
    } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `<svg class="isax isax-tick-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;"><path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z"/><path d="M7.75 12L10.58 14.83L16.25 9.17"/></svg> <span>Saqlash</span>`;
    }
}

async function handleDeleteContactClick() {
    const origPhone = document.getElementById('contactOriginalPhone')?.value || document.getElementById('contactPhoneInput')?.value;
    if (!origPhone) return;
    if (!confirm(`Rostdan ham ushbu mijozni o'chirmoqchimisiz?`)) return;

    try {
        const res = await fetch(`/api/contacts/${encodeURIComponent(origPhone)}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            const key = normalizeContactLookupKey(origPhone);
            if (key) clientContactsMap.delete(key);
            updateHeaderContactsCount();
            if (currentViewerOperators && currentViewerOperators.length > 0) {
                renderOperators(currentViewerOperators);
            }
            if (currentViewerCallbacks) {
                renderViewerCallbacks(currentViewerCallbacks);
            }
            closeContactModal();
            showViewerToast("Mijoz o'chirildi");
        }
    } catch (e) {
        alert("O'chirishda xatolik: " + e.message);
    }
}

function showViewerToast(msg) {
    let toast = document.getElementById('viewerToastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'viewerToastNotification';
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.background = 'rgba(15, 23, 42, 0.95)';
        toast.style.border = '1px solid rgba(56, 189, 248, 0.5)';
        toast.style.color = '#ffffff';
        toast.style.padding = '10px 18px';
        toast.style.borderRadius = '10px';
        toast.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.6)';
        toast.style.fontSize = '13px';
        toast.style.fontWeight = '600';
        toast.style.zIndex = '99999';
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toast.style.pointerEvents = 'none';
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
    }, 2800);
}

/* Client Directory Modal logic */
function openClientDirectoryModal() {
    const modal = document.getElementById('clientDirectoryModal');
    if (!modal) return;
    modal.style.display = 'flex';
    const searchInput = document.getElementById('directorySearchInput');
    if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 100);
    }
    renderClientDirectory();
}

function closeClientDirectoryModal() {
    const modal = document.getElementById('clientDirectoryModal');
    smoothCloseModal(modal);
}

function handleDirectorySearch(val) {
    renderClientDirectory(val);
}

function renderClientDirectory(searchQuery = '') {
    const container = document.getElementById('directoryTableContainer');
    if (!container) return;
    const q = (searchQuery || '').trim().toLowerCase();

    let contacts = Array.from(clientContactsMap.values());
    if (q) {
        contacts = contacts.filter(c => {
            const phone = (c.phone || '').toLowerCase();
            const name = (c.name || '').toLowerCase();
            const org = (c.organization || '').toLowerCase();
            const notes = (c.notes || '').toLowerCase();
            return phone.includes(q) || name.includes(q) || org.includes(q) || notes.includes(q);
        });
    }

    const badge = document.getElementById('directoryCountBadge');
    if (badge) badge.innerText = `${contacts.length} ta mijoz`;

    if (contacts.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 40px 20px;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); margin-bottom: 12px; color: #94a3b8;">
                    ${isax('clipboard-text', '', 'width: 24px; height: 24px;')}
                </div>
                <div>${q ? "Qidiruv bo'yicha hech qanday mijoz topilmadi" : "Hozircha saqlangan mijozlar yo'q"}</div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="client-directory-table">
            <thead>
                <tr>
                    <th>Telefon</th>
                    <th>Mijoz / Kimligi</th>
                    <th>Qayerdan / Tashkilot</th>
                    <th>So'zlashuv tili</th>
                    <th>Izoh</th>
                    <th style="text-align: right;">Harakatlar</th>
                </tr>
            </thead>
            <tbody>
                ${contacts.map(c => {
                    let langBadge = '<span style="color: #64748b;">—</span>';
                    const l = (c.language || '').toLowerCase();
                    if (l === 'uz') langBadge = '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">O\'zbek</span>';
                    else if (l === 'ru') langBadge = '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);">Русский</span>';
                    else if (l === 'en') langBadge = '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">English</span>';
                    else if (l) langBadge = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: rgba(255, 255, 255, 0.08); color: #e2e8f0; border: 1px solid rgba(255, 255, 255, 0.15);">${escapeHtml(l)}</span>`;

                    return `
                    <tr>
                        <td class="contact-table-phone" style="display: flex; align-items: center; gap: 4px;">${isax('call')} ${formatCallerNumber(c.phone)}</td>
                        <td class="contact-table-name">${c.name ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('user')} ${escapeHtml(c.name)}</span>` : '<span style="color: #64748b; font-style: italic;">Ko\'rsatilmagan</span>'}</td>
                        <td class="contact-table-org">${c.organization ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('location')} ${escapeHtml(c.organization)}</span>` : '<span style="color: #64748b;">—</span>'}</td>
                        <td>${langBadge}</td>
                        <td style="font-size: 12px; color: #94a3b8; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${c.notes ? escapeHtml(c.notes) : '<span style="color: #64748b;">—</span>'}
                        </td>
                        <td style="text-align: right; white-space: nowrap;">
                            <button type="button" class="contact-table-action-btn" onclick="openEditContactModal('${escapeAttr(c.phone)}', event)" title="Tahrirlash">
                                <span style="display: inline-flex; align-items: center; gap: 4px;">${isax('edit', '', 'width: 12px; height: 12px;')} Tahrirlash</span>
                            </button>
                            <button type="button" class="contact-table-action-btn delete" onclick="deleteContactFromDirectory('${escapeAttr(c.phone)}', event)" title="O'chirish" style="margin-left: 6px;">
                                <svg class="isax isax-trash" style="width: 13px; height: 13px; display: block;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-trash"></use></svg>
                            </button>
                        </td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function deleteContactFromDirectory(phone, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Rostdan ham ushbu mijozni o'chirmoqchimisiz?`)) return;
    try {
        const res = await fetch(`/api/contacts/${encodeURIComponent(phone)}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            const key = normalizeContactLookupKey(phone);
            if (key) clientContactsMap.delete(key);
            updateHeaderContactsCount();
            if (currentViewerOperators && currentViewerOperators.length > 0) {
                renderOperators(currentViewerOperators);
            }
            if (currentViewerCallbacks) {
                renderViewerCallbacks(currentViewerCallbacks);
            }
            const searchVal = document.getElementById('directorySearchInput')?.value || '';
            renderClientDirectory(searchVal);
            showViewerToast("Mijoz o'chirildi");
        }
    } catch (e) {
        alert("O'chirishda xatolik: " + e.message);
    }
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
            console.log('Viewer WebSocket connected to', wsUrl);
            if (myOperatorId) {
                registerMyOperatorWithServer();
            }
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'session_terminated') {
                    alert(msg.message || 'Parolingiz o\'zgartirildi yoki sessiyangiz yakunlandi. Iltimos, qayta kiring.');
                    window.location.href = '/login';
                    return;
                }
                if (window.TicketsApp && typeof window.TicketsApp.handleWsEvent === 'function') {
                    window.TicketsApp.handleWsEvent(msg);
                }
                if (msg.type === 'server_version' && msg.data) {
                    if (!msg.data.app || msg.data.app === 'call-center-viewer') {
                        handleServerBuildId(msg.data.buildId);
                    }
                } else if (msg.type === 'client_identity' && msg.data) {
                    myClientIp = msg.data.ip;
                    myUserRole = msg.data.role;
                    myUsername = msg.data.username;
                    isOperatorLocked = Boolean(msg.data.operatorLocked);
                    checkSuperuserPrivileges();
                    if (msg.data.operatorId) {
                        setMyOperator(msg.data.operatorId, msg.data.operatorName);
                    } else if (myOperatorId) {
                        registerMyOperatorWithServer();
                    }
                    if (window.TicketsApp && typeof window.TicketsApp.setOperatorIdentity === 'function') {
                        window.TicketsApp.setOperatorIdentity(msg.data.operatorId || myOperatorId, msg.data.operatorName || myOperatorName);
                    }
                    updateHeaderUserProfile(msg.data.operatorName, msg.data.operatorId, msg.data.username, msg.data.role);
                } else if (msg.type === 'help_request_status' && msg.data) {
                    handleHelpRequestStatus(msg.data);
                } else if (msg.type === 'incoming_help_request' && msg.data) {
                    handleIncomingHelpRequest(msg.data);
                } else if (msg.type === 'help_response_received' && msg.data) {
                    handleHelpResponseReceived(msg.data);
                } else if (msg.type === 'help_cancelled' && msg.data) {
                    handleHelpCancelled(msg.data);
                } else if (msg.type === 'active_viewers_update' && msg.data) {
                    renderActiveViewers(msg.data);
                } else if (msg.type === 'initial_state' && msg.data) {
                    // Eslatma: initial_state upstream (3535) dan keladi, shuning uchun uning serverVersion ini qabul qilmaymiz
                    if (msg.data.conversations) currentActiveConversations = msg.data.conversations;
                    if (msg.data.contacts) setClientContactsList(msg.data.contacts);
                    if (msg.data.operators) {
                        currentViewerOperators = msg.data.operators;
                        renderOperators(msg.data.operators);
                    }
                    if (msg.data.callbacks) renderViewerCallbacks(msg.data.callbacks);
                } else if (msg.type === 'client_contacts_update' && msg.data) {
                    handleWsClientContactUpdate(msg.data);
                } else if (msg.type === 'active_conversations_update' && Array.isArray(msg.data)) {
                    currentActiveConversations = msg.data;
                    if (currentViewerOperators && currentViewerOperators.length > 0) {
                        renderOperators(currentViewerOperators);
                    }
                    renderViewerCallbacks(currentViewerCallbacks);
                } else if (msg.type === 'operators_update' && Array.isArray(msg.data)) {
                    currentViewerOperators = msg.data;
                    renderOperators(msg.data);
                    renderViewerCallbacks(currentViewerCallbacks);
                } else if (msg.type === 'agent_operators_update' && Array.isArray(msg.data)) {
                    currentViewerOperators = msg.data;
                    renderOperators(msg.data);
                    renderViewerCallbacks(currentViewerCallbacks);
                } else if (msg.type === 'callbacks_update') {
                    renderViewerCallbacks(msg.data);
                }
            } catch (err) {
                console.warn('WS parse error:', err.message);
            }
        };

        socket.onclose = (event) => {
            if (event && event.code === 4001) {
                window.location.href = '/login';
                return;
            }
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

// Language change reactive listener — re-renders open detail table
window.addEventListener('languageChanged', () => {
    // Sahifa sarlavhasini yangi tilga moslash
    document.title = t('ext_title', 'Call Center — Operatorlar');

    // Re-render table body if detail modal is open
    const modal = document.getElementById('detailModal');
    if (modal && modal.style.display !== 'none' && detailState.rawCalls.length > 0) {
        renderDetailTableBody();
        if (detailState.currentOp) renderOperatorSummaryPills();
    }
    // Re-render operators with new language
    if (window._rawLastOperators) {
        renderOperators(window._rawLastOperators);
    }
});

let currentViewerCallbacks = [];
let currentActiveConversations = [];
let currentViewerOperators = [];
let currentCallbackDateFilter = 'today'; // 'today' | 'all'
let currentCallbackTab = 'pending'; // 'pending' | 'unreachable' | 'resolved'
let viewerCbResolvedTodayOnly = false; // by default disabled (off)
try {
    viewerCbResolvedTodayOnly = localStorage.getItem('viewerCbResolvedTodayOnly') === 'true';
} catch (e) {}

function toggleViewerCbResolvedTodayOnly(checked) {
    viewerCbResolvedTodayOnly = !!checked;
    try {
        localStorage.setItem('viewerCbResolvedTodayOnly', viewerCbResolvedTodayOnly ? 'true' : 'false');
    } catch (e) {}
    const slider = document.getElementById('sliderViewerCbResolvedTodayOnly');
    const knob = document.getElementById('knobViewerCbResolvedTodayOnly');
    if (slider && knob) {
        if (viewerCbResolvedTodayOnly) {
            slider.style.backgroundColor = '#10b981';
            slider.style.borderColor = 'rgba(16, 185, 129, 0.5)';
            slider.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.35)';
            knob.style.transform = 'translateX(16px)';
        } else {
            slider.style.backgroundColor = '#334155';
            slider.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            slider.style.boxShadow = 'none';
            knob.style.transform = 'translateX(0px)';
        }
    }
    renderViewerCallbacks(currentViewerCallbacks);
}

function initViewerCbResolvedToggle() {
    try {
        if (viewerCbResolvedTodayOnly) {
            const chk = document.getElementById('toggleViewerCbResolvedTodayOnly');
            if (chk) chk.checked = true;
            const slider = document.getElementById('sliderViewerCbResolvedTodayOnly');
            const knob = document.getElementById('knobViewerCbResolvedTodayOnly');
            if (slider && knob) {
                slider.style.backgroundColor = '#10b981';
                slider.style.borderColor = 'rgba(16, 185, 129, 0.5)';
                slider.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.35)';
                knob.style.transform = 'translateX(16px)';
            }
        }
    } catch (e) {}
}

function getPhone9(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    return digits.length >= 9 ? digits.slice(-9) : null;
}

function findActiveCallForPhone(phone, itemActiveCall) {
    if (itemActiveCall && itemActiveCall.operator) {
        return itemActiveCall;
    }
    const target9 = getPhone9(phone);
    if (!target9) return null;

    // 1. Faol suhbatlar (talking)
    if (Array.isArray(currentActiveConversations)) {
        for (const conv of currentActiveConversations) {
            const c9 = getPhone9(conv.callerId);
            if (c9 && c9 === target9) {
                const rawName = conv.operator || '';
                const cleanName = String(rawName).replace(/\s*\(\d+\)\s*/g, '').trim() || (conv.operatorExten ? `Operator ${conv.operatorExten}` : 'Operator');
                return {
                    operator: cleanName,
                    operatorExten: conv.operatorExten || '',
                    state: 'talking',
                    stateLabel: 'gaplashmoqda'
                };
            }
        }
    }

    // 2. Chiquvchi yoki kiruvchi qo'ng'iroq jiringlayotgan (ringing)
    if (Array.isArray(currentViewerOperators)) {
        for (const op of currentViewerOperators) {
            if (op.presence === 'ringing' && op.ringingCaller) {
                const r9 = getPhone9(op.ringingCaller);
                if (r9 && r9 === target9) {
                    const cleanName = op.realName || op.name || `Operator ${op.id}`;
                    return {
                        operator: cleanName,
                        operatorExten: op.id,
                        state: 'ringing',
                        stateLabel: 'qo\'ng\'iroq qilinmoqda'
                    };
                }
            }
        }
    }

    return null;
}

function switchCallbackDateFilter(filter) {
    if (filter !== 'today' && filter !== 'all') return;
    currentCallbackDateFilter = filter;
    
    const btnToday = document.getElementById('btnFilterToday');
    const btnAll = document.getElementById('btnFilterAll');
    if (btnToday && btnAll) {
        if (filter === 'today') {
            btnToday.classList.add('active');
            btnToday.style.background = '#3b82f6';
            btnToday.style.color = '#fff';
            btnAll.classList.remove('active');
            btnAll.style.background = 'transparent';
            btnAll.style.color = '#94a3b8';
        } else {
            btnAll.classList.add('active');
            btnAll.style.background = '#3b82f6';
            btnAll.style.color = '#fff';
            btnToday.classList.remove('active');
            btnToday.style.background = 'transparent';
            btnToday.style.color = '#94a3b8';
        }
    }
    renderViewerCallbacks(currentViewerCallbacks);
}

function switchCallbackTab(tab) {
    if (tab !== 'pending' && tab !== 'unreachable' && tab !== 'resolved') return;
    currentCallbackTab = tab;

    const btnPending = document.getElementById('tabPendingBtn');
    const btnUnreachable = document.getElementById('tabUnreachableBtn');
    const btnResolved = document.getElementById('tabResolvedBtn');
    const hintEl = document.getElementById('cbTabHint');
    const filterBar = document.getElementById('viewerCbResolvedFilterBar');

    if (filterBar) {
        filterBar.style.display = (tab === 'resolved') ? 'flex' : 'none';
    }

    if (btnPending && btnUnreachable) {
        // Reset all 3
        btnPending.classList.remove('active');
        btnPending.style.background = 'rgba(100, 116, 139, 0.15)';
        btnPending.style.borderColor = 'rgba(100, 116, 139, 0.3)';
        btnPending.style.color = '#94a3b8';

        btnUnreachable.classList.remove('active');
        btnUnreachable.style.background = 'rgba(100, 116, 139, 0.15)';
        btnUnreachable.style.borderColor = 'rgba(100, 116, 139, 0.3)';
        btnUnreachable.style.color = '#94a3b8';

        if (btnResolved) {
            btnResolved.classList.remove('active');
            btnResolved.style.background = 'rgba(100, 116, 139, 0.15)';
            btnResolved.style.borderColor = 'rgba(100, 116, 139, 0.3)';
            btnResolved.style.color = '#94a3b8';
        }

        if (tab === 'pending') {
            btnPending.classList.add('active');
            btnPending.style.background = 'rgba(245, 158, 11, 0.18)';
            btnPending.style.borderColor = 'rgba(245, 158, 11, 0.5)';
            btnPending.style.color = '#fbbf24';

            if (hintEl) {
                hintEl.textContent = t('viewer_callback_pending_hint', "* Hali operatorlar bog'lanmagan yangi mijozlar");
            }
        } else if (tab === 'unreachable') {
            btnUnreachable.classList.add('active');
            btnUnreachable.style.background = 'rgba(239, 68, 68, 0.18)';
            btnUnreachable.style.borderColor = 'rgba(239, 68, 68, 0.5)';
            btnUnreachable.style.color = '#f87171';

            if (hintEl) {
                hintEl.textContent = t('viewer_callback_unreachable_hint', "* Operator qo'ng'iroq qilgan, ammo mijoz go'shakni ko'tarmagan");
            }
        } else if (tab === 'resolved' && btnResolved) {
            btnResolved.classList.add('active');
            btnResolved.style.background = 'rgba(16, 185, 129, 0.18)';
            btnResolved.style.borderColor = 'rgba(16, 185, 129, 0.5)';
            btnResolved.style.color = '#34d399';

            if (hintEl) {
                hintEl.textContent = t('viewer_callback_resolved_hint', "* Operatorlar gaplashib bo'lgan mijozlar");
            }
        }
    }
    renderViewerCallbacks(currentViewerCallbacks);
}

function getCallbackRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
        const parts = String(dateStr).trim().split(/[- :]/);
        if (parts.length < 5) return '';
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const hour = parseInt(parts[3], 10);
        const min = parseInt(parts[4], 10);
        const sec = parts[5] ? parseInt(parts[5], 10) : 0;
        
        // Target date in Tashkent timezone (UTC+5)
        const targetUtc = Date.UTC(year, month, day, hour - 5, min, sec);
        const diffSec = Math.floor((Date.now() - targetUtc) / 1000);
        
        if (isNaN(diffSec) || diffSec < 0) return '';
        if (diffSec < 60) return typeof t === 'function' ? t('time_just_now', 'hozirgina') : 'hozirgina';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin} ${typeof t === 'function' ? t('time_min_ago', 'daq oldin') : 'daq oldin'}`;
        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return `${diffHours} ${typeof t === 'function' ? t('time_hour_ago', 'soat oldin') : 'soat oldin'}`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} ${typeof t === 'function' ? t('time_day_ago', 'kun oldin') : 'kun oldin'}`;
    } catch (e) {
        return '';
    }
}

function renderViewerCallbacks(callbacks) {
    currentViewerCallbacks = Array.isArray(callbacks) ? callbacks : [];
    const countEl = document.getElementById('viewerCallbackCount');
    const pendingCountEl = document.getElementById('cbPendingCount');
    const unreachableCountEl = document.getElementById('cbUnreachableCount');
    const resolvedCountEl = document.getElementById('cbResolvedCount');
    const listEl = document.getElementById('viewerCallbackList');

    const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);

    // 1. Sana filtri (Bugun / Hammasi)
    const isTodayCallback = (c) => {
        if (!c) return false;
        if (c.status === 'resolved') {
            if (viewerCbResolvedTodayOnly) {
                return Boolean(c.call_time && c.call_time.startsWith(todayStr));
            }
            const isResolvedToday = (c.updated_at && c.updated_at.startsWith(todayStr)) || 
                                    (c.dismissed_at && c.dismissed_at.startsWith(todayStr)) ||
                                    (c.call_time && c.call_time.startsWith(todayStr));
            return isResolvedToday;
        }
        if (!c.call_time) return false;
        return c.call_time.startsWith(todayStr);
    };

    const activeViewerCallbacks = currentViewerCallbacks.filter(c => c && c.source !== 'ivr_non_working');

    const dateFilteredRaw = (currentCallbackDateFilter === 'today')
        ? activeViewerCallbacks.filter(isTodayCallback)
        : activeViewerCallbacks;

    // Unikal mijozlar (Distinct Clients) bo'yicha guruhlash:
    // Bir xil telefon raqamidan kelgan takroriy qo'ng'iroqlarni 1 ta mijoz sifatida jamlaymiz
    const deduplicateViewerCallbacksByPhone = (items) => {
        const sorted = [...items].sort((a, b) => {
            const isPendingA = (a.status === 'pending' || !a.status) ? 0 : 1;
            const isPendingB = (b.status === 'pending' || !b.status) ? 0 : 1;
            if (isPendingA !== isPendingB) return isPendingA - isPendingB;
            const timeA = a.call_time || a.created_at || '';
            const timeB = b.call_time || b.created_at || '';
            return timeB.localeCompare(timeA);
        });

        const map = new Map();
        for (const r of sorted) {
            const isPending = (r.status === 'pending' || !r.status);
            const callDate = r.call_time ? r.call_time.slice(0, 10) : (r.created_at ? r.created_at.slice(0, 10) : todayStr);
            const groupKey = isPending ? `pending_${r.phone}` : `${r.phone}_${callDate}`;
            const isToday = Boolean(r.call_time && r.call_time.startsWith(todayStr));
            const rTodayAtt = Number(r.today_attempts !== undefined && r.today_attempts !== null ? r.today_attempts : (isToday ? r.attempts_count : 0)) || (isToday ? 1 : 0);
            const rTotalAtt = Number(r.attempts_count) || (rTodayAtt || 1);

            if (!map.has(groupKey)) {
                map.set(groupKey, {
                    ...r,
                    today_attempts: rTodayAtt,
                    attempts_count: rTotalAtt,
                    all_ids: [r.id]
                });
            } else {
                const existing = map.get(groupKey);
                if (isToday) {
                    existing.today_attempts = (existing.today_attempts || 0) + (rTodayAtt > 0 ? rTodayAtt : 1);
                }
                existing.attempts_count = (existing.attempts_count || 1) + (rTotalAtt > 0 ? rTotalAtt : 1);
                if (!existing.all_ids.includes(r.id)) existing.all_ids.push(r.id);
                if (r.call_time && (!existing.call_time || r.call_time > existing.call_time)) {
                    existing.call_time = r.call_time;
                }
            }
        }
        return Array.from(map.values());
    };

    const dateFiltered = deduplicateViewerCallbacksByPhone(dateFilteredRaw);

    // 2. Kategoriya bo'yicha ajratish: Kutilmoqda vs Bog'lanib bo'lmadi vs Gaplashildi
    const pendingList = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && (!c.outbound_attempts || c.outbound_attempts === 0));
    const unreachableList = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && c.outbound_attempts && c.outbound_attempts > 0);
    let resolvedList = dateFiltered.filter(c => c.status === 'resolved');

    // "Faqat bugun tushgan mijozlar" switch filtri yoqilgan bo'lsa:
    if (viewerCbResolvedTodayOnly) {
        resolvedList = resolvedList.filter(c => c.call_time && c.call_time.startsWith(todayStr));
    }

    const totalNeedAttention = pendingList.length + unreachableList.length;

    // Hisoblagichlarni yangilash
    if (countEl) {
        countEl.textContent = `${totalNeedAttention} ta`;
        if (totalNeedAttention > 0) {
            countEl.style.background = 'rgba(245, 158, 11, 0.2)';
            countEl.style.color = '#fbbf24';
            countEl.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        } else {
            countEl.style.background = 'rgba(255, 255, 255, 0.08)';
            countEl.style.color = '#94a3b8';
            countEl.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }
    }
    if (pendingCountEl) pendingCountEl.textContent = `${pendingList.length}`;
    if (unreachableCountEl) unreachableCountEl.textContent = `${unreachableList.length}`;
    if (resolvedCountEl) resolvedCountEl.textContent = `${resolvedList.length}`;

    if (!listEl) return;

    let displayList = pendingList;
    if (currentCallbackTab === 'unreachable') displayList = unreachableList;
    else if (currentCallbackTab === 'resolved') displayList = resolvedList;

    // Eng yangilari tepada bo'lishi uchun call_time bo'yicha kamayish (DESC) tartibida saralash
    displayList = [...displayList].sort((a, b) => {
        const timeA = a.call_time || a.created_at || '';
        const timeB = b.call_time || b.created_at || '';
        return timeB.localeCompare(timeA);
    });

    if (displayList.length === 0) {
        const emptyMsg = (currentCallbackTab === 'unreachable')
            ? t('live_callbacks_unreachable_empty', "Bog'lanib bo'lmagan mijozlar yo'q")
            : (currentCallbackTab === 'resolved')
                ? t('live_callbacks_resolved_empty', "Hozircha gaplashilgan mijozlar yo'q")
                : t('live_callbacks_pending_empty', "Hozircha kutilayotgan yangi mijozlar yo'q");
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 18px; font-size: 13px;">
                ${emptyMsg}
            </div>
        `;
        return;
    }

    let html = '';
    for (let index = 0; index < displayList.length; index++) {
        const item = displayList[index];
        const phone = item.phone || '';
        let cleanPhone = String(phone).replace(/[^\d]/g, '');
        if (cleanPhone.length === 12 && cleanPhone.startsWith('998')) {
            cleanPhone = cleanPhone.slice(3);
        }
        let formattedPhone = cleanPhone || phone;

        const isIvr = (item.source === 'ivr_non_working');
        const isUnreachable = (currentCallbackTab === 'unreachable');
        const isResolved = (currentCallbackTab === 'resolved' || item.status === 'resolved');
        const isNewestItem = (index === 0 && (currentCallbackTab === 'pending' || !currentCallbackTab));

        let badgeLabel = isIvr ? t('callback_source_ivr', 'Ish vaqti emas') : t('callback_source_abandoned', 'Navbatdan chiqdi');
        let badgeStyle = isIvr 
            ? 'background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35);'
            : 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);';
        let badgeIcon = isIvr ? isax('moon') : isax('timer');

        if (isResolved) {
            badgeLabel = t('tab_callbacks_resolved', 'Gaplashildi');
            badgeStyle = 'background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);';
            badgeIcon = isax('tick-circle');
        }

        let timeDisplay = item.call_time || '';
        if (timeDisplay.includes(' ')) {
            const parts = timeDisplay.split(' ');
            timeDisplay = `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
        }

        let resTimeDisplay = item.updated_at || item.dismissed_at || item.call_time || '';
        if (resTimeDisplay.includes(' ')) {
            const parts = resTimeDisplay.split(' ');
            resTimeDisplay = `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
        }

        const relTime = getCallbackRelativeTime(item.call_time);

        // Tartib raqami (#1, #2, #3...)
        let orderBadge = '';
        if (isNewestItem) {
            orderBadge = `
                <span style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.4)); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.6); font-size: 9.5px; font-weight: 800; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35); text-transform: uppercase; letter-spacing: 0.4px;">
                    ${isax('flash', '', 'width: 10px; height: 10px; color: #34d399;')} ${t('cb_order_newest', '#1 Eng yangi')}
                </span>
            `;
        } else {
            orderBadge = `
                <span style="background: rgba(255, 255, 255, 0.08); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.12); font-size: 10px; font-weight: 700; padding: 1.5px 5.5px; border-radius: 5px; display: inline-flex; align-items: center;">
                    #${index + 1}
                </span>
            `;
        }

        const activeCall = findActiveCallForPhone(phone, item.activeCall);
        const isActive = Boolean(activeCall);

        // Karta chekkasi stili
        let cardBorder = '';
        if (isActive) {
            cardBorder = 'border: 1.5px solid #10b981; border-left: 4px solid #10b981; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(15, 23, 42, 0.9)); box-shadow: 0 0 16px rgba(16, 185, 129, 0.28);';
        } else if (isResolved) {
            cardBorder = 'background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(16, 185, 129, 0.25); border-left: 3.5px solid #10b981;';
        } else if (isUnreachable) {
            const outAttempts = item.outbound_attempts || 1;
            const borderCol = outAttempts >= 3 ? '#ef4444' : (outAttempts === 2 ? '#f97316' : '#eab308');
            cardBorder = `background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(239, 68, 68, 0.25); border-left: 3.5px solid ${borderCol};`;
        } else if (isNewestItem) {
            cardBorder = 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(30, 41, 59, 0.85)); border: 1.5px solid rgba(16, 185, 129, 0.45); border-left: 4px solid #10b981; box-shadow: 0 0 16px rgba(16, 185, 129, 0.2);';
        } else {
            cardBorder = `background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(245, 158, 11, 0.28); border-left: 3px solid ${isIvr ? '#a855f7' : '#f59e0b'};`;
        }

        const titleText = isActive 
            ? `${activeCall.operator} hozirda ushbu mijoz bilan ${activeCall.state === 'ringing' ? "bog'lanmoqda" : "gaplashmoqda"}! Nusxalash uchun bosing`
            : "Raqamni nusxalash uchun bosing";

        // Urinishlar belgisi (agar Bog'lanib bo'lmadi bo'lsa yoki Gaplashilgan bo'lsa)
        let retryBadge = '';
        let lastOutboundInfo = '';
        if (isResolved) {
            const resType = item.resolution_type || '';
            const disBy = item.dismissed_by || '';
            const isOutbound = (resType === 'operator_outbound') || disBy.includes('outbound') || disBy === 'realtime_outbound_bridge';
            const isInbound = (resType === 'client_inbound') || disBy.includes('inbound') || disBy === 'realtime_agent_connect';

            let resTitle = "Aloqa o'rnatildi";
            let resIcon = isax('tick-circle', '', 'width: 10px; height: 10px; color: #34d399;');
            let resColor = '#34d399';

            if (isOutbound) {
                resTitle = "Operator aloqaga chiqdi";
                resIcon = isax('call-calling', '', 'width: 10px; height: 10px; color: #10b981;');
                resColor = '#10b981';
            } else if (isInbound) {
                resTitle = "Mijoz qayta bog'landi";
                resIcon = isax('call-received', '', 'width: 10px; height: 10px; color: #38bdf8;');
                resColor = '#38bdf8';
            }

            const KNOWN_OPS = {
                '101': 'Oybek',
                '102': 'Dilnoza',
                '103': 'Feruza',
                '104': 'Zuhra',
                '105': 'Shaxnoza',
                '106': 'Ubaydullayeva Gulchehra',
                '107': 'Madina',
                '108': 'Xurshida',
                '109': 'Sitora',
                '111': 'Nozima',
                '112': 'Nargiza',
                '113': 'Malika',
                '114': 'Maxmudbek',
                '115': 'Nilufar',
                '117': 'Zarnigor',
                '119': 'Muattar',
                '120': 'Navruzoy'
            };

            let opRaw = item.last_outbound_operator || '';
            if (opRaw === 'NULL' || opRaw === 'null' || opRaw === '\\N' || opRaw.includes('cdr_sync') || opRaw.includes('hangup')) {
                opRaw = '';
            }

            let opDisplayName = '';
            if (opRaw && !/^\d{2,4}$/.test(opRaw.trim())) {
                opDisplayName = opRaw.trim();
            } else {
                let ext = opRaw ? opRaw.trim() : '';
                if (!ext && disBy) {
                    const m = disBy.match(/(?:operator_|3cx_\w*?)(\d{2,4})/);
                    if (m) ext = m[1];
                }
                if (ext) {
                    if (typeof currentOperators !== 'undefined' && Array.isArray(currentOperators)) {
                        const found = currentOperators.find(o => String(o.id || o.extension || o.ext) === ext);
                        if (found && found.name && found.name !== ext) {
                            opDisplayName = String(found.name).includes(`(${ext})`) ? found.name : `${found.name} (${ext})`;
                        }
                    }
                    if (!opDisplayName && KNOWN_OPS[ext]) {
                        opDisplayName = `${KNOWN_OPS[ext]} (${ext})`;
                    }
                    if (!opDisplayName) {
                        opDisplayName = `Operator ${ext}`;
                    }
                }
            }

            if (opDisplayName) {
                opDisplayName = opDisplayName.replace(/\((\d+)\)\s*\(\1\)/g, '($1)').replace(/\s+/g, ' ').trim();
            }

            if (!opDisplayName) {
                opDisplayName = "Operator biriktirilmagan";
            }

            lastOutboundInfo = `
                <div style="background: rgba(15, 23, 42, 0.65); border: 1px dashed rgba(16, 185, 129, 0.28); border-radius: 7px; padding: 5px 9px; margin-top: 3px; font-size: 11px; display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #94a3b8; font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">
                            ${resIcon} Holat:
                        </span>
                        <span style="color: ${resColor}; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                            ${resTitle}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #94a3b8; font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('user', '', 'width: 10px; height: 10px; opacity: 0.7;')} Operator:
                        </span>
                        <span style="display: inline-flex; align-items: center; gap: 5px;">
                            <span style="color: #38bdf8; font-weight: 600;">${opDisplayName}</span>
                            ${resTimeDisplay ? `<span style="color: #34d399; font-weight: 600; font-size: 9.5px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.5px 4.5px; border-radius: 3px;" title="Oxirgi marta aloqaga chiqilgan vaqt">${resTimeDisplay}</span>` : ''}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #94a3b8; font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('clock', '', 'width: 10px; height: 10px; opacity: 0.7;')} Mijoz bog'langan so'ngi vaqt:
                        </span>
                        <span style="color: #f1f5f9; font-weight: 600;">${timeDisplay}</span>
                    </div>
                </div>
            `;
        } else if (isUnreachable) {
            const outAttempts = item.outbound_attempts || 1;
            let retryStyle = 'background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);';
            let retryIcon = isax('warning-2');
            if (outAttempts === 2) {
                retryStyle = 'background: rgba(249, 115, 22, 0.2); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.4);';
                retryIcon = isax('warning-2');
            } else if (outAttempts >= 3) {
                retryStyle = 'background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);';
                retryIcon = isax('close-circle');
            }

            retryBadge = `
                <span style="padding: 2px 7px; border-radius: 5px; font-weight: 700; font-size: 10px; ${retryStyle}">
                    ${retryIcon} ${outAttempts} marta urinildi
                </span>
            `;

            let outTimeDisplay = item.last_outbound_time || '';
            if (outTimeDisplay.includes(' ')) {
                const parts = outTimeDisplay.split(' ');
                outTimeDisplay = `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
            }

            lastOutboundInfo = `
                <div style="background: rgba(15, 23, 42, 0.65); border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: 7px; padding: 6px 9px; margin-top: 3px; font-size: 11px; display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #94a3b8; font-size: 10.5px;">Oxirgi operator:</span>
                        <span style="color: #38bdf8; font-weight: 600;">${item.last_outbound_operator || 'Operator'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #94a3b8; font-size: 10.5px;">Oxirgi urinish:</span>
                        <span style="color: #f1f5f9; font-weight: 600;">${outTimeDisplay || timeDisplay}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #94a3b8; font-size: 10.5px;">Natija:</span>
                        <span style="color: #fb7185; font-weight: 600;">${item.last_outbound_cause || 'Javob bermadi'}</span>
                    </div>
                </div>
            `;
        }

        const cbContact = getClientContact(phone);
        const isToday = Boolean(item.call_time && item.call_time.startsWith(todayStr));
        const attemptsCount = (currentCallbackDateFilter === 'today' || isToday)
            ? (Number(item.today_attempts) || (isToday ? Number(item.attempts_count) || 1 : 1))
            : (Number(item.attempts_count || item.today_attempts) || 1);
        const attemptBadge = attemptsCount > 1
            ? `<span style="background: rgba(239, 68, 68, 0.22); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45); font-size: 10.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; margin-left: 5px; display: inline-flex; align-items: center;" title="Bugun ${attemptsCount} marta tushgan">x${attemptsCount}</span>`
            : '';

        html += `
            <div class="${isActive ? 'callback-card-talking' : ''}" style="${cardBorder} border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; position: relative;" onclick="copyViewerCallbackPhone('${phone}', this)" title="${titleText}">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${orderBadge}
                        <span style="font-size: 13.5px; font-weight: 700; color: #fff; letter-spacing: 0.3px;">${formattedPhone}</span>
                        ${attemptBadge}
                    </div>
                    ${isActive ? `
                        <div class="callback-active-badge" title="${activeCall.operator} ${activeCall.stateLabel}">
                            <img src="/img/calling-green.png" alt="Calling" />
                            <span>${activeCall.operator}</span>
                        </div>
                    ` : `
                        ${retryBadge || `<span style="font-size: 11px; opacity: 0.7; display: inline-flex;">${isax('clipboard-text', '', 'width: 12px; height: 12px;')}</span>`}
                    `}
                </div>
                ${cbContact ? (() => {
                    const hasName = Boolean(cbContact.name && cbContact.name.trim());
                    const hasOrg = Boolean(cbContact.organization && cbContact.organization.trim());
                    return `
                    <div style="font-size: 11.5px; color: #38bdf8; font-weight: 600; display: flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                         onclick="event.stopPropagation(); openEditContactModal('${escapeAttr(phone)}', event);" title="Mijoz ma'lumotini tahrirlash">
                        ${hasName ? `<span style="display: inline-flex; align-items: center; gap: 3px;">${isax('user', '', 'width: 11px; height: 11px;')} ${escapeHtml(cbContact.name)}</span>` : ''}
                        ${hasName && hasOrg ? `<span style="color: #94a3b8; font-size: 10.5px; font-weight: 400;">•</span>` : ''}
                        ${hasOrg ? `<span style="color: ${hasName ? '#94a3b8' : '#f59e0b'}; font-size: ${hasName ? '10.5px' : '11.5px'}; font-weight: ${hasName ? '400' : '700'}; display: inline-flex; align-items: center; gap: 3px;">${isax('location', '', 'width: 11px; height: 11px;')} ${escapeHtml(cbContact.organization)}</span>` : ''}
                        <span style="font-size: 10px; opacity: 0.7; margin-left: 2px; display: inline-flex;">${isax('edit', '', 'width: 10px; height: 10px;')}</span>
                    </div>
                    `;
                })() : `
                <div style="font-size: 10.5px;" onclick="event.stopPropagation(); openAddContactModal('${escapeAttr(phone)}', event);">
                    <span style="color: #38bdf8; opacity: 0.8; cursor: pointer; border-bottom: 1px dashed rgba(56, 189, 248, 0.5);">+ Ism / Qayerdan saqlash</span>
                </div>
                `}
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-top: 2px;">
                    <span style="padding: 2px 7px; border-radius: 5px; font-weight: 600; font-size: 10px; ${badgeStyle}">
                        ${badgeIcon} ${badgeLabel}
                    </span>
                    <div style="display: flex; align-items: center; gap: 4px; color: #94a3b8; font-size: 10.5px;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('clock', '', 'width: 11px; height: 11px; opacity: 0.75;')}
                            ${isResolved ? `Gaplashildi: ${resTimeDisplay}` : `Tushgan: ${timeDisplay}`}
                            ${relTime && !isResolved ? `<strong style="color: ${isNewestItem ? '#34d399' : '#cbd5e1'}; font-weight: 600; margin-left: 2px;">(${relTime})</strong>` : ''}
                        </span>
                    </div>
                </div>
                ${lastOutboundInfo}
                ${isActive ? `
                    <div class="callback-active-subrow">
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span class="active-dot"></span>
                            <span>${activeCall.operator}</span>
                        </div>
                        <span style="color: #a7f3d0; font-weight: 500; font-size: 10.5px;">${activeCall.state === 'ringing' ? "Qo'ng'iroq qilinmoqda..." : "Suhbatlashmoqda..."}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    listEl.innerHTML = html;
}

function copyViewerCallbackPhone(phone, el) {
    if (!phone) return;

    const onSuccess = () => {
        if (el) {
            const titleSpan = el.querySelector('span');
            if (titleSpan) {
                const orig = titleSpan.textContent;
                titleSpan.textContent = "✓ Nusxalandi!";
                titleSpan.style.color = "#10b981";
                setTimeout(() => {
                    titleSpan.textContent = orig;
                    titleSpan.style.color = "#fff";
                }, 1200);
            }
        }
    };

    // 1-usul: modern Clipboard API (faqat HTTPS yoki localhost'da mavjud)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(phone).then(onSuccess).catch(() => fallbackCopyViewerCallbackPhone(phone, onSuccess));
        return;
    }
    fallbackCopyViewerCallbackPhone(phone, onSuccess);
}

// Clipboard API ishlamasa (HTTP orqali ochilganda) — eski usul: vaqtinchalik textarea + execCommand('copy')
function fallbackCopyViewerCallbackPhone(phone, onSuccess) {
    try {
        const ta = document.createElement('textarea');
        ta.value = phone;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
            onSuccess();
        } else {
            window.prompt('Brauzer ruxsat bermadi. Raqamni qo\'lda nusxalang:', phone);
        }
    } catch (e) {
        window.prompt('Brauzer ruxsat bermadi. Raqamni qo\'lda nusxalang:', phone);
    }
}

async function fetchViewerCallbacks() {
    try {
        const resp = await fetch('/api/callbacks');
        const json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
            renderViewerCallbacks(json.data);
        }
    } catch (e) {}
}

function initPageElevator() {
    const btn = document.getElementById('pageElevatorBtn');
    if (!btn) return;

    let hideTimer = null;
    let lastScrollTop = 0;
    let isHovered = false;

    function getActiveScrollTarget() {
        const container = document.querySelector('.viewer-container') || document.querySelector('.main-area');
        if (container && (container.scrollHeight - container.clientHeight > 60)) {
            return container;
        }
        const docElem = document.scrollingElement || document.documentElement || document.body;
        if (docElem && (docElem.scrollHeight - window.innerHeight > 60)) {
            return window;
        }
        return container || window;
    }

    function getMetrics(target) {
        if (target === window) {
            const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
            const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight || 0);
            const clientHeight = window.innerHeight || 0;
            return { scrollTop, scrollHeight, clientHeight };
        }
        return {
            scrollTop: target.scrollTop || 0,
            scrollHeight: target.scrollHeight || 0,
            clientHeight: target.clientHeight || 0
        };
    }

    function scheduleHide(delay = 1800) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!isHovered) {
                btn.classList.remove('visible');
            }
        }, delay);
    }

    function setDirection(mode) {
        if (mode === 'down') {
            btn.classList.remove('mode-up');
            btn.classList.add('mode-down');
            btn.setAttribute('title', "Eng pastga tushish");
            btn.setAttribute('aria-label', "Eng pastga tushish");
        } else {
            btn.classList.remove('mode-down');
            btn.classList.add('mode-up');
            btn.setAttribute('title', "Eng tepaga chiqish");
            btn.setAttribute('aria-label', "Eng tepaga chiqish");
        }
    }

    function handleScroll() {
        const target = getActiveScrollTarget();
        const { scrollTop, scrollHeight, clientHeight } = getMetrics(target);

        // Sahifada skroll qilish imkoni bo'lmasa, ko'rinmaydi
        if (scrollHeight <= clientHeight + 80) {
            btn.classList.remove('visible');
            return;
        }

        const delta = scrollTop - lastScrollTop;
        const isNearTop = scrollTop <= 80;
        const isNearBottom = scrollTop + clientHeight >= scrollHeight - 80;

        // Yo'nalishni aniqlash:
        // 1. Eng pastga yetib kelgan bo'lsa -> faqat yuqoriga (mode-up)
        if (isNearBottom) {
            setDirection('up');
        }
        // 2. Eng tepada bo'lsa -> faqat pastga (mode-down)
        else if (isNearTop) {
            setDirection('down');
        }
        // 3. Foydalanuvchi pastga qarab skroll qilyapti (delta > 3) -> pastga yo'l ko'rsatsin (mode-down)
        else if (delta > 3) {
            setDirection('down');
        }
        // 4. Foydalanuvchi tepaga qarab skroll qilyapti (delta < -3) -> tepaga yo'l ko'rsatsin (mode-up)
        else if (delta < -3) {
            setDirection('up');
        }

        lastScrollTop = Math.max(0, scrollTop);

        // Faqat skroll qilganda paydo bo'ladi
        btn.classList.add('visible');

        // Va skroll to'xtagach sekin disappear bo'lib yo'qoladi
        scheduleHide(1800);
    }

    btn.addEventListener('mouseenter', () => {
        isHovered = true;
        clearTimeout(hideTimer);
    });

    btn.addEventListener('mouseleave', () => {
        isHovered = false;
        scheduleHide(1200);
    });

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const target = getActiveScrollTarget();
        const isUp = btn.classList.contains('mode-up');
        const { scrollHeight } = getMetrics(target);
        const destination = isUp ? 0 : scrollHeight;

        if (target === window) {
            window.scrollTo({ top: destination, behavior: 'smooth' });
        } else {
            target.scrollTo({ top: destination, behavior: 'smooth' });
        }

        // Bosilgach yo'nalishni teskarisiga o'zgartirib, sekin yashiramiz
        setDirection(isUp ? 'down' : 'up');
        scheduleHide(1200);
    });

    const container = document.querySelector('.viewer-container') || document.querySelector('.main-area');
    if (container) {
        container.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Boshida mutlaqo ko'rinmasin
    btn.classList.remove('visible');
    const { scrollTop, scrollHeight, clientHeight } = getMetrics(getActiveScrollTarget());
    lastScrollTop = scrollTop;
    if (scrollTop > (scrollHeight - clientHeight) / 2) {
        setDirection('up');
    } else {
        setDirection('down');
    }
}

function initViewer() {
    document.title = t('ext_title', 'Call Center — Operatorlar');
    initHeaderClock();
    initDetailModalEvents();
    loadClientContacts();
    initViewerCbResolvedToggle();
    loadOperators();
    fetchActiveViewers();
    fetchViewerCallbacks();
    initViewerProfileIdentity();
    initPageElevator();
    initWebSocket();
    initDeployWatcher();
    initConverterDropzone();

    // Avtomatik zaxira so'rovi (har 6 soniyada)
    refreshInterval = setInterval(() => {
        loadOperators();
        fetchActiveViewers();
        fetchViewerCallbacks();
    }, 6000);
}

/* ==========================================================================
   PRODUCTION DEPLOY & AUTO-REFRESH ENGINE
   ========================================================================== */
let currentClientBuildId = null;
let deployBannerCountdownTimer = null;
let isDeployBannerActive = false;

function initDeployWatcher() {
    // 1. Initial silent version check to store current buildId
    checkVersionFromServer(true);

    // 2. Periodic polling every 20 seconds (background fallback if WS is idle or sleeping)
    setInterval(() => {
        checkVersionFromServer(false);
    }, 20000);

    // 3. Check immediately when user switches back to this browser tab
    window.addEventListener('focus', () => {
        checkVersionFromServer(false);
    });

    window.addEventListener('online', () => {
        checkVersionFromServer(false);
    });
}

async function checkVersionFromServer(isInitial = false) {
    try {
        const res = await fetch(`/api/version?_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.buildId) {
            handleServerBuildId(data.buildId, isInitial);
        }
    } catch (e) {
        // Server restart in progress, silently ignore
    }
}

function handleServerBuildId(incomingBuildId, isInitial = false) {
    if (!incomingBuildId || incomingBuildId === 'dev') return;

    // Dastlabki yuklanishda joriy versiya bazasini o'rnatamiz
    if (isInitial || !currentClientBuildId) {
        currentClientBuildId = incomingBuildId;
        try {
            if (sessionStorage.getItem('last_reloaded_build') === incomingBuildId) {
                sessionStorage.removeItem('last_reloaded_build');
            }
        } catch (e) {}
        return;
    }

    // Agar ushbu versiyaga allaqachon sahifa yangilangan bo'lsa, qayta banner ochmaymiz
    try {
        if (sessionStorage.getItem('last_reloaded_build') === incomingBuildId) {
            return;
        }
    } catch (e) {}

    // Faqat haqiqiy yangi versiya kelganda va buildId mos kelmagandagina banner chiqadi
    if (incomingBuildId !== currentClientBuildId) {
        showDeployUpdateBanner(incomingBuildId);
    }
}

function executeDeployReload(targetBuildId) {
    if (deployBannerCountdownTimer) {
        clearInterval(deployBannerCountdownTimer);
        deployBannerCountdownTimer = null;
    }
    try {
        if (targetBuildId) {
            sessionStorage.setItem('last_reloaded_build', targetBuildId);
        }
    } catch (e) {}
    // Keshni chetlab o'tish uchun vaqt tamg'asi bilan majburiy yangilash
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.href = url.toString();
}
window.executeDeployReload = executeDeployReload;

function showDeployUpdateBanner(targetBuildId) {
    if (isDeployBannerActive || document.getElementById('deployUpdateBanner')) return;
    isDeployBannerActive = true;

    const banner = document.createElement('div');
    banner.id = 'deployUpdateBanner';
    banner.className = 'deploy-update-banner';
    banner.setAttribute('role', 'alert');

    let countdownSec = 8;

    const titleText = (typeof t === 'function' ? t('deploy_banner_title', "🚀 Tizim muvaffaqiyatli yangilandi! (Yangi versiya)") : "🚀 Tizim muvaffaqiyatli yangilandi! (Yangi versiya)");
    const btnReloadText = (typeof t === 'function' ? t('btn_deploy_reload', "Hozir yangilash") : "Hozir yangilash");
    const btnCancelText = (typeof t === 'function' ? t('btn_deploy_cancel', "To'xtatish") : "To'xtatish");

    banner.innerHTML = `
        <div class="deploy-banner-content">
            <div class="deploy-banner-left">
                <div class="deploy-banner-icon">
                    <span>🚀</span>
                </div>
                <div class="deploy-banner-text">
                    <strong class="deploy-banner-title">${titleText}</strong>
                    <span class="deploy-banner-sub" id="deployBannerCountdownText">
                        Sahifa <span id="deployCountdownSec" class="countdown-sec">${countdownSec}</span> soniyada avtomatik yangilanadi...
                    </span>
                </div>
            </div>
            <div class="deploy-banner-actions">
                <button type="button" id="btnDeployReloadNow" class="btn-deploy-reload" onclick="executeDeployReload('${targetBuildId || ''}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    <span>${btnReloadText}</span>
                </button>
                <button type="button" id="btnDeployDismiss" class="btn-deploy-dismiss" onclick="cancelDeployAutoReload()" title="${btnCancelText}">
                    ${isax('close')}
                </button>
            </div>
        </div>
    `;

    document.body.prepend(banner);

    deployBannerCountdownTimer = setInterval(() => {
        countdownSec--;
        const countEl = document.getElementById('deployCountdownSec');
        if (countEl) countEl.textContent = countdownSec;

        if (countdownSec <= 0) {
            clearInterval(deployBannerCountdownTimer);
            executeDeployReload(targetBuildId);
        }
    }, 1000);
}

window.cancelDeployAutoReload = function() {
    if (deployBannerCountdownTimer) {
        clearInterval(deployBannerCountdownTimer);
        deployBannerCountdownTimer = null;
    }
    const textEl = document.getElementById('deployBannerCountdownText');
    if (textEl) {
        const pausedText = (typeof t === 'function' ? t('deploy_banner_paused', "Avtomatik yangilanish to'xtatildi. Iltimos, ish tugagach sahifani yangilang.") : "Avtomatik yangilanish to'xtatildi. Iltimos, ish tugagach sahifani yangilang.");
        textEl.innerHTML = `<span style="color: #fde047;">${pausedText}</span>`;
    }
    const dismissBtn = document.getElementById('btnDeployDismiss');
    if (dismissBtn) dismissBtn.style.display = 'none';
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewer);
} else {
    initViewer();
}

/* ==========================================================================
   Universal File Converter Logic for Operators (Viewer Port 3005)
   Zero-storage: In-browser instant conversion for images, python engine for docs
   ========================================================================== */
let currentConverterFile = null;
let selectedTargetFormat = '';
let convertedFileBlobUrl = null;

function openConverterModal() {
    const modal = document.getElementById('converterModal');
    if (!modal) return;
    modal.style.display = 'flex';
}

function closeConverterModal() {
    const modal = document.getElementById('converterModal');
    smoothCloseModal(modal);
}

function formatConverterFileSize(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function handleConverterFileSelected(file) {
    if (!file) return;

    // Maksimal hajm: 35 MB
    const maxBytes = 35 * 1024 * 1024;
    if (file.size > maxBytes) {
        alert("Fayl hajmi 35 MB dan oshmasligi kerak");
        return;
    }

    currentConverterFile = file;
    const name = file.name || 'document';
    const ext = (name.split('.').pop() || '').toLowerCase();

    const nameEl = document.getElementById('convFileName');
    const sizeEl = document.getElementById('convFileSize');
    const badgeEl = document.getElementById('convFileIconBadge');
    const detailsEl = document.getElementById('converterFileDetails');
    const dropzoneEl = document.getElementById('converterDropzone');
    const resultBox = document.getElementById('converterResultBox');
    const progressBox = document.getElementById('converterProgressBox');

    if (nameEl) nameEl.textContent = name;
    if (sizeEl) sizeEl.textContent = formatConverterFileSize(file.size);
    if (badgeEl) {
        badgeEl.textContent = ext.toUpperCase().slice(0, 4);
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            badgeEl.style.background = 'rgba(245, 158, 11, 0.15)';
            badgeEl.style.borderColor = 'rgba(245, 158, 11, 0.35)';
            badgeEl.style.color = '#fbbf24';
        } else if (['pdf'].includes(ext)) {
            badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
            badgeEl.style.borderColor = 'rgba(239, 68, 68, 0.35)';
            badgeEl.style.color = '#f87171';
        } else if (['docx', 'doc'].includes(ext)) {
            badgeEl.style.background = 'rgba(59, 130, 246, 0.15)';
            badgeEl.style.borderColor = 'rgba(59, 130, 246, 0.35)';
            badgeEl.style.color = '#60a5fa';
        } else {
            badgeEl.style.background = 'rgba(168, 85, 247, 0.15)';
            badgeEl.style.borderColor = 'rgba(168, 85, 247, 0.35)';
            badgeEl.style.color = '#c084fc';
        }
    }

    // Formatlar xaritasi
    const formatMap = {
        'pdf': ['docx', 'txt'],
        'docx': ['pdf', 'txt'],
        'doc': ['docx', 'pdf', 'txt'],
        'txt': ['pdf', 'docx'],
        'jpg': ['png', 'webp', 'pdf'],
        'jpeg': ['png', 'webp', 'pdf'],
        'png': ['jpg', 'webp', 'pdf'],
        'webp': ['png', 'jpg', 'pdf']
    };

    const targets = formatMap[ext] || ['pdf', 'docx', 'txt'];
    const pillsWrap = document.getElementById('converterTargetPills');
    if (pillsWrap) {
        pillsWrap.innerHTML = targets.map((tFmt, idx) => `
            <button type="button" class="converter-pill ${idx === 0 ? 'active' : ''}" onclick="selectConverterTarget('${tFmt}')">
                ${tFmt.toUpperCase()}
            </button>
        `).join('');
    }

    selectedTargetFormat = targets[0] || 'pdf';

    if (dropzoneEl) dropzoneEl.style.display = 'none';
    if (detailsEl) detailsEl.style.display = 'block';
    if (progressBox) progressBox.style.display = 'none';
    if (resultBox) resultBox.style.display = 'none';
}

function selectConverterTarget(format) {
    selectedTargetFormat = format.toLowerCase();
    const pills = document.querySelectorAll('#converterTargetPills .converter-pill');
    pills.forEach(p => {
        if (p.textContent.trim().toLowerCase() === selectedTargetFormat) {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });
}

function resetConverterState() {
    currentConverterFile = null;
    selectedTargetFormat = '';
    if (convertedFileBlobUrl) {
        try { URL.revokeObjectURL(convertedFileBlobUrl); } catch (e) {}
        convertedFileBlobUrl = null;
    }

    const fileInput = document.getElementById('converterFileInput');
    if (fileInput) fileInput.value = '';

    const dropzoneEl = document.getElementById('converterDropzone');
    const detailsEl = document.getElementById('converterFileDetails');
    const progressBox = document.getElementById('converterProgressBox');
    const resultBox = document.getElementById('converterResultBox');
    const btn = document.getElementById('btnRunConversion');
    const btnText = document.getElementById('btnRunConversionText');

    if (dropzoneEl) dropzoneEl.style.display = 'block';
    if (detailsEl) detailsEl.style.display = 'none';
    if (progressBox) progressBox.style.display = 'none';
    if (resultBox) resultBox.style.display = 'none';
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Konvertatsiya qilish';
}

async function convertImageInBrowser(file, targetFmt) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (targetFmt === 'jpg' || targetFmt === 'jpeg') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.drawImage(img, 0, 0);

            let mimeType = 'image/png';
            if (targetFmt === 'jpg' || targetFmt === 'jpeg') mimeType = 'image/jpeg';
            else if (targetFmt === 'webp') mimeType = 'image/webp';

            canvas.toBlob((blob) => {
                if (!blob) return reject(new Error('Canvas konvertatsiya amalga oshmadi'));
                const base = file.name.substring(0, file.name.lastIndexOf('.')) || 'image';
                const newName = `${base}.${targetFmt}`;
                const blobUrl = URL.createObjectURL(blob);
                resolve({
                    filename: newName,
                    size: blob.size,
                    url: blobUrl
                });
            }, mimeType, 0.95);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Rasmni o'qib bo'lmadi"));
        };
        img.src = url;
    });
}

async function executeFileConversion() {
    if (!currentConverterFile) {
        alert("Iltimos, avval faylni tanlang");
        return;
    }
    if (!selectedTargetFormat) {
        alert("Maqsadli formatni tanlang");
        return;
    }

    const btn = document.getElementById('btnRunConversion');
    const btnText = document.getElementById('btnRunConversionText');
    const progressBox = document.getElementById('converterProgressBox');
    const progressBar = document.getElementById('converterProgressBar');
    const progressPct = document.getElementById('converterProgressPct');
    const progressStatus = document.getElementById('converterProgressStatus');
    const resultBox = document.getElementById('converterResultBox');
    const resultName = document.getElementById('converterResultName');
    const resultSize = document.getElementById('converterResultSize');
    const downloadBtn = document.getElementById('btnDownloadConvertedFile');

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Jarayon ketmoqda...';
    if (progressBox) progressBox.style.display = 'block';
    if (progressBar) progressBar.style.width = '20%';
    if (progressPct) progressPct.textContent = '20%';
    if (progressStatus) progressStatus.textContent = 'Fayl tayyorlanmoqda...';

    const srcExt = (currentConverterFile.name.split('.').pop() || '').toLowerCase();
    const isImageSrc = ['jpg', 'jpeg', 'png', 'webp'].includes(srcExt);
    const isImageTarget = ['jpg', 'jpeg', 'png', 'webp'].includes(selectedTargetFormat);

    try {
        let resultInfo = null;

        // 1. Agar rasm -> rasm bo'lsa, mijoz brauzerida zudlik bilan konvertatsiya
        if (isImageSrc && isImageTarget && window.HTMLCanvasElement) {
            if (progressBar) progressBar.style.width = '60%';
            if (progressPct) progressPct.textContent = '60%';
            if (progressStatus) progressStatus.textContent = 'Brauzerda qayta ishlanmoqda...';

            resultInfo = await convertImageInBrowser(currentConverterFile, selectedTargetFormat);
        } else {
            // 2. Serverga xavfsiz uzatish (Zero-storage)
            if (progressBar) progressBar.style.width = '40%';
            if (progressPct) progressPct.textContent = '40%';
            if (progressStatus) progressStatus.textContent = 'Serverga xavfsiz uzatilmoqda...';

            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("Faylni o'qishda xatolik"));
                reader.readAsDataURL(currentConverterFile);
            });

            if (progressBar) progressBar.style.width = '75%';
            if (progressPct) progressPct.textContent = '75%';
            if (progressStatus) progressStatus.textContent = 'Konvertatsiya qilinmoqda (Zero-storage)...';

            const response = await fetch('/api/converter/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileData: base64Data,
                    fileName: currentConverterFile.name,
                    targetFormat: selectedTargetFormat
                })
            });

            const resJson = await response.json();
            if (!response.ok || !resJson.success) {
                throw new Error(resJson.error || `Server xatosi: ${response.status}`);
            }

            const b64Parts = (resJson.fileData || resJson.base64).split(',');
            const rawB64 = b64Parts.length > 1 ? b64Parts[1] : b64Parts[0];
            const byteChars = atob(rawB64);
            const byteNums = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
                byteNums[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNums);
            const blob = new Blob([byteArray], { type: resJson.mimeType });
            const blobUrl = URL.createObjectURL(blob);

            resultInfo = {
                filename: resJson.filename,
                size: blob.size,
                url: blobUrl
            };
        }

        if (progressBar) progressBar.style.width = '100%';
        if (progressPct) progressPct.textContent = '100%';
        if (progressStatus) progressStatus.textContent = 'Tayyor!';

        setTimeout(() => {
            if (progressBox) progressBox.style.display = 'none';

            if (convertedFileBlobUrl) {
                try { URL.revokeObjectURL(convertedFileBlobUrl); } catch (e) {}
            }
            convertedFileBlobUrl = resultInfo.url;

            if (resultName) resultName.textContent = resultInfo.filename;
            if (resultSize) resultSize.textContent = `Hajmi: ${formatConverterFileSize(resultInfo.size)}`;
            if (downloadBtn) {
                downloadBtn.href = resultInfo.url;
                downloadBtn.download = resultInfo.filename;
            }
            if (resultBox) resultBox.style.display = 'block';

            if (btn) btn.disabled = false;
            if (btnText) btnText.textContent = 'Konvertatsiya qilish';
        }, 350);

    } catch (err) {
        console.error('Konvertatsiya xatosi:', err);
        if (progressBox) progressBox.style.display = 'none';
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Qayta urinish';
        alert("Xatolik: " + err.message);
    }
}

function initConverterDropzone() {
    const dropzone = document.getElementById('converterDropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files[0]) {
            handleConverterFileSelected(dt.files[0]);
        }
    }, false);
}

// Global scope bindings for inline HTML onclick attributes
window.openConverterModal = openConverterModal;
window.closeConverterModal = closeConverterModal;
window.handleConverterFileSelected = handleConverterFileSelected;
window.selectConverterTarget = selectConverterTarget;
window.resetConverterState = resetConverterState;
window.executeFileConversion = executeFileConversion;
window.initConverterDropzone = initConverterDropzone;

