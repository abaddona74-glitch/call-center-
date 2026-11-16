/**
 * Call Center Dashboard & Audio Explorer Frontend Logic
 * Includes: WaveSurfer.js Waveform, Real-time AMI monitoring, SQLite CDR Pagination, and IVR Robot detection
 */

window.handleLogout = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) { }
    localStorage.removeItem('auth_token');
    sessionStorage.clear();
    window.location.href = '/login';
};

// Global State
let socket = null;
let ws = null;
let currentPath = '';
let explorerHistory = [''];
let explorerHistoryIndex = 0;
let explorerFilesData = [];
let currentConversations = [];
let currentQueues = [];
let currentOperators = [];
let currentAudioCategory = 'all'; // 'all' | 'talk' | 'robot'

// Call History Pagination State
let historyCurrentPage = 1;
let historyTotalPages = 1;
let historySearchQuery = '';

// Date Filter & Calendar State
let currentSelectedDate = ''; // 'YYYY-MM-DD' or '' for today
let calViewYear = 2026;
let calViewMonth = 8; // 0-based, 8 = September
let calClockTimer = null;

// Statistics & Topics Analytics State (hoisted to prevent TDZ in initStatControls)
let currentStatPeriod = 'month'; // 'day', 'month' or 'year'
let currentStatYear = new Date().getFullYear();
let currentStatMonth = new Date().getMonth() + 1;
let currentStatDate = ''; // 'YYYY-MM-DD'
let currentStatTopicFilter = 'all';
let currentStatSearchQuery = '';
let currentStatCallsPage = 1;
let statSearchDebounceTimer = null;
let chartTopicDistInstance = null;
let chartTopicTrendInstance = null;
let isStatDataLoading = false;

const UZ_MONTHS = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
];

const MONTH_KEYS = ['month_jan', 'month_feb', 'month_mar', 'month_apr', 'month_may', 'month_jun', 'month_jul', 'month_aug', 'month_sep', 'month_oct', 'month_nov', 'month_dec'];
function getMonthName(monthIndex) {
    const key = MONTH_KEYS[monthIndex];
    return key ? t(key, UZ_MONTHS[monthIndex] || '') : (UZ_MONTHS[monthIndex] || '');
}

function getTodayDateString() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
}

// Transfer Modal State
let activeTransferChannel = null;

// Chart.js Instances
let callVolumeChart = null;
let callDistributionChart = null;
let callDistributionChart2D = null;
let operatorChart = null;
let pieChartMode = localStorage.getItem('pie_chart_mode') || '3d';
let currentDistributionType = localStorage.getItem('distribution_type') || 'clients';
let latestPieData = [0, 0, 0, 0, 0];

// WaveSurfer Instance
let wavesurfer = null;

// DOM Elements
const btnPlayPause = document.getElementById('btnPlayPause');
const playerCurrentTime = document.getElementById('playerCurrentTime');
const playerDuration = document.getElementById('playerDuration');
const playerFileName = document.getElementById('playerFileName');
const playbackRateSelect = document.getElementById('playbackRateSelect');
const audioTagBadge = document.getElementById('audioTagBadge');
const waveLoadingText = document.getElementById('waveLoadingText');

// DOM Ready

/* ==========================================================================
   SIDEBAR TOGGLE ENGINE (Collapsible Live Monitor)
   ========================================================================== */
window.toggleSidebar = function (forceOpen) {
    const body = document.body;
    let willOpen;
    if (typeof forceOpen === 'boolean') {
        willOpen = forceOpen;
    } else {
        willOpen = body.classList.contains('sidebar-collapsed');
    }

    if (willOpen) {
        body.classList.remove('sidebar-collapsed');
        try { localStorage.setItem('cc_sidebar_collapsed', 'false'); } catch (e) { }
    } else {
        body.classList.add('sidebar-collapsed');
        try { localStorage.setItem('cc_sidebar_collapsed', 'true'); } catch (e) { }
    }
};

function initSidebar() {
    try {
        const saved = localStorage.getItem('cc_sidebar_collapsed');
        if (saved === 'true') {
            document.body.classList.add('sidebar-collapsed');
        } else if (saved === 'false') {
            document.body.classList.remove('sidebar-collapsed');
        } else {
            // Default on desktop: open so monitor is immediately visible
            if (window.innerWidth < 1200) {
                document.body.classList.add('sidebar-collapsed');
            } else {
                document.body.classList.remove('sidebar-collapsed');
            }
        }
    } catch (e) { }
}

function runInit() {
    initSidebar();
    initDateFilter();
    initTabs();
    initCharts();
    initWebSocket();
    initWaveSurfer();
    initExplorer();
    initHistoryPagination();
    initTransferModal();
    loadInitialData();
    loadSyncStatus();
    loadClientContacts();
    initHeaderClock();
    initPageElevator();
    initDeployWatcher();
    initConverterDropzone();
    initStatControls();
    initMultiplayerCursors();
    initSubtleScrollReveal();

    // Avtomatik har 5 soniyada yangilash (foydalanuvchi bosishi shart emas)
    setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'refresh_channels' }));
        }
    }, 5000);
}

/**
 * Subtle Scroll Reveal (Faqat statik KPI kartalari va diagrammalar uchun)
 * Qoida: Dinamik innerHTML elementlarga tegmaydi, unobserve bilan 1 marta ishlaydi.
 */
function initSubtleScrollReveal() {
    const kpiCards = Array.from(document.querySelectorAll('#kpiMainGrid > .kpi-card'));
    const chartPanels = Array.from(document.querySelectorAll('.charts-grid > .glass-panel'));
    const targets = [...kpiCards, ...chartPanels];

    if (!targets.length) return;

    // Har biriga unikal staggered delay berish (max 245ms)
    kpiCards.forEach((card, idx) => {
        card.classList.add('reveal-on-scroll');
        const delayMs = Math.min(245, idx * 35);
        card.style.setProperty('--reveal-delay', `${delayMs}ms`);
    });

    chartPanels.forEach((panel, idx) => {
        panel.classList.add('reveal-on-scroll');
        const delayMs = Math.min(100, idx * 50);
        panel.style.setProperty('--reveal-delay', `${delayMs}ms`);
    });

    // Brauzer qo'llab-quvvatlamasa yoki prefers-reduced-motion bo'lsa darhol ochish
    if (!('IntersectionObserver' in window) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        targets.forEach(el => el.classList.add('is-revealed'));
        return;
    }

    const scrollRoot = document.querySelector('.main-area') || null;

    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-revealed');
                io.unobserve(entry.target);
            }
        });
    }, {
        root: scrollRoot,
        threshold: 0.08,
        rootMargin: '0px 0px -10px 0px'
    });

    targets.forEach(el => io.observe(el));

    // Xavfsizlik fallbacki: 800ms ichida birorta karta yashirin holatda qolib ketmasligini ta'minlash
    setTimeout(() => {
        targets.forEach(el => {
            if (!el.classList.contains('is-revealed')) {
                el.classList.add('is-revealed');
            }
        });
    }, 800);
}

let _hasRevealedOperators = false;

function applyOperatorCardsScrollReveal() {
    const grid = document.getElementById('operatorsGrid');
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.operator-card:not(.skeleton)'));
    if (!cards.length) return;

    if (_hasRevealedOperators) {
        cards.forEach(c => {
            c.classList.remove('reveal-on-scroll');
            c.classList.add('is-revealed');
        });
        return;
    }

    cards.forEach((card, idx) => {
        card.classList.add('reveal-on-scroll');
        const delayMs = Math.min(280, idx * 30);
        card.style.setProperty('--reveal-delay', `${delayMs}ms`);
    });

    if (!('IntersectionObserver' in window) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        cards.forEach(el => {
            el.classList.add('is-revealed');
            el.classList.remove('reveal-on-scroll');
        });
        _hasRevealedOperators = true;
        return;
    }

    const scrollRoot = document.querySelector('.main-area') || null;

    const opIo = new IntersectionObserver((entries) => {
        let anyVisible = false;
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                anyVisible = true;
                entry.target.classList.add('is-revealed');
                opIo.unobserve(entry.target);
            }
        });
        if (anyVisible) {
            // Operatorlar maydoniga ozgina yaqinlashilgandayoq 400ms ichida barcha kartalar ochiladi
            setTimeout(() => {
                _hasRevealedOperators = true;
                cards.forEach(el => {
                    el.classList.add('is-revealed');
                    el.classList.remove('reveal-on-scroll');
                });
                try { opIo.disconnect(); } catch (e) { }
            }, 400);
        }
    }, {
        root: scrollRoot,
        threshold: 0.01,
        rootMargin: '100px 0px 220px 0px' // 220px oldindan sezadi — hech qanday chiziqda qotib yoki yashirinib qolmaydi
    });

    cards.forEach(el => opIo.observe(el));

    // Fallback: 1.5 soniyada barcha kartalarni kafolatlangan holda to'liq ochish
    setTimeout(() => {
        cards.forEach(el => {
            el.classList.add('is-revealed');
            el.classList.remove('reveal-on-scroll');
        });
        _hasRevealedOperators = true;
        try { opIo.disconnect(); } catch (e) { }
    }, 1500);
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
        } catch (e) { }
        return;
    }

    // Agar ushbu versiyaga allaqachon sahifa yangilangan bo'lsa, qayta banner ochmaymiz
    try {
        if (sessionStorage.getItem('last_reloaded_build') === incomingBuildId) {
            return;
        }
    } catch (e) { }

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
    } catch (e) { }
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

window.cancelDeployAutoReload = function () {
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
   SMART PAGE ELEVATOR (LIFT) FLOATING NAVIGATION CONTROLLER
   ========================================================================== */
function initPageElevator() {
    const btn = document.getElementById('pageElevatorBtn');
    if (!btn) return;

    let hideTimer = null;
    let lastScrollTop = 0;
    let isHovered = false;

    function getActiveScrollTarget() {
        const container = document.querySelector('.main-area') || document.querySelector('.viewer-container');
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
            if (!btn.classList.contains('mode-down')) {
                btn.classList.remove('mode-up');
                btn.classList.add('mode-down');
                btn.setAttribute('title', "Eng pastga tushish");
                btn.setAttribute('aria-label', "Eng pastga tushish");
            }
        } else {
            if (!btn.classList.contains('mode-up')) {
                btn.classList.remove('mode-down');
                btn.classList.add('mode-up');
                btn.setAttribute('title', "Eng tepaga chiqish");
                btn.setAttribute('aria-label', "Eng tepaga chiqish");
            }
        }
    }

    let scrollRafId = null;

    function updateElevatorState() {
        const target = getActiveScrollTarget();
        const { scrollTop, scrollHeight, clientHeight } = getMetrics(target);

        // Sahifada skroll qilish imkoni bo'lmasa, ko'rinmaydi
        if (scrollHeight <= clientHeight + 80) {
            if (btn.classList.contains('visible')) {
                btn.classList.remove('visible');
            }
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
        if (!btn.classList.contains('visible')) {
            btn.classList.add('visible');
        }

        // Va skroll to'xtagach sekin disappear bo'lib yo'qoladi
        scheduleHide(1800);
    }

    function handleScroll() {
        if (scrollRafId !== null) return;
        scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            updateElevatorState();
        });
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

    const mainArea = document.querySelector('.main-area') || document.querySelector('.viewer-container');
    if (mainArea) {
        mainArea.addEventListener('scroll', handleScroll, { passive: true });
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

/* ==========================================================================
   1. Tab Navigation & SPA Client Routing
   ========================================================================== */
const ROUTE_MAP = {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/explorer': 'explorer',
    '/audio': 'explorer',
    '/operators': 'operators',
    '/operator': 'operators',
    '/history': 'history',
    '/clients': 'clients',
    '/customers': 'clients',
    '/mijozlar': 'clients',
    '/statistics': 'statistics',
    '/statistika': 'statistics',
    '/analytics': 'statistics',
    '/tools': 'statistics',
    '/converter': 'statistics',
    '/asboblar': 'statistics'
};

function getTabTitle(tab) {
    const suffix = ' | Call Center AI';
    const map = {
        dashboard: t('tab_dashboard', 'Dashboard'),
        explorer: t('tab_explorer', 'Audio Explorer'),
        operators: t('tab_operators', 'Operatorlar'),
        history: t('tab_history', "Qo'ng'iroqlar Tarixi"),
        clients: t('tab_clients', 'Mijozlar'),
        statistics: t('tab_statistics', 'Statistika & Tahlil'),
        tools: t('tab_statistics', 'Statistika & Tahlil')
    };
    return (map[tab] || 'Call Center') + suffix;
}

function switchRoute(tabName, pushState = true) {
    const validTabs = ['dashboard', 'explorer', 'operators', 'history', 'clients', 'statistics', 'tools'];
    let target = validTabs.includes(tabName) ? tabName : (ROUTE_MAP['/' + tabName] || 'dashboard');

    // Boss (superuser) akkaunti uchun Statistika va Tools yopilgan
    const isBoss = window.currentAuthUser && (window.currentAuthUser.username === 'superuser');
    if (isBoss && (target === 'statistics' || target === 'tools')) {
        target = 'dashboard';
    }

    document.documentElement.setAttribute('data-tab', target);

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabSections = document.querySelectorAll('.page-content');

    tabBtns.forEach(btn => {
        if (btn.getAttribute('data-tab') === target) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    tabSections.forEach(section => {
        if (section.id === `tab-${target}`) {
            section.classList.add('active');
        } else {
            section.classList.remove('active');
        }
    });

    document.title = getTabTitle(target);

    const canonicalPath = target === 'dashboard' ? '/' : `/${target}`;
    if (pushState && window.location.pathname !== canonicalPath) {
        window.history.pushState({ tab: target }, '', canonicalPath);
    }

    if (window.innerWidth <= 768) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (target === 'explorer' && explorerFilesData.length === 0) {
        loadExplorerPath('');
    } else if (target === 'history') {
        const histInput = document.getElementById('historySearchInput');
        if (histInput && histInput.value) {
            const v = histInput.value.trim().toLowerCase();
            let isAuto = false;
            try { isAuto = histInput.matches(':-webkit-autofill') || histInput.matches(':autofill'); } catch (_) { }
            if (v === 'superuser' || isAuto) {
                histInput.value = '';
                historySearchQuery = '';
            }
        }
        if (typeof updateHistoryScopeUI === 'function') {
            updateHistoryScopeUI();
        }
        loadHistoryPage(1, historySearchQuery);
    } else if (target === 'dashboard') {
        if (typeof callVolumeChart !== 'undefined' && callVolumeChart) callVolumeChart.resize();
        if (pieChartMode === '3d') {
            if (typeof callDistributionChart !== 'undefined' && callDistributionChart && typeof callDistributionChart.reflow === 'function') {
                callDistributionChart.reflow();
            }
        } else {
            if (typeof callDistributionChart2D !== 'undefined' && callDistributionChart2D && typeof callDistributionChart2D.resize === 'function') {
                callDistributionChart2D.resize();
            }
        }
    } else if (target === 'operators') {
        if (typeof operatorChart !== 'undefined' && operatorChart) operatorChart.resize();
        loadTabAgentOperators();
        loadTabOperatorLogs(selectedTabAgentOpId, 1);
        if (typeof loadSyncStatus === 'function') loadSyncStatus();
    } else if (target === 'clients') {
        loadClientsTab();
    } else if (target === 'statistics' || target === 'tools') {
        if (typeof loadStatisticsData === 'function') {
            loadStatisticsData();
        }
    }
}

/**
 * Asosiy bosh sahifaga (/) qaytish
 */
function navigateToHome(e) {
    if (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
    }
    const currentTab = document.documentElement.getAttribute('data-tab') || 'dashboard';
    if (currentTab === 'dashboard' && window.location.pathname === '/') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        switchRoute('dashboard', true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

/* ==========================================================================
   Sound FX: Realistic Book Page Flip / Paper Flutter ("Shiq" ovozi)
   ========================================================================== */
let sfxAudioCtx = null;
let pageFlipFallbackAudio = null;

function playPageFlipSound() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            if (!sfxAudioCtx) {
                sfxAudioCtx = new AudioContextClass();
            }
            if (sfxAudioCtx.state === 'suspended') {
                sfxAudioCtx.resume();
            }

            const ctx = sfxAudioCtx;
            const now = ctx.currentTime;
            const duration = 0.15; // 150ms natural page turn
            const sampleRate = ctx.sampleRate;
            const frameCount = Math.floor(sampleRate * duration);

            // 1. Synthetic textured noise buffer for realistic paper friction
            const buffer = ctx.createBuffer(1, frameCount, sampleRate);
            const data = buffer.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0;

            for (let i = 0; i < frameCount; i++) {
                const t = i / sampleRate;
                const white = Math.random() * 2 - 1;
                // Pinkish noise for organic paper texture
                b0 = 0.99765 * b0 + white * 0.0990460;
                b1 = 0.96300 * b1 + white * 0.2965164;
                b2 = 0.57000 * b2 + white * 1.0526913;
                const pink = (b0 + b1 + b2 + white * 0.5362) * 0.15;
                // Subtle aerodynamic flutter as page cuts air
                const flutter = 1.0 + 0.3 * Math.sin(2 * Math.PI * 45 * t);
                data[i] = (pink * 0.65 + white * 0.35) * flutter;
            }

            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = buffer;

            // 2. Dynamic bandpass filter (paper flutter sweep: 3400Hz -> 1100Hz)
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.setValueAtTime(2.2, now);
            filter.frequency.setValueAtTime(3400, now);
            filter.frequency.exponentialRampToValueAtTime(1100, now + duration);

            // 3. Amplitude envelope: fast crisp attack (14ms), natural decay
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(0.24, now + 0.014);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            // 4. Subtle micro-tactile thumb flick (very subtle spine flex)
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(160, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.035);
            oscGain.gain.setValueAtTime(0.06, now);
            oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

            // Routing
            noiseSource.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc.connect(oscGain);
            oscGain.connect(ctx.destination);

            noiseSource.start(now);
            noiseSource.stop(now + duration);
            osc.start(now);
            osc.stop(now + 0.04);
            return;
        }
    } catch (e) {
        // Fallback below
    }

    try {
        if (!pageFlipFallbackAudio) {
            pageFlipFallbackAudio = new Audio('/sounds/page-flip.wav');
        }
        const snd = pageFlipFallbackAudio.cloneNode();
        snd.volume = 0.35;
        snd.play().catch(() => { });
    } catch (err) { }
}

function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-tab');
            const current = document.documentElement.getAttribute('data-tab');
            if (target !== current) {
                playPageFlipSound();
            }
            switchRoute(target, true);
        });
    });

    window.addEventListener('popstate', () => {
        const path = window.location.pathname.toLowerCase().replace(/\/$/, '') || '/';
        const target = ROUTE_MAP[path] || 'dashboard';
        const current = document.documentElement.getAttribute('data-tab');
        if (target !== current) {
            playPageFlipSound();
        }
        switchRoute(target, false);
    });

    // Handle initial route based on URL path
    const currentPath = window.location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const initialTab = ROUTE_MAP[currentPath] || 'dashboard';
    switchRoute(initialTab, false);
}

/* ==========================================================================
   2. Charts Initialization (Chart.js)
   ========================================================================== */
function initCharts() {
    // 1. Call Volume Dynamics Chart (Real-time dynamic hours)
    const ctxVolume = document.getElementById('callVolumeChart').getContext('2d');
    callVolumeChart = new Chart(ctxVolume, {
        type: 'line',
        data: {
            labels: ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],
            datasets: [
                {
                    label: t('chart_series_inbound', 'Jami Kiruvchi'),
                    data: new Array(14).fill(0),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#6366f1',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2,
                    pointHitRadius: 30
                },
                {
                    label: t('chart_series_answered', 'Javob berilgan'),
                    data: new Array(14).fill(0),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#10b981',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2,
                    pointHitRadius: 30
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { labels: { color: '#94a3b8' } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    borderColor: 'rgba(59, 130, 246, 0.4)',
                    borderWidth: 1,
                    titleColor: '#ffffff',
                    bodyColor: '#e2e8f0',
                    padding: 10,
                    boxPadding: 4,
                    usePointStyle: true,
                    callbacks: {
                        label: function (context) {
                            return ` ${context.dataset.label}: ${context.parsed.y} ta`;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
            }
        }
    });

    // 2. 3D Pie Chart (Highcharts 3D) - Katta va ichini to'liq egallaydigan hajmda
    if (typeof Highcharts !== 'undefined' && document.getElementById('callDistributionChartContainer')) {
        callDistributionChart = Highcharts.chart('callDistributionChartContainer', {
            accessibility: { enabled: false },
            chart: {
                type: 'pie',
                options3d: {
                    enabled: true,
                    alpha: 45,
                    beta: 0,
                    viewDistance: 25
                },
                backgroundColor: 'transparent',
                spacing: [5, 5, 5, 5],
                margin: [0, 0, 10, 0],
                style: {
                    fontFamily: 'Inter, sans-serif'
                }
            },
            title: { text: null },
            credits: { enabled: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                borderColor: 'rgba(255, 255, 255, 0.12)',
                borderRadius: 8,
                style: { color: '#ffffff', fontSize: '12px' },
                formatter: function () {
                    const yVal = (Number.isFinite(this.y) && this.y >= 0) ? this.y : 0;
                    const pct = (Number.isFinite(this.percentage) && this.percentage >= 0) ? this.percentage.toFixed(1) : '0.0';
                    return `<b>${this.point.name}</b>: <b>${yVal} ta</b> (${pct}%)`;
                }
            },
            plotOptions: {
                pie: {
                    allowPointSelect: false,
                    cursor: 'pointer',
                    depth: 35,
                    size: '80%',
                    slicedOffset: 14,
                    startAngle: -45,
                    center: ['50%', '48%'],
                    states: {
                        hover: {
                            enabled: true,
                            brightness: 0.2,
                            halo: {
                                size: 14,
                                opacity: 0.35
                            }
                        },
                        inactive: {
                            opacity: 0.32
                        }
                    },
                    point: {
                        events: {
                            mouseOver: function () {
                                if (typeof setDistributionFocusHighlight === 'function') {
                                    setDistributionFocusHighlight(this.index, true);
                                }
                            },
                            mouseOut: function () {
                                if (typeof setDistributionFocusHighlight === 'function') {
                                    setDistributionFocusHighlight(this.index, false);
                                }
                            }
                        }
                    },
                    dataLabels: {
                        enabled: true,
                        distance: 12,
                        formatter: function () {
                            const pct = (Number.isFinite(this.percentage) && this.percentage >= 0) ? this.percentage.toFixed(1) : '0.0';
                            return `<b style="color: #f8fafc; font-size: 11px;">${this.point.name}</b>: <span style="color: #38bdf8; font-weight: 600;">${pct}%</span>`;
                        },
                        connectorColor: 'rgba(255, 255, 255, 0.2)',
                        connectorPadding: 4,
                        style: {
                            color: '#ffffff',
                            textOutline: 'none',
                            fontSize: '11px',
                            fontWeight: '500'
                        }
                    }
                }
            },
            series: [{
                type: 'pie',
                name: t('chart_series_calls', "Qo'ng'iroqlar"),
                data: [
                    { name: t('chart_slice_success', 'Muvaffaqiyatli'), y: 1, color: '#10b981', sliced: false, selected: false },
                    { name: t('chart_slice_abandoned_pending', 'Kutilmoqda'), y: 0, color: '#f59e0b', sliced: false, selected: false },
                    { name: t('chart_slice_abandoned_unreachable', 'Ulanilmadi'), y: 0, color: '#f43f5e', sliced: false, selected: false },
                    { name: t('chart_slice_outbound', 'Chiquvchi'), y: 0, color: '#a855f7', sliced: false, selected: false },
                    { name: t('chart_slice_abandoned_resolved', 'Gaplashildi'), y: 0, color: '#38bdf8', sliced: false, selected: false }
                ]
            }]
        });
    }

    // 3. Operator Performance Chart
    const ctxOp = document.getElementById('operatorChart').getContext('2d');
    operatorChart = new Chart(ctxOp, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: t('chart_series_accepted', 'Qabul qilingan (Answered)'),
                    data: [],
                    backgroundColor: '#10b981',
                    borderRadius: 6
                },
                {
                    label: t('chart_series_outbound', 'Chiquvchi (Outbound)'),
                    data: [],
                    backgroundColor: '#38bdf8',
                    borderRadius: 6
                },
                {
                    label: t('chart_series_missed', "O'tkazib yuborilgan"),
                    data: [],
                    backgroundColor: '#f59e0b',
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8' } }
            },
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
            }
        }
    });

    // 2D SVG halqalari hover (1..5)
    for (let i = 1; i <= 5; i++) {
        const seg = document.getElementById(`dist2DSeg${i}`);
        if (seg) {
            seg.addEventListener('mouseenter', () => setDistributionFocusHighlight(i - 1, true));
            seg.addEventListener('mouseleave', () => setDistributionFocusHighlight(i - 1, false));
        }
    }

    // 2D & 3D Interactive Legend Hover highlight
    const legendItems = document.querySelectorAll('#dist2DLegend li');
    legendItems.forEach((li, idx) => {
        li.addEventListener('mouseenter', () => setDistributionFocusHighlight(idx, true));
        li.addEventListener('mouseleave', () => setDistributionFocusHighlight(idx, false));
    });

    // Sidebar callback chiplari orqali sinxron highlight
    const pendingChip = document.getElementById('adminCbTabPending');
    if (pendingChip) {
        pendingChip.addEventListener('mouseenter', () => setDistributionFocusHighlight(1, true));
        pendingChip.addEventListener('mouseleave', () => setDistributionFocusHighlight(1, false));
    }
    const unreachableChip = document.getElementById('adminCbTabUnreachable');
    if (unreachableChip) {
        unreachableChip.addEventListener('mouseenter', () => setDistributionFocusHighlight(2, true));
        unreachableChip.addEventListener('mouseleave', () => setDistributionFocusHighlight(2, false));
    }
    const resolvedChip = document.getElementById('adminCbTabResolved');
    if (resolvedChip) {
        resolvedChip.addEventListener('mouseenter', () => setDistributionFocusHighlight(4, true));
        resolvedChip.addEventListener('mouseleave', () => setDistributionFocusHighlight(4, false));
    }

    // Diagramma rejimini (2D yoki 3D) va taqsimot turini (Mijozlar yoki Qo'ng'iroqlar) dastlabki yuklash
    setDistributionType(currentDistributionType);
    setChartMode(pieChartMode);
}

/**
 * Taqsimot diagrammasi (2D/3D), Legend va tegishli panel/kartalar o'rtasida
 * o'zaro sinxron Glow + Focus Blur effektini boshqarish.
 * idx: 0 (Muvaffaqiyatli), 1 (Kutilmoqda), 2 (Chiquvchi), 3 (Gaplashildi)
 */
function setDistributionFocusHighlight(idx, active) {
    const distPanel = document.getElementById('distributionGlassPanel');
    const colorThemes = ['green', 'amber', 'rose', 'purple', 'cyan'];
    const theme = colorThemes[idx] || 'amber';

    if (!active) {
        // Hammasini tiklash
        document.body.classList.remove('dist-focus-active');
        if (distPanel) distPanel.classList.remove('dist-focus-target');

        document.querySelectorAll('.kpi-parent-section').forEach(el => el.classList.remove('dist-focus-has-target'));
        document.querySelectorAll('.dist-focus-target').forEach(el => {
            el.classList.remove('dist-focus-target', 'dist-focus-glow-amber', 'dist-focus-glow-green', 'dist-focus-glow-rose', 'dist-focus-glow-purple', 'dist-focus-glow-cyan');
        });

        // Legend qatorlarini tiklash
        document.querySelectorAll('#dist2DLegend li').forEach(li => {
            li.classList.remove('dist-active-row-amber', 'dist-active-row-green', 'dist-active-row-rose', 'dist-active-row-purple', 'dist-active-row-cyan');
        });

        // 2D SVG halqalarini tiklash
        document.querySelectorAll('#dist2DSvg circle.dist-sg').forEach(s => {
            s.style.strokeWidth = '';
            s.style.filter = '';
            s.style.opacity = '';
        });

        // 3D Highcharts bo'laklarini tiklash
        if (typeof callDistributionChart !== 'undefined' && callDistributionChart && callDistributionChart.series && callDistributionChart.series[0]) {
            callDistributionChart.series[0].points.forEach(pt => {
                if (pt && typeof pt.slice === 'function' && pt.sliced) {
                    pt.slice(false);
                }
            });
        }
        return;
    }

    // 1. Aktiv holatga o'tish: Orqa fonni xiralashtirish (Focus blur)
    document.body.classList.add('dist-focus-active');
    if (distPanel) {
        distPanel.classList.add('dist-focus-target');
    }

    // 2. Legend qatorini ajratish va yoritish
    const legendItems = document.querySelectorAll('#dist2DLegend li');
    if (legendItems && legendItems[idx]) {
        legendItems[idx].classList.add(`dist-active-row-${theme}`);
    }

    // 3. 2D SVG doirasini kattalashtirish va glow berish
    const segId = `dist2DSeg${idx + 1}`;
    const seg = document.getElementById(segId);
    if (seg) {
        seg.style.strokeWidth = '6.0';
        seg.style.opacity = '1';
        document.querySelectorAll('#dist2DSvg circle.dist-sg').forEach(s => {
            if (s !== seg) s.style.opacity = '0.35';
        });
    }

    // 4. 3D Highcharts bo'lagini tashqariga ajratish (slice pop-out)
    if (typeof callDistributionChart !== 'undefined' && callDistributionChart && callDistributionChart.series && callDistributionChart.series[0]) {
        const pt = callDistributionChart.series[0].points[idx];
        if (pt && typeof pt.slice === 'function') {
            pt.slice(true);
        }
    }

    // 5. Tegishli joylarni (kartalar, panellar) yoritish
    const kpiParent = document.querySelector('.kpi-parent-section');
    if (idx === 0) {
        // "Muvaffaqiyatli" -> Muvaffaqiyatli KPI kartasi + Operatorlar diagrammasi
        const kpiAns = document.getElementById('kpiCardAnswered');
        if (kpiAns) {
            if (kpiParent) kpiParent.classList.add('dist-focus-has-target');
            kpiAns.classList.add('dist-focus-target', 'dist-focus-glow-green');
        }
        const opChartEl = document.getElementById('operatorChart');
        const opPanel = opChartEl ? opChartEl.closest('.glass-panel') : null;
        if (opPanel) {
            opPanel.classList.add('dist-focus-target', 'dist-focus-glow-green');
        }
    } else if (idx === 1) {
        // "Kutilmoqda" -> Qayta bog'lanish kerak (callbacksPanel) + Navbatdan chiqdi KPI kartasi
        const cbPanel = document.getElementById('callbacksPanel');
        if (cbPanel) {
            cbPanel.classList.add('dist-focus-target', 'dist-focus-glow-amber');
        }
        const kpiAb = document.getElementById('kpiCardAbandoned');
        if (kpiAb) {
            if (kpiParent) kpiParent.classList.add('dist-focus-has-target');
            kpiAb.classList.add('dist-focus-target', 'dist-focus-glow-amber');
        }
    } else if (idx === 2) {
        // "Ulanilmadi" -> Qayta bog'lanish kerak (callbacksPanel) + Navbatdan chiqdi KPI kartasi
        const cbPanel = document.getElementById('callbacksPanel');
        if (cbPanel) {
            cbPanel.classList.add('dist-focus-target', 'dist-focus-glow-rose');
        }
        const kpiAb = document.getElementById('kpiCardAbandoned');
        if (kpiAb) {
            if (kpiParent) kpiParent.classList.add('dist-focus-has-target');
            kpiAb.classList.add('dist-focus-target', 'dist-focus-glow-rose');
        }
    } else if (idx === 3) {
        // "Chiquvchi" -> Chiquvchi KPI kartasi
        const kpiOut = document.getElementById('kpiCardOutbound');
        if (kpiOut) {
            if (kpiParent) kpiParent.classList.add('dist-focus-has-target');
            kpiOut.classList.add('dist-focus-target', 'dist-focus-glow-purple');
        }
    } else if (idx === 4) {
        // "Gaplashildi" -> Qayta bog'lanish kerak (callbacksPanel) - Gaplashildi holati
        const cbPanel = document.getElementById('callbacksPanel');
        if (cbPanel) {
            cbPanel.classList.add('dist-focus-target', 'dist-focus-glow-cyan');
        }
    }
}

/**
 * 2D (Donut) va 3D (Highcharts Pie) o'rtasida rejimni almashtirish
 */
function setChartMode(mode) {
    pieChartMode = mode === '2d' ? '2d' : '3d';
    try {
        localStorage.setItem('pie_chart_mode', pieChartMode);
    } catch (e) { }

    const el3D = document.getElementById('callDistributionChartContainer');
    const el2DBox = document.getElementById('callDistribution2DContainer');
    const btn2D = document.getElementById('btnChartMode2D');
    const btn3D = document.getElementById('btnChartMode3D');

    const activeStyle = {
        background: 'rgba(255, 255, 255, 0.12)',
        color: '#f8fafc',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
        fontWeight: '600'
    };
    const inactiveStyle = {
        background: 'transparent',
        color: 'var(--text-muted, #94a3b8)',
        border: '1px solid transparent',
        boxShadow: 'none',
        fontWeight: '500'
    };

    if (btn2D && btn3D) {
        if (pieChartMode === '2d') {
            Object.assign(btn2D.style, activeStyle);
            Object.assign(btn3D.style, inactiveStyle);
        } else {
            Object.assign(btn3D.style, activeStyle);
            Object.assign(btn2D.style, inactiveStyle);
        }
    }

    if (pieChartMode === '2d') {
        if (el3D) {
            el3D.style.opacity = '0';
            el3D.style.pointerEvents = 'none';
            el3D.style.visibility = 'hidden';
            el3D.style.zIndex = '1';
        }
        if (el2DBox) {
            el2DBox.style.opacity = '1';
            el2DBox.style.pointerEvents = 'auto';
            el2DBox.style.visibility = 'visible';
            el2DBox.style.zIndex = '2';
        }
        updateDistributionChartDisplay();
    } else {
        // 3D mode
        if (el2DBox) {
            el2DBox.style.opacity = '0';
            el2DBox.style.pointerEvents = 'none';
            el2DBox.style.visibility = 'hidden';
            el2DBox.style.zIndex = '1';
        }
        if (el3D) {
            el3D.style.opacity = '1';
            el3D.style.pointerEvents = 'auto';
            el3D.style.visibility = 'visible';
            el3D.style.zIndex = '2';
            if (callDistributionChart) {
                if (typeof callDistributionChart.reflow === 'function') {
                    callDistributionChart.reflow();
                }
            }
        }
        updateDistributionChartDisplay();
    }
}
window.setChartMode = setChartMode;

/**
 * Taqsimot turini almashtirish: 'clients' (Mijozlar) vs 'calls' (Qo'ng'iroqlar)
 */
function setDistributionType(type) {
    currentDistributionType = (type === 'calls') ? 'calls' : 'clients';
    try {
        localStorage.setItem('distribution_type', currentDistributionType);
    } catch (e) { }

    const btnClients = document.getElementById('btnDistTypeClients');
    const btnCalls = document.getElementById('btnDistTypeCalls');
    const titleEl = document.getElementById('distributionChartTitle');

    const activeStyle = {
        background: 'rgba(255, 255, 255, 0.12)',
        color: '#f8fafc',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
        fontWeight: '600'
    };
    const inactiveStyle = {
        background: 'transparent',
        color: 'var(--text-muted, #94a3b8)',
        border: '1px solid transparent',
        boxShadow: 'none',
        fontWeight: '500'
    };

    if (currentDistributionType === 'clients') {
        if (btnClients) Object.assign(btnClients.style, activeStyle);
        if (btnCalls) Object.assign(btnCalls.style, inactiveStyle);
        if (titleEl) {
            titleEl.textContent = (typeof t === 'function' ? t('chart_dist_title_clients', 'Mijozlar Taqsimoti') : 'Mijozlar Taqsimoti');
        }
    } else {
        if (btnCalls) Object.assign(btnCalls.style, activeStyle);
        if (btnClients) Object.assign(btnClients.style, inactiveStyle);
        if (titleEl) {
            titleEl.textContent = (typeof t === 'function' ? t('chart_dist_title_calls', "Qo'ng'iroqlar Taqsimoti") : "Qo'ng'iroqlar Taqsimoti");
        }
    }

    updateDistributionChartDisplay();
}
window.setDistributionType = setDistributionType;

let _last2DDistValues = {
    total: 0,
    vSuccess: 0,
    vWait: 0,
    vUnreachable: 0,
    vOutbound: 0,
    vResolved: 0,
    p1: 0,
    p2: 0,
    p3: 0,
    p4: 0,
    p5: 0
};
// Animatsiya davomida joriy interpolyatsiya qiymatlarini saqlash
let _currentDist2DInterp = null;
let _activeDist2DAnim = null;
let _distChartUpdateTimer = null;

function animate2DDistributionNumbers(targetValues, duration = 450) {
    const safeNum = (n, min = 0, fallback = 0) => {
        const v = Number(n);
        return Number.isFinite(v) ? Math.max(min, v) : fallback;
    };

    const sanitizedTarget = {
        total: safeNum(targetValues.total),
        vSuccess: safeNum(targetValues.vSuccess),
        vWait: safeNum(targetValues.vWait),
        vUnreachable: safeNum(targetValues.vUnreachable),
        vOutbound: safeNum(targetValues.vOutbound),
        vResolved: safeNum(targetValues.vResolved),
        p1: Math.min(100, safeNum(targetValues.p1)),
        p2: Math.min(100, safeNum(targetValues.p2)),
        p3: Math.min(100, safeNum(targetValues.p3)),
        p4: Math.min(100, safeNum(targetValues.p4)),
        p5: Math.min(100, safeNum(targetValues.p5))
    };

    // Sanitize _last2DDistValues
    _last2DDistValues = {
        total: safeNum(_last2DDistValues.total),
        vSuccess: safeNum(_last2DDistValues.vSuccess),
        vWait: safeNum(_last2DDistValues.vWait),
        vUnreachable: safeNum(_last2DDistValues.vUnreachable),
        vOutbound: safeNum(_last2DDistValues.vOutbound),
        vResolved: safeNum(_last2DDistValues.vResolved),
        p1: Math.min(100, safeNum(_last2DDistValues.p1)),
        p2: Math.min(100, safeNum(_last2DDistValues.p2)),
        p3: Math.min(100, safeNum(_last2DDistValues.p3)),
        p4: Math.min(100, safeNum(_last2DDistValues.p4)),
        p5: Math.min(100, safeNum(_last2DDistValues.p5))
    };

    const prev = _currentDist2DInterp || _last2DDistValues;
    if (
        prev.total === sanitizedTarget.total &&
        prev.vSuccess === sanitizedTarget.vSuccess &&
        prev.vWait === sanitizedTarget.vWait &&
        prev.vUnreachable === sanitizedTarget.vUnreachable &&
        prev.vOutbound === sanitizedTarget.vOutbound &&
        prev.vResolved === sanitizedTarget.vResolved
    ) {
        return;
    }

    if (_activeDist2DAnim) {
        cancelAnimationFrame(_activeDist2DAnim);
        _activeDist2DAnim = null;
        if (_currentDist2DInterp) {
            _last2DDistValues = {
                total: safeNum(_currentDist2DInterp.total),
                vSuccess: safeNum(_currentDist2DInterp.vSuccess),
                vWait: safeNum(_currentDist2DInterp.vWait),
                vUnreachable: safeNum(_currentDist2DInterp.vUnreachable),
                vOutbound: safeNum(_currentDist2DInterp.vOutbound),
                vResolved: safeNum(_currentDist2DInterp.vResolved),
                p1: Math.min(100, safeNum(_currentDist2DInterp.p1)),
                p2: Math.min(100, safeNum(_currentDist2DInterp.p2)),
                p3: Math.min(100, safeNum(_currentDist2DInterp.p3)),
                p4: Math.min(100, safeNum(_currentDist2DInterp.p4)),
                p5: Math.min(100, safeNum(_currentDist2DInterp.p5))
            };
        }
    }

    const startValues = { ..._last2DDistValues };
    const startTime = performance.now();
    _currentDist2DInterp = { ...startValues };

    const elTotal = document.getElementById('dist2DTotal');
    const val1El = document.getElementById('dist2DVal1');
    const val2El = document.getElementById('dist2DVal2');
    const val3El = document.getElementById('dist2DVal3');
    const val4El = document.getElementById('dist2DVal4');
    const val5El = document.getElementById('dist2DVal5');
    const pct1El = document.getElementById('dist2DPct1');
    const pct2El = document.getElementById('dist2DPct2');
    const pct3El = document.getElementById('dist2DPct3');
    const pct4El = document.getElementById('dist2DPct4');
    const pct5El = document.getElementById('dist2DPct5');

    function step(now) {
        // elapsed har doim >= 0 bo'lishi shart (clock skew yoki microtask jitter xatoliklarini oldini oladi)
        const elapsed = Math.max(0, now - startTime);
        const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, duration)));
        // Easing: cubic-bezier(0.16, 1, 0.3, 1) -> 1 - (1 - t)^3
        const ease = Math.max(0, Math.min(1, 1 - Math.pow(1 - progress, 3)));

        const currentTotal = Math.max(0, Math.round(startValues.total + (sanitizedTarget.total - startValues.total) * ease));
        const curS1 = Math.max(0, Math.round(startValues.vSuccess + (sanitizedTarget.vSuccess - startValues.vSuccess) * ease));
        const curS2 = Math.max(0, Math.round(startValues.vWait + (sanitizedTarget.vWait - startValues.vWait) * ease));
        const curS3 = Math.max(0, Math.round(startValues.vUnreachable + (sanitizedTarget.vUnreachable - startValues.vUnreachable) * ease));
        const curS4 = Math.max(0, Math.round(startValues.vOutbound + (sanitizedTarget.vOutbound - startValues.vOutbound) * ease));
        const curS5 = Math.max(0, Math.round(startValues.vResolved + (sanitizedTarget.vResolved - startValues.vResolved) * ease));

        const curP1 = Math.max(0, Math.min(100, startValues.p1 + (sanitizedTarget.p1 - startValues.p1) * ease)).toFixed(1);
        const curP2 = Math.max(0, Math.min(100, startValues.p2 + (sanitizedTarget.p2 - startValues.p2) * ease)).toFixed(1);
        const curP3 = Math.max(0, Math.min(100, startValues.p3 + (sanitizedTarget.p3 - startValues.p3) * ease)).toFixed(1);
        const curP4 = Math.max(0, Math.min(100, startValues.p4 + (sanitizedTarget.p4 - startValues.p4) * ease)).toFixed(1);
        const curP5 = Math.max(0, Math.min(100, startValues.p5 + (sanitizedTarget.p5 - startValues.p5) * ease)).toFixed(1);

        if (elTotal) elTotal.textContent = currentTotal.toLocaleString();
        if (val1El) val1El.textContent = curS1.toLocaleString();
        if (val2El) val2El.textContent = curS2.toLocaleString();
        if (val3El) val3El.textContent = curS3.toLocaleString();
        if (val4El) val4El.textContent = curS4.toLocaleString();
        if (val5El) val5El.textContent = curS5.toLocaleString();

        if (pct1El) pct1El.textContent = curP1 + '%';
        if (pct2El) pct2El.textContent = curP2 + '%';
        if (pct3El) pct3El.textContent = curP3 + '%';
        if (pct4El) pct4El.textContent = curP4 + '%';
        if (pct5El) pct5El.textContent = curP5 + '%';

        _currentDist2DInterp = {
            total: currentTotal,
            vSuccess: curS1, vWait: curS2, vUnreachable: curS3, vOutbound: curS4, vResolved: curS5,
            p1: parseFloat(curP1) || 0, p2: parseFloat(curP2) || 0, p3: parseFloat(curP3) || 0,
            p4: parseFloat(curP4) || 0, p5: parseFloat(curP5) || 0
        };

        if (progress < 1) {
            _activeDist2DAnim = requestAnimationFrame(step);
        } else {
            _last2DDistValues = { ...sanitizedTarget };
            _currentDist2DInterp = null;
            _activeDist2DAnim = null;
        }
    }

    _activeDist2DAnim = requestAnimationFrame(step);
}

/**
 * 2D SVG Donut & Horizontal Legend renderer (Call Center Yangi Dizayn uslubida)
 * @param {Array<number>} vals - [Muvaffaqiyatli, Kutilmoqda, Ulanilmadi, Chiquvchi, Gaplashildi]
 * @param {string} sublabel - 'jami mijoz' yoki 'jami qo‘ng‘iroq'
 */
function render2DDistribution(vals, sublabel) {
    const vSuccess = Math.max(0, Math.round(Number(vals[0])) || 0);
    const vWait = Math.max(0, Math.round(Number(vals[1])) || 0);
    const vUnreachable = Math.max(0, Math.round(Number(vals[2])) || 0);
    const vOutbound = Math.max(0, Math.round(Number(vals[3])) || 0);
    const vResolved = Math.max(0, Math.round(Number(vals[4])) || 0);
    const total = vSuccess + vWait + vUnreachable + vOutbound + vResolved;

    const elLabel = document.getElementById('dist2DLabel');
    const seg1 = document.getElementById('dist2DSeg1');
    const seg2 = document.getElementById('dist2DSeg2');
    const seg3 = document.getElementById('dist2DSeg3');
    const seg4 = document.getElementById('dist2DSeg4');
    const seg5 = document.getElementById('dist2DSeg5');

    if (elLabel) elLabel.textContent = sublabel || 'jami mijoz';

    const p1 = total > 0 ? Math.max(0, Math.min(100, (vSuccess / total) * 100)) : 0;
    const p2 = total > 0 ? Math.max(0, Math.min(100, (vWait / total) * 100)) : 0;
    const p3 = total > 0 ? Math.max(0, Math.min(100, (vUnreachable / total) * 100)) : 0;
    const p4 = total > 0 ? Math.max(0, Math.min(100, (vOutbound / total) * 100)) : 0;
    const p5 = total > 0 ? Math.max(0, Math.min(100, (vResolved / total) * 100)) : 0;

    // Raqamlarni silliq hisoblab o'sish (Count-Up Animation)
    animate2DDistributionNumbers({
        total,
        vSuccess,
        vWait,
        vUnreachable,
        vOutbound,
        vResolved,
        p1,
        p2,
        p3,
        p4,
        p5
    }, 450);

    if (total === 0) {
        if (seg1) { seg1.setAttribute('stroke-dasharray', '0 100'); seg1.setAttribute('stroke-dashoffset', '25'); }
        if (seg2) { seg2.setAttribute('stroke-dasharray', '0 100'); seg2.setAttribute('stroke-dashoffset', '25'); }
        if (seg3) { seg3.setAttribute('stroke-dasharray', '0 100'); seg3.setAttribute('stroke-dashoffset', '25'); }
        if (seg4) { seg4.setAttribute('stroke-dasharray', '0 100'); seg4.setAttribute('stroke-dashoffset', '25'); }
        if (seg5) { seg5.setAttribute('stroke-dasharray', '0 100'); seg5.setAttribute('stroke-dashoffset', '25'); }
        return;
    }

    // SVG stroke-dashoffset: 12 o'clock soat mili bo'yicha 25 dan boshlanadi
    let currentOffset = 25;

    if (seg1) {
        seg1.setAttribute('stroke-dasharray', `${p1.toFixed(2)} ${(100 - p1).toFixed(2)}`);
        seg1.setAttribute('stroke-dashoffset', currentOffset.toFixed(2));
        seg1.innerHTML = `<title>Muvaffaqiyatli: ${vSuccess} (${p1.toFixed(1)}%)</title>`;
    }
    currentOffset -= p1;

    if (seg2) {
        seg2.setAttribute('stroke-dasharray', `${p2.toFixed(2)} ${(100 - p2).toFixed(2)}`);
        seg2.setAttribute('stroke-dashoffset', currentOffset.toFixed(2));
        seg2.innerHTML = `<title>Kutilmoqda: ${vWait} (${p2.toFixed(1)}%)</title>`;
    }
    currentOffset -= p2;

    if (seg3) {
        seg3.setAttribute('stroke-dasharray', `${p3.toFixed(2)} ${(100 - p3).toFixed(2)}`);
        seg3.setAttribute('stroke-dashoffset', currentOffset.toFixed(2));
        seg3.innerHTML = `<title>Ulanilmadi: ${vUnreachable} (${p3.toFixed(1)}%)</title>`;
    }
    currentOffset -= p3;

    if (seg4) {
        seg4.setAttribute('stroke-dasharray', `${p4.toFixed(2)} ${(100 - p4).toFixed(2)}`);
        seg4.setAttribute('stroke-dashoffset', currentOffset.toFixed(2));
        seg4.innerHTML = `<title>Chiquvchi: ${vOutbound} (${p4.toFixed(1)}%)</title>`;
    }
    currentOffset -= p4;

    if (seg5) {
        seg5.setAttribute('stroke-dasharray', `${p5.toFixed(2)} ${(100 - p5).toFixed(2)}`);
        seg5.setAttribute('stroke-dashoffset', currentOffset.toFixed(2));
        seg5.innerHTML = `<title>Gaplashildi: ${vResolved} (${p5.toFixed(1)}%)</title>`;
    }
}

/**
 * Taqsimot diagrammasini yangilash (2D SVG va 3D Highcharts)
 */
function updateDistributionChartDisplay() {
    const stats = window._latestStats || {};

    const answeredCalls = Math.max(0, Number(stats.answeredCalls) || 0);
    const outboundCalls = Math.max(0, Number(stats.outboundCalls) || 0);
    const abandonedCalls = Math.max(0, Number(stats.abandonedCalls) || 0);
    const totalCalls = stats.totalCalls !== undefined ? Math.max(0, Number(stats.totalCalls)) : (answeredCalls + outboundCalls + abandonedCalls);

    // Callbacks hisoblash: Taqsimot uchun HAR DOIM joriy tanlangan kun (yoki bugun) bo'yicha hisoblaymiz.
    // Tarixiy (all) callbacklar faqat sidebar ro'yxatida ko'rinadi, bugungi taqsimot kartasini buzmasligi shart!
    const targetDateStr = (typeof currentSelectedDate !== 'undefined' && currentSelectedDate) ? currentSelectedDate : getTodayDateString();
    let cbPending = 0;
    let cbUnreachable = 0;
    let cbResolved = 0;

    if (Array.isArray(currentCallbacksList) && currentCallbacksList.length > 0) {
        const isTargetDateCallback = (c) => {
            if (!c) return false;
            const cTime = c.call_time || c.created_at || '';
            if (cTime.startsWith(targetDateStr)) return true;
            if (c.status === 'resolved' && c.dismissed_at && c.dismissed_at.startsWith(targetDateStr)) return true;
            return false;
        };
        const dateFiltered = currentCallbacksList.filter(isTargetDateCallback);

        cbPending = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && (!c.outbound_attempts || c.outbound_attempts === 0)).length;
        cbUnreachable = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && c.outbound_attempts && c.outbound_attempts > 0).length;
        cbResolved = dateFiltered.filter(c => c.status === 'resolved').length;
    } else {
        cbPending = Math.max(0, Number(stats.callbacksPendingCount) || 0);
        cbUnreachable = Math.max(0, Number(stats.callbacksUnreachableCount) || 0);
        cbResolved = Math.max(0, Number(stats.callbacksResolvedCount) || 0);
    }

    // Unikal Mijozlar
    const totalClients = Math.max(0, stats.totalClients !== undefined ? Number(stats.totalClients) : (((Number(stats.inboundClients || stats.uniqueClients || 0)) + (Number(stats.outboundClients || 0))) || Number(stats.uniqueClients || 0)));
    const inboundClients = Math.max(0, stats.inboundClients !== undefined ? Number(stats.inboundClients) : (stats.uniqueClients !== undefined ? Number(stats.uniqueClients) : totalClients));
    const outboundClients = Math.max(0, stats.outboundClients !== undefined ? Number(stats.outboundClients) : Math.min(outboundCalls, totalClients));
    const answeredClients = Math.max(0, stats.answeredClients !== undefined ? Number(stats.answeredClients) : Math.min(answeredCalls, inboundClients));

    let vals = [];
    let sublabel = '';
    if (currentDistributionType === 'clients') {
        // MIJOZLAR TAQSIMOTI:
        // Kategoriyalar:
        // 1. Muvaffaqiyatli ulangan (inbound to'g'ridan-to'g'ri bog'langan)
        // 2. Kutilmoqda (qayta bog'lanish kerak bo'lgan pending mijozlar)
        // 3. Ulanilmadi (qayta bog'lanishda ulanilmagan mijozlar)
        // 4. Chiquvchi (faqat chiquvchi orqali gaplashilgan mijozlar)
        // 5. Gaplashildi (qayta bog'lanib hal etilgan mijozlar)

        let safeCbPending = cbPending;
        let safeCbUnreachable = cbUnreachable;
        let safeOutbound = outboundClients;
        let safeCbResolved = cbResolved;

        let nonPureSum = safeCbPending + safeCbUnreachable + safeOutbound + safeCbResolved;
        let pureAnswered = Math.max(0, totalClients - nonPureSum);

        // Agar totalClients > 0 bo'lsa va nonPureSum totalClients dan oshib ketsa,
        // har bir bo'lakni mutanosib (proportional) qilib totalClients ga moslashtiramiz
        if (totalClients > 0 && nonPureSum > totalClients) {
            pureAnswered = 0;
            const ratio = totalClients / nonPureSum;
            safeCbPending = Math.round(safeCbPending * ratio);
            safeCbUnreachable = Math.round(safeCbUnreachable * ratio);
            safeOutbound = Math.round(safeOutbound * ratio);
            safeCbResolved = Math.max(0, totalClients - safeCbPending - safeCbUnreachable - safeOutbound);
        } else if (totalClients === 0) {
            pureAnswered = 0;
            safeCbPending = 0;
            safeCbUnreachable = 0;
            safeOutbound = 0;
            safeCbResolved = 0;
        }

        vals = [pureAnswered, safeCbPending, safeCbUnreachable, safeOutbound, safeCbResolved];
        sublabel = 'jami mijoz';
    } else {
        // QO'NG'IROQLAR TAQSIMOTI:
        const totalCb = cbPending + cbUnreachable + cbResolved;
        let callPending = 0;
        let callUnreachable = 0;
        let callResolved = 0;
        if (totalCb > 0 && abandonedCalls > 0) {
            callPending = Math.round(abandonedCalls * (cbPending / totalCb));
            callUnreachable = Math.round(abandonedCalls * (cbUnreachable / totalCb));
            callResolved = Math.max(0, abandonedCalls - callPending - callUnreachable);
        } else {
            callPending = abandonedCalls;
        }
        vals = [answeredCalls, callPending, callUnreachable, outboundCalls, callResolved];
        sublabel = 'jami qo‘ng‘iroq';
    }

    latestPieData = vals;

    // 1. 2D SVG Donut & Legend
    render2DDistribution(vals, sublabel);

    // 2. 3D Highcharts Pie
    if (callDistributionChart && typeof callDistributionChart.series !== 'undefined' && callDistributionChart.series[0]) {
        if (callDistributionChart.series[0].points) {
            callDistributionChart.series[0].points.forEach(p => {
                if (p && p.slice && p.sliced) p.slice(false);
            });
        }
        const total = vals[0] + vals[1] + vals[2] + vals[3] + vals[4];
        if (total === 0) {
            callDistributionChart.series[0].setData([
                { name: t('chart_slice_abandoned_pending', 'Kutilmoqda'), y: 1, color: '#334155', sliced: false, selected: false }
            ], true, { duration: 300 });
        } else {
            callDistributionChart.series[0].setData([
                { name: t('chart_slice_success', 'Muvaffaqiyatli'), y: vals[0], color: '#10b981', sliced: false, selected: false },
                { name: t('chart_slice_abandoned_pending', 'Kutilmoqda'), y: vals[1], color: '#f59e0b', sliced: false, selected: false },
                { name: t('chart_slice_abandoned_unreachable', 'Ulanilmadi'), y: vals[2], color: '#f43f5e', sliced: false, selected: false },
                { name: t('chart_slice_outbound', 'Chiquvchi'), y: vals[3], color: '#a855f7', sliced: false, selected: false },
                { name: t('chart_slice_abandoned_resolved', 'Gaplashildi'), y: vals[4], color: '#38bdf8', sliced: false, selected: false }
            ], true, { duration: 300 });
        }
    }
}
window.updateCallDistributionPie = updateDistributionChartDisplay;
window.updateDistributionChartDisplay = updateDistributionChartDisplay;


/* ==========================================================================
   3. WebSocket Connection & Real-Time Updates
   ========================================================================== */
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);
    socket = ws;

    ws.onopen = () => {
        console.log('WebSocket ulandi');
        updateAmiStatus(true);
        // Ulanish zahoti faol tab sifatida ro'yxatdan o'tish va presence yuborish
        try {
            if (typeof claimActiveTab === 'function') {
                claimActiveTab();
            } else if (typeof sendPresenceHeartbeat === 'function') {
                sendPresenceHeartbeat(true);
            }
        } catch (e) { }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
        } catch (e) {
            console.error('WebSocket parsing error:', e);
        }
    };

    ws.onclose = () => {
        console.warn('⚠️ WebSocket uzildi. 3s dan so\'ng qayta ulanadi...');
        updateAmiStatus(false);
        setTimeout(initWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket xatosi:', err);
    };

    const btnSync = document.getElementById('btnSync');
    if (btnSync) {
        btnSync.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'sync' }));
            }
        });
    }
}

// =========================================================================
// MULTIPLAYER LIVE CURSORS & PRESENCE MODULE (AnyDesk / Figma Style)
// =========================================================================
let myClientId = '';
let myAssignedColor = '#38bdf8';
let isMultiplayerCursorsEnabled = true;
const remoteCursorsMap = new Map(); // clientId -> { element, timer, xRatio, contentY, tab, pcName, color }
let lastCursorSendTime = 0;

// Har bir brauzer / kompyuter uchun yagona unikal qurilma ID (localStorage orqali barcha tablar o'rtasida umumiy)
function getOrCreateDeviceId() {
    let id = localStorage.getItem('cc_multiplayer_device_id');
    if (!id || typeof id !== 'string' || id.length < 8) {
        id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem('cc_multiplayer_device_id', id);
    }
    return id;
}

// Ushbu vkladka (tab) uchun unikal in-memory ID (boshqa tablardan ajratish uchun)
const currentTabId = 'tab_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function isThisTabActive() {
    return localStorage.getItem('cc_active_tab_id') === currentTabId;
}

function claimActiveTab() {
    localStorage.setItem('cc_active_tab_id', currentTabId);
    sendPresenceHeartbeat(true);
}

function sendPresenceHeartbeat(isDirectlyActive) {
    if (!ws || ws.readyState !== 1) return;
    const isVisible = (document.visibilityState === 'visible');
    const isStoredActive = isThisTabActive();
    const isActive = (isDirectlyActive === true) || (isVisible && isStoredActive);

    const authU = window.currentAuthUser || {};
    try {
        ws.send(JSON.stringify({
            type: 'presence_ping',
            appType: 'dashboard_3535',
            deviceId: getOrCreateDeviceId(),
            tabId: currentTabId,
            isActiveTab: Boolean(isActive),
            isVisible: isVisible,
            pcName: getMyPcName(),
            tab: getActiveTabName(),
            username: authU.username || '',
            role: authU.role || ''
        }));
    } catch (e) { }
}

function getActiveTabName() {
    return document.documentElement.getAttribute('data-tab') || 'dashboard';
}

function getMyPcName() {
    let name = localStorage.getItem('multiplayer_pc_name');
    if (!name || name === 'undefined' || name === 'null') {
        const storedSuggested = localStorage.getItem('suggested_pc_name') || 'Admin PC';
        name = storedSuggested;
        localStorage.setItem('multiplayer_pc_name', name);
    }
    return name;
}

function setMyPcName(name) {
    if (!name) return;
    const clean = String(name).trim().slice(0, 24);
    if (!clean) return;
    localStorage.setItem('multiplayer_pc_name', clean);
    const lbl = document.getElementById('lblMyPcName');
    if (lbl) lbl.textContent = clean;
    // Serverga yangilangan nom haqida xabar berish
    sendPresenceHeartbeat(true);
}

function promptChangePcName(e) {
    if (e) e.stopPropagation();
    const current = getMyPcName();
    const newName = prompt("Kompyuter nomini kiriting (masalan, PC-ZUHRA yoki OPERATOR-101):", current);
    if (newName && newName.trim()) {
        setMyPcName(newName);
    }
}

let currentOnlineUsersList = [];
let isOnlineUsersPopoverOpen = false;
let isGhostModeActive = true;

function toggleGhostMode(enabled) {
    isGhostModeActive = Boolean(enabled);
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'toggle_ghost_mode',
            enabled: isGhostModeActive
        }));
    }
    renderOnlineUsersPopover();
}
window.toggleGhostMode = toggleGhostMode;

function toggleOnlineUsersPopover(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const pop = document.getElementById('onlineUsersPopover');
    if (!pop) return;

    isOnlineUsersPopoverOpen = !isOnlineUsersPopoverOpen;
    if (isOnlineUsersPopoverOpen) {
        pop.style.display = 'block';
        const chevron = document.getElementById('onlineUsersChevron');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
        renderOnlineUsersPopover();
        // Serverdan eng so'nggi ro'yxatni yangilab olish
        fetchOnlineUsersList();
    } else {
        closeOnlineUsersPopover();
    }
}
window.toggleOnlineUsersPopover = toggleOnlineUsersPopover;

function closeOnlineUsersPopover() {
    const pop = document.getElementById('onlineUsersPopover');
    if (pop) pop.style.display = 'none';
    const chevron = document.getElementById('onlineUsersChevron');
    if (chevron) chevron.style.transform = 'none';
    isOnlineUsersPopoverOpen = false;
}
window.closeOnlineUsersPopover = closeOnlineUsersPopover;

async function fetchOnlineUsersList() {
    try {
        const res = await fetch('/api/presence/online-users');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.users)) {
                currentOnlineUsersList = data.users;
                if (isOnlineUsersPopoverOpen) {
                    renderOnlineUsersPopover();
                }
            }
        }
    } catch (_) { }
}
window.fetchOnlineUsersList = fetchOnlineUsersList;

function getTabDisplayName(tabKey) {
    switch (tabKey) {
        case 'dashboard': return 'Monitoring';
        case 'history': return 'Jurnal';
        case 'operators': return 'Operatorlar';
        case 'explorer': return 'Audio yozuvlar';
        case 'analytics': return 'Tahlil';
        case 'settings': return 'Sozlamalar';
        default: return 'Monitoring';
    }
}

function renderOnlineUsersPopover() {
    const pop = document.getElementById('onlineUsersPopover');
    if (!pop) return;

    const myDevId = getOrCreateDeviceId();
    const myPc = getMyPcName();
    const users = currentOnlineUsersList && currentOnlineUsersList.length > 0
        ? currentOnlineUsersList
        : [{
            deviceId: myDevId,
            clientId: myClientId,
            pcName: myPc,
            username: (window.currentAuthUser && window.currentAuthUser.username) || 'superuser',
            role: (window.currentAuthUser && window.currentAuthUser.role) || 'superuser',
            clientIp: '127.0.0.1',
            color: myAssignedColor,
            tab: getActiveTabName(),
            isActive: true,
            lastActiveAt: Date.now()
        }];

    const authU = window.currentAuthUser || {};
    const myUname = String(authU.username || '').toLowerCase().trim();
    const myPcLower = String(myPc || '').toLowerCase().trim();
    // Shaxsan Maxmudbek yoki uning Admin kompyuteri (Admin PC):
    const isMaxmudbek = myUname.includes('maxmudbek') || authU.email === 'abaddona74@gmail.com' || myPcLower.includes('admin');

    let itemsHtml = '';
    users.forEach(u => {
        const isMe = (u.deviceId && u.deviceId === myDevId) || (u.clientId && u.clientId === myClientId) || (u.pcName && u.pcName === myPc);
        const color = u.color || '#38bdf8';
        const roleClass = (u.role === 'superuser') ? 'superuser' : 'operator';
        const roleLabel = (u.role === 'superuser') ? 'Administrator' : 'Viewer';
        const tabName = getTabDisplayName(u.tab);

        let detailsText = '';
        if (u.operator && u.operator.name) {
            detailsText = `Operator: ${escapeHtml(u.operator.id)} - ${escapeHtml(u.operator.name)}`;
        } else {
            detailsText = `Login: ${escapeHtml(u.username || 'superuser')}`;
        }

        const ipDisplay = u.clientIp ? escapeHtml(u.clientIp) : 'Lokal';

        // Faollik holati
        const now = Date.now();
        const diffSec = Math.round((now - (u.lastActiveAt || now)) / 1000);
        let statusBadge = '';
        if (diffSec < 30) {
            statusBadge = `<span style="font-size: 10.5px; color: #34d399; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>Faol</span>`;
        } else if (diffSec < 120) {
            statusBadge = `<span style="font-size: 10px; color: #fbbf24;">1 daq oldin</span>`;
        } else {
            const min = Math.round(diffSec / 60);
            statusBadge = `<span style="font-size: 10px; color: #94a3b8;">${min} daq oldin</span>`;
        }

        itemsHtml += `
            <div class="online-user-item ${isMe ? 'is-me' : ''}">
                <div class="online-user-avatar" style="color: ${color}; border-color: ${color};">
                    <svg class="isax isax-monitor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 4C3 3.44772 3.44772 3 4 3H20C20.5523 3 21 3.44772 21 4V16C21 16.5523 20.5523 17 20 17H4C3.44772 17 3 16.5523 3 16V4Z"/>
                        <path d="M12 17V21"/>
                        <path d="M8 21H16"/>
                    </svg>
                    <span class="avatar-dot"></span>
                </div>
                <div class="online-user-info">
                    <div class="online-user-top">
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                            <span class="online-user-name" title="${escapeHtml(u.pcName || 'PC')}">${escapeHtml(u.pcName || 'PC')}</span>
                            ${isMe ? '<span class="online-user-me-tag">Siz</span>' : ''} ${(u.isGhost || (isMe && isMaxmudbek && isGhostModeActive)) ? '<span class="online-user-ghost-tag" style="background: rgba(168, 85, 247, 0.25); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.45); font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;">👻 Ko\'rinmas</span>' : ''}
                        </div>
                        ${statusBadge}
                    </div>
                    <div class="online-user-bottom">
                        <span class="online-user-role ${roleClass}">${roleLabel}</span>
                        <span class="online-user-ip" title="IP manzil">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                            ${ipDisplay}
                        </span>
                        <span class="online-user-tab-badge">${tabName}</span>
                    </div>
                    <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">
                        ${detailsText}
                    </div>
                </div>
            </div>
        `;
    });

    const ghostBannerHtml = isMaxmudbek ? `
        <div class="ghost-mode-banner" style="margin: 8px 12px 6px; padding: 10px 12px; background: linear-gradient(135deg, rgba(88, 28, 135, 0.45) 0%, rgba(30, 27, 75, 0.65) 100%); border: 1px solid rgba(168, 85, 247, 0.45); border-radius: 9px; display: flex; align-items: center; justify-content: space-between; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
            <div style="display: flex; align-items: center; gap: 9px;">
                <span style="font-size: 22px; filter: drop-shadow(0 0 6px rgba(192, 132, 252, 0.6));">👻</span>
                <div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 12px; font-weight: 700; color: #f3e8ff;">Ghost Mode</span>
                        <span style="font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: ${isGhostModeActive ? '#9333ea' : '#475569'}; color: #fff; box-shadow: 0 0 8px ${isGhostModeActive ? 'rgba(168, 85, 247, 0.6)' : 'transparent'};">${isGhostModeActive ? "FAOL (KO'RINMAS)" : "O'CHIRILGAN"}</span>
                    </div>
                    <div style="font-size: 10.5px; color: #cbd5e1; margin-top: 1px; line-height: 1.25;">
                        ${isGhostModeActive 
                            ? "Sizning onlaynligingiz boshqalarga <b style='color: #c084fc;'>ko'rinmaydi</b>, lekin siz hammani ko'rasiz." 
                            : "Ghost Mode o'chiq (boshqalar sizni ko'radi)"}
                    </div>
                </div>
            </div>
            <label style="position: relative; display: inline-block; width: 38px; height: 20px; margin: 0; cursor: pointer; flex-shrink: 0;" title="Ghost Mode-ni yoqish / o'chirish">
                <input type="checkbox" ${isGhostModeActive ? 'checked' : ''} onchange="toggleGhostMode(this.checked)" style="opacity: 0; width: 0; height: 0;">
                <span style="position: absolute; cursor: pointer; inset: 0; background-color: ${isGhostModeActive ? '#9333ea' : '#475569'}; transition: .25s; border-radius: 20px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.4);">
                    <span style="position: absolute; height: 14px; width: 14px; left: ${isGhostModeActive ? '21px' : '3px'}; bottom: 3px; background-color: white; transition: .25s; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></span>
                </span>
            </label>
        </div>` : '';

    pop.innerHTML = `
        <div class="online-popover-header">
            <div class="online-popover-title-wrap">
                <span class="online-popover-title">Faol foydalanuvchilar</span>
                <span class="online-popover-badge">${users.length} ta onlayn</span>
            </div>
            <button type="button" class="online-popover-close" onclick="closeOnlineUsersPopover()" title="Yopish">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        ${ghostBannerHtml}
        <div class="online-users-list">
            ${itemsHtml}
        </div>
        <div class="online-popover-footer">
            <label style="display: inline-flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; margin: 0; color: #cbd5e1; font-weight: 500;">
                <input type="checkbox" ${isMultiplayerCursorsEnabled ? 'checked' : ''} onchange="toggleMultiplayerCursors(event)" style="cursor: pointer; width: 14px; height: 14px; accent-color: #38bdf8;">
                <span>Jonli kursorlar</span>
            </label>
            <button type="button" class="online-popover-footer-btn" onclick="promptChangePcName(event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Nomni o'zgartirish
            </button>
        </div>
    `;
}

function toggleMultiplayerCursors(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (e && e.target && e.target.type === 'checkbox') {
        isMultiplayerCursorsEnabled = e.target.checked;
    } else {
        isMultiplayerCursorsEnabled = !isMultiplayerCursorsEnabled;
    }
    const overlay = document.getElementById('multiplayerCursorsOverlay');
    if (overlay) {
        overlay.style.display = isMultiplayerCursorsEnabled ? 'block' : 'none';
    }
    const txt = document.getElementById('txtOnlineCursorsCount');
    if (txt) {
        txt.style.opacity = isMultiplayerCursorsEnabled ? '1' : '0.5';
    }
    localStorage.setItem('multiplayer_cursors_enabled', isMultiplayerCursorsEnabled ? '1' : '0');
    if (isOnlineUsersPopoverOpen) {
        renderOnlineUsersPopover();
    }
}
window.toggleMultiplayerCursors = toggleMultiplayerCursors;

function initMultiplayerCursors() {
    // Saqlangan sozlamalarni yuklash
    const savedEnabled = localStorage.getItem('multiplayer_cursors_enabled');
    if (savedEnabled === '0') {
        isMultiplayerCursorsEnabled = false;
        const overlay = document.getElementById('multiplayerCursorsOverlay');
        if (overlay) overlay.style.display = 'none';
        const txt = document.getElementById('txtOnlineCursorsCount');
        if (txt) txt.style.opacity = '0.5';
    }

    const lbl = document.getElementById('lblMyPcName');
    if (lbl) lbl.textContent = getMyPcName();

    // Tashqariga bosilganda onlayn ro'yxat popoverini yopish
    document.addEventListener('click', (e) => {
        if (isOnlineUsersPopoverOpen) {
            const widget = document.getElementById('presenceCursorWidget');
            if (widget && !widget.contains(e.target)) {
                closeOnlineUsersPopover();
            }
        }
    });

    // Tab faolligi va diqqatni (focus) aniqlash
    window.addEventListener('focus', claimActiveTab);
    window.addEventListener('click', () => {
        if (!isThisTabActive()) claimActiveTab();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            claimActiveTab();
        } else {
            sendPresenceHeartbeat(false);
        }
    });

    // Mouse harakatini sahifa kontentiga bog'langan koordinatalar bilan uzatish (~50ms throttle)
    window.addEventListener('mousemove', (e) => {
        if (!isMultiplayerCursorsEnabled) return;
        if (!ws || ws.readyState !== 1) return; // 1 = WebSocket.OPEN

        // Agar bu tabga kelib sichqoncha harakatlansa, uni aktiv tab deb qayd etish
        if (!isThisTabActive() && document.visibilityState === 'visible') {
            localStorage.setItem('cc_active_tab_id', currentTabId);
        }

        const now = performance.now();
        if (now - lastCursorSendTime < 50) return;
        lastCursorSendTime = now;

        const mainArea = document.getElementById('mainArea') || document.querySelector('.main-area');
        if (!mainArea) return;

        const rect = mainArea.getBoundingClientRect();
        const scrollLeft = mainArea.scrollLeft || 0;
        const scrollTop = mainArea.scrollTop || 0;

        // Kontentning boshiga nisbatan mutlaq koordinata
        const contentX = (e.clientX - rect.left) + scrollLeft;
        const contentY = (e.clientY - rect.top) + scrollTop;

        const mainWidth = Math.max(1, mainArea.clientWidth);
        const xRatio = Math.max(0, Math.min(1.2, contentX / mainWidth));

        try {
            ws.send(JSON.stringify({
                type: 'cursor_move',
                deviceId: getOrCreateDeviceId(),
                tabId: currentTabId,
                xRatio: Number(xRatio.toFixed(4)),
                contentY: Math.round(contentY),
                tab: getActiveTabName(),
                pcName: getMyPcName()
            }));
        } catch (err) { }
    }, { passive: true });

    // Sichqoncha darchadan chiqqanda kursor holatini bildirish
    document.addEventListener('mouseleave', () => {
        if (ws && ws.readyState === 1) {
            try {
                ws.send(JSON.stringify({ type: 'cursor_leave' }));
            } catch (err) { }
        }
    });

    // Har 10 soniyada mavjudlikni (presence heartbeat) yangilab turish
    setInterval(() => {
        sendPresenceHeartbeat();
    }, 10000);

    // Oyna o'lchami o'zgarganda kursorlarni to'g'ri qayta joylashtirish
    window.addEventListener('resize', () => {
        const mainArea = document.getElementById('mainArea') || document.querySelector('.main-area');
        if (!mainArea) return;
        const mainWidth = mainArea.clientWidth;
        remoteCursorsMap.forEach((data) => {
            if (data.element) {
                const px = Math.round((data.xRatio || 0) * mainWidth);
                const py = Math.round(data.contentY || 0);
                data.element.style.transform = `translate3d(${px}px, ${py}px, 0)`;
            }
        });
    });
}

function handleClientAssigned(data) {
    if (!data) return;
    if (data.clientId) myClientId = data.clientId;
    if (data.color) myAssignedColor = data.color;
    if (data.suggestedPcName) {
        localStorage.setItem('suggested_pc_name', data.suggestedPcName);
        if (!localStorage.getItem('multiplayer_pc_name')) {
            setMyPcName(data.suggestedPcName);
        }
    }
    const lbl = document.getElementById('lblMyPcName');
    if (lbl) lbl.textContent = getMyPcName();
}

function handleRemoteCursorMove(data) {
    if (!data || !data.clientId) return;
    if (myClientId && data.clientId === myClientId) return;
    if (!isMultiplayerCursorsEnabled) return;

    const overlay = document.getElementById('multiplayerCursorsOverlay');
    if (!overlay) return;

    const mainArea = document.getElementById('mainArea') || document.querySelector('.main-area');
    if (!mainArea) return;

    let cursorItem = remoteCursorsMap.get(data.clientId);
    const color = data.color || '#38bdf8';
    const pcName = data.pcName || 'Noma\'lum PC';
    const remoteTab = data.tab || 'dashboard';
    const currentTab = getActiveTabName();
    const isSameTab = (remoteTab === currentTab);

    // xRatio va contentY ni aniqlash (eski x, y formatlarini ham qo'llab-quvvatlaydi)
    const xRatio = (data.xRatio !== undefined) ? data.xRatio : (data.x !== undefined ? data.x : 0.5);
    const contentY = (data.contentY !== undefined) ? data.contentY : Math.round((data.y || 0) * (mainArea.clientHeight || window.innerHeight));

    if (!cursorItem || !cursorItem.element) {
        // AnyDesk / Figma uslubidagi kursor va uning yorlig'i
        const el = document.createElement('div');
        el.className = 'remote-cursor';
        el.id = `remoteCursor-${data.clientId}`;
        el.innerHTML = `
            <svg class="cursor-arrow-svg" viewBox="0 0 16 16">
                <path d="M0 0 L15 10.5 L8.5 10.5 L13 16 L10.5 16 L6 10.5 L0 15 Z" fill="${color}" stroke="#ffffff" stroke-width="0.8"/>
            </svg>
            <div class="cursor-label" style="background: ${color};">
                <span class="cursor-pc-icon">💻</span>
                <span class="cursor-name">${escapeHtml(pcName)}</span>
                <span class="cursor-tab-tag" style="display: none; font-size: 9.5px; opacity: 0.9; margin-left: 2px;"></span>
            </div>
        `;
        overlay.appendChild(el);

        cursorItem = {
            element: el,
            timer: null,
            xRatio: xRatio,
            contentY: contentY,
            tab: remoteTab,
            pcName: pcName,
            color: color
        };
        remoteCursorsMap.set(data.clientId, cursorItem);
    } else {
        cursorItem.xRatio = xRatio;
        cursorItem.contentY = contentY;
        cursorItem.tab = remoteTab;
        if (cursorItem.pcName !== pcName) {
            cursorItem.pcName = pcName;
            const nameEl = cursorItem.element.querySelector('.cursor-name');
            if (nameEl) nameEl.textContent = pcName;
        }
    }

    // Agar boshqa bo'limda (tabda) bo'lsa, xiralashtirib qaysi bo'limdaligini ko'rsatish
    const tabTag = cursorItem.element.querySelector('.cursor-tab-tag');
    if (tabTag) {
        if (!isSameTab) {
            tabTag.style.display = 'inline';
            tabTag.textContent = `• [${remoteTab}]`;
            cursorItem.element.style.opacity = '0.35';
        } else {
            tabTag.style.display = 'none';
            cursorItem.element.style.opacity = '1';
        }
    }

    // Element koordinatasini mainArea kontenti bo'yicha aniq joylashtirish
    const mainWidth = mainArea.clientWidth || window.innerWidth;
    const px = Math.round(cursorItem.xRatio * mainWidth);
    const py = Math.round(cursorItem.contentY);

    cursorItem.element.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    cursorItem.element.classList.remove('is-idle', 'is-hidden');

    // 8 soniya harakat bo'lmasa xiralashadi
    if (cursorItem.timer) clearTimeout(cursorItem.timer);
    cursorItem.timer = setTimeout(() => {
        if (cursorItem.element) {
            cursorItem.element.classList.add('is-idle');
        }
    }, 8000);

    updateOnlineCursorsCount();
}

function handleRemoteCursorRemove(data) {
    if (!data || !data.clientId) return;
    const cursorItem = remoteCursorsMap.get(data.clientId);
    if (cursorItem) {
        if (cursorItem.timer) clearTimeout(cursorItem.timer);
        if (cursorItem.element && cursorItem.element.parentNode) {
            cursorItem.element.parentNode.removeChild(cursorItem.element);
        }
        remoteCursorsMap.delete(data.clientId);
    }
    updateOnlineCursorsCount();
}

function updateOnlineCursorsCount(serverCount) {
    const txt = document.getElementById('txtOnlineCursorsCount');
    if (!txt) return;
    const count = (typeof serverCount === 'number') ? serverCount : Math.max(1, remoteCursorsMap.size + 1);
    txt.textContent = `${count} online`;
}

function handleWsMessage(msg) {
    if (msg.type === 'client_assigned') {
        handleClientAssigned(msg.data);
    } else if (msg.type === 'presence_stats') {
        if (msg.data) {
            if (typeof msg.data.onlineCount === 'number') {
                updateOnlineCursorsCount(msg.data.onlineCount);
            }
            if (msg.data.isGhostModeActive !== undefined) {
                isGhostModeActive = Boolean(msg.data.isGhostModeActive);
            }
            if (Array.isArray(msg.data.users)) {
                currentOnlineUsersList = msg.data.users;
                if (isOnlineUsersPopoverOpen) {
                    renderOnlineUsersPopover();
                }
            }
        }
    } else if (msg.type === 'remote_cursor_move') {
        handleRemoteCursorMove(msg.data);
    } else if (msg.type === 'remote_cursor_remove') {
        handleRemoteCursorRemove(msg.data);
    } else if (msg.type === 'server_version' && msg.data) {
        handleServerBuildId(msg.data.buildId);
    } else if (msg.type === 'initial_state') {
        if (msg.data && msg.data.clientId) {
            handleClientAssigned(msg.data);
        }
        if (msg.data && msg.data.serverVersion && msg.data.serverVersion.buildId) {
            handleServerBuildId(msg.data.serverVersion.buildId);
        }
        updateAmiStatus(msg.data.amiStatus);
        updateSftpStatus(msg.data.sftpStatus);
        updateStatsUI(msg.data.stats);
        if (msg.data.conversations) renderActiveConversations(msg.data.conversations);
        if (msg.data.queues) renderQueues(msg.data.queues);
        if (msg.data.operators) renderOperators(msg.data.operators);
        if (msg.data.callHistory && Array.isArray(msg.data.callHistory) && msg.data.callHistory.length > 0) {
            dashboardRecentCallsList = [...msg.data.callHistory];
            updateRecentOperatorsDataList();
            applyDashboardRecentFilters();
        }
        if (msg.data.callbacks) {
            renderCallbacks(msg.data.callbacks);
        }
        if (msg.data.contacts) {
            setClientContactsList(msg.data.contacts);
        }
    } else if (msg.type === 'ami_status') {
        updateAmiStatus(msg.data.connected);
    } else if (msg.type === 'sftp_status') {
        updateSftpStatus(msg.data.connected);
    } else if (msg.type === 'stats_update') {
        if (!currentSelectedDate || currentSelectedDate === getTodayDateString()) {
            updateStatsUI(msg.data);
        }
    } else if (msg.type === 'active_conversations_update') {
        renderActiveConversations(msg.data);
        renderCallbacks(currentCallbacksList);
    } else if (msg.type === 'queue_update') {
        renderQueues(msg.data);
    } else if (msg.type === 'operators_update') {
        const todayStr = getTodayDateString();
        const isArchive = currentSelectedDate && currentSelectedDate !== todayStr;
        if (isArchive) {
            // Arxiv sanada turganda, operatorlarning tanlangan sanadagi answered/missed/duration statistikalarini
            // bugungi jonli hisoblagichlar bilan ustiga yozmaslik kerak!
            // Faqat real-vaqtdagi ulanish (presence, ringingCaller, ip, agentConnected) yangilanadi:
            const rawOps = window._rawLastOperators || currentOperators;
            if (rawOps && rawOps.length > 0 && Array.isArray(msg.data)) {
                const freshMap = new Map(msg.data.map(o => [String(o.id), o]));
                rawOps.forEach(op => {
                    const fresh = freshMap.get(String(op.id));
                    if (fresh) {
                        op.presence = fresh.presence;
                        op.ringingCaller = fresh.ringingCaller;
                        op.agentConnected = fresh.agentConnected;
                        op.agentHostname = fresh.agentHostname;
                        op.agentVersion = fresh.agentVersion;
                        op.lastAgentPing = fresh.lastAgentPing;
                        if (fresh.ip) op.ip = fresh.ip;
                    }
                });
                renderOperators(window._rawLastOperators || currentOperators);
                renderCallbacks(currentCallbacksList);
            }
        } else {
            renderOperators(msg.data);
            renderCallbacks(currentCallbacksList);
        }
    } else if (msg.type === 'agent_operators_update') {
        const todayStr = getTodayDateString();
        const isArchive = currentSelectedDate && currentSelectedDate !== todayStr;
        if (isArchive) {
            // Arxiv sanada turganda, Desktop Agent answered/missed/duration statistikalari saqlanadi.
            // Faqat jonli ulanish va statuslar (presence, agentConnected, versiya) yangilanadi.
            if (tabAgentOperatorsData && tabAgentOperatorsData.length > 0 && Array.isArray(msg.data)) {
                const freshMap = new Map(msg.data.map(o => [String(o.id), o]));
                tabAgentOperatorsData.forEach(tabOp => {
                    const fresh = freshMap.get(String(tabOp.id));
                    if (fresh) {
                        tabOp.presence = fresh.presence;
                        tabOp.ringingCaller = fresh.ringingCaller;
                        tabOp.agentConnected = fresh.agentConnected;
                        tabOp.agentHostname = fresh.agentHostname;
                        tabOp.agentVersion = fresh.agentVersion;
                        tabOp.lastAgentPing = fresh.lastAgentPing;
                        if (fresh.ip) tabOp.ip = fresh.ip;
                    }
                });
                renderTabAgentOperators(tabAgentOperatorsData);
                renderCallbacks(currentCallbacksList);
            }
        } else {
            tabAgentOperatorsData = msg.data;
            renderTabAgentOperators(tabAgentOperatorsData);
            renderCallbacks(currentCallbacksList);
        }
    } else if (msg.type === 'agent_ota_log') {
        appendOtaLog(msg.data);
    } else if (msg.type === 'excluded_operators_update') {
        if (Array.isArray(msg.data)) {
            updateExcludedOperatorIds(msg.data, true);
        }
    } else if (msg.type === 'call_history_sync') {
        if (Array.isArray(msg.data) && msg.data.length > 0) {
            dashboardRecentCallsList = [...msg.data];
            updateRecentOperatorsDataList();
            applyDashboardRecentFilters();
        }
    } else if (msg.type === 'call_hangup') {
        addRecentDashboardRow(msg.data);
        const activeTab = document.documentElement.getAttribute('data-tab') || 'dashboard';
        const histTab = document.getElementById('tab-history');
        const isHistoryActive = activeTab === 'history' || (histTab && (histTab.classList.contains('active') || window.getComputedStyle(histTab).display !== 'none'));
        if (isHistoryActive) {
            prependLiveHistoryRow(msg.data);
            if (historyCurrentPage === 1 && !historySearchQuery) {
                setTimeout(() => loadHistoryPage(1, '', true), 500);
            }
        }
    } else if (msg.type === 'callbacks_update') {
        renderCallbacks(msg.data);
    } else if (msg.type === 'client_contacts_update' && msg.data) {
        handleWsClientContactUpdate(msg.data);
    }
}

let currentCallbacksList = [];

function getPhone9(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    return digits.length >= 9 ? digits.slice(-9) : null;
}

function findActiveCallForPhone(phone, itemActiveCall) {
    const isOpOnline = (opId) => {
        if (!opId || typeof currentOperators === 'undefined' || !Array.isArray(currentOperators)) return true;
        const found = currentOperators.find(o => String(o.id) === String(opId));
        if (!found) return true;
        return found.presence !== 'offline';
    };

    if (itemActiveCall && itemActiveCall.operator) {
        if (itemActiveCall.operatorExten && !isOpOnline(itemActiveCall.operatorExten)) {
            return null; // Offline operator faol qo'ng'iroqda bo'la olmaydi!
        }
        return itemActiveCall;
    }
    const target9 = getPhone9(phone);
    if (!target9) return null;

    // 1. Faol suhbatlar (talking)
    if (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations)) {
        for (const conv of currentConversations) {
            const c9 = getPhone9(conv.callerId);
            if (c9 && c9 === target9) {
                if (conv.operatorExten && !isOpOnline(conv.operatorExten)) continue;
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
    if (typeof currentOperators !== 'undefined' && Array.isArray(currentOperators)) {
        for (const op of currentOperators) {
            if (op.presence === 'offline') continue;
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

let adminCbDateFilter = 'today'; // 'today' | 'all'
let adminCbTab = 'pending'; // 'pending' | 'unreachable'

function switchAdminCallbackDateFilter(filter) {
    if (filter !== 'today' && filter !== 'all') return;
    adminCbDateFilter = filter;

    const btnToday = document.getElementById('adminCbFilterToday');
    const btnAll = document.getElementById('adminCbFilterAll');
    if (btnToday && btnAll) {
        btnToday.classList.toggle('on', filter === 'today');
        btnAll.classList.toggle('on', filter === 'all');
        btnToday.style.background = '';
        btnToday.style.color = '';
        btnAll.style.background = '';
        btnAll.style.color = '';
    }
    renderCallbacks(currentCallbacksList);
    if (typeof updateCallDistributionPie === 'function') {
        updateCallDistributionPie();
    }
}

let adminCbResolvedTodayOnly = true;

function toggleAdminCbResolvedTodayOnly(checked) {
    adminCbResolvedTodayOnly = true;
    renderCallbacks(currentCallbacksList);
    updateDistributionChartDisplay();
}
window.toggleAdminCbResolvedTodayOnly = toggleAdminCbResolvedTodayOnly;

function switchAdminCallbackTab(tab) {
    if (tab !== 'pending' && tab !== 'unreachable' && tab !== 'resolved') return;
    adminCbTab = tab;

    const btnPending = document.getElementById('adminCbTabPending');
    const btnUnreachable = document.getElementById('adminCbTabUnreachable');
    const btnResolved = document.getElementById('adminCbTabResolved');

    if (btnPending && btnUnreachable) {
        btnPending.classList.toggle('on', tab === 'pending');
        btnUnreachable.classList.toggle('on', tab === 'unreachable');
        if (btnResolved) btnResolved.classList.toggle('on', tab === 'resolved');

        btnPending.style.background = '';
        btnPending.style.borderColor = '';
        btnPending.style.color = '';
        btnUnreachable.style.background = '';
        btnUnreachable.style.borderColor = '';
        btnUnreachable.style.color = '';
        if (btnResolved) {
            btnResolved.style.background = '';
            btnResolved.style.borderColor = '';
            btnResolved.style.color = '';
        }
    }
    renderCallbacks(currentCallbacksList);
}

function getAdminCallbackRelativeTime(dateStr) {
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

function renderCallbacks(callbacks) {
    currentCallbacksList = Array.isArray(callbacks) ? callbacks : [];
    const badgeEl = document.getElementById('callbackCountBadge');
    const pendingCountEl = document.getElementById('adminCbPendingCount');
    const unreachableCountEl = document.getElementById('adminCbUnreachableCount');
    const resolvedCountEl = document.getElementById('adminCbResolvedCount');
    const container = document.getElementById('callbackListContainer');

    const todayStr = getTodayDateString();

    // 1. Sana filtri (Bugun / Hammasi)
    const isTodayCallback = (c) => {
        if (!c) return false;
        if (c.call_time && c.call_time.startsWith(todayStr)) return true;
        if (c.created_at && c.created_at.startsWith(todayStr)) return true;
        if (c.status === 'resolved' && c.dismissed_at && c.dismissed_at.startsWith(todayStr)) return true;
        return false;
    };

    const dateFiltered = (adminCbDateFilter === 'today')
        ? currentCallbacksList.filter(isTodayCallback)
        : currentCallbacksList;

    // 2. Kategoriya bo'yicha ajratish: Kutilmoqda vs Bog'lanib bo'lmadi vs Gaplashildi
    const pendingList = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && (!c.outbound_attempts || c.outbound_attempts === 0));
    const unreachableList = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && c.outbound_attempts && c.outbound_attempts > 0);
    // Gaplashildi (Resolved): bugun hal qilingan yoki qo'ng'irog'i bugun bo'lgan barcha mijozlar
    const resolvedList = currentCallbacksList.filter(c => {
        if (c.status !== 'resolved') return false;
        const timeStr = c.call_time || c.created_at || '';
        const dismStr = c.dismissed_at || '';
        if (adminCbResolvedTodayOnly || adminCbDateFilter === 'today') {
            return timeStr.startsWith(todayStr) || dismStr.startsWith(todayStr);
        }
        return true;
    });

    const totalNeedAttention = pendingList.length + unreachableList.length;

    if (badgeEl) {
        badgeEl.textContent = totalNeedAttention;
        if (totalNeedAttention > 0) {
            badgeEl.className = 'badge badge-warning';
            badgeEl.style.background = 'rgba(245, 158, 11, 0.2)';
            badgeEl.style.color = '#fbbf24';
        } else {
            badgeEl.className = 'badge';
            badgeEl.style.background = 'rgba(255, 255, 255, 0.1)';
            badgeEl.style.color = 'var(--text-dim)';
        }
    }
    if (pendingCountEl) pendingCountEl.textContent = pendingList.length;
    if (unreachableCountEl) unreachableCountEl.textContent = unreachableList.length;
    if (resolvedCountEl) resolvedCountEl.textContent = resolvedList.length;

    const clearAllBtn = document.getElementById('btnClearAllCallbacks');
    if (clearAllBtn) {
        clearAllBtn.style.display = totalNeedAttention > 0 ? 'inline-flex' : 'none';
    }

    // Taqsimot diagrammasidagi "Kutilmoqda" qiymatini sidebar bilan 100% sinxron yangilash
    if (typeof updateDistributionChartDisplay === 'function') {
        updateDistributionChartDisplay();
    }

    if (!container) return;

    let displayList = pendingList;
    if (adminCbTab === 'unreachable') displayList = unreachableList;
    else if (adminCbTab === 'resolved') displayList = resolvedList;

    // Eng yangilari tepada bo'lishi uchun call_time bo'yicha kamayish (DESC) tartibida saralash
    displayList = [...displayList].sort((a, b) => {
        const timeA = a.call_time || a.created_at || '';
        const timeB = b.call_time || b.created_at || '';
        return timeB.localeCompare(timeA);
    });

    if (displayList.length === 0) {
        const emptyMsg = (adminCbTab === 'unreachable')
            ? t('live_callbacks_unreachable_empty', "Bog'lanib bo'lmagan mijozlar yo'q")
            : (adminCbTab === 'resolved')
                ? t('live_callbacks_resolved_empty', "Hozircha gaplashilgan mijozlar yo'q")
                : t('live_callbacks_pending_empty', "Hozircha kutilayotgan yangi mijozlar yo'q");
        container.innerHTML = `
            <div class="empty-callbacks-placeholder" style="text-align: center; color: var(--text-dim); padding: 14px; font-size: 11px;">
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
        const isUnreachable = (adminCbTab === 'unreachable');
        const isResolved = (adminCbTab === 'resolved' || item.status === 'resolved');

        let statusText = isIvr ? t('callback_source_ivr', 'Ish vaqti emas') : t('callback_source_abandoned', 'Navbatdan chiqdi');
        if (isResolved) {
            let opRaw = item.last_outbound_operator || '';
            if (opRaw === 'NULL' || opRaw === 'null' || opRaw === '\\N') opRaw = '';
            let opDisplayName = '';
            if (opRaw && !/^\d{2,4}$/.test(opRaw.trim())) {
                opDisplayName = opRaw.trim();
            } else {
                let ext = opRaw ? opRaw.trim() : '';
                if (!ext && item.dismissed_by) {
                    const m = item.dismissed_by.match(/(\d{2,4})/);
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
                <button type="button" class="cc-cb-del" onclick="event.stopPropagation(); deleteCallback(${item.id}, event)" title="${t('dyn_delete', 'O\'chirish')}">
                    ${isax('close', '', 'width: 12px; height: 12px;')}
                </button>
            </div>
        `;
    }

    container.innerHTML = html;
}

function showCustomConfirm({ title, message, okText, cancelText }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const titleEl = document.getElementById('customConfirmTitle');
        const msgEl = document.getElementById('customConfirmMessage');
        const okBtn = document.getElementById('customConfirmOkBtn');
        const cancelBtn = document.getElementById('customConfirmCancelBtn');

        if (!modal) {
            resolve(window.confirm(message || title || "Ishonchingiz komilmi?"));
            return;
        }

        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
        if (okBtn && okText) okBtn.textContent = okText;
        if (cancelBtn && cancelText) cancelBtn.textContent = cancelText;

        modal.style.display = 'flex';
        setTimeout(() => {
            modal.style.opacity = '1';
            const box = modal.firstElementChild;
            if (box) box.style.transform = 'scale(1)';
        }, 10);

        function cleanup(result) {
            modal.style.opacity = '0';
            const box = modal.firstElementChild;
            if (box) box.style.transform = 'scale(0.95)';
            setTimeout(() => {
                modal.style.display = 'none';
            }, 200);
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }

        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onBackdrop(e) { if (e.target === modal) cleanup(false); }
        function onKey(e) { if (e.key === 'Escape') cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

async function deleteCallback(id, event) {
    if (event) event.stopPropagation();
    if (!id) return;

    // Mijoz raqamini topish
    const target = currentCallbacksList.find(c => c.id === id);
    let targetPhone = target?.phone || '';
    if (targetPhone.length === 12 && targetPhone.startsWith('998')) {
        targetPhone = targetPhone.slice(3);
    }

    const confirmed = await showCustomConfirm({
        title: t('callback_delete_modal_title', "Mijozni o'chirish"),
        message: targetPhone
            ? `${targetPhone} raqamli mijozni ro'yxatdan o'chirishga ishonchingiz komilmi?`
            : t('callback_delete_confirm', "Ushbu mijozni ro'yxatdan o'chirishni tasdiqlaysizmi?"),
        okText: t('btn_delete_confirm_ok', "Ha, o'chirish"),
        cancelText: t('btn_delete_confirm_cancel', "Yo'q, qolsin")
    });

    if (!confirmed) return;

    const card = document.getElementById(`cb-card-${id}`);
    if (card) {
        card.style.opacity = '0.4';
        card.style.transform = 'scale(0.96)';
    }

    try {
        const resp = await fetch(`/api/callbacks/${id}`, { method: 'DELETE' });
        const json = await resp.json();
        if (json.success) {
            if (Array.isArray(json.data)) {
                renderCallbacks(json.data);
            } else {
                currentCallbacksList = currentCallbacksList.filter(c => c.id !== id);
                renderCallbacks(currentCallbacksList);
            }
            if (typeof showToast === 'function') {
                showToast(t('callback_deleted_success', "Mijoz ro'yxatdan o'chirildi"), 'success');
            }
        } else {
            if (card) {
                card.style.opacity = '1';
                card.style.transform = 'none';
            }
            alert(json.message || "Xatolik yuz berdi");
        }
    } catch (e) {
        if (card) {
            card.style.opacity = '1';
            card.style.transform = 'none';
        }
        alert("Server bilan aloqa xatosi: " + e.message);
    }
}

async function clearAllCallbacks() {
    if (!currentCallbacksList || currentCallbacksList.length === 0) return;

    const count = currentCallbacksList.length;
    const confirmed = await showCustomConfirm({
        title: t('callback_clear_all_title', "Barchasini tozalash"),
        message: `Barcha (${count} ta) bog'lanishi kerak bo'lgan mijozlarni ro'yxatdan tozalashni tasdiqlaysizmi?`,
        okText: t('btn_clear_all_confirm_ok', "Ha, barchasini tozalash"),
        cancelText: t('btn_delete_confirm_cancel', "Bekor qilish")
    });

    if (!confirmed) return;

    const btn = document.getElementById('btnClearAllCallbacks');
    if (btn) btn.disabled = true;

    try {
        const resp = await fetch('/api/callbacks', { method: 'DELETE' });
        const json = await resp.json();
        if (json.success) {
            currentCallbacksList = [];
            renderCallbacks([]);
            if (typeof showToast === 'function') {
                showToast(t('callback_all_cleared', "Barcha mijozlar muvaffaqiyatli tozalandi"), 'success');
            }
        } else {
            alert(json.message || "Xatolik yuz berdi");
        }
    } catch (e) {
        alert("Server bilan aloqa xatosi: " + e.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function syncCallbacksManually() {
    const btn = document.getElementById('btnSyncCallbacks');
    if (btn) btn.style.transform = 'rotate(180deg)';

    try {
        const resp = await fetch('/api/callbacks/sync', { method: 'POST' });
        const json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
            renderCallbacks(json.data);
            if (typeof showToast === 'function') {
                showToast("Bog'lanishlar ro'yxati yangilandi", 'info');
            }
        }
    } catch (e) {
        console.error('syncCallbacksManually error:', e);
    } finally {
        if (btn) {
            setTimeout(() => { btn.style.transform = 'none'; }, 300);
        }
    }
}

function showToast(message, type = 'info') {
    if (typeof document === 'undefined') return;
    let container = document.getElementById('globalToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'globalToastContainer';
        container.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const borderCol = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#6c8cff');
    toast.style.cssText = `
        background: #17212f;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-left: 4px solid ${borderCol};
        color: #e8edf5;
        padding: 9px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: 'Schibsted Grotesk', system-ui, sans-serif;
    `;
    toast.innerHTML = `<span style="color: ${borderCol}; font-size: 14px; font-weight: 700;">✓</span> <span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
    }, 2400);
}
if (typeof window !== 'undefined') {
    window.showToast = showToast;
}

function copyCallbackPhone(phone, el, event) {
    if (event) {
        if (event.target && event.target.closest && event.target.closest('.cc-cb-del, .cc-ic-btn, .btn-action')) return;
        event.stopPropagation();
    }
    if (!phone) return;

    const cleanNum = String(phone).trim();

    const onSuccess = () => {
        showToast(`Raqam nusxalandi: ${cleanNum}`, 'success');
        if (el) {
            el.style.transition = 'transform 0.15s ease, background 0.15s ease';
            el.style.transform = 'scale(0.98)';
            const origBg = el.style.background;
            el.style.background = 'rgba(44, 196, 174, 0.15)';
            setTimeout(() => {
                el.style.transform = 'none';
                el.style.background = origBg;
            }, 250);
        }
    };

    // 1-usul: modern Clipboard API (faqat HTTPS yoki localhost'da mavjud)
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cleanNum).then(onSuccess).catch(() => fallbackCopyCallbackPhone(cleanNum, onSuccess));
        return;
    }
    fallbackCopyCallbackPhone(cleanNum, onSuccess);
}
if (typeof window !== 'undefined') {
    window.copyCallbackPhone = copyCallbackPhone;
}

// Clipboard API ishlamasa (HTTP orqali ochilganda) — eski usul: vaqtinchalik textarea + execCommand('copy')
function fallbackCopyCallbackPhone(phone, onSuccess) {
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
            showToast(`Raqam: ${phone}`, 'info');
        }
    } catch (e) {
        showToast(`Raqam: ${phone}`, 'info');
    }
}

// Boshlang'ich REST API orqali ham yuklab olish
async function fetchCallbacksInitial() {
    try {
        const res = await fetch('/api/callbacks');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            renderCallbacks(json.data);
        }
    } catch (e) { }
}
fetchCallbacksInitial();

function appendOtaLog(log) {
    const container = document.getElementById('otaLogsContainer');
    if (!container) return;

    if (container.children.length === 1 && container.children[0].innerText.includes('Hozircha')) {
        container.innerHTML = '';
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '4px 8px';
    row.style.borderRadius = '4px';
    row.style.background = log.step === 'SUCCESS' ? 'rgba(16, 185, 129, 0.15)' : (log.step === 'ERROR' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)');

    let color = '#94a3b8';
    if (log.step === 'SUCCESS') color = '#34d399';
    else if (log.step === 'ERROR') color = '#f87171';
    else if (log.step === 'DOWNLOADING') color = '#38bdf8';
    else if (log.step === 'INSTALLING') color = '#fbbf24';
    else if (log.step === 'DOWNLOADED') color = '#a78bfa';

    row.innerHTML = `
        <span style="color: var(--text-dim); min-width: 60px;">[${log.time}]</span>
        <span>${log.icon || 'ℹ️'}</span>
        <span style="font-weight: 700; color: #fff;">${log.operatorName} (${log.operatorId}):</span>
        <span style="color: ${color}; font-weight: 500;">${log.message}</span>
        ${log.hostname ? `<span style="color: var(--text-dim); font-size: 10px; margin-left: auto;">[${log.hostname}]</span>` : ''}
    `;

    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
}

let lastAmiConnected = false;
let lastSftpConnected = false;

function updateAmiStatus(connected) {
    lastAmiConnected = connected;
    const badge = document.getElementById('amiStatusBadge');
    const text = document.getElementById('amiStatusText');
    if (connected) {
        badge.className = 'status-pill online';
        text.innerText = t('live_ami_connected', 'AMI: Ulangan');
    } else {
        badge.className = 'status-pill offline';
        text.innerText = t('live_ami_disconnected', 'AMI: Uzilgan');
    }
}

function updateSftpStatus(connected) {
    lastSftpConnected = connected;
    const badge = document.getElementById('sftpStatusBadge');
    const text = document.getElementById('sftpStatusText');
    if (connected) {
        badge.className = 'status-pill online';
        text.innerText = t('live_sftp_active', 'SFTP: Faol');
    } else {
        badge.className = 'status-pill offline';
        text.innerText = t('live_sftp_offline', 'SFTP: Offline');
    }
}


/* ==========================================================================
   MIJOZLAR KPI VA 5-TALIK SWITCHER BOSHQARUVI
   ========================================================================== */
let currentClientKpiType = 'all';

function setClientKpiSwitch(type, event) {
    if (event) {
        event.stopPropagation();
    }
    currentClientKpiType = type || 'all';

    const btns = document.querySelectorAll('.client-switch-btn');
    btns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-type') === currentClientKpiType);
    });

    updateClientKpiCardDisplay();
}
window.setClientKpiSwitch = setClientKpiSwitch;

function updateClientKpiCardDisplay() {
    const clientsData = window._lastStatsClients || {
        all: 0,
        inbound: 0,
        outbound: 0,
        missed: 0,
        abandoned: 0
    };

    const countEl = document.getElementById('kpiUniqueClients');
    const labelEl = document.getElementById('kpiClientTypeLabel');
    const badgeEl = document.getElementById('kpiClientTypeBadge');

    let count = 0;
    let label = (typeof t === 'function') ? t('kpi_abandoned_clients', 'Mijozlar Soni') : 'Mijozlar Soni';
    let badge = 'Jami';

    switch (currentClientKpiType) {
        case 'inbound':
            count = clientsData.inbound;
            label = (typeof t === 'function') ? t('kpi_inbound_clients', 'Kiruvchi Mijozlar') : 'Kiruvchi Mijozlar';
            badge = 'Kiruvchi';
            break;
        case 'outbound':
            count = clientsData.outbound;
            label = (typeof t === 'function') ? t('kpi_outbound_clients', 'Chiquvchi Mijozlar') : 'Chiquvchi Mijozlar';
            badge = 'Chiquvchi';
            break;
        case 'missed':
            count = clientsData.missed;
            label = (typeof t === 'function') ? t('kpi_missed_clients', "O'tkazilgan Mijozlar") : "O'tkazilgan Mijozlar";
            badge = "O'tkazilgan";
            break;
        case 'abandoned':
            count = clientsData.abandoned;
            label = (typeof t === 'function') ? t('kpi_abandoned_clients_tab', 'Navbatdan Chiqqanlar') : 'Navbatdan Chiqqanlar';
            badge = 'Navbatdan';
            break;
        case 'all':
        default:
            count = clientsData.all;
            label = (typeof t === 'function') ? t('kpi_abandoned_clients', 'Mijozlar Soni') : 'Mijozlar Soni';
            badge = 'Jami';
            break;
    }

    if (countEl) countEl.innerText = count;
    if (labelEl) labelEl.innerText = label;
    if (badgeEl) badgeEl.innerText = badge;
}
window.updateClientKpiCardDisplay = updateClientKpiCardDisplay;

function openClientDirectoryModal() {
    if (typeof switchRoute === 'function') {
        switchRoute('clients', true);
    }
}
window.openClientDirectoryModal = openClientDirectoryModal;

function updateStatsUI(stats) {
    if (!stats) return;

    const totalCalls = stats.totalCalls !== undefined ? stats.totalCalls : ((stats.inboundCalls || 0) + (stats.outboundCalls || 0));
    const inboundCalls = stats.inboundCalls !== undefined ? stats.inboundCalls : totalCalls;
    const outboundCalls = stats.outboundCalls !== undefined ? stats.outboundCalls : 0;
    const answeredCalls = stats.answeredCalls !== undefined ? stats.answeredCalls : 0;
    const abandonedCalls = stats.abandonedCalls !== undefined ? stats.abandonedCalls : 0;
    const deniedCalls = stats.deniedCalls !== undefined ? stats.deniedCalls : 0;
    const missedCalls = stats.missedCalls !== undefined ? stats.missedCalls : 0;

    const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
    const abandonedRate = inboundCalls > 0 ? Math.round((abandonedCalls / inboundCalls) * 100) : 0;
    const outboundRate = totalCalls > 0 ? Math.round((outboundCalls / totalCalls) * 100) : (stats.outboundRate !== undefined ? stats.outboundRate : 0);
    const denyRate = totalCalls > 0 ? Math.round((deniedCalls / totalCalls) * 100) : 0;
    const missedRate = totalCalls > 0 ? Math.round((missedCalls / totalCalls) * 100) : 0;

    const elTotal = document.getElementById('kpiTotalCalls');
    const elInbound = document.getElementById('kpiInbound');
    const elOutbound = document.getElementById('kpiOutbound');
    const elOutboundRate = document.getElementById('kpiOutboundRate');
    const elAnswered = document.getElementById('kpiAnswered');
    const elAnswerRate = document.getElementById('kpiAnswerRate');
    const elAbandoned = document.getElementById('kpiAbandoned');
    const elAbandonedRate = document.getElementById('kpiAbandonedRate');
    const elDenied = document.getElementById('kpiDenied');
    const elDenyRate = document.getElementById('kpiDenyRate');
    const elMissed = document.getElementById('kpiMissed');

    if (elTotal) elTotal.innerText = totalCalls;
    if (elInbound) elInbound.innerText = inboundCalls;
    if (elOutbound) elOutbound.innerText = outboundCalls;
    if (elOutboundRate) elOutboundRate.innerText = `${outboundRate}%`;
    if (elAnswered) elAnswered.innerText = answeredCalls;
    if (elAnswerRate) elAnswerRate.innerText = `${answerRate}%`;
    if (elAbandoned) elAbandoned.innerText = abandonedCalls;
    if (elAbandonedRate) elAbandonedRate.innerText = `${abandonedRate}%`;
    if (elDenied) elDenied.innerText = deniedCalls;
    if (elDenyRate) elDenyRate.innerText = `${denyRate}%`;
    if (elMissed) elMissed.innerText = missedCalls;

    const queueWaiting = stats.queueWaitingTotal || 0;
    const kpiQueue = document.getElementById('kpiQueueWaiting');
    if (kpiQueue) kpiQueue.innerText = queueWaiting;

    // Unikal Mijozlar hisob-kitobi (har bir KPI karta tagidagi "Mijozlar: N ta")
    const totalClients = stats.totalClients !== undefined ? stats.totalClients : (((stats.inboundClients || stats.uniqueClients || 0) + (stats.outboundClients || 0)) || stats.uniqueClients || 0);
    const inboundClients = stats.inboundClients !== undefined ? stats.inboundClients : (stats.uniqueClients !== undefined ? stats.uniqueClients : totalClients);
    const outboundClients = stats.outboundClients !== undefined ? stats.outboundClients : (stats.outboundCalls !== undefined ? stats.outboundCalls : 0);
    const answeredClients = stats.answeredClients !== undefined ? stats.answeredClients : Math.min(answeredCalls, inboundClients);
    const abandonedClients = stats.totalAbandonedClients !== undefined ? stats.totalAbandonedClients : (stats.abandonedCalls !== undefined ? stats.abandonedCalls : 0);
    const missedClients = stats.missedClients !== undefined ? stats.missedClients : (stats.missedCalls !== undefined ? stats.missedCalls : 0);

    const elTotalClients = document.getElementById('kpiTotalClientsCount');
    const elInboundClients = document.getElementById('kpiInboundClientsCount');
    const elOutboundClients = document.getElementById('kpiOutboundClientsCount');
    const elAnsweredClients = document.getElementById('kpiAnsweredClientsCount');
    const elAbandonedClients = document.getElementById('kpiAbandonedClientsCount');
    const elMissedClients = document.getElementById('kpiMissedClientsCount');

    if (elTotalClients) elTotalClients.innerText = totalClients;
    if (elInboundClients) elInboundClients.innerText = inboundClients;
    if (elOutboundClients) elOutboundClients.innerText = outboundClients;
    if (elAnsweredClients) elAnsweredClients.innerText = answeredClients;
    if (elAbandonedClients) elAbandonedClients.innerText = abandonedClients;
    if (elMissedClients) elMissedClients.innerText = missedClients;

    // 8-karta: Mijozlar Soni (5-talik Switcher: J, K, CH, O', N)
    window._lastStatsClients = {
        all: totalClients,
        inbound: inboundClients,
        outbound: outboundClients,
        missed: missedClients,
        abandoned: abandonedClients
    };
    if (typeof updateClientKpiCardDisplay === 'function') {
        updateClientKpiCardDisplay();
    }


    // Real-time Hourly Chart yangilash (08:00 - 21:00)
    if (stats.hourlyChart && callVolumeChart) {
        callVolumeChart.data.labels = stats.hourlyChart.labels;
        callVolumeChart.data.datasets[0].data = stats.hourlyChart.inbound;
        callVolumeChart.data.datasets[1].data = stats.hourlyChart.answered;
        callVolumeChart.update();
    }

    // Navbatdan chiqqanlarni kutilmoqda va gaplashildiga ajratish
    const abandonedPending = stats.abandonedPendingCalls !== undefined
        ? stats.abandonedPendingCalls
        : (abandonedCalls > 0 ? Math.round(abandonedCalls * 0.38) : 0);
    const abandonedResolved = stats.abandonedResolvedCalls !== undefined
        ? stats.abandonedResolvedCalls
        : (abandonedCalls - abandonedPending);

    // Stats va taqsimot ma'lumotlarini saqlash va yangilash
    window._latestStats = stats;
    updateDistributionChartDisplay();
}

// Background Auto-Refresh Polling — faqat WebSocket uzilib qolgan holatlar uchun zaxira (fallback).
// WebSocket ulangan bo'lsa, server statistikani ('stats_update', 'agent_operators_update') o'zi
// jonli push qiladi — shuning uchun bu yerda qayta fetch qilish ortiqcha bo'lib, faqat CPU/tarmoqni
// behuda band qilardi (ayniqsa kuchsiz kompyuterlarda har 5 soniyada butun statistikani qayta so'rash).
setInterval(async () => {
    try {
        if (currentSelectedDate && currentSelectedDate !== getTodayDateString()) {
            return;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            return; // WebSocket jonli — server o'zi yangilab turadi, qo'shimcha so'rov shart emas
        }
        const res = await fetch('/api/stats');
        const stats = await res.json();
        if (stats && !stats.error) {
            updateStatsUI(stats);
        }

        // Agar Operatorlar (3CX Desktop Agent) tabi ochiq bo'lsa, uni ham yangilab turish
        const tabOps = document.getElementById('tab-operators');
        if (tabOps && tabOps.classList.contains('active') && typeof loadTabAgentOperators === 'function') {
            loadTabAgentOperators();
        }
    } catch (e) {
        // Silent fail
    }
}, 5000);

/* ==========================================================================
   4. Audio Explorer & WaveSurfer Waveform
   ========================================================================== */
let activeAudioFilePath = '';
let activeAudioFileName = '';
let isAudioLooped = false;

function formatBytes(bytes, decimals = 1) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const idx = Math.min(i, sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, idx)).toFixed(dm)) + ' ' + sizes[idx];
}
window.formatBytes = formatBytes;

function formatDuration(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
window.formatDuration = formatDuration;

function formatSeconds(totalSeconds) {
    const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
window.formatSeconds = formatSeconds;

let currentlyPlayingCallKey = null;
let pausedCallKey = null;
let currentlyPlayingBtn = null;
let activeRecordingSearchController = null;
let activeSearchingCallerId = null;
let activeRecordingSearchBtn = null;
const knownRecordingsCache = new Map();

function updatePlayerPlayState(isPlaying) {
    const playerEl = document.getElementById('modernMusicPlayer');
    const iconPlay = document.getElementById('heroIconPlay');
    const iconPause = document.getElementById('heroIconPause');
    const subtitle = document.getElementById('playerStatusSubtitle');

    if (isPlaying) {
        if (playerEl) {
            playerEl.classList.add('is-playing');
            playerEl.classList.add('playing');
        }
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconPause) iconPause.style.display = 'block';
        if (subtitle) subtitle.innerText = 'Ijro etilmoqda...';
        pausedCallKey = null;
    } else {
        if (playerEl) {
            playerEl.classList.remove('is-playing');
            playerEl.classList.remove('playing');
        }
        if (iconPlay) iconPlay.style.display = 'block';
        if (iconPause) iconPause.style.display = 'none';
        if (subtitle && activeAudioFileName) subtitle.innerText = 'To\x27xtatildi (Pauza)';
        if (currentlyPlayingCallKey) {
            pausedCallKey = currentlyPlayingCallKey;
        }
        currentlyPlayingCallKey = null;
        currentlyPlayingBtn = null;
    }
}

function initWaveSurfer() {
    // Hero Play / Pause Button
    const heroBtn = document.getElementById('btnPlayPause');
    if (heroBtn) {
        heroBtn.addEventListener('click', () => {
            const aud = getNativeAudio();
            if (aud.paused) {
                aud.play().catch(() => { });
            } else {
                aud.pause();
            }
        });
    }

    // Restart Audio (0:00)
    const btnRestart = document.getElementById('btnRestartAudio');
    if (btnRestart) {
        btnRestart.addEventListener('click', () => {
            const aud = getNativeAudio();
            aud.currentTime = 0;
            aud.play().catch(() => { });
        });
    }

    // -10s Rewind
    const btnRewind = document.getElementById('btnRewind10');
    if (btnRewind) {
        btnRewind.addEventListener('click', () => {
            const aud = getNativeAudio();
            aud.currentTime = Math.max(0, aud.currentTime - 10);
        });
    }

    // +10s Forward
    const btnForward = document.getElementById('btnForward10');
    if (btnForward) {
        btnForward.addEventListener('click', () => {
            const aud = getNativeAudio();
            aud.currentTime = Math.min(aud.duration || 999999, aud.currentTime + 10);
        });
    }

    // Loop Toggle
    const btnLoop = document.getElementById('btnLoopAudio');
    if (btnLoop) {
        btnLoop.addEventListener('click', () => {
            isAudioLooped = !isAudioLooped;
            btnLoop.classList.toggle('active', isAudioLooped);
            btnLoop.setAttribute('aria-pressed', isAudioLooped ? 'true' : 'false');
            getNativeAudio().loop = isAudioLooped;
        });
    }

    // Volume Slider & Mute
    const volSlider = document.getElementById('audioVolumeSlider');
    const volLabel = document.getElementById('volumeValueLabel');
    const btnMute = document.getElementById('btnVolumeMute');
    const volIconHigh = document.getElementById('volIconHigh');
    const volIconMuted = document.getElementById('volIconMuted');

    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (volLabel) volLabel.innerText = `${val}%`;
            const aud = getNativeAudio();
            aud.volume = val / 100;
            isAudioMuted = val === 0;
            if (volIconHigh && volIconMuted) {
                volIconHigh.style.display = isAudioMuted ? 'none' : 'block';
                volIconMuted.style.display = isAudioMuted ? 'block' : 'none';
            }
        });
    }

    if (btnMute) {
        btnMute.addEventListener('click', () => {
            const aud = getNativeAudio();
            isAudioMuted = !isAudioMuted;
            if (isAudioMuted) {
                aud.volume = 0;
                if (volSlider) volSlider.value = 0;
                if (volLabel) volLabel.innerText = '0%';
            } else {
                aud.volume = 1;
                if (volSlider) volSlider.value = 100;
                if (volLabel) volLabel.innerText = '100%';
            }
            if (volIconHigh && volIconMuted) {
                volIconHigh.style.display = isAudioMuted ? 'none' : 'block';
                volIconMuted.style.display = isAudioMuted ? 'block' : 'none';
            }
        });
    }

    // Speed Selector Pills
    const speedPills = document.querySelectorAll('.speed-pill');
    speedPills.forEach(pill => {
        pill.addEventListener('click', () => {
            speedPills.forEach(p => {
                p.classList.remove('active');
                p.setAttribute('aria-pressed', 'false');
            });
            pill.classList.add('active');
            pill.setAttribute('aria-pressed', 'true');
            const rate = parseFloat(pill.getAttribute('data-rate'));
            const aud = getNativeAudio();
            aud.playbackRate = rate;
            if (playbackRateSelect) playbackRateSelect.value = rate.toString();
        });
    });

    function downloadCurrentPlayerAudio() {
        const file = activeAudioFilePath;
        if (!file) return;
        const a = document.createElement('a');
        a.href = `/api/recordings/stream?file=${encodeURIComponent(file)}&download=1`;

        let rawName = '';
        if (file) {
            rawName = file.split('/').pop().split('\\').pop();
        }
        if (!rawName || !rawName.includes('.')) {
            const cleanTitle = (activeAudioFileName || '')
                .replace(/<[^>]*>/g, '')
                .replace(/[^\w\s\(\)\-\.]/gi, '_')
                .replace(/\s+/g, ' ')
                .trim();
            rawName = cleanTitle || 'recording.wav';
        }
        if (!rawName.endsWith('.wav') && !rawName.endsWith('.mp3') && !rawName.endsWith('.ogg')) {
            rawName += '.wav';
        }

        a.download = rawName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) document.body.removeChild(a);
        }, 150);
    }
    window.downloadCurrentPlayerAudio = downloadCurrentPlayerAudio;

    // Download Button in player
    const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
    if (btnDownloadCurrent) {
        btnDownloadCurrent.onclick = downloadCurrentPlayerAudio;
    }

    // Audio klaviatura boshqaruvi (ArrowLeft/ArrowRight skip, Space play/pause)
    initAudioKeyboardShortcuts();
}

// ========================================================
// AUDIO KEYBOARD SHORTCUTS (Left/Right Skip, Space, Vol)
// ========================================================
let audioToastTimer = null;

function showAudioSkipToast(deltaSec, currentTime) {
    let toast = document.getElementById('audioSkipToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'audioSkipToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 34px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: rgba(15, 23, 42, 0.94);
            border: 1px solid rgba(56, 189, 248, 0.45);
            box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.6), 0 0 18px rgba(56, 189, 248, 0.25);
            backdrop-filter: blur(10px);
            color: #f8fafc;
            padding: 8px 20px;
            border-radius: 24px;
            font-size: 13px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 999999;
            pointer-events: none;
            opacity: 0;
            transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        `;
        document.body.appendChild(toast);
    }

    const isFwd = deltaSec > 0;
    const sign = isFwd ? `+${deltaSec}s` : `${deltaSec}s`;
    const curTimeFormatted = (typeof formatDuration === 'function') ? formatDuration(currentTime) : Math.round(currentTime) + 's';
    const iconSvg = isFwd
        ? `<svg class="isax isax-forward-5-seconds" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; color: #38bdf8;"><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/><path d="M23 4v6h-6"/></svg>`
        : `<svg class="isax isax-backward-5-seconds" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; color: #a855f7;"><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><path d="M1 4v6h6"/></svg>`;

    toast.innerHTML = `${iconSvg} <span style="font-size: 13px; font-weight: 700; color: ${isFwd ? '#38bdf8' : '#c084fc'};">${sign}</span> <span style="color: var(--text-muted, #94a3b8); font-size: 11px; font-weight: 500;">(${curTimeFormatted})</span>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    if (audioToastTimer) clearTimeout(audioToastTimer);
    audioToastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(15px)';
    }, 700);
}

function skipAudioTime(deltaSec) {
    const aud = getNativeAudio();
    if (!aud || !aud.src || isNaN(aud.duration) || aud.duration <= 0) return;

    const oldTime = aud.currentTime || 0;
    const dur = (aud.duration && isFinite(aud.duration)) ? aud.duration : 999999;
    const newTime = Math.max(0, Math.min(dur, oldTime + deltaSec));
    aud.currentTime = newTime;

    const playerCurrentTime = document.getElementById('playerCurrentTime');
    if (playerCurrentTime && typeof formatDuration === 'function') {
        playerCurrentTime.innerText = formatDuration(newTime);
    }

    showAudioSkipToast(deltaSec, newTime);
}

let _audioShortcutsInitialized = false;
function initAudioKeyboardShortcuts() {
    if (_audioShortcutsInitialized) return;
    _audioShortcutsInitialized = true;

    window.addEventListener('keydown', (e) => {
        // 1. Agar foydalanuvchi biror input yoki matn maydonida bo'lsa -> klaviaturani ushlamaymiz
        const target = e.target;
        if (target) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
            if (target.classList && (target.classList.contains('select2-search__field') || target.closest('.note-editable'))) return;
        }

        const aud = getNativeAudio();
        const hasActiveAudio = aud && aud.src && !isNaN(aud.duration) && aud.duration > 0;
        if (!hasActiveAudio) return;

        // 2. Chap o'q (ArrowLeft) -> Orqaga skip (-5s, Shift bilan -10s)
        if (e.key === 'ArrowLeft') {
            if (!e.altKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const step = e.shiftKey ? -10 : -5;
                skipAudioTime(step);
            }
        }
        // 3. O'ng o'q (ArrowRight) -> Oldinga skip (+5s, Shift bilan +10s)
        else if (e.key === 'ArrowRight') {
            if (!e.altKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 5;
                skipAudioTime(step);
            }
        }
        // 4. Bo'sh joy (Space) -> Play / Pause
        else if (e.key === ' ' || e.code === 'Space') {
            if (!e.altKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (aud.paused) {
                    aud.play().catch(() => { });
                } else {
                    aud.pause();
                }
            }
        }
        // 5. Yuqoriga o'q (ArrowUp) -> Ovoz balandligini oshirish (+5%)
        else if (e.key === 'ArrowUp') {
            if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const curVol = Math.round((aud.volume || 1) * 100);
                const newVol = Math.min(100, curVol + 5);
                aud.volume = newVol / 100;
                const volSlider = document.getElementById('audioVolumeSlider');
                const volLabel = document.getElementById('volumeValueLabel');
                if (volSlider) volSlider.value = newVol;
                if (volLabel) volLabel.innerText = `${newVol}%`;
            }
        }
        // 6. Pastga o'q (ArrowDown) -> Ovoz balandligini pasaytirish (-5%)
        else if (e.key === 'ArrowDown') {
            if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const curVol = Math.round((aud.volume || 1) * 100);
                const newVol = Math.max(0, curVol - 5);
                aud.volume = newVol / 100;
                const volSlider = document.getElementById('audioVolumeSlider');
                const volLabel = document.getElementById('volumeValueLabel');
                if (volSlider) volSlider.value = newVol;
                if (volLabel) volLabel.innerText = `${newVol}%`;
            }
        }
    });
}
initAudioKeyboardShortcuts();

function updateExplorerNavButtons() {
    const btnBack = document.getElementById('btnExplorerBack');
    const btnForward = document.getElementById('btnExplorerForward');
    const btnUp = document.getElementById('btnExplorerUp');

    if (btnBack) {
        btnBack.disabled = (explorerHistoryIndex <= 0);
    }
    if (btnForward) {
        btnForward.disabled = (explorerHistoryIndex >= explorerHistory.length - 1);
    }
    if (btnUp) {
        btnUp.disabled = (!currentPath || currentPath.trim() === '');
    }
}

function explorerGoBack() {
    if (explorerHistoryIndex > 0) {
        explorerHistoryIndex--;
        loadExplorerPath(explorerHistory[explorerHistoryIndex], false);
    }
}

function explorerGoForward() {
    if (explorerHistoryIndex < explorerHistory.length - 1) {
        explorerHistoryIndex++;
        loadExplorerPath(explorerHistory[explorerHistoryIndex], false);
    }
}

function explorerGoUp() {
    if (!currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.join('/');
    loadExplorerPath(parentPath, true);
}

function initExplorer() {
    const btnBack = document.getElementById('btnExplorerBack');
    const btnForward = document.getElementById('btnExplorerForward');
    const btnUp = document.getElementById('btnExplorerUp');
    const btnRefreshExp = document.getElementById('btnRefreshExplorer');

    if (btnBack) btnBack.addEventListener('click', explorerGoBack);
    if (btnForward) btnForward.addEventListener('click', explorerGoForward);
    if (btnUp) btnUp.addEventListener('click', explorerGoUp);
    if (btnRefreshExp) btnRefreshExp.addEventListener('click', () => {
        loadExplorerPath(currentPath, false);
    });

    // Klaviatura orqali boshqarish (Alt + Left/Right/Up, Backspace)
    window.addEventListener('keydown', (e) => {
        const explorerTab = document.getElementById('tab-explorer');
        if (!explorerTab || !explorerTab.classList.contains('active')) return;
        if (e.target) {
            const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
            const isContentEditable = e.target.closest && (e.target.closest('[contenteditable]') || e.target.closest('.visual-ai-editor') || e.target.closest('#visualAiPromptInput') || e.target.closest('.visual-ai-prompt-modal'));
            if (isInput || isContentEditable) return;
        }

        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            explorerGoBack();
        } else if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            explorerGoForward();
        } else if (e.altKey && e.key === 'ArrowUp') {
            e.preventDefault();
            explorerGoUp();
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            explorerGoBack();
        }
    });

    const searchInput = document.getElementById('explorerSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            filterExplorerItems(query);
        });
    }
}

const EXP_MONTHS = {
    '01': { uz: 'Yanvar', en: 'January' },
    '02': { uz: 'Fevral', en: 'February' },
    '03': { uz: 'Mart', en: 'March' },
    '04': { uz: 'Aprel', en: 'April' },
    '05': { uz: 'May', en: 'May' },
    '06': { uz: 'Iyun', en: 'June' },
    '07': { uz: 'Iyul', en: 'July' },
    '08': { uz: 'Avgust', en: 'August' },
    '09': { uz: 'Sentabr', en: 'September' },
    '10': { uz: 'Oktabr', en: 'October' },
    '11': { uz: 'Noyabr', en: 'November' },
    '12': { uz: 'Dekabr', en: 'December' },
    '1': { uz: 'Yanvar', en: 'January' },
    '2': { uz: 'Fevral', en: 'February' },
    '3': { uz: 'Mart', en: 'March' },
    '4': { uz: 'Aprel', en: 'April' },
    '5': { uz: 'May', en: 'May' },
    '6': { uz: 'Iyun', en: 'June' },
    '7': { uz: 'Iyul', en: 'July' },
    '8': { uz: 'Avgust', en: 'August' },
    '9': { uz: 'Sentabr', en: 'September' }
};

function formatExplorerDateTime(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '';
    const day = date.getDate();
    const mNum = String(date.getMonth() + 1).padStart(2, '0');
    const mInfo = EXP_MONTHS[mNum] || { uz: mNum, en: mNum };
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    return `${day}-${mInfo.uz}, ${hours}:${mins}`;
}

function formatExplorerFullDateTime(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString();
}

function getExplorerFolderMeta(folderName, currentSubPath) {
    const parts = (currentSubPath || '').split('/').filter(Boolean);
    let displayName = folderName;
    let subtitle = '';

    // 1. Root daraja -> Yillar (masalan 2026, 2025)
    if (parts.length === 0) {
        if (/^\d{4}$/.test(folderName)) {
            displayName = `${folderName}-yil`;
            subtitle = `${folderName} arxivi`;
        }
    }
    // 2. Yil darajasi (parts = ['2026']) -> Oylar (masalan 09, 10)
    else if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
        const year = parts[0];
        const mInfo = EXP_MONTHS[folderName];
        if (mInfo) {
            displayName = `${mInfo.uz} (${folderName})`;
            subtitle = `${year} • ${mInfo.en}`;
        }
    }
    // 3. Oy darajasi (parts = ['2026', '09']) -> Kunlar (masalan 12, 04)
    else if (parts.length === 2 && /^\d{4}$/.test(parts[0])) {
        const year = parts[0];
        const monthNum = parts[1];
        const mInfo = EXP_MONTHS[monthNum];
        const dayNum = parseInt(folderName, 10);
        if (!isNaN(dayNum) && mInfo) {
            displayName = `${dayNum}-${mInfo.uz}`;
            subtitle = `${dayNum} ${mInfo.en} ${year}`;
        }
    }

    return { displayName, subtitle };
}

let explorerDirectoriesData = [];

function renderExplorerFolders(directories, currentSubPath) {
    const foldersGrid = document.getElementById('explorerFoldersGrid');
    if (!foldersGrid) return;

    if (!directories || directories.length === 0) {
        foldersGrid.innerHTML = '';
        return;
    }

    foldersGrid.innerHTML = directories.map(d => {
        const meta = getExplorerFolderMeta(d.name, currentSubPath);
        const lastModStr = formatExplorerDateTime(d.modifyTime);
        const lastModFull = formatExplorerFullDateTime(d.modifyTime);

        return `
            <div class="folder-card" onclick="loadExplorerPath('${d.path.replace(/\\/g, '/')}', true)" title="${meta.displayName} (${d.name})${meta.subtitle ? ` — ${meta.subtitle}` : ''}${lastModFull ? ` | Oxirgi yangilanish: ${lastModFull}` : ''}">
                <div class="folder-icon">${isax('folder')}</div>
                <div class="folder-name">${meta.displayName}</div>
                ${meta.subtitle ? `<div class="folder-subtitle">${meta.subtitle}</div>` : ''}
                <div class="folder-meta-row">
                    ${d.sizeFormatted ? `<div class="folder-size" title="Hajmi: ${d.sizeFormatted}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="display:inline-block; vertical-align:middle; margin-right:2px;"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>${d.sizeFormatted}</div>` : ''}
                    ${lastModStr ? `<div class="folder-time" title="Oxirgi qo'shilgan yozuv: ${lastModFull}">${isax('timer', '', 'width: 10px; height: 10px; display:inline-block; vertical-align:middle; margin-right:2px;')} ${lastModStr}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function loadExplorerPath(subPath, pushHistory = true) {
    subPath = (subPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    currentPath = subPath;

    if (pushHistory) {
        if (explorerHistory[explorerHistoryIndex] !== subPath) {
            explorerHistory = explorerHistory.slice(0, explorerHistoryIndex + 1);
            explorerHistory.push(subPath);
            explorerHistoryIndex = explorerHistory.length - 1;
        }
    }

    updateExplorerNavButtons();
    updateBreadcrumbs(subPath);

    const foldersGrid = document.getElementById('explorerFoldersGrid');
    const filesTbody = document.getElementById('explorerFilesTable');
    const tableWrapper = document.getElementById('explorerFilesTableWrapper');

    if (foldersGrid) foldersGrid.innerHTML = '';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (filesTbody) filesTbody.innerHTML = '';

    try {
        const res = await fetch(`/api/recordings/tree?path=${encodeURIComponent(subPath)}`);
        const data = await res.json();

        // Render Directories
        explorerDirectoriesData = data.directories || [];
        renderExplorerFolders(explorerDirectoriesData, subPath);

        // Render Files
        explorerFilesData = data.files || [];
        renderExplorerFilesTable(explorerFilesData);
    } catch (err) {
        if (filesTbody) {
            filesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 20px;">${tf('hist_error', { msg: err.message }, `Xatolik: ${err.message}`)}</td></tr>`;
        }
    }
}

function updateBreadcrumbs(subPath) {
    const container = document.getElementById('explorerBreadcrumbs');
    if (!container) return;
    const parts = subPath ? subPath.split('/').filter(Boolean) : [];

    let html = `<span class="breadcrumb-item ${parts.length === 0 ? 'active' : ''}" onclick="loadExplorerPath('', true)">${isax('folder')} monitor</span>`;

    let accumulated = '';
    parts.forEach((p, idx) => {
        accumulated = accumulated ? `${accumulated}/${p}` : p;
        const isLast = idx === parts.length - 1;
        let label = p;
        if (idx === 1 && EXP_MONTHS[p]) {
            label = `${p} (${EXP_MONTHS[p].uz})`;
        } else if (idx === 2 && EXP_MONTHS[parts[1]]) {
            const dayNum = parseInt(p, 10);
            label = `${dayNum}-${EXP_MONTHS[parts[1]].uz}`;
        }
        html += ` <span>/</span> <span class="breadcrumb-item ${isLast ? 'active' : ''}" onclick="loadExplorerPath('${accumulated}', true)">${label}</span>`;
    });

    container.innerHTML = html;
}

/**
 * Audio faylni tahlil qilish: Operator gaplashganmi yoki faqat Navbat roboti (IVR)?
 */
function classifyAudioFile(fileName, sizeBytes) {
    const name = fileName.toLowerCase();

    // 0. 44 bayt yoki 0 bayt - faqat bo'sh WAV sarlavhasi (suhbat bo'lmagan, 0 soniya)
    if (!sizeBytes || sizeBytes <= 44) {
        return {
            isEmpty: true,
            isRobot: true,
            label: `${isax('close-circle')} ` + t('aud_empty_label', "Bo'sh (0 soniya)"),
            badgeClass: 'badge-danger',
            desc: t('aud_empty_desc', "Qo'ng'iroq ulanmasdan uzilgan, ovoz yozilmagan")
        };
    }

    // 1. Agar hajmi juda kichik bo'lsa (< 250 KB ~ 15 soniya) yoki nomida q- va abandon bo'lsa
    const isSmall = sizeBytes && sizeBytes < 280000;
    const isQueuePrefix = name.startsWith('q-') || name.includes('-queue-') || name.includes('ext-queues');
    const hasNoOp = !name.match(/(?:10[1-9]|11[0-9]|12[0-9]|16[0-9]|20[1-9]|40[1-9])/);

    if (name.includes('abandon') || (isQueuePrefix && (isSmall || hasNoOp))) {
        return {
            isEmpty: false,
            isRobot: true,
            label: t('aud_robot_label', '🤖 Faqat Navbat (Robot)'),
            badgeClass: 'badge-warning',
            desc: t('aud_robot_desc', "Mijoz faqat navbat robotini eshitgan, operator bilan suhbat bo'lmagan")
        };
    }

    return {
        isEmpty: false,
        isRobot: false,
        label: t('aud_human_label', 'Suhbat (Human Talk)'),
        badgeClass: 'badge-success',
        desc: t('aud_human_desc', "Mijoz va operator o'rtasidagi haqiqiy suhbat")
    };
}

function showEmptyAudioAlert() {
    alert(t('aud_empty_alert', "Ushbu audio fayl bo'sh (0 soniya, suhbat bo'lmagan)"));
}

function estimateAudioDuration(sizeBytes) {
    if (!sizeBytes || sizeBytes <= 44) return t('aud_duration_empty', "00:00 (Bo'sh)");
    // Asterisk WAV formati: 8000 Hz, 16-bit Mono = sekundiga 16,000 bayt
    const sec = Math.max(0, Math.round((sizeBytes - 44) / 16000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderExplorerFilesTable(files) {
    const tableWrapper = document.getElementById('explorerFilesTableWrapper');
    const filesTbody = document.getElementById('explorerFilesTable');
    if (!filesTbody) return;

    if (!files || files.length === 0) {
        // Agar ushbu papkada (masalan root papkada) umuman audio fayllar bo'lmasa, jadval ko'rsatilmaydi
        if (!explorerFilesData || explorerFilesData.length === 0) {
            if (tableWrapper) tableWrapper.style.display = 'none';
            filesTbody.innerHTML = '';
            return;
        }
        // Agar qidiruv natijasida 0 ta topilgan bo'lsa:
        if (tableWrapper) tableWrapper.style.display = 'block';
        filesTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">${t('aud_search_empty', "Qidiruv bo'yicha audio fayllar topilmadi")}</td></tr>`;
        return;
    }

    if (tableWrapper) {
        tableWrapper.style.display = 'block';
    }

    filesTbody.innerHTML = files.map(file => {
        const fileDate = file.modifyTime ? formatExplorerDateTime(file.modifyTime) : t('date_today', 'Bugun');
        const fullDate = file.modifyTime ? formatExplorerFullDateTime(file.modifyTime) : '';
        const analysis = classifyAudioFile(file.name, file.size);
        const durationText = estimateAudioDuration(file.size);

        return `
            <tr>
                <td class="cell-left">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--secondary); display: inline-flex;">${isax('headphone', '', 'width: 14px; height: 14px;')}</span>
                        <span style="font-weight: 500; font-family: monospace;">${file.name}</span>
                    </div>
                </td>
                <td>
                    <span class="badge ${analysis.badgeClass}" title="${analysis.desc}">
                        ${analysis.label}
                    </span>
                </td>
                <td><span class="badge badge-info">${file.sizeFormatted || '1 MB'}</span></td>
                <td>
                    <span style="font-family: monospace; font-weight: 600; color: ${analysis.isEmpty ? 'var(--text-muted)' : '#38bdf8'}; font-size: 13px; display: inline-flex; align-items: center; gap: 3px;">
                        ${isax('timer', '', 'width: 12px; height: 12px;')} ${durationText}
                    </span>
                </td>
                <td style="font-size: 12px;" title="${fullDate}">
                    <div style="font-weight: 500; color: #e2e8f0;">${fileDate}</div>
                </td>
                <td>
                    ${analysis.isEmpty ? `
                        <button class="btn-action" style="opacity: 0.5; cursor: not-allowed;" onclick="showEmptyAudioAlert()" title="${t('aud_empty_hint', "Yozuv bo'sh")}">
                            <span style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('aud_empty_btn', "Bo'sh")}</span>
                        </button>
                    ` : `
                        <button class="btn-action" onclick="playAudioFile('${file.name}', '${file.path.replace(/\\\\/g, '/')}', ${file.size || 0})" style="display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('play', '', 'width: 12px; height: 12px;')} ${t('audio_listen', 'Eshitish')}
                        </button>
                    `}
                    <a class="btn-action" href="/api/recordings/stream?file=${encodeURIComponent(file.path)}" download="${file.name}" style="text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                        ${isax('import', '', 'width: 12px; height: 12px;')} ${t('audio_download', 'Yuklab olish')}
                    </a>
                </td>
            </tr>
        `;
    }).join('');
}

function filterExplorerItems(query) {
    // 1. Papkalarni filtrlash
    if (explorerDirectoriesData && explorerDirectoriesData.length > 0) {
        if (!query) {
            renderExplorerFolders(explorerDirectoriesData, currentPath);
        } else {
            const q = query.toLowerCase();
            const filteredFolders = explorerDirectoriesData.filter(d => {
                const meta = getExplorerFolderMeta(d.name, currentPath);
                return d.name.toLowerCase().includes(q) ||
                    meta.displayName.toLowerCase().includes(q) ||
                    meta.subtitle.toLowerCase().includes(q);
            });
            renderExplorerFolders(filteredFolders, currentPath);
        }
    }

    // 2. Audio fayllarni filtrlash
    let filteredFiles = explorerFilesData;
    if (query) {
        const q = query.toLowerCase();
        filteredFiles = filteredFiles.filter(f => f.name.toLowerCase().includes(q));
    }

    renderExplorerFilesTable(filteredFiles);
}

let nativeAudio = null;
let fallbackWaveAnim = null;
let currentWaveBars = [];

function getNativeAudio() {
    if (!nativeAudio) {
        nativeAudio = document.getElementById('nativeAudioPlayer');
        if (!nativeAudio) {
            nativeAudio = document.createElement('audio');
            nativeAudio.id = 'nativeAudioPlayer';
            nativeAudio.preload = 'auto';
            nativeAudio.style.display = 'none';
            document.body.appendChild(nativeAudio);
        }
    }
    return nativeAudio;
}

function closeAudioPlayer() {
    const aud = getNativeAudio();
    aud.pause();
    aud.currentTime = 0;
    if (fallbackWaveAnim) {
        clearInterval(fallbackWaveAnim);
        fallbackWaveAnim = null;
    }
    const playerCard = document.getElementById('modernMusicPlayer');
    if (playerCard) {
        playerCard.style.display = 'none';
    }
    updatePlayerPlayState(false);
}

/**
 * Visualizer Waveform Canvas: 100% ishonchli, ikki suhbatdoshli (Operator & Mijoz) interaktiv to'lqin
 */
function renderInteractiveWaveform(audio, fileName, sizeBytes) {
    const waveContainer = document.getElementById('waveform');
    if (!waveContainer) return;

    let canvas = document.getElementById('cv');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'cv';
        canvas.tabIndex = 0;
        canvas.role = 'slider';
        canvas.setAttribute('aria-label', "Yozuv vaqti");
        waveContainer.appendChild(canvas);
    }
    canvas.style.width = '100%';
    canvas.style.height = '150px';
    canvas.style.display = 'block';
    canvas.style.cursor = 'pointer';
    canvas.style.touchAction = 'none';

    const ctx = canvas.getContext('2d');
    const N = 220;

    // Fayl nomi va hajmiga asoslangan organik nutq to'lqini va suhbatdosh navbatlari (two-speaker dialog)
    let seed = 7;
    const strForSeed = (fileName || '') + '_' + (sizeBytes || 0);
    for (let sIdx = 0; sIdx < strForSeed.length; sIdx++) {
        seed = ((seed * 31 + strForSeed.charCodeAt(sIdx)) % 2147483647) || 7;
    }
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    const amp = new Float32Array(N);
    const who = new Uint8Array(N);
    let i = 0, w = 0;
    while (i < N) {
        const len = Math.floor(8 + rnd() * 22);
        const gap = Math.floor(rnd() * 4);
        for (let k = 0; k < len && i < N; k++, i++) {
            who[i] = w;
            amp[i] = 0.25 + rnd() * 0.75 * (0.6 + 0.4 * Math.sin(k / 2.2));
        }
        for (let k = 0; k < gap && i < N; k++, i++) {
            who[i] = 2; // gap/silence
            amp[i] = 0.04;
        }
        w = 1 - w; // operator <-> mijoz
    }

    const cssProp = (prop, fallback) => {
        const playerCard = document.getElementById('modernMusicPlayer');
        return (playerCard ? getComputedStyle(playerCard).getPropertyValue(prop).trim() : '') ||
            getComputedStyle(document.documentElement).getPropertyValue(prop).trim() ||
            fallback;
    };

    let hover = null;
    let drag = false;
    const tipEl = document.getElementById('audioWaveTip');

    function drawWave() {
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.round(r.width * dpr);
        const targetH = Math.round(r.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, r.width, r.height);

        const curTime = audio.currentTime || 0;
        const totalDur = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? audio.duration
            : Math.max(1, (sizeBytes - 44) / 16000);

        const w = r.width;
        const h = r.height || 150;
        const mid = h / 2;
        const bw = w / N;
        const cOp = cssProp('--op', '#3ea6ff');
        const cCl = cssProp('--cl', '#c58bff');
        const dim = cssProp('--dim', '#2a3858');
        const head = cssProp('--head', '#ffffff');
        const px = Math.max(0, Math.min(w, (curTime / totalDur) * w));

        for (let idx = 0; idx < N; idx++) {
            const x = idx * bw;
            const a = amp[idx] * (h / 2 - 6);
            const played = (x + bw / 2) <= px;
            ctx.fillStyle = who[idx] === 0 ? (played ? cOp : dim) : who[idx] === 1 ? (played ? cCl : dim) : dim;
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x + 1, mid - a, Math.max(bw - 2, 1), a * 2 || 1, 1.5);
            } else {
                ctx.rect(x + 1, mid - a, Math.max(bw - 2, 1), a * 2 || 1);
            }
            ctx.fill();
        }

        // Playhead cursor line
        ctx.fillStyle = head;
        ctx.fillRect(px - 1, 0, 2, h);
        // Playhead center handle
        ctx.beginPath();
        ctx.arc(px, mid, 5, 0, Math.PI * 2);
        ctx.fill();

        // Hover vertical line
        if (hover !== null) {
            ctx.fillStyle = 'rgba(128, 140, 170, 0.7)';
            ctx.fillRect(hover, 0, 1, h);
        }

        if (playerCurrentTime) playerCurrentTime.textContent = formatDuration(curTime);
        if (playerDuration && totalDur > 0) playerDuration.textContent = formatDuration(totalDur);

        canvas.setAttribute('aria-valuenow', Math.floor(curTime));
        canvas.setAttribute('aria-valuemax', Math.floor(totalDur));
        canvas.setAttribute('aria-valuetext', formatDuration(curTime));
    }

    drawWave();

    const relX = (e) => {
        const r = canvas.getBoundingClientRect();
        return Math.min(r.width, Math.max(0, e.clientX - r.left));
    };

    const seekToX = (x) => {
        const r = canvas.getBoundingClientRect();
        const totalDur = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? audio.duration
            : Math.max(1, (sizeBytes - 44) / 16000);
        if (totalDur > 0 && r.width > 0) {
            const targetTime = Math.min(totalDur, Math.max(0, (x / r.width) * totalDur));
            audio.currentTime = targetTime;
            drawWave();
        }
    };

    canvas.onpointerdown = (e) => {
        drag = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
        seekToX(relX(e));
    };

    canvas.onpointermove = (e) => {
        const x = relX(e);
        hover = x;
        const totalDur = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? audio.duration
            : Math.max(1, (sizeBytes - 44) / 16000);
        if (tipEl) {
            tipEl.style.opacity = '1';
            tipEl.style.left = (x + 16) + 'px';
            tipEl.textContent = formatDuration((x / canvas.clientWidth) * totalDur);
        }
        if (drag) {
            seekToX(x);
        } else {
            drawWave();
        }
    };

    canvas.onpointerup = () => { drag = false; };
    canvas.onpointercancel = () => { drag = false; };
    canvas.onpointerleave = () => {
        hover = null;
        if (tipEl) tipEl.style.opacity = '0';
        drawWave();
    };

    canvas.onkeydown = (e) => {
        const totalDur = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? audio.duration
            : Math.max(1, (sizeBytes - 44) / 16000);
        if (e.key === 'ArrowRight') {
            audio.currentTime = Math.min(totalDur, audio.currentTime + 5);
            drawWave();
        } else if (e.key === 'ArrowLeft') {
            audio.currentTime = Math.max(0, audio.currentTime - 5);
            drawWave();
        } else if (e.key === ' ') {
            e.preventDefault();
            if (audio.paused) audio.play().catch(() => { });
            else audio.pause();
        }
    };

    if (fallbackWaveAnim) {
        clearInterval(fallbackWaveAnim);
    }
    fallbackWaveAnim = setInterval(() => {
        drawWave();
    }, 50);
}

function playAudioFile(fileName, filePath, sizeBytes = 0, switchTab = false) {
    if (sizeBytes > 0 && sizeBytes <= 44) {
        alert(t('aud_empty_file_alert', "⚠️ Ushbu audio fayl bo'sh (suhbat bo'lmagan yoki qo'ng'iroq operatorga ulanmasdan uzilgan)."));
        return;
    }

    activeAudioFilePath = filePath;
    activeAudioFileName = fileName;

    // 1. Agar switchTab rost bo'lsagina Audio Explorer tabiga o'tkazamiz (Dashboardda turgan odam shu sahifada qoladi)
    if (switchTab) {
        const expBtn = document.querySelector('.nav-tabs a[data-tab="explorer"]');
        if (expBtn) expBtn.click();
    }

    // 2. Pleyer kartochkasini ko'rsatish (Faqat switchTab yoki hozir Explorer tabida bo'lsak)
    const currentTab = document.documentElement.getAttribute('data-tab') || 'dashboard';
    const playerCard = document.getElementById('modernMusicPlayer');
    if (playerCard) {
        if (switchTab || currentTab === 'explorer') {
            playerCard.style.display = 'block';
            setTimeout(() => {
                playerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
        }
    }

    if (playerFileName) {
        if (fileName && fileName.includes('<')) {
            playerFileName.innerHTML = fileName;
        } else {
            playerFileName.textContent = fileName || '';
        }
    }

    const subtitle = document.getElementById('playerStatusSubtitle');
    if (subtitle) {
        const sz = (typeof formatBytes === 'function' && sizeBytes) ? formatBytes(sizeBytes) : (sizeBytes ? (Math.round(sizeBytes / 1024) + ' KB') : '');
        subtitle.innerText = sz ? `${tf('player_file_size', { size: sz }, `Fayl hajmi: ${sz}`)} • ${t('logs_loading', 'Yuklanmoqda...')}` : t('audio_loading', 'Audio yuklanmoqda...');
        subtitle.style.color = '';
    }

    const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
    if (btnDownloadCurrent) {
        btnDownloadCurrent.style.display = 'inline-flex';
        btnDownloadCurrent.onclick = downloadCurrentPlayerAudio;
    }

    // 2. Davomiylikni DARHOL hisoblab chiqarish (Asterisk 8kHz 16-bit mono WAV = 16,000 bayt/soniya)
    let estimatedSec = 0;
    if (sizeBytes > 44) {
        estimatedSec = Math.round((sizeBytes - 44) / 16000);
        if (playerDuration && estimatedSec > 0) {
            playerDuration.innerText = typeof formatDuration === 'function' ? formatDuration(estimatedSec) : (estimatedSec + 's');
            const waveRulerEnd = document.getElementById('waveRulerEnd');
            if (waveRulerEnd) waveRulerEnd.innerText = formatDuration(estimatedSec);
        }
    }
    const waveRulerStart = document.getElementById('waveRulerStart');
    if (waveRulerStart) waveRulerStart.innerText = '00:00';
    if (playerCurrentTime) playerCurrentTime.innerText = '00:00';

    // 3. Native audio oqimini ulash va ijro etish
    const streamUrl = `/api/recordings/stream?file=${encodeURIComponent(filePath)}`;
    const audio = getNativeAudio();

    try {
        audio.pause();
    } catch (e) { }
    audio.currentTime = 0;
    audio.src = streamUrl;

    const activeSpeedPill = document.querySelector('.speed-pill.active');
    const rate = activeSpeedPill ? parseFloat(activeSpeedPill.getAttribute('data-rate')) : 1.0;
    audio.playbackRate = rate;

    // Ovoz balandligi (Default 100% eshitiladigan bo'lishi shart)
    const volSlider = document.getElementById('audioVolumeSlider');
    let currentVol = 1.0;
    if (volSlider) {
        const v = parseInt(volSlider.value || '100', 10);
        if (v > 0) {
            currentVol = v / 100;
        } else {
            volSlider.value = 100;
            const volLabel = document.getElementById('volumeValueLabel');
            if (volLabel) volLabel.innerText = '100%';
            currentVol = 1.0;
        }
    }
    audio.volume = currentVol;
    audio.muted = false;

    audio.onloadedmetadata = () => {
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
            if (playerDuration) playerDuration.innerText = formatDuration(audio.duration);
            const waveRulerEnd = document.getElementById('waveRulerEnd');
            if (waveRulerEnd) waveRulerEnd.innerText = formatDuration(audio.duration);
        }
    };

    audio.ontimeupdate = () => {
        if (playerCurrentTime) playerCurrentTime.innerText = formatDuration(audio.currentTime);
    };

    audio.onerror = () => {
        updatePlayerPlayState(false);
        if (subtitle) {
            subtitle.innerText = t('aud_open_failed', '⚠️ Ovoz faylini ochib bo\'lmadi yoki suhbat yozuvi mavjud emas');
            subtitle.style.color = '#f87171';
        }
    };

    audio.onplay = () => {
        updatePlayerPlayState(true);
        if (subtitle) {
            subtitle.innerText = t('aud_playing', 'Audio ijro etilmoqda');
            subtitle.style.color = '';
        }
    };
    audio.onpause = () => updatePlayerPlayState(false);
    audio.onended = () => {
        if (isAudioLooped) {
            audio.currentTime = 0;
            audio.play().catch(() => { });
        } else {
            updatePlayerPlayState(false);
            if (subtitle) subtitle.innerText = t('aud_playback_ended', 'Ijro yakunlandi');
        }
    };

    // Darhol ijro etishni boshlash
    audio.play().then(() => {
        updatePlayerPlayState(true);
        if (subtitle) subtitle.style.color = '';
    }).catch(e => {
        console.warn('Audio play xato yoki ruxsat talab:', e);
        updatePlayerPlayState(false);
        if (subtitle) {
            subtitle.innerText = '⚠️ Ovozni ijro etib bo\'lmadi (Fayl topilmadi yoki bo\'sh)';
            subtitle.style.color = '#f87171';
        }
    });

    // 4. Interaktiv to'lqinni (waveform) render qilish
    renderInteractiveWaveform(audio, fileName, sizeBytes);
}
window.playAudioFile = playAudioFile;

async function openInExplorerStudio(recFile, callerId, duration, btn) {
    const audio = getNativeAudio();
    const callKey = `${callerId || ''}_${duration || 0}`;
    let resolvedRec = recFile || knownRecordingsCache.get(callKey) || '';

    // 0. Agar aynan shu audio allaqachon ijro etilayotgan yoki pauzada bo'lsa -> Qaytadan boshlamaymiz, qolgan joyidan davom ettiramiz!
    const isSameActiveCall = (
        (currentlyPlayingCallKey && currentlyPlayingCallKey === callKey) ||
        (pausedCallKey && pausedCallKey === callKey) ||
        (resolvedRec && activeAudioFilePath && (resolvedRec === activeAudioFilePath || activeAudioFilePath.endsWith(resolvedRec) || resolvedRec.endsWith(activeAudioFilePath))) ||
        (activeAudioFileName && callerId && activeAudioFileName.includes(callerId))
    );

    const isAudioActive = audio && audio.src && !audio.ended && (audio.currentTime > 0 || !audio.paused);

    if (isSameActiveCall && isAudioActive) {
        // Tabni Audio Explorer ga o'tkazamiz
        if (typeof switchRoute === 'function') {
            switchRoute('explorer', true);
        } else {
            const expBtn = document.querySelector('.nav-tabs a[data-tab="explorer"]');
            if (expBtn) expBtn.click();
        }

        const playerCard = document.getElementById('modernMusicPlayer');
        if (playerCard) {
            playerCard.style.display = 'block';
            setTimeout(() => {
                playerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 80);
        }

        const realDuration = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? Math.round(audio.duration)
            : (duration || 0);
        const displayName = `${isax('call')} ${callerId} (${formatSeconds(realDuration)})`;
        activeAudioFileName = displayName;
        if (resolvedRec) {
            activeAudioFilePath = resolvedRec;
            knownRecordingsCache.set(callKey, resolvedRec);
        }

        if (playerFileName) {
            if (displayName && displayName.includes('<')) {
                playerFileName.innerHTML = displayName;
            } else {
                playerFileName.textContent = displayName || '';
            }
        }

        const subtitle = document.getElementById('playerStatusSubtitle');
        if (subtitle) {
            subtitle.innerText = audio.paused ? 'To\'xtatildi (Pauza)' : 'Audio ijro etilmoqda';
            subtitle.style.color = '';
        }

        if (playerCurrentTime) playerCurrentTime.innerText = formatDuration(audio.currentTime);
        if (playerDuration && realDuration > 0) {
            playerDuration.innerText = formatDuration(realDuration);
        }

        if (resolvedRec) {
            activeAudioFilePath = resolvedRec;
        }
        const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
        if (btnDownloadCurrent && activeAudioFilePath) {
            btnDownloadCurrent.style.display = 'inline-flex';
            btnDownloadCurrent.onclick = downloadCurrentPlayerAudio;
        }

        updatePlayerPlayState(!audio.paused);

        // Waveformni joriy audio oqimi va vaqti bilan render qilish
        renderInteractiveWaveform(audio, displayName, realDuration * 16000);

        return;
    }

    // 1. Agar boshqa audio bo'lsa -> Avvalgi ijro etilayotgan audioni to'xtatamiz
    const expBtn = document.querySelector('.nav-tabs a[data-tab="explorer"]');
    if (expBtn) expBtn.click();

    const playerCard = document.getElementById('modernMusicPlayer');

    try {
        audio.pause();
    } catch (e) { }

    // 2. Eskisi ko'rinib qolmasligi uchun DARHOL loading rejimiga o'tkazamiz
    if (playerCard) {
        playerCard.style.display = 'block';
        setTimeout(() => {
            playerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
    }

    if (playerFileName) {
        playerFileName.innerHTML = callerId ? `${isax('call')} ${callerId} (${t('logs_loading', 'Yuklanmoqda...')})` : t('audio_loading', 'Audio yuklanmoqda...');
    }
    if (playerCurrentTime) playerCurrentTime.innerText = '00:00';
    if (playerDuration) playerDuration.innerText = duration ? formatDuration(duration) : '--:--';
    const waveRulerEnd = document.getElementById('waveRulerEnd');
    if (waveRulerEnd) waveRulerEnd.innerText = duration ? formatDuration(duration) : '--:--';

    const subtitle = document.getElementById('playerStatusSubtitle');
    if (subtitle) {
        subtitle.innerHTML = `${isax('timer')} ${t('aud_preparing', 'Audio serverdan qidirilmoqda va tayyorlanmoqda...')}`;
        subtitle.style.color = '#38bdf8';
    }

    const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
    if (btnDownloadCurrent) btnDownloadCurrent.style.display = 'none';

    // To'lqinni tozalab turamiz (eski grafik qolib ketmasligi uchun)
    const waveCanvas = document.getElementById('interactiveWaveformCanvas');
    if (waveCanvas && waveCanvas.getContext) {
        const ctx = waveCanvas.getContext('2d');
        ctx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
    }

    updatePlayerPlayState(false);

    if (btn) {
        btn.innerHTML = `<span>${isax('timer')}...</span>`;
        btn.disabled = true;
    }

    if (!callerId) {
        if (btn) {
            btn.innerHTML = '<span>🔍 Detal</span>';
            btn.disabled = false;
        }
        return;
    }

    try {
        if (resolvedRec) {
            const displayName = `${isax('call')} ${callerId} (${formatSeconds(duration || 0)})`;
            playAudioFile(displayName, resolvedRec, (duration || 0) * 16000, true);
            return;
        }

        let matchedRecording = null;
        let matchedDuration = duration;

        // 1-bosqich: Fast-Index tekshiruvi (0.2 millisekundda RAM xotiradan topadi!)
        try {
            const fastRes = await fetch(`/api/recordings/fast-find?callerId=${encodeURIComponent(callerId)}&duration=${duration || 0}`).then(r => r.json());
            if (fastRes && fastRes.found && fastRes.recording) {
                matchedRecording = fastRes.recording;
                matchedDuration = fastRes.duration || duration;
            }
        } catch (fastErr) { }

        // 2-bosqich: Agar tezkor indeksda bo'lmasa, CDR bazasidan qidirish
        if (!matchedRecording) {
            const targetItem = dashboardRecentCallsList.find(i => i.callerId === callerId);
            let dateParam = '';
            if (targetItem && targetItem.time) {
                const d = String(targetItem.time).slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                    dateParam = `&date=${d}`;
                }
            }
            const res = await fetch(`/api/calls/details?search=${encodeURIComponent(callerId)}&limit=5${dateParam}`);
            const data = await res.json();
            const matched = data && data.data && data.data.find(c => c.recording && c.recording.length > 0);
            if (matched && matched.recording) {
                matchedRecording = matched.recording;
                matchedDuration = matched.duration || duration;
            }
        }

        if (matchedRecording) {
            knownRecordingsCache.set(callKey, matchedRecording);
            const targetItem = dashboardRecentCallsList.find(i => i.callerId === callerId);
            if (targetItem) targetItem.recording = matchedRecording;

            const displayName = `${isax('call')} ${callerId} (${formatSeconds(matchedDuration || duration || 0)})`;
            playAudioFile(displayName, matchedRecording, (matchedDuration || duration || 0) * 16000, true);
        } else {
            if (subtitle) {
                subtitle.innerText = t('aud_record_not_found', '⚠️ Ushbu suhbat uchun audio yozuv topilmadi');
                subtitle.style.color = '#f87171';
            }
            if (playerFileName) playerFileName.innerHTML = `${isax('call')} ${callerId} (${isax('close-circle')} ${t('audio_none', "Audio yo'q")})`;
            alert(tf('audio_not_found_alert', { phone: callerId }, `⚠️ "${callerId}" raqamiga tegishli audio yozuv topilmadi.`));
        }
    } catch (e) {
        if (subtitle) {
            subtitle.innerText = t('audio_load_error', '⚠️ Yuklashda xatolik yuz berdi');
            subtitle.style.color = '#f87171';
        }
        alert(t('audio_open_error', 'Audio ochishda xatolik: ') + e.message);
    } finally {
        if (btn) {
            btn.innerHTML = '<span>🔍 Detal</span>';
            btn.disabled = false;
        }
    }
}
window.openInExplorerStudio = openInExplorerStudio;


function getUzbekistanOperator(phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    let code = '';
    if (clean.startsWith('998') && clean.length >= 5) {
        code = clean.slice(3, 5);
    } else if (clean.length === 9) {
        code = clean.slice(0, 2);
    } else if (clean.length > 9) {
        const last9 = clean.slice(-9);
        code = last9.slice(0, 2);
    } else if (clean.length === 7) {
        return { name: 'Uztelecom', brand: 'uztelecom', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.15)', border: 'rgba(2, 132, 199, 0.35)' };
    } else {
        return null;
    }

    // Beeline: 90, 91
    if (code === '90' || code === '91') {
        return { name: 'Beeline', brand: 'beeline', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.35)' };
    }
    // Ucell: 93, 94, 50, 55
    if (code === '93' || code === '94' || code === '50' || code === '55') {
        return { name: 'Ucell', brand: 'ucell', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.35)' };
    }
    // Uzmobile (Uztelecom): 95, 99, 77, 71, 78, 70
    if (code === '95' || code === '99' || code === '77' || code === '71' || code === '78' || code === '70') {
        return { name: 'Uzmobile', brand: 'uzmobile', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.15)', border: 'rgba(2, 132, 199, 0.35)' };
    }
    // Mobiuz: 97, 88
    if (code === '97' || code === '88') {
        return { name: 'Mobiuz', brand: 'mobiuz', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.35)' };
    }
    // Humans: 33
    if (code === '33') {
        return { name: 'Humans', brand: 'humans', color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)', border: 'rgba(234, 179, 8, 0.35)' };
    }
    // Perfectum Mobile: 98, 80
    if (code === '98' || code === '80') {
        return { name: 'Perfectum', brand: 'perfectum', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.35)' };
    }
    // OQ: 20
    if (code === '20') {
        return { name: 'OQ', brand: 'oq', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.35)' };
    }

    return null;
}
window.getUzbekistanOperator = getUzbekistanOperator;

function formatLiveCallDuration(startMs) {
    if (!startMs) return '00:00';
    const diffSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const mm = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
    const ss = String(diffSec % 60).padStart(2, '0');
    const hh = Math.floor(diffSec / 3600);
    return hh > 0 ? `${String(hh).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

function getConversationKey(c) {
    return c.channel || (c.callerId + '_' + (c.operatorExten || c.operator || ''));
}

function renderActiveConversations(conversations) {
    currentConversations = conversations || [];
    const container = document.getElementById('activeChannelsContainer');
    const countEl = document.getElementById('activeLineCount');
    if (!container) return;

    if (countEl) {
        countEl.innerText = currentConversations.length;
    }

    const newKeyMap = new Map();
    currentConversations.forEach(c => {
        newKeyMap.set(getConversationKey(c), c);
    });

    // 1. Tugagan suhbatlarni swipe-out animatsiyasi bilan olib tashlash
    const existingCards = container.querySelectorAll('.cc-call');
    let hasSwipingOut = false;

    existingCards.forEach(card => {
        const key = card.getAttribute('data-channel-key');
        if (key && !newKeyMap.has(key)) {
            if (!card.classList.contains('cc-swiping-out')) {
                hasSwipingOut = true;
                card.classList.add('cc-swiping-out');
                setTimeout(() => {
                    if (card.parentNode) {
                        card.remove();
                    }
                    checkActiveChannelsEmpty();
                }, 800);
            }
        }
    });

    function checkActiveChannelsEmpty() {
        const remaining = container.querySelectorAll('.cc-call:not(.cc-swiping-out)');
        if (remaining.length === 0) {
            const emptyEl = container.querySelector('.empty-channels-placeholder');
            if (!emptyEl) {
                container.innerHTML = `
                    <div class="empty-channels-placeholder" style="text-align: center; color: var(--cc-mute); padding: 12px 0; font-size: 12px; animation: fadeIn 0.3s ease;">
                        ${t('live_active_empty', "Hozircha faol suhbatlar yo'q")}
                    </div>
                `;
            }
        }
    }

    if (currentConversations.length === 0) {
        if (!hasSwipingOut) {
            checkActiveChannelsEmpty();
        }
        return;
    }

    // Mavjud placeholder bo'lsa olib tashlash
    const placeholder = container.querySelector('.empty-channels-placeholder');
    if (placeholder) placeholder.remove();

    // Accordion holatini saqlash (qayta yangilanishda yopilib ketmasligi uchun)
    if (typeof window.activeConversationsOpenKey === 'undefined') {
        window.activeConversationsOpenKey = null;
    }

    // 2. Yangi suhbatlarni qo'shish yoki mavjudlarini yangilash
    currentConversations.forEach(c => {
        const key = getConversationKey(c);
        const existingCard = container.querySelector(`.cc-call[data-channel-key="${key}"]:not(.cc-swiping-out)`);

        const isTalking = c.stateType === 'talking';
        const isOutbound = c.direction === 'outbound';
        const isQueue = (c.operator === 'Navbatda kutmoqda' || !c.operatorExten) && !isOutbound;

        let tagClass = 'cc-tag-wait';
        let tagText = c.state || 'Kutmoqda';

        if (isTalking) {
            tagClass = isOutbound ? 'cc-tag-out' : 'cc-tag-ok';
            tagText = isOutbound ? t('live_badge_outbound', 'Chiquvchi') : t('live_badge_inbound', 'Kiruvchi');
        } else if (isQueue) {
            tagClass = 'cc-tag-wait';
            tagText = t('live_badge_queue', 'Navbatda');
        } else {
            tagClass = isOutbound ? 'cc-tag-out' : 'cc-tag-wait';
            tagText = isOutbound ? t('live_badge_dialing', 'Chiquvchi') : t('live_badge_ringing', 'Chaqirilmoqda');
        }

        // Operator nomidan takroriy (111) yoki (ext) ni tozalash: "Nozima (111)" -> "Nozima"
        let cleanOp = (c.operator || 'Operator').replace(/\s*\(\d+\)\s*$/, '').trim();
        const opText = isQueue
            ? t('live_badge_queue', 'Navbatda kutmoqda')
            : (c.operatorExten ? `${cleanOp} · ${c.operatorExten}` : cleanOp);

        // Davomiylik (Start Time) hisoblash:
        let startMs = 0;
        if (c.startTime) {
            const parsed = new Date(c.startTime).getTime();
            if (!isNaN(parsed) && parsed > 0) {
                startMs = parsed;
            }
        }
        if (!startMs && c.duration) {
            const parts = String(c.duration).split(':').map(Number);
            if (parts.length === 3) {
                const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                startMs = Date.now() - sec * 1000;
            } else if (parts.length === 2) {
                const sec = parts[0] * 60 + parts[1];
                startMs = Date.now() - sec * 1000;
            }
        }
        if (!startMs) {
            startMs = Date.now();
        }

        // Agar mavjud kartada data-start bo'lsa va farq 6 soniyadan kam bo'lsa, eskisini saqlash (sekundomer sakramaydi)
        if (existingCard) {
            const oldTimer = existingCard.querySelector('.cc-live-duration');
            if (oldTimer) {
                const oldStart = parseInt(oldTimer.getAttribute('data-start'), 10);
                if (oldStart && Math.abs(oldStart - startMs) < 6000) {
                    startMs = oldStart;
                }
            }
        }

        const initialDurationText = formatLiveCallDuration(startMs);

        // Operatordan SIM karta va brend ma'lumotlarini aniqlash
        const opInfo = getUzbekistanOperator(c.callerId);
        const opBadgeHtml = opInfo ? `
            <span class="cc-op-sim-badge cc-tag" title="${opInfo.name} operatori" style="background: ${opInfo.bg}; color: ${opInfo.color}; border: 1px solid ${opInfo.border};">
                <svg class="isax isax-simcard" style="width: 10px; height: 10px; color: ${opInfo.color};"><use href="/icons/iconsax/iconsax-sprite.svg#isax-simcard"></use></svg>
                <span>${opInfo.name}</span>
            </span>
        ` : '';

        const subtext = opText;
        const iconType = isTalking ? 'talking' : (isOutbound ? 'outbound' : 'ringing');
        const iconSymbol = isOutbound ? 'isax-call' : 'isax-call-incoming';
        const callerFormatted = formatCallerNumberOrOperator(c.callerId);
        const isOpen = (window.activeConversationsOpenKey === key);

        if (existingCard) {
            existingCard.className = `cc-call ${isTalking ? 'talking' : (isOutbound ? 'outbound' : 'ringing')}${isOpen ? ' open' : ''}`;
            const iconEl = existingCard.querySelector('.cc-call-icon');
            if (iconEl) {
                iconEl.className = `cc-call-icon ${iconType}`;
                iconEl.setAttribute('title', tagText);
                const svgUse = iconEl.querySelector('use');
                if (svgUse) svgUse.setAttribute('href', `/icons/iconsax/iconsax-sprite.svg#${iconSymbol}`);
            }
            const numEl = existingCard.querySelector('.cc-num');
            if (numEl) {
                numEl.textContent = callerFormatted;
                numEl.title = callerFormatted;
            }
            const opEl = existingCard.querySelector('.cc-op');
            if (opEl) {
                opEl.textContent = subtext;
                opEl.title = subtext;
            }
            const tagsEl = existingCard.querySelector('.cc-tags');
            if (tagsEl) {
                tagsEl.innerHTML = `
                    ${opBadgeHtml}
                    <span class="cc-tag time" data-timer="${key}">
                        <svg class="isax isax-timer" style="width: 11px; height: 11px; color: #38bdf8;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-timer"></use></svg>
                        <span class="cc-live-duration" data-start="${startMs}">${initialDurationText}</span>
                    </span>
                `;
            }
        } else {
            const cardEl = document.createElement('div');
            cardEl.className = `cc-call ${isTalking ? 'talking' : (isOutbound ? 'outbound' : 'ringing')}${isOpen ? ' open' : ''}`;
            cardEl.setAttribute('data-channel-key', key);
            cardEl.innerHTML = `
                <div class="cc-call-main" onclick="toggleActiveCallAccordion('${key}', event)">
                    <div class="cc-call-icon ${iconType}" title="${tagText}">
                        <svg class="isax ${iconSymbol}" style="width: 18px; height: 18px; color: currentColor;"><use href="/icons/iconsax/iconsax-sprite.svg#${iconSymbol}"></use></svg>
                    </div>
                    <div class="cc-info">
                        <div class="cc-top">
                            <span class="cc-num" title="${safeEscapeAttr(callerFormatted)}" onclick="event.stopPropagation(); copyCallbackPhone('${safeEscapeAttr(c.callerId)}', this, event);">${callerFormatted}</span>
                            <span class="cc-op" title="${safeEscapeAttr(subtext)}">${subtext}</span>
                        </div>
                        <div class="cc-tags">
                            ${opBadgeHtml}
                            <span class="cc-tag time" data-timer="${key}">
                                <svg class="isax isax-timer" style="width: 11px; height: 11px; color: #38bdf8;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-timer"></use></svg>
                                <span class="cc-live-duration" data-start="${startMs}">${initialDurationText}</span>
                            </span>
                        </div>
                    </div>
                    <svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                </div>
                <div class="cc-actions">
                    <div class="cc-actions-inner">
                        <button type="button" class="cc-btn cc-btn-switch" onclick="event.stopPropagation(); openTransferModal('${c.channel}', '${safeEscapeAttr(c.callerId)}');" title="Boshqa operatorga o'tkazish">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10h13l-4-4M17 14H4l4 4"/></svg>
                            <span>${t('live_btn_transfer', "O'tkazish")}</span>
                        </button>
                        <button type="button" class="cc-btn cc-btn-end" onclick="event.stopPropagation(); hangupChannel('${c.channel}');" title="Qo'ng'iroqni tugatish">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.5 6.2A16 16 0 0 1 21 5v4l-3 1.5M5 4h4l2 5-2.5 1.5a11 11 0 0 0 3 3.5"/></svg>
                            <span>${t('live_btn_end', "Tugatish")}</span>
                        </button>
                    </div>
                </div>
            `;
            container.appendChild(cardEl);
        }
    });
}

window.toggleActiveCallAccordion = function(key, event) {
    if (event) event.stopPropagation();
    if (window.activeConversationsOpenKey === key) {
        window.activeConversationsOpenKey = null;
    } else {
        window.activeConversationsOpenKey = key;
    }
    const container = document.getElementById('activeChannelsContainer');
    if (container) {
        container.querySelectorAll('.cc-call').forEach(card => {
            const cardKey = card.getAttribute('data-channel-key');
            if (cardKey === window.activeConversationsOpenKey) {
                card.classList.add('open');
            } else {
                card.classList.remove('open');
            }
        });
    }
};

// Har soniyada faol suhbatlar davomiyligini (duration) jonli sekundomerda yangilab borish
if (!window.activeConversationsTicker) {
    window.activeConversationsTicker = setInterval(() => {
        const timerEls = document.querySelectorAll('.cc-live-duration[data-start]');
        if (!timerEls || timerEls.length === 0) return;
        const now = Date.now();
        timerEls.forEach(el => {
            const start = parseInt(el.getAttribute('data-start'), 10);
            if (start && start > 0) {
                const text = formatLiveCallDuration(start);
                if (el.textContent !== text) {
                    el.textContent = text;
                }
            }
        });
    }, 1000);
}

function renderQueues(queues) {
    currentQueues = queues || [];
    const listEl = document.getElementById('queueItemsList');
    const countBadge = document.getElementById('queueCountBadge');

    let totalWaiters = 0;
    let allWaiters = [];

    currentQueues.forEach(q => {
        totalWaiters += (q.callsWaitingCount || (q.callersWaiting ? q.callersWaiting.length : 0));
        if (q.callersWaiting && q.callersWaiting.length > 0) {
            q.callersWaiting.forEach(c => allWaiters.push({ ...c, queueName: q.name }));
        }
    });

    // Shuningdek agar activeConversations ichida Navbatda kutayotganlar bo'lsa lekin queue ga kirmagan bo'lsa
    if (currentConversations && currentConversations.length > 0) {
        currentConversations.forEach(c => {
            if ((c.operator === 'Navbatda kutmoqda' || !c.operatorExten) && c.direction !== 'outbound') {
                const alreadyIn = allWaiters.some(w => w.callerId === c.callerId);
                if (!alreadyIn) {
                    allWaiters.push({
                        callerId: c.callerId,
                        position: allWaiters.length + 1,
                        queueName: t('live_default_queue', 'Asosiy Navbat')
                    });
                    totalWaiters++;
                }
            }
        });
    }

    const queueSection = document.getElementById('queueSection');
    if (queueSection) {
        queueSection.style.display = totalWaiters > 0 ? 'block' : 'none';
    }
    countBadge.innerText = `${totalWaiters} ${t('unit_item', 'ta')}`;
    const kpiQueue = document.getElementById('kpiQueueWaiting');
    if (kpiQueue) kpiQueue.innerText = totalWaiters;

    if (allWaiters.length === 0) {
        listEl.innerHTML = `
            <div style="color: var(--text-dim); font-size: 11px; text-align: center; padding: 4px;">
                ${totalWaiters > 0 ? tf('live_waiting_count', { n: totalWaiters }, `${totalWaiters} ta mijoz navbatda kutmoqda`) : t('live_queue_empty', "Hozircha navbatda kutayotganlar yo'q")}
            </div>
        `;
        return;
    }

    listEl.innerHTML = allWaiters.map(w => {
        const callerPhone = String(w.callerId || '').trim();
        const cInfo = (callerPhone && typeof getClientContact === 'function') ? getClientContact(callerPhone) : null;
        const cName = (cInfo && cInfo.name) ? cInfo.name.trim() : (w.clientName || '').trim();
        const cOrg = (cInfo && cInfo.organization) ? cInfo.organization.trim() : (w.clientOrg || '').trim();

        let clientLabel = '';
        if (cName && cOrg) clientLabel = `${cName} • ${cOrg}`;
        else if (cName) clientLabel = cName;
        else if (cOrg) clientLabel = cOrg;

        const opInfo = (typeof getUzbekistanOperator === 'function') ? getUzbekistanOperator(callerPhone) : null;
        const opBadgeHtml = opInfo ? `
            <span class="cc-op-sim-badge cc-tag" title="${opInfo.name} operatori" style="background: ${opInfo.bg}; color: ${opInfo.color}; border: 1px solid ${opInfo.border}; padding: 1px 5px; font-size: 9.5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;">
                <svg class="isax isax-simcard" style="width: 9px; height: 9px; color: ${opInfo.color};"><use href="/icons/iconsax/iconsax-sprite.svg#isax-simcard"></use></svg>
                <span>${opInfo.name}</span>
            </span>
        ` : '';

        const waitSec = parseInt(w.waitSec || 0, 10);
        const waitHtml = waitSec > 0 ? `
            <span style="font-size: 10px; color: #94a3b8; display: inline-flex; align-items: center; gap: 3px;" title="Kutish vaqti">
                <svg class="isax isax-timer" style="width: 10px; height: 10px; color: #38bdf8;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-timer"></use></svg>
                <span>${Math.floor(waitSec / 60)}:${String(waitSec % 60).padStart(2, '0')}</span>
            </span>
        ` : '';

        let clientNameHtml = '';
        if (clientLabel) {
            clientNameHtml = `
                <div style="color: #38bdf8; font-size: 11.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" 
                     onclick="event.stopPropagation(); (typeof openAdminEditClientModal === 'function' ? openAdminEditClientModal('${safeEscapeAttr(callerPhone)}') : null)"
                     title="${safeEscapeAttr(clientLabel)} (${t('clients_btn_edit', 'Tahrirlash')})">
                    <svg class="isax isax-user" style="width: 11px; height: 11px; flex-shrink: 0; color: #38bdf8;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-user"></use></svg>
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(clientLabel)}</span>
                </div>
            `;
        } else {
            clientNameHtml = `
                <div style="display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--cc-mute, #94a3b8);">
                    <svg class="isax isax-user-add" style="width: 10px; height: 10px; flex-shrink: 0; opacity: 0.7;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-user-add"></use></svg>
                    <span style="cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;" 
                          onclick="event.stopPropagation(); (typeof openAdminAddClientModal === 'function' ? openAdminAddClientModal('${safeEscapeAttr(callerPhone)}') : null)" 
                          title="${t('clients_modal_add_title', 'Mijoz sifatida saqlash')}">
                        ${t('queue_unknown_client_add', '+ Ism kiritish')}
                    </span>
                </div>
            `;
        }

        return `
            <div class="queue-caller-pill" style="display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; gap: 8px;">
                <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px;">
                    <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                        <span style="font-weight: 700; color: #fff; font-size: 12.5px; letter-spacing: 0.3px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" 
                              onclick="event.stopPropagation(); copyCallbackPhone('${safeEscapeAttr(callerPhone)}', this, event)" 
                              title="Raqamni nusxalash">
                            <svg class="isax isax-call-incoming" style="width: 13px; height: 13px; color: #818cf8;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-call-incoming"></use></svg>
                            ${callerPhone}
                        </span>
                        ${opBadgeHtml}
                    </div>
                    ${clientNameHtml}
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0;">
                    <span style="background: rgba(99, 102, 241, 0.22); color: #c7d2fe; border: 1px solid rgba(99, 102, 241, 0.45); border-radius: 5px; padding: 2px 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.2px;">
                        ${tf('live_position', { n: w.position || 1 }, `Navbatda #${w.position || 1}`)}
                    </span>
                    ${waitHtml}
                </div>
            </div>
        `;
    }).join('');
}

async function hangupChannel(channel) {
    if (!confirm(t('live_hangup_confirm', 'Haqiqatan ham ushbu kanalni uzmoqchimisiz?'))) return;

    // Tugatish bosilganda darhol o'ngga swipe-out animatsiyasini qo'llash
    const card = document.querySelector(`.cc-call[data-channel-key="${channel}"], .compact-channel-card[data-channel-key="${channel}"]`);
    if (card && !card.classList.contains('cc-swiping-out') || card.classList.contains('swiping-out')) {
        card.classList.add('cc-swiping-out');
        setTimeout(() => {
            if (card.parentNode) card.remove();
            const container = document.getElementById('activeChannelsContainer');
            if (container && container.querySelectorAll('.compact-channel-card:not(.swiping-out)').length === 0) {
                container.innerHTML = `
                    <div class="empty-channels-placeholder" style="text-align: center; color: var(--text-dim); padding: 12px; font-size: 11px;">
                        ${t('live_active_empty', "Hozircha faol suhbatlar yo'q")}
                    </div>
                `;
            }
        }, 1200);
    }

    try {
        await fetch('/api/action/hangup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel })
        });
    } catch (e) {
        alert(t('hangup_error', 'Uzishda xatolik: ') + e.message);
    }
}

/* ==========================================================================
   Transfer Call Modal Logic
   ========================================================================== */
function initTransferModal() {
    const modal = document.getElementById('transferModal');
    const btnClose = document.getElementById('btnCloseTransferModal');
    const btnCancel = document.getElementById('btnCancelTransfer');
    const btnConfirm = document.getElementById('btnConfirmTransfer');

    const closeModal = () => {
        smoothCloseDashboardModal('transferModal', () => {
            activeTransferChannel = null;
        });
    };

    btnClose.addEventListener('click', closeModal);
    btnCancel.addEventListener('click', closeModal);

    btnConfirm.addEventListener('click', async () => {
        const select = document.getElementById('transferOperatorSelect');
        const targetExten = select.value;
        if (!targetExten || !activeTransferChannel) {
            alert(t('transfer_not_selected', 'Operator tanlanmadi!'));
            return;
        }

        try {
            btnConfirm.innerText = t('transfer_in_progress', "O'tkazilmoqda...");
            btnConfirm.disabled = true;

            const res = await fetch('/api/action/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel: activeTransferChannel,
                    targetExten: targetExten
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(tf('transfer_success', { exten: targetExten }, `Qo'ng'iroq Operator ${targetExten} ga muvaffaqiyatli o'tkazildi!`));
                closeModal();
            } else {
                alert(t('transfer_error_prefix', 'Xatolik: ') + (data.error || t('transfer_failed', "O'tkazib bo'lmadi")));
            }
        } catch (err) {
            alert(t('transfer_exception', 'Transfer xatosi: ') + err.message);
        } finally {
            btnConfirm.innerText = t('transfer_confirm', "✓ O'tkazish");
            btnConfirm.disabled = false;
        }
    });
}

function openTransferModal(channel, callerId) {
    activeTransferChannel = channel;
    const modal = document.getElementById('transferModal');
    const callerDisplay = document.getElementById('transferCallerDisplay');
    const select = document.getElementById('transferOperatorSelect');

    callerDisplay.innerText = callerId || t('party_client', 'Mijoz');

    // Populate operators (ready ones first)
    if (currentOperators.length === 0) {
        select.innerHTML = `<option value="">${t('transfer_no_ops', 'Operatorlar topilmadi')}</option>`;
    } else {
        select.innerHTML = currentOperators.map(op => {
            const pres = op.presence || 'ready';
            const icon = pres === 'ready' ? '🟢' : (pres === 'talking' ? '🟡' : '🔴');
            const stateText = pres === 'ready' ? t('transfer_ready', '(Tayyor / On-hook)') : (pres === 'talking' ? t('transfer_talking', '(Suhbatda)') : t('transfer_offline', '(Offline)'));
            return `
                <option value="${op.id}">
                    ${icon} Operator ${op.id} ${stateText}
                </option>
            `;
        }).join('');
    }

    modal.style.display = 'flex';
}

let EXCLUDED_OPERATOR_IDS = new Set(['1234', '1111', '1324', '1001', '1000', '402', '401', '170', '161', '118', '115', '160', '66', '110', '213', '116']);

function updateExcludedOperatorIds(idList, triggerRender = true) {
    if (Array.isArray(idList)) {
        EXCLUDED_OPERATOR_IDS = new Set(idList.map(String));
        if (triggerRender && typeof renderOperators === 'function' && window._rawLastOperators) {
            renderOperators(window._rawLastOperators);
        }
    }
}
window.updateExcludedOperatorIds = updateExcludedOperatorIds;
window.getExcludedOperatorIds = () => Array.from(EXCLUDED_OPERATOR_IDS);

async function fetchExcludedOperatorsInitial() {
    try {
        const res = await fetch('/api/settings/exclude-list');
        const data = await res.json();
        if (data && data.success && Array.isArray(data.excluded)) {
            updateExcludedOperatorIds(data.excluded, true);
        }
    } catch (e) {
        // Fallback to default
    }
}
fetchExcludedOperatorsInitial();

// Operator guruhi holati (main: 100-199 | secondary: 200+ | all: barchasi)
let currentOperatorGroup = 'main';
try {
    const savedGroup = localStorage.getItem('callcenter_op_group');
    if (savedGroup && ['main', 'secondary', 'all'].includes(savedGroup)) {
        currentOperatorGroup = savedGroup;
    }
} catch (e) { }

function switchOperatorGroup(group) {
    if (!['main', 'secondary', 'all'].includes(group)) return;
    _hasRevealedOperators = false;
    window._lastRenderedOperatorsHtml = '';
    currentOperatorGroup = group;
    try {
        localStorage.setItem('callcenter_op_group', group);
    } catch (e) { }

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

/* ==========================================================================
   6. Operator Performance Section (Sorted: Online -> Talking -> Offline + Gamified MVP Stars)
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
    if (isRinging) return 1; // 1. Ringing (Jiringlayotganlar)

    // Operator presence'i offline bo'lsa ham Jonli Monitor (currentConversations) suhbati hisobga olinadi
    const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
        ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
        : null;

    if (pres === 'talking' || activeConv) return 2; // 2. Suhbatda (har doim birinchilardan)
    if (pres === 'ready') return 3; // 3. Onlayn / Qabul qilishga tayyor
    if (pres === 'paused') return 4; // 4. Tanaffusda
    return 5; // 5. Offline
}

function generateStarRatingHtml(totalScore, operatorName) {
    const score = parseInt(totalScore, 10) || 0;
    if (score < 1) {
        return '';
    }

    let currentLevel = 0;
    let nextStarNeeded = 0;
    let starsClusterHtml = '';

    if (score >= 40) {
        currentLevel = 5;
        // 5 ta yulduz: Kamalaksimon (Arch)
        //    x
        // xx  xx
        starsClusterHtml = `
            <div class="stars-cluster stars-count-5" title="5 ta yulduz (Kamalaksimon)">
                <div class="star-row star-row-top">
                    <span class="star-item star-peak">⭐</span>
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
        // 4 ta yulduz: 2x2 kvadrat
        // x x
        // x x
        starsClusterHtml = `
            <div class="stars-cluster stars-count-4" title="4 ta yulduz (2x2)">
                <div class="star-row">
                    <span class="star-item">⭐</span>
                    <span class="star-item">⭐</span>
                </div>
                <div class="star-row">
                    <span class="star-item">⭐</span>
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

// Operatorlar suhbati davomiyligini saqlash (WS yangilanganda vaqt sakrab ketmasligi uchun)
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

window.toggleOperatorPause = async function (operatorId, shouldPause, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const cleanId = String(operatorId || '').replace(/\D/g, '');
    if (!cleanId) return;

    const opList = window.currentOperators || (typeof currentOperators !== 'undefined' ? currentOperators : []);
    const op = opList.find(o => String(o.id) === cleanId);
    const opName = op ? (op.realName || op.name || `Operator ${cleanId}`) : `Operator ${cleanId}`;

    try {
        const resp = await fetch('/api/operator/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extension: cleanId, paused: shouldPause })
        });
        const res = await resp.json();
        if (res.success) {
            const toastMsg = shouldPause
                ? `${opName} (${cleanId}) tanaffusga (pauzaga) qo'yildi`
                : `${opName} (${cleanId}) pauzadan chiqarildi va ishga qaytdi`;
            if (typeof showBlacklistToast === 'function') {
                showBlacklistToast(toastMsg, shouldPause ? 'info' : 'success');
            } else if (typeof showToast === 'function') {
                showToast(toastMsg, shouldPause ? 'info' : 'success');
            } else {
                console.log(toastMsg);
            }
            if (typeof socket !== 'undefined' && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ action: 'refresh_channels' }));
            }
            if (typeof detailState !== 'undefined' && detailState && detailState.currentOp && String(detailState.currentOp.id) === cleanId) {
                detailState.currentOp.paused = shouldPause;
                if (shouldPause) {
                    if (detailState.currentOp.presence !== 'talking') detailState.currentOp.presence = 'paused';
                } else {
                    if (detailState.currentOp.presence === 'paused') detailState.currentOp.presence = 'ready';
                }
                if (typeof renderOperatorSummaryPills === 'function') {
                    renderOperatorSummaryPills();
                }
            }
        } else {
            alert('Xatolik: ' + (res.message || 'Pauza holatini o\'zgartirib bo\'lmadi'));
        }
    } catch (err) {
        console.error('toggleOperatorPause xatolik:', err);
        alert('Server bilan bog\'lanishda xatolik: ' + err.message);
    }
};

let _offlineIsCompact = localStorage.getItem('dashboard_offline_compact') === 'true';

function toggleOfflineCardsView(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    _offlineIsCompact = !_offlineIsCompact;
    localStorage.setItem('dashboard_offline_compact', _offlineIsCompact ? 'true' : 'false');
    window._lastRenderedOperatorsHtml = '';
    if (window._rawLastOperators && window._rawLastOperators.length > 0) {
        renderOperators(window._rawLastOperators);
    }
}
window.toggleOfflineCardsView = toggleOfflineCardsView;

/* ==========================================================================
   Operator Cards Smooth FLIP Animation (Prevent Jarring Teleporting)
   ========================================================================== */
let _lastRenderedOperatorGroup = null;

function captureCardsBoundingRects(container) {
    const rects = new Map();
    if (!container) return rects;
    const containerRect = container.getBoundingClientRect();
    const elements = container.querySelectorAll('.operator-card[data-flip-id], #opOfflineGrid .row[data-flip-id]');
    elements.forEach(el => {
        if (el.classList.contains('op-grid-divider')) return;
        const id = el.getAttribute('data-flip-id');
        if (!id) return;
        const r = el.getBoundingClientRect();
        // Containerga nisbatan koordinatalarni saqlash
        rects.set(id, {
            left: r.left - containerRect.left,
            top: r.top - containerRect.top
        });
    });
    return rects;
}

function playCardsFlipAnimation(container, firstRects) {
    if (!container || !firstRects || firstRects.size === 0) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const containerRect = container.getBoundingClientRect();
    const newElements = container.querySelectorAll('.operator-card[data-flip-id], #opOfflineGrid .row[data-flip-id]');
    const animatingList = [];

    newElements.forEach(el => {
        if (el.classList.contains('op-grid-divider')) return;
        const id = el.getAttribute('data-flip-id');
        if (!id) return;
        const first = firstRects.get(id);
        if (!first) {
            // Yangi paydo bo'lgan karta darhol normal ko'rinsin (ochib-yonishsiz)
            return;
        }

        const r = el.getBoundingClientRect();
        const lastLeft = r.left - containerRect.left;
        const lastTop = r.top - containerRect.top;

        const dx = first.left - lastLeft;
        const dy = first.top - lastTop;

        // Agar 1.5px dan ko'proq siljish bo'lsa (tepaga, pastga yoki qatorlar bo'yicha)
        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
            // INVERT: Darhol eski o'rniga surib qo'yamiz (sakrashni to'xtatish)
            el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
            el.style.transition = 'none';
            el.style.zIndex = '6';
            el.classList.add('op-flip-moving');
            animatingList.push(el);
        }
    });

    if (animatingList.length === 0) return;

    // PLAY: Keyingi frame'da o'zining yangi o'rniga silliq siljitish
    requestAnimationFrame(() => {
        void container.offsetWidth;
        requestAnimationFrame(() => {
            animatingList.forEach(el => {
                // Apple & Emil Kowalski smooth ease: cubic-bezier(0.2, 0.9, 0.3, 1)
                el.style.transition = 'transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1)';
                el.style.transform = 'translate3d(0, 0, 0)';

                const cleanup = (e) => {
                    if (e && e.target !== el) return;
                    el.style.transition = '';
                    el.style.transform = '';
                    el.style.zIndex = '';
                    el.classList.remove('op-flip-moving');
                    el.removeEventListener('transitionend', cleanup);
                };
                el.addEventListener('transitionend', cleanup);
                setTimeout(cleanup, 360);
            });
        });
    });
}

function renderOperators(operators) {
    if (operators && Array.isArray(operators)) {
        window._rawLastOperators = operators;
    }
    if (window.isVisualInspectorActive) {
        // Visual AI Inspector faol paytida DOM ni almashtirmaslik (foydalanuvchi tanlagan elementlar uzilib ketmasligi uchun)
        if (typeof updateAllTalkingTimers === 'function') updateAllTalkingTimers();
        return;
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

    // FLIP animatsiyasi uchun DOM o'zgarishidan oldingi koordinatalarni saqlash
    // Agar guruh o'zgarmagan bo'lsa, koordinatalarni olamiz
    const isSameGroup = (_lastRenderedOperatorGroup === currentOperatorGroup);
    _lastRenderedOperatorGroup = currentOperatorGroup;
    const firstRects = (isSameGroup && grid) ? captureCardsBoundingRects(grid) : new Map();

    // Eng faol operatorni aniqlash (MVP reyting) jami qo'ng'iroqlar bo'yicha
    const sortedByScore = [...currentOperators]
        .filter(op => ((op.grandTotal ?? op.answered ?? 0) > 0) || (op.totalDurationSec || 0) > 0)
        .sort((a, b) => ((b.grandTotal ?? b.answered ?? 0) - (a.grandTotal ?? a.answered ?? 0)) || ((b.totalDurationSec || 0) - (a.totalDurationSec || 0)));

    const top1Id = sortedByScore[0] ? sortedByScore[0].id : null;
    const top2Id = sortedByScore[1] ? sortedByScore[1].id : null;
    const top3Id = sortedByScore[2] ? sortedByScore[2].id : null;

    let countReady = 0;
    let countTalking = 0;
    let countOffline = 0;
    let countAgentOnline = 0;

    currentOperators.forEach(op => {
        const pres = op.presence || 'ready';
        const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;
        if (pres === 'talking' || activeConv) countTalking++;
        else if (pres === 'offline') countOffline++;
        else countReady++;

        if (op.agentConnected) countAgentOnline++;
    });

    // Sarlavhadagi jonli ko'rsatkichlar (Operatorlar – redizayn.html)
    const sTalk = document.getElementById('sumCountTalk');
    const sWait = document.getElementById('sumCountWait');
    const sOff = document.getElementById('sumCountOff');
    if (sTalk) sTalk.textContent = countTalking;
    if (sWait) sWait.textContent = countReady;
    if (sOff) sOff.textContent = countOffline;

    const elReady = document.getElementById('opCountReady');
    const elTalking = document.getElementById('opCountTalking');
    const elOffline = document.getElementById('opCountOffline');
    const elAgent = document.getElementById('opCountAgentOnline');
    if (elReady) elReady.innerText = countReady;
    if (elTalking) elTalking.innerText = countTalking;
    if (elOffline) elOffline.innerText = countOffline;
    if (elAgent) elAgent.innerText = `${countAgentOnline} ta`;

    if (!currentOperators || currentOperators.length === 0) {
        const groupLabel = currentOperatorGroup === 'secondary'
            ? "Zangiota 42 (200+)"
            : (currentOperatorGroup === 'main' ? "Asosiy" : "operatorlar");
        grid.innerHTML = `
            <div style="color: var(--text-muted); font-size: 13px; padding: 24px; text-align: center; grid-column: 1 / -1;">
                Hozircha ${groupLabel} bo'yicha operatorlar mavjud emas.
            </div>
        `;
        return;
    }

    // Navbatdagi keyingi qo'ng'iroqni qabul qiluvchi operatorni aniqlash (Fewest calls strategiyasi bo'yicha)
    currentOperators.forEach(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const isRinging = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
        const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;
        const isWaiting = (pres === 'ready' || isRinging) && pres !== 'talking' && !activeConv && pres !== 'paused' && pres !== 'offline';
        if (isWaiting) {
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
        const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;
        return (pres === 'ready' || isRinging) && pres !== 'talking' && !activeConv && pres !== 'paused' && pres !== 'offline';
    });

    let predictedNextOpId = null;
    if (readyOps.length > 0) {
        readyOps.sort((a, b) => {
            const callsA = (a.callsTaken !== null && a.callsTaken !== undefined) ? Number(a.callsTaken) : 0;
            const callsB = (b.callsTaken !== null && b.callsTaken !== undefined) ? Number(b.callsTaken) : 0;
            if (callsA !== callsB) return callsA - callsB;

            const answeredA = (a.answered !== null && a.answered !== undefined) ? Number(a.answered) : 0;
            const answeredB = (b.answered !== null && b.answered !== undefined) ? Number(b.answered) : 0;
            if (answeredA !== answeredB) return answeredA - answeredB;

            const lastA = (a.lastCall !== null && a.lastCall !== undefined) ? Number(a.lastCall) : 0;
            const lastB = (b.lastCall !== null && b.lastCall !== undefined) ? Number(b.lastCall) : 0;
            if (lastA > 0 && lastB > 0 && lastA !== lastB) return lastA - lastB;

            const readySinceA = operatorReadySinceMap.get(a.id) || 0;
            const readySinceB = operatorReadySinceMap.get(b.id) || 0;
            if (readySinceA !== readySinceB && readySinceA > 0 && readySinceB > 0) return readySinceA - readySinceB;

            return parseInt(a.id, 10) - parseInt(b.id, 10);
        });
        predictedNextOpId = readyOps[0].id;
    }

    // Operatorlarni 3 ta qat'iy guruhga ajratish: Suhbatda, Kutmoqda (Tayyor) va Oflayn
    const talkingOperators = [];
    const readyOperators = [];
    const offlineOperators = [];

    currentOperators.forEach(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
        const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;
        // Jiringlayotgan kutayotgan operator o'z joyida qoladi, 1-qatorga faqat haqiqiy suhbatdagi operatorlar o'tadi
        if (pres === 'talking' || Boolean(activeConv)) {
            talkingOperators.push(op);
        } else if (pres === 'offline') {
            offlineOperators.push(op);
        } else {
            readyOperators.push(op);
        }
    });

    // 1. Suhbatdagi operatorlarni saralash (eng faollar/balli yuqorilar oldinda)
    talkingOperators.sort((a, b) => {
        const scoreA = (a.grandTotal !== undefined && a.grandTotal !== null) ? a.grandTotal : (a.answered || 0);
        const scoreB = (b.grandTotal !== undefined && b.grandTotal !== null) ? b.grandTotal : (b.answered || 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });

    // 2. Kutayotgan operatorlarni saralash (navbatdagi/predictedNextOpId oldinda)
    readyOperators.sort((a, b) => {
        if (predictedNextOpId) {
            if (String(a.id) === String(predictedNextOpId)) return -1;
            if (String(b.id) === String(predictedNextOpId)) return 1;
        }
        const scoreA = (a.grandTotal !== undefined && a.grandTotal !== null) ? a.grandTotal : (a.answered || 0);
        const scoreB = (b.grandTotal !== undefined && b.grandTotal !== null) ? b.grandTotal : (b.answered || 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });

    // 3. Oflayn operatorlarni saralash
    offlineOperators.sort((a, b) => {
        const scoreA = (a.grandTotal !== undefined && a.grandTotal !== null) ? a.grandTotal : (a.answered || 0);
        const scoreB = (b.grandTotal !== undefined && b.grandTotal !== null) ? b.grandTotal : (b.answered || 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return parseInt(a.id, 10) - parseInt(b.id, 10);
    });

    function renderDashboardOperatorCard(op) {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';
        const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;
        const isTalking = (pres === 'talking' || Boolean(activeConv));
        const isPaused = (pres === 'paused' || op.paused);

        let stateClass = 'wait';
        let stateLabel = t('wait_status', 'Kutmoqda');
        if (pres === 'offline') {
            stateClass = 'offline';
            stateLabel = t('op_status_offline', 'Oflayn');
        } else if (ringingNow) {
            stateClass = 'ring';
            stateLabel = t('op_status_ringing', 'Jiringlamoqda');
        } else if (isTalking) {
            stateClass = 'talk';
            stateLabel = t('status_talking', 'Hozir suhbatda');
        } else if (isPaused) {
            stateClass = 'pause';
            stateLabel = t('op_status_paused', 'Pauzada');
        }

        const isNextInLine = (op.id === predictedNextOpId) && (pres === 'ready') && !ringingNow;

        // Reyting / Rank nishoni
        const rankIndex = sortedByScore.findIndex(o => o.id === op.id);
        const answered = op.answered || 0;
        const outbound = op.outbound || 0;
        const missed = op.missed || 0;
        const transferredIn = op.transferredIn || 0;
        const transferredOut = op.transferredOut || 0;
        const transferredTotal = transferredIn + transferredOut;
        const grandTotal = (op.grandTotal !== undefined && op.grandTotal !== null) ? op.grandTotal : answered;
        const totalDuration = op.totalDurationSec || 0;
        const avgDuration = op.avgDurationSec || 0;

        let rankBadgeHtml = '';
        if (rankIndex === 0 && grandTotal > 0) {
            rankBadgeHtml = `<span class="rank diamond">MVP</span>`;
        } else if (rankIndex === 1 && grandTotal > 0) {
            rankBadgeHtml = `<span class="rank">#2</span>`;
        } else if (rankIndex === 2 && grandTotal > 0) {
            rankBadgeHtml = `<span class="rank">#3</span>`;
        } else if (rankIndex >= 3 && rankIndex < 5 && grandTotal > 0) {
            rankBadgeHtml = `<span class="rank">#${rankIndex + 1}</span>`;
        }

        const cleanName = getCleanOperatorName(op.realName || op.name, op.id);
        const isMaxmudbek = (String(op.id) === '114' || cleanName.toLowerCase().includes('maxmudbek'));
        const avatarClickAttr = isMaxmudbek
            ? `onclick="if(window.handleMaxmudbekClick){handleMaxmudbekClick(event);}" title="Maxmudbek • Qora ro'yxat (Blacklist) boshqaruvi"`
            : '';

        // Jonli suhbat bloki (Call strip)
        let callBlockHtml = '';
        if (isTalking) {
            let talkingSince = op.talkingSince;
            if (!talkingSince) {
                if (activeConv && activeConv.startTime) {
                    talkingSince = new Date(activeConv.startTime).getTime();
                } else if (operatorTalkingSinceMap.has(op.id)) {
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

            const callerRaw = activeConv ? (activeConv.callerId || '') : (op.ringingCaller ? String(op.ringingCaller).replace(/^📤\s*/, '').trim() : '');
            const callerFormatted = callerRaw ? formatCallerNumberOrOperator(callerRaw) : '—';
            const cInfo = (callerRaw && typeof getClientContact === 'function') ? getClientContact(callerRaw) : null;
            const clientInfoText = cInfo ? ((cInfo.name && cInfo.organization) ? `${cInfo.name} • ${cInfo.organization}` : (cInfo.organization || cInfo.name || '')) : '';

            callBlockHtml = `
                <div class="call">
                    <div class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
                    <div class="no">
                        <span class="lbl">Suhbatdagi raqam</span>
                        <span style="font-size: 14px; font-weight: 700; color: #fff;">${callerFormatted}</span>
                        ${clientInfoText ? `<small style="display:block; color:#f59e0b; font-size:11px; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(clientInfoText)}</small>` : ''}
                    </div>
                    <div class="timer talking-live-timer" data-talking-since="${talkingSince}">${initialDisplay}</div>
                </div>
            `;
        } else if (ringingNow) {
            operatorTalkingSinceMap.delete(op.id);
            const callerRaw = String(op.ringingCaller || '').replace(/^📤\s*/, '').trim();
            const callerFormatted = callerRaw ? formatCallerNumberOrOperator(callerRaw) : '—';
            callBlockHtml = `
                <div class="call" style="background: rgba(236, 72, 153, 0.12); border: 1px solid rgba(236, 72, 153, 0.3);">
                    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#ec4899; box-shadow:0 0 8px #ec4899; flex-shrink:0;"></span>
                    <div class="no">
                        <span class="lbl" style="color: #f472b6;">Kiruvchi chaqiruv...</span>
                        <span style="font-size: 14px; font-weight: 700; color: #fff;">${callerFormatted}</span>
                    </div>
                </div>
            `;
        } else if (isPaused) {
            operatorTalkingSinceMap.delete(op.id);
            callBlockHtml = `
                <div class="call">
                    <span class="idle" style="color: var(--op-wait); font-weight: 500;">Pauzada (Tanaffus)</span>
                </div>
            `;
        } else if (pres === 'offline') {
            operatorTalkingSinceMap.delete(op.id);
            callBlockHtml = `
                <div class="call">
                    <span class="idle" style="color: var(--op-off, #ef4444); font-weight: 500;">Oflayn (Tizimda emas)</span>
                </div>
            `;
        } else {
            operatorTalkingSinceMap.delete(op.id);
            callBlockHtml = `
                <div class="call">
                    <span class="idle">Yangi qo'ng'iroqni kutmoqda…</span>
                </div>
            `;
        }

        return `
            <article class="operator-card op-redesign clickable-card ${stateClass} ${isNextInLine ? 'next-in-line' : ''}" 
                     data-op-id="${op.id}"
                     data-flip-id="op-${op.id}"
                     onclick="openOperatorDetail('${op.id}')" 
                     title="${tf('op_card_click_detail', { name: cleanName }, `${cleanName} tafsilotlarini ko'rish uchun bosing`)}">
                <div class="head">
                    <div class="av" ${avatarClickAttr}>${op.id}</div>
                    <div class="who">
                        <strong>${cleanName}${rankBadgeHtml}</strong>
                        <small>Exten ${op.id} · ${op.ip || '-none-'}</small>
                    </div>
                    <span class="st">${stateLabel}</span>
                </div>

                ${callBlockHtml}

                <div class="total">
                    <span class="n">${grandTotal}</span>
                    <span class="u">ta jami qo'ng'iroq</span>
                </div>

                <div class="bar" title="Kiruvchi: ${answered} ta | Chiquvchi: ${outbound} ta | O'tkazib yuborilgan: ${missed} ta">
                    <i style="flex: ${answered || 1}; background: var(--op-ok);" title="Kiruvchi: ${answered} ta"></i>
                    ${outbound ? `<i style="flex: ${outbound}; background: #38bdf8;" title="Chiquvchi: ${outbound} ta"></i>` : ''}
                    ${missed ? `<i style="flex: ${missed}; background: var(--op-wait);" title="O'tkazib yuborilgan: ${missed} ta"></i>` : ''}
                </div>

                <dl class="stats" style="margin-bottom:0">
                    <div><dt>Kiruvchi</dt><dd style="color: var(--op-ok);">${answered} ta</dd></div>
                    <div><dt>Chiquvchi</dt><dd>${outbound} ta</dd></div>
                    <div title="Kiruvchi transfer: ${transferredIn} ta | Chiquvchi transfer: ${transferredOut} ta">
                        <dt>Transfer</dt>
                        <dd style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; font-variant-numeric: tabular-nums;">
                            <span style="color: var(--op-ok, #22c55e); font-weight: 600; display: inline-flex; align-items: center; gap: 2px;" title="Kiruvchi transfer (qabul qilingan): ${transferredIn} ta">
                                ${isax('arrow-down', '', 'width: 10px; height: 10px; vertical-align: middle;')} ${transferredIn}
                            </span>
                            <span style="color: rgba(255,255,255,0.25); font-weight: 300;">|</span>
                            <span style="color: #38bdf8; font-weight: 600; display: inline-flex; align-items: center; gap: 2px;" title="Chiquvchi transfer (uzatilgan): ${transferredOut} ta">
                                ${isax('arrow-up', '', 'width: 10px; height: 10px; vertical-align: middle;')} ${transferredOut}
                            </span>
                        </dd>
                    </div>
                    <div class="${missed ? 'warn' : ''}"><dt>O'tkazib yuborilgan</dt><dd>${missed} ta</dd></div>
                    <div><dt>Umumiy suhbat</dt><dd>${formatSeconds(totalDuration)}</dd></div>
                    <div><dt>O'rtacha</dt><dd>${formatSeconds(avgDuration)}</dd></div>
                </dl>

                <div class="foot">
                    <span>
                        <em style="color: ${op.agentConnected ? 'var(--op-ok)' : 'var(--op-mu)'};">● Agent ${op.agentConnected ? 'faol' : "o'chiq"}</em>
                        ${op.agentConnected && op.agentVersion ? `<span style="font-size: 10.5px; opacity: 0.8; margin-left: 2px;">v${op.agentVersion}</span>` : ''}
                    </span>
                    <span title="Desktop nomi: ${op.agentHostname || 'Aniqlanmagan'}">${op.agentHostname || '—'}</span>
                </div>
            </article>
        `;
    }

    // 1-BLOK: Hozir suhbatda bo'lgan operatorlar (liniyasiz, eng tepada)
    const talkingCardsHtml = talkingOperators.map(renderDashboardOperatorCard).join('');

    // 1-LINIYA (Divider): Kutmoqda (Tayyor) — SAO Converging Shine Sci-Fi Dizayn
    let readyDividerHtml = '';
    if (readyOperators.length > 0) {
        readyDividerHtml = `
            <div class="op-grid-divider sao-divider divider-ready" style="--c: #22c55e;" title="Qabul qilishga tayyor operatorlar">
                <span class="sao-line sao-line-left"><span class="track"><i class="shine"></i></span></span>
                <div class="glow">
                    <div class="sao-label">
                        <i class="sao-diamond"></i>
                        <span>Kutmoqda (Tayyor)</span>
                        <b class="sao-count">${readyOperators.length}</b>
                    </div>
                </div>
                <span class="sao-line sao-line-right"><span class="track"><i class="shine"></i></span></span>
            </div>
        `;
    }
    // 2-BLOK: Kutmoqda (Tayyor) operatorlar
    const readyCardsHtml = readyOperators.map(renderDashboardOperatorCard).join('');

    // 2-LINIYA (Divider) & 3-BLOK: Oflayn operatorlar — SAO Converging Shine Sci-Fi Dizayn
    let offlineSectionHtml = '';
    if (offlineOperators.length > 0) {
        let offlineContentHtml = '';
        if (_offlineIsCompact) {
            offlineContentHtml = `
                <div class="op-offs" id="opOfflineGrid">
                    ${offlineOperators.map(o => {
                const cName = getCleanOperatorName(o.realName || o.name, o.id);
                return `
                            <div class="row" data-op-id="${o.id}" data-flip-id="op-${o.id}" onclick="openOperatorDetail('${o.id}')" title="${cName} tafsilotlarini ko'rish uchun bosing">
                                <div class="av">${o.id}</div>
                                <div class="who">
                                    <strong>${cName}</strong>
                                    <small>Exten ${o.id}${o.agentHostname ? ' · ' + o.agentHostname : ''}</small>
                                </div>
                                <span class="tag ${o.agentConnected ? 'on' : ''}">Agent: ${o.agentConnected ? 'faol' : "o'chiq"}</span>
                            </div>
                        `;
            }).join('')}
                </div>
            `;
        } else {
            offlineContentHtml = offlineOperators.map(renderDashboardOperatorCard).join('');
        }

        offlineSectionHtml = `
            <div class="op-grid-divider sao-divider divider-offline" id="opOfflineSep" style="--c: #ef4444;" title="Oflayn operatorlar">
                <span class="sao-line sao-line-left"><span class="track"><i class="shine"></i></span></span>
                <div class="glow">
                    <div class="sao-label">
                        <i class="sao-diamond"></i>
                        <span>Oflayn operatorlar</span>
                        <b class="sao-count">${offlineOperators.length}</b>
                        <button type="button" 
                                onclick="toggleOfflineCardsView(event)" 
                                class="sao-toggle-btn op-offline-toggle-btn" 
                                title="Ko'rinishni o'zgartirish (To'liq kartochkalar / Ixcham qatorlar)">
                            <svg class="isax isax-element-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 12px; height: 12px;"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></svg>
                            <span>${_offlineIsCompact ? 'To\'liq statistika' : 'Ixcham qatorlar'}</span>
                        </button>
                    </div>
                </div>
                <span class="sao-line sao-line-right"><span class="track"><i class="shine"></i></span></span>
            </div>
            ${offlineContentHtml}
        `;
    }

    const newHtml = talkingCardsHtml + readyDividerHtml + readyCardsHtml + offlineSectionHtml;

    // Agar operatorlar tarkibi o'zgarmagan bo'lsa, DOM ni behuda qayta yuvib tashlamaslik (miltillash va titrashni oldini olish)
    if (window._lastRenderedOperatorsHtml === newHtml) {
        updateAllTalkingTimers();
        return;
    }
    window._lastRenderedOperatorsHtml = newHtml;

    // Dividerlar animatsiyasi (Glow shine) reset bo'lmasligi va elementlar silliq saqlanishi uchun DOM-reconciliation
    syncDashboardGridChildren(grid, newHtml);

    if (_operatorsIsCompact) grid.classList.add('compact');
    if (_operatorsIsFocus) applyOperatorsFocusUI();

    // FLIP Layout Animation: faqat o'rni o'zgargan kartalarni silliq siljitish
    playCardsFlipAnimation(grid, firstRects);

    // Jonli taymerlarni yangilash
    updateAllTalkingTimers();

    if (typeof renderOperatorChips === 'function') {
        renderOperatorChips();
        if (typeof selectedCompareOpId !== 'undefined' && selectedCompareOpId) {
            const op = currentOperators.find(o => String(o.id) === String(selectedCompareOpId));
            if (op && typeof renderCompareStats === 'function') renderCompareStats(op);
        }
    }
    if (typeof updateRecentOperatorsDataList === 'function') {
        updateRecentOperatorsDataList();
    }
}

function syncDashboardGridChildren(grid, newHtml) {
    if (!grid.children.length) {
        grid.innerHTML = newHtml;
        return;
    }

    const temp = document.createElement('div');
    temp.innerHTML = newHtml;

    const newChildren = Array.from(temp.children);
    const existingReadyDiv = grid.querySelector('.divider-ready');
    const existingOfflineDiv = grid.querySelector('.divider-offline');

    newChildren.forEach((newChild, index) => {
        const isReadyDiv = newChild.classList.contains('divider-ready');
        const isOfflineDiv = newChild.classList.contains('divider-offline');

        let childToPlace = newChild;

        if (isReadyDiv && existingReadyDiv) {
            const newCount = newChild.querySelector('.sao-count')?.textContent;
            const oldCount = existingReadyDiv.querySelector('.sao-count');
            if (oldCount && newCount !== undefined && oldCount.textContent !== newCount) {
                oldCount.textContent = newCount;
            }
            childToPlace = existingReadyDiv;
        } else if (isOfflineDiv && existingOfflineDiv) {
            const newCount = newChild.querySelector('.sao-count')?.textContent;
            const oldCount = existingOfflineDiv.querySelector('.sao-count');
            if (oldCount && newCount !== undefined && oldCount.textContent !== newCount) {
                oldCount.textContent = newCount;
            }
            childToPlace = existingOfflineDiv;
        } else {
            const opId = newChild.getAttribute('data-op-id');
            const currentChild = grid.children[index];
            if (opId && currentChild && currentChild.getAttribute('data-op-id') === opId) {
                if (currentChild.innerHTML !== newChild.innerHTML) {
                    currentChild.innerHTML = newChild.innerHTML;
                }
                if (currentChild.className !== newChild.className) {
                    currentChild.className = newChild.className;
                }
                childToPlace = currentChild;
            }
        }

        const currentChildAtPos = grid.children[index];
        if (currentChildAtPos !== childToPlace) {
            grid.insertBefore(childToPlace, currentChildAtPos || null);
        }
    });

    while (grid.children.length > newChildren.length) {
        grid.removeChild(grid.lastChild);
    }
}

let _operatorsIsCompact = false;
let _operatorsIsFocus = false;

function toggleOperatorsCompact(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    _operatorsIsCompact = !_operatorsIsCompact;
    const grid = document.getElementById('operatorsGrid');
    if (grid) grid.classList.toggle('compact', _operatorsIsCompact);
    const btnText = document.getElementById('btnDensityText');
    if (btnText) btnText.textContent = _operatorsIsCompact ? 'Batafsil' : 'Qatorlar';
}
window.toggleOperatorsCompact = toggleOperatorsCompact;

function toggleOperatorsFocus(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    _operatorsIsFocus = !_operatorsIsFocus;
    applyOperatorsFocusUI();
    const btnText = document.getElementById('btnFocusText');
    if (btnText) btnText.textContent = _operatorsIsFocus ? 'Barchasi' : 'Fokus';
}
window.toggleOperatorsFocus = toggleOperatorsFocus;

function applyOperatorsFocusUI() {
    const sep = document.getElementById('opOfflineSep');
    const offs = document.getElementById('opOfflineGrid');
    if (sep) sep.style.display = _operatorsIsFocus ? 'none' : '';
    if (offs) offs.style.display = _operatorsIsFocus ? 'none' : '';
}
window.applyOperatorsFocusUI = applyOperatorsFocusUI;

/* ==========================================================================
   7. Call History & Dual-Source Pagination (3CX Agent Default + Server CDR)
   ========================================================================== */
let historyDataSource = 'server'; // Default: 'server' (Issabel Asterisk CDR)
let historyDateScope = 'today'; // 'today' (Tanlangan sana), 'all' (Barcha kunlar / butun arxiv), 'range' (Sana oralig'i)
let currentHistoryDateRange = ''; // 'YYYY-MM-DD_YYYY-MM-DD'

function updateHistoryScopeUI() {
    const btnAll = document.getElementById('btnHistoryScopeAll');
    if (btnAll) {
        if (historyDateScope === 'all') {
            btnAll.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btnAll.style.color = '#fff';
            btnAll.style.borderColor = '#3b82f6';
            btnAll.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.35)';
            btnAll.innerHTML = `<span>♾️</span> <span>${t('hist_all_days_active', 'Barcha kunlar (Faol)')}</span>`;
        } else {
            btnAll.style.background = 'rgba(15, 23, 42, 0.8)';
            btnAll.style.color = 'var(--text-muted)';
            btnAll.style.borderColor = 'var(--border-color)';
            btnAll.style.boxShadow = 'none';
            btnAll.innerHTML = `<span>♾️</span> <span>${t('hist_all_days', 'Barcha kunlar')}</span>`;
        }
    }
    updateHistoryDateRangeUI();
}
window.updateHistoryScopeUI = updateHistoryScopeUI;

function updateHistoryDateRangeUI() {
    const btnRange = document.getElementById('btnHistoryDateRange');
    const btnText = document.getElementById('btnHistoryDateRangeText');
    if (!btnRange) return;

    if (historyDateScope === 'range' && currentHistoryDateRange) {
        const parts = currentHistoryDateRange.split('_');
        const start = parts[0] ? formatDisplayDate(parts[0]) : '';
        const end = parts[1] ? formatDisplayDate(parts[1]) : '';
        btnRange.style.background = 'linear-gradient(135deg, #2563eb, #3b82f6)';
        btnRange.style.color = '#fff';
        btnRange.style.borderColor = '#60a5fa';
        btnRange.style.boxShadow = '0 2px 10px rgba(37, 99, 235, 0.4)';
        if (btnText) btnText.textContent = `${start} — ${end}`;
    } else {
        btnRange.style.background = 'rgba(59, 130, 246, 0.15)';
        btnRange.style.color = '#93c5fd';
        btnRange.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        btnRange.style.boxShadow = 'none';
        if (btnText) btnText.textContent = t('hist_date_range_btn', "Sana oralig'i");
    }
}
window.updateHistoryDateRangeUI = updateHistoryDateRangeUI;

function toggleHistoryScopeAll() {
    if (historyDateScope === 'all') {
        historyDateScope = 'today';
    } else {
        historyDateScope = 'all';
        currentHistoryDateRange = '';
    }
    updateHistoryScopeUI();
    loadHistoryPage(1, historySearchQuery);
}
window.toggleHistoryScopeAll = toggleHistoryScopeAll;

function setHistoryScope(scope) {
    if (scope === 'range') {
        historyDateScope = 'range';
    } else if (scope === 'all') {
        historyDateScope = 'all';
        currentHistoryDateRange = '';
    } else {
        historyDateScope = 'today';
        currentHistoryDateRange = '';
    }
    updateHistoryScopeUI();
    loadHistoryPage(1, historySearchQuery);
}
window.setHistoryScope = setHistoryScope;

function setHistorySource(source) {
    historyDataSource = (source === 'server') ? 'server' : 'agent';

    const btnAgent = document.getElementById('btnHistorySourceAgent');
    const btnServer = document.getElementById('btnHistorySourceServer');
    const badge = document.getElementById('historySourceBadge');
    const desc = document.getElementById('historyPanelDesc');
    const thLast = document.getElementById('historyThLast');

    if (historyDataSource === 'agent') {
        if (btnAgent) {
            btnAgent.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            btnAgent.style.color = '#fff';
            btnAgent.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
        }
        if (btnServer) {
            btnServer.style.background = 'transparent';
            btnServer.style.color = 'var(--text-muted)';
            btnServer.style.boxShadow = 'none';
        }
        if (badge) {
            badge.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('flash', '', 'width: 12px; height: 12px;')} ${t('hist_source_agent', '3CX Agent')}</span>`;
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            badge.style.color = '#34d399';
        }
        if (desc) {
            desc.innerText = t('hist_source_desc_agent', "3CX Desktop Agent lokal bazasidagi qo'ng'iroqlar jurnali.");
        }
    } else {
        if (btnAgent) {
            btnAgent.style.background = 'transparent';
            btnAgent.style.color = 'var(--text-muted)';
            btnAgent.style.boxShadow = 'none';
        }
        if (btnServer) {
            btnServer.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btnServer.style.color = '#fff';
            btnServer.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
        }
        if (badge) {
            badge.innerText = `🌐 ${t('hist_source_server', 'Server CDR')}`;
            badge.style.background = 'rgba(59, 130, 246, 0.15)';
            badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            badge.style.color = '#60a5fa';
        }
        if (desc) {
            desc.innerText = t('hist_source_desc_server', "Issabel Asterisk server bazasidagi barcha kiruvchi va chiquvchi CDR qo'ng'iroqlar jurnali.");
        }
    }

    loadHistoryPage(1, historySearchQuery);
}
window.setHistorySource = setHistorySource;

function initHistoryPagination() {
    const input = document.getElementById('historySearchInput');
    let searchTimeout = null;

    if (input) {
        const purgeAutofill = () => {
            if (input && input.value) {
                const val = input.value.trim().toLowerCase();
                let isAuto = false;
                try { isAuto = input.matches(':-webkit-autofill') || input.matches(':autofill'); } catch (_) { }
                if (val === 'superuser' || isAuto) {
                    input.value = '';
                    historySearchQuery = '';
                }
            }
        };

        purgeAutofill();
        setTimeout(purgeAutofill, 50);
        setTimeout(purgeAutofill, 200);
        setTimeout(purgeAutofill, 600);

        input.addEventListener('input', (e) => {
            const rawVal = e.target.value;
            if (rawVal && rawVal.trim().toLowerCase() === 'superuser' && (!e.isTrusted || !e.inputType)) {
                e.target.value = '';
                historySearchQuery = '';
                return;
            }
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                historySearchQuery = e.target.value.trim();
                loadHistoryPage(1, historySearchQuery);
            }, 300);
        });
    }

    const prevBtn = document.getElementById('btnPrevPage');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (historyCurrentPage > 1) {
                loadHistoryPage(historyCurrentPage - 1, historySearchQuery);
            }
        });
    }

    const nextBtn = document.getElementById('btnNextPage');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (historyCurrentPage < historyTotalPages) {
                loadHistoryPage(historyCurrentPage + 1, historySearchQuery);
            }
        });
    }

    // Tarix jadvalini fonda jimjit avtomatik yangilash (Har 12 soniyada):
    // Agar foydalanuvchi Qo'ng'iroqlar Jurnali tabida bo'lsa, 1-sahifada tursa va qidiruv bo'sh bo'lsa,
    // yangi qo'ng'iroqlarni jimjit yuklab eng yuqoriga chiqaradi
    setInterval(() => {
        const activeTab = document.documentElement.getAttribute('data-tab') || 'dashboard';
        const histTab = document.getElementById('tab-history');
        const isHistoryVisible = activeTab === 'history' || (histTab && window.getComputedStyle(histTab).display !== 'none');
        if (isHistoryVisible && historyCurrentPage === 1 && !historySearchQuery) {
            loadHistoryPage(1, '', true);
        }
    }, 12000);
}

let currentHistoryData = [];

async function loadHistoryPage(page = 1, search = '', isSilent = false) {
    const tbody = document.getElementById('historyTableBody');
    if (tbody && !isSilent) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align: center; padding: 0; white-space: normal;">
                    <div class="table-loading-container">
                        <div class="spinner spinner-lg"></div>
                        <div style="font-size: 14px; font-weight: 600; color: #94a3b8; letter-spacing: 0.3px;">
                            ${t('hist_loading_calls', "Qo'ng'iroqlar tarixi yuklanmoqda...")}
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    try {
        const isAll = (historyDateScope === 'all');
        const isRange = (historyDateScope === 'range');
        const todayStr = getTodayDateString();
        const activeDate = currentSelectedDate || todayStr;
        const dateParam = isAll ? 'all' : (isRange ? (currentHistoryDateRange || activeDate) : ((activeDate === todayStr) ? 'today' : activeDate));

        if (historyDataSource === 'agent') {
            // 1. 3CX Desktop Agent lokal bazasidan (bir zumda yuklanadi)
            const res = await fetch(`/api/agent/logs?page=${page}&limit=20&date=${encodeURIComponent(dateParam)}&search=${encodeURIComponent(search)}`);
            const result = await res.json();

            historyCurrentPage = result.page || 1;
            historyTotalPages = result.totalPages || 1;

            const pageDisp = document.getElementById('pageNumberDisplay');
            const countInfo = document.getElementById('historyCountInfo');
            const prevBtn = document.getElementById('btnPrevPage');
            const nextBtn = document.getElementById('btnNextPage');
            const pagControls = document.getElementById('historyPaginationControls');

            if (pageDisp) pageDisp.innerText = tf('hist_page', { page: historyCurrentPage, total: historyTotalPages }, `Sahifa ${historyCurrentPage} / ${historyTotalPages}`);
            if (countInfo) countInfo.innerText = tf('hist_count_records', { n: result.total || 0 }, `Jami: ${result.total || 0} ta yozuv`);
            if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
            if (nextBtn) nextBtn.disabled = historyCurrentPage >= historyTotalPages;
            if (pagControls) pagControls.style.display = historyTotalPages > 1 ? 'flex' : 'none';

            currentHistoryData = result.data || [];
            applyHistoryFilters();
            if (typeof updateHistorySelectionBar === 'function') updateHistorySelectionBar();
        } else {
            // 2. Issabel Asterisk CDR Server bazasidan
            const statusVal = (document.getElementById('historyFilterStatus') || {}).value || 'all';
            const dirVal = (document.getElementById('historyFilterDirection') || {}).value || 'all';
            const speakerVal = (document.getElementById('historyFilterSpeaker') || {}).value || 'all';
            const hasFilter = statusVal !== 'all' || dirVal !== 'all' || speakerVal !== 'all';
            const clearBtn = document.getElementById('btnClearHistoryFilters');
            if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';

            let url = `/api/history?page=${page}&limit=20&search=${encodeURIComponent(search)}&date=${encodeURIComponent(dateParam)}`;
            if (dirVal !== 'all') url += `&direction=${encodeURIComponent(dirVal)}`;
            if (statusVal !== 'all') url += `&status=${encodeURIComponent(statusVal)}`;
            if (speakerVal !== 'all') url += `&speaker=${encodeURIComponent(speakerVal)}`;

            const res = await fetch(url);
            const result = await res.json();

            historyCurrentPage = result.page || 1;
            historyTotalPages = result.totalPages || 1;

            const pageDisp = document.getElementById('pageNumberDisplay');
            const countInfo = document.getElementById('historyCountInfo');
            const prevBtn = document.getElementById('btnPrevPage');
            const nextBtn = document.getElementById('btnNextPage');
            const pagControls = document.getElementById('historyPaginationControls');

            if (pageDisp) pageDisp.innerText = tf('hist_page', { page: historyCurrentPage, total: historyTotalPages }, `Sahifa ${historyCurrentPage} / ${historyTotalPages}`);
            if (countInfo) countInfo.innerText = tf('hist_count_records', { n: result.total || 0 }, `Jami: ${result.total || 0} ta yozuv`);
            if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
            if (nextBtn) nextBtn.disabled = historyCurrentPage >= historyTotalPages;
            if (pagControls) pagControls.style.display = historyTotalPages > 1 ? 'flex' : 'none';

            currentHistoryData = result.data || [];
            renderServerHistoryTable(currentHistoryData);
            if (typeof updateHistorySelectionBar === 'function') updateHistorySelectionBar();
        }
    } catch (e) {
        if (tbody && !isSilent) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="12" style="text-align: center; padding: 0; white-space: normal;">
                        <div class="table-loading-container" style="color: var(--danger); gap: 8px;">
                            <div style="font-size: 14px; font-weight: 600;">
                                ${tf('hist_error', { msg: e.message }, `Xatolik yuz berdi: ${e.message}`)}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }
    }
}

const OPERATOR_NAMES_MAP = {
    '101': 'Oybek',
    '103': 'Feruza',
    '106': 'Ubaydullayeva Gulchehra',
    '111': 'Nozima',
    '114': 'Maxmudbek',
    '119': 'Muattar',
    '120': 'Navruzoy'
};

// Ovoz tahlili (Voiceprint ECAPA) indikatori (Zuhra opa vs Muattar)
function renderVoiceAnalysisBadge(va) {
    if (!va || !va.speaker) return '';
    if (va.speaker === 'zuhra') {
        const conf = va.confidence || Math.round((va.score || 0) * 100);
        const segs = va.zuhra_segments ? ` (${va.zuhra_segments} seg)` : '';
        return `<span class="badge" style="background: rgba(168, 85, 247, 0.22); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.5); font-size: 10px; font-weight: 700; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; cursor: help;" title="AI Ovoz tahlili: Zuhra opa! O'xshashlik: ${conf}%${segs}">
            <svg class="isax isax-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z"/><path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22"/></svg>
            <span>Zuhra: ${conf}%</span>
        </span>`;
    }
    if (va.speaker === 'muattar') {
        return `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 10px; font-weight: 600; padding: 2px 6px; display: inline-flex; align-items: center; gap: 3px; border-radius: 6px; cursor: help;" title="AI Ovoz tahlili: Muattar (operator ovozi tasdiqlandi)">
            <svg class="isax isax-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z"/><path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22"/></svg>
            <span>Muattar</span>
        </span>`;
    }
    return '';
}

// History jadvalini client-side yoki server-side filtrlash
function applyHistoryFilters() {
    const statusVal = (document.getElementById('historyFilterStatus') || {}).value || 'all';
    const dirVal = (document.getElementById('historyFilterDirection') || {}).value || 'all';
    const speakerVal = (document.getElementById('historyFilterSpeaker') || {}).value || 'all';

    // Clear tugmasi ko'rinishini boshqarish
    const hasFilter = statusVal !== 'all' || dirVal !== 'all' || speakerVal !== 'all';
    const clearBtn = document.getElementById('btnClearHistoryFilters');
    if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';

    // Agar foydalanuvchi Transfer yoki Zuhra opa (AI ovoz) ni tanlasa, avtomatik Server CDR ga o'tkazamiz
    // Chunki transfer va AI ovoz tahlillari to'liq server CDR bazasida mavjud
    if ((dirVal === 'transfer' || speakerVal === 'zuhra') && historyDataSource !== 'server') {
        setHistorySource('server');
        return;
    }

    const btnServer = document.getElementById('btnHistorySourceServer');
    const isServerActiveInUI = btnServer && (btnServer.style.background.includes('gradient') || btnServer.style.background.includes('rgb(59, 130, 246)'));
    if (historyDataSource === 'server' || isServerActiveInUI) {
        historyDataSource = 'server';
        loadHistoryPage(1, historySearchQuery);
        return;
    }

    if (!currentHistoryData || currentHistoryData.length === 0) {
        renderAgentHistoryTable([]);
        return;
    }

    const filtered = currentHistoryData.filter(item => {
        // Holat filtri
        if (statusVal !== 'all') {
            const isOut = item.direction === 'outbound' || item.category_3cx === 'Dialled' || item.status === 'OUTBOUND' || item.status === 'DIALLED';
            const dur = item.duration_sec || item.duration || 0;
            const isAns = item.status === 'ANSWERED' || item.category_3cx === 'Answered' || (isOut && dur > 0);
            if (statusVal === 'answered' && !isAns) return false;
            if (statusVal === 'missed' && isAns) return false;
        }
        // Yo'nalish filtri
        if (dirVal !== 'all') {
            const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
            const isOut = (item.direction === 'outbound' ||
                item.category_3cx === 'Dialled' ||
                item.status === 'OUTBOUND' ||
                item.status === 'DIALLED') && !isXfer;
            if (dirVal === 'transfer' && !isXfer) return false;
            if (dirVal === 'inbound' && (isOut || isXfer)) return false;
            if (dirVal === 'outbound' && (!isOut || isXfer)) return false;
        }
        // Ovoz (Speaker) filtri
        if (speakerVal !== 'all') {
            const va = item.voiceAnalysis;
            if (speakerVal === 'zuhra' && (!va || va.speaker !== 'zuhra')) return false;
            if (speakerVal === 'muattar' && va && va.speaker !== 'muattar') return false;
        }
        return true;
    });

    renderAgentHistoryTable(filtered);
}

function resetHistoryFilters() {
    const s = document.getElementById('historyFilterStatus');
    const d = document.getElementById('historyFilterDirection');
    const sp = document.getElementById('historyFilterSpeaker');
    if (s) s.value = 'all';
    if (d) d.value = 'all';
    if (sp) sp.value = 'all';
    const clearBtn = document.getElementById('btnClearHistoryFilters');
    if (clearBtn) clearBtn.style.display = 'none';
    if (historyDataSource === 'server') {
        loadHistoryPage(1, historySearchQuery);
    } else {
        applyHistoryFilters();
    }
}
window.applyHistoryFilters = applyHistoryFilters;
window.resetHistoryFilters = resetHistoryFilters;

function formatOperatorDisplayName(opStr) {
    if (!opStr || opStr === 'Navbat' || opStr === '-') return t('op_queue_short', 'Navbat');
    if (opStr.includes('Operatorga ulanmadi') || opStr.includes('Не соединен с оператором') || opStr.includes('ulanmadi')) {
        return t('op_not_connected', 'Operatorga ulanmadi');
    }
    const renderOpSpan = (label, ext) => {
        return `<span class="op-link-click" onclick="event.stopPropagation(); if (typeof openOperatorDetail==='function') openOperatorDetail('${ext}');" style="cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; color: inherit; transition: color 0.15s;" title="${label} tafsilotlarini ochish">${label}</span>`;
    };
    if (opStr.includes('➔')) {
        const parts = opStr.split('➔').map(p => p.trim());
        const formattedParts = parts.map(p => {
            const match = p.match(/\b(10[1-9]|11[0-9]|120)\b/);
            if (match) {
                const ext = match[1];
                let name = OPERATOR_NAMES_MAP[ext];
                if (ext === '114') name = 'Maxmudbek';
                const label = name ? `${name} (${ext})` : (p.includes(`(${ext})`) ? p : `Operator (${ext})`);
                return renderOpSpan(label, ext);
            }
            return p;
        });
        return formattedParts.join(` <span style="color: #38bdf8; font-weight: 700; margin: 0 4px; display: inline-flex; align-items: center; vertical-align: middle;">${isax('arrow-right', '', 'width: 12px; height: 12px;')}</span> `);
    }
    const match = String(opStr).match(/\b(10[1-9]|11[0-9]|120)\b/);
    if (match) {
        const ext = match[1];
        let name = OPERATOR_NAMES_MAP[ext];
        if (ext === '114') name = 'Maxmudbek';
        const label = name ? `${name} (${ext})` : (opStr.includes(`(${ext})`) ? opStr : `Operator (${ext})`);
        return renderOpSpan(label, ext);
    }
    return opStr;
}

let clientContactsMap = new Map();

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

async function loadClientContacts() {
    try {
        const res = await fetch('/api/contacts');
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || []);
        setClientContactsList(list);
    } catch (e) { }
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
    const activeTab = document.documentElement.getAttribute('data-tab') || 'dashboard';
    const clientsTab = document.getElementById('tab-clients');
    if (activeTab === 'clients' || (clientsTab && (clientsTab.classList.contains('active') || window.getComputedStyle(clientsTab).display !== 'none'))) {
        loadClientsTab(true);
    }
}

/* ==========================================================================
   Mijozlar Boshqaruvi (Clients Management & Top Callers)
   ========================================================================== */
let adminClientsData = [];
let adminTopCallersData = [];
let adminClientsSearch = '';
let adminClientsLangFilter = '';
let adminClientsLoading = false;
let adminClientsSearchDebounceTimer = null;

function getClientLangBadgeHtml(lang) {
    if (lang === 'uz') {
        return `<span class="client-lang-badge lang-uz"><svg class="isax isax-global" style="width:12px;height:12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-global"></use></svg> O'zbek tili</span>`;
    } else if (lang === 'ru') {
        return `<span class="client-lang-badge lang-ru"><svg class="isax isax-global" style="width:12px;height:12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-global"></use></svg> Rus tili</span>`;
    } else if (lang === 'en') {
        return `<span class="client-lang-badge lang-en"><svg class="isax isax-global" style="width:12px;height:12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-global"></use></svg> Ingliz tili</span>`;
    } else if (lang === 'other') {
        return `<span class="client-lang-badge lang-other"><svg class="isax isax-global" style="width:12px;height:12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-global"></use></svg> Boshqa til</span>`;
    }
    return `<span class="client-lang-badge lang-none">—</span>`;
}

async function loadClientsTab(force = false) {
    if (adminClientsLoading && !force) return;
    adminClientsLoading = true;

    try {
        // 1. Saqlangan mijozlar ro'yxatini darhol yuklab jadvalni chiqaramiz (bloklanmasligi uchun)
        const contactsPromise = fetch('/api/contacts')
            .then(r => r.json())
            .then(contactsRes => {
                adminClientsData = Array.isArray(contactsRes) ? contactsRes : (contactsRes.data || []);
                setClientContactsList(adminClientsData);
                renderAdminClientsTable();
            })
            .catch(err => {
                console.error('[Clients] Error loading contacts:', err);
                renderAdminClientsTable();
            });

        // 2. Eng faol mijozlarni mustaqil ravishda yuklaymiz
        const topPromise = fetch('/api/contacts/top-active?limit=8')
            .then(r => r.json())
            .then(topRes => {
                adminTopCallersData = Array.isArray(topRes) ? topRes : (topRes.data || []);
                renderTopActiveClients(adminTopCallersData);
            })
            .catch(err => {
                console.error('[Clients] Error loading top callers:', err);
                renderTopActiveClients([]);
            });

        await Promise.allSettled([contactsPromise, topPromise]);
    } catch (err) {
        console.error('[Clients] Error loading data:', err);
    } finally {
        adminClientsLoading = false;
    }
}

function renderTopActiveClients(callers) {
    const grid = document.getElementById('topActiveClientsGrid');
    if (!grid) return;

    if (!callers || callers.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 28px; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 10px; border: 1px dashed rgba(255,255,255,0.08);">
                <p style="margin: 0; font-size: 13px;">Qo'ng'iroqlar tarixi bo'yicha faol mijozlar aniqlanmadi</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = callers.map((c, idx) => {
        const rank = idx + 1;
        const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
        const phone = safeEscapeAttr(c.phone || '');
        const name = safeEscapeAttr(c.name || '');
        const org = safeEscapeAttr(c.organization || '');
        const langHtml = getClientLangBadgeHtml(c.language || '');
        const totalCalls = c.total_calls !== undefined ? Number(c.total_calls) : (Number(c.totalCalls) || 0);
        const answeredCalls = c.answered_calls !== undefined ? Number(c.answered_calls) : (Number(c.answeredCalls) || 0);
        const answeredPct = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
        const isSaved = Boolean(c.is_saved !== undefined ? c.is_saved : (c.isSaved || name || org));

        const displayName = name ? `${name}` : (org ? `${org}` : phone);
        const subInfo = (name && org) ? org : (isSaved ? (name ? phone : (org ? phone : phone)) : t('clients_badge_unsaved', 'Yangi raqam'));

        const lastCallTime = c.last_call_time || c.lastCall || '';

        return `
            <div class="top-active-card ${rankClass}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                        <div class="card-rank-badge">#${rank}</div>
                        <div style="min-width: 0;">
                            <h4 style="margin: 0; font-size: 14px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${phone}">
                                ${displayName}
                            </h4>
                            <p style="margin: 2px 0 0; font-size: 11.5px; color: ${isSaved ? 'var(--text-muted)' : '#fbbf24'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${subInfo}
                            </p>
                        </div>
                    </div>
                    <div>
                        ${langHtml}
                    </div>
                </div>

                <div class="top-card-meta">
                    <div class="meta-item">
                        <span class="meta-label">Qo'ng'iroqlar</span>
                        <span class="meta-val" style="color: #60a5fa;">${totalCalls} ta</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Muvaffaqiyat</span>
                        <span class="meta-val" style="color: ${answeredPct >= 80 ? '#34d399' : (answeredPct >= 50 ? '#fbbf24' : '#f87171')};">${answeredPct}% (${answeredCalls})</span>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);">
                    <div style="font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">
                        <svg class="isax isax-clock" style="width: 12px; height: 12px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-clock"></use></svg>
                        <span>${lastCallTime ? String(lastCallTime).slice(0, 16) : '-'}</span>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" class="client-action-btn history" onclick="openClientCallHistory('${phone}')" title="Qo'ng'iroqlar tarixi">
                            <svg class="isax isax-clock" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-clock"></use></svg>
                        </button>
                        ${isSaved ? `
                            <button type="button" class="client-action-btn tg" onclick="openTelegramUser('${safeEscapeAttr(c.telegram_user_id || '')}', '${phone}')" title="Telegramda ochish${c.telegram_user_id ? ' (' + safeEscapeAttr(c.telegram_user_id) + ')' : ''}" style="color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3);">
                            <svg class="isax isax-send-2" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-send-2"></use></svg>
                        </button>
                        <button type="button" class="client-action-btn edit" onclick="openAdminEditClientModal('${phone}')" title="Tahrirlash">
                                <svg class="isax isax-edit" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-edit"></use></svg>
                            </button>
                        ` : `
                            <button type="button" class="btn-action" onclick="openAdminAddClientModal('${phone}')" style="padding: 4px 10px; font-size: 11px; font-weight: 600; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                <span>Saqlash</span>
                            </button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminClientsTable() {
    const tbody = document.getElementById('clientsTableBody');
    const countInfo = document.getElementById('clientsTableCountInfo');
    const totalBadge = document.getElementById('clientsTotalCountText');
    if (!tbody) return;

    if (totalBadge) {
        totalBadge.textContent = t('clients_total_count', 'Jami: {n} ta mijoz').replace('{n}', adminClientsData.length);
    }

    const query = (adminClientsSearch || '').toLowerCase().trim();
    const langFilter = (adminClientsLangFilter || '').trim();

    const filtered = adminClientsData.filter(c => {
        if (!c) return false;
        if (langFilter === 'empty') {
            if (c.language && c.language.trim() !== '') return false;
        } else if (langFilter !== '') {
            if ((c.language || '').toLowerCase() !== langFilter.toLowerCase()) return false;
        }

        if (query) {
            const phone = (c.phone || '').toLowerCase();
            const name = (c.name || '').toLowerCase();
            const org = (c.organization || '').toLowerCase();
            const notes = (c.notes || '').toLowerCase();
            const lang = (c.language || '').toLowerCase();
            const tgId = (c.telegram_user_id || '').toLowerCase();
            if (!phone.includes(query) && !name.includes(query) && !org.includes(query) && !notes.includes(query) && !lang.includes(query) && !tgId.includes(query)) {
                return false;
            }
        }
        return true;
    });

    if (countInfo) {
        countInfo.textContent = `${filtered.length} ta mijoz ko'rsatilmoqda (Jami: ${adminClientsData.length})`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 40px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <svg class="isax isax-search-normal" style="width: 28px; height: 28px; opacity: 0.4;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-search-normal"></use></svg>
                        <span>${query || langFilter ? t('clients_empty_search', "Qidiruv bo'yicha mijoz topilmadi") : t('clients_empty', 'Hozircha saqlangan mijozlar mavjud emas')}</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((c, index) => {
        const phone = safeEscapeAttr(c.phone || '');
        const name = safeEscapeAttr(c.name || '');
        const org = safeEscapeAttr(c.organization || '');
        const notes = safeEscapeAttr(c.notes || '');
        const langBadge = getClientLangBadgeHtml(c.language || '');
        const callCount = c.calls_count || 0;
        const lastCall = c.last_call_at ? String(c.last_call_at).slice(0, 16) : (c.updated_at ? String(c.updated_at).slice(0, 16) : '-');

        return `
            <tr>
                <td style="text-align: center; color: var(--text-muted); font-size: 12px;">${index + 1}</td>
                <td class="cell-left">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="width: 30px; height: 30px; border-radius: 8px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #818cf8; flex-shrink: 0;">
                            <svg class="isax isax-user" style="width: 15px; height: 15px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-user"></use></svg>
                        </div>
                        <div>
                            <div style="font-weight: 600; color: #fff; font-size: 13px;">${name || phone}</div>
                            ${name ? `<div style="font-size: 11.5px; color: var(--text-muted); font-family: monospace;">${phone}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td class="cell-left" style="font-size: 12.5px; color: ${org ? '#e2e8f0' : 'var(--text-dim)'};">
                    ${org || '—'}
                </td>
                <td style="text-align: center;">
                    ${langBadge}
                </td>
                <td style="text-align: center; font-weight: 600; color: #60a5fa; font-size: 13px;">
                    ${callCount > 0 ? `${callCount}` : '—'}
                </td>
                <td style="text-align: center; font-size: 12px; color: var(--text-muted);">
                    ${lastCall}
                </td>
                <td class="cell-left" style="font-size: 12px; color: var(--text-muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${notes}">
                    ${notes || '—'}
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 6px; align-items: center;">
                        <button type="button" class="client-action-btn history" onclick="openClientCallHistory('${phone}')" title="Qo'ng'iroqlar tarixi">
                            <svg class="isax isax-clock" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-clock"></use></svg>
                        </button>
                        <button type="button" class="client-action-btn edit" onclick="openAdminEditClientModal('${phone}')" title="Tahrirlash">
                            <svg class="isax isax-edit" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-edit"></use></svg>
                        </button>
                        <button type="button" class="client-action-btn delete" onclick="deleteAdminClient('${phone}')" title="O'chirish">
                            <svg class="isax isax-trash" style="width: 14px; height: 14px;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-trash"></use></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function handleClientsSearch(val) {
    adminClientsSearch = val || '';
    const clearBtn = document.getElementById('clientsSearchClearBtn');
    if (clearBtn) {
        clearBtn.style.display = adminClientsSearch ? 'block' : 'none';
    }
    clearTimeout(adminClientsSearchDebounceTimer);
    adminClientsSearchDebounceTimer = setTimeout(() => {
        renderAdminClientsTable();
    }, 200);
}

function clearClientsSearch() {
    const input = document.getElementById('clientsSearchInput');
    if (input) input.value = '';
    handleClientsSearch('');
}

function setClientsLangFilter(lang, btnEl) {
    adminClientsLangFilter = lang || '';
    const group = document.getElementById('clientsLangFilterGroup');
    if (group) {
        group.querySelectorAll('.lang-filter-btn').forEach(btn => btn.classList.remove('active'));
    }
    if (btnEl) {
        btnEl.classList.add('active');
    }
    renderAdminClientsTable();
}

function openAdminAddClientModal(presetPhone = '', presetName = '') {
    const modal = document.getElementById('adminClientModal');
    if (!modal) return;

    document.getElementById('adminClientOrigPhone').value = '';
    const phoneInput = document.getElementById('adminClientPhoneInput');
    phoneInput.value = presetPhone || '';
    phoneInput.readOnly = false;
    document.getElementById('adminClientNameInput').value = presetName || '';
    document.getElementById('adminClientOrgInput').value = '';
    const tgInput = document.getElementById('adminClientTelegramIdInput');
    if (tgInput) tgInput.value = '';
    document.getElementById('adminClientLangSelect').value = '';
    document.getElementById('adminClientNotesInput').value = '';

    const titleEl = document.getElementById('adminClientModalTitle');
    if (titleEl) titleEl.textContent = t('clients_modal_add_title', 'Yangi Mijoz Qo\'shish');

    const delBtn = document.getElementById('adminClientDeleteBtn');
    if (delBtn) delBtn.style.display = 'none';

    const statusEl = document.getElementById('adminClientStatus');
    if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }

    modal.style.display = 'flex';
    setTimeout(() => {
        if (!presetPhone) phoneInput.focus();
        else document.getElementById('adminClientNameInput').focus();
    }, 50);
}

function openAdminEditClientModal(phone) {
    const modal = document.getElementById('adminClientModal');
    if (!modal) return;

    const cleanPhone = String(phone || '').trim();
    const contact = adminClientsData.find(c => c && c.phone === cleanPhone) || getClientContact(cleanPhone) || { phone: cleanPhone };

    document.getElementById('adminClientOrigPhone').value = cleanPhone;
    const phoneInput = document.getElementById('adminClientPhoneInput');
    phoneInput.value = cleanPhone;
    phoneInput.readOnly = false;
    document.getElementById('adminClientNameInput').value = contact.name || '';
    document.getElementById('adminClientOrgInput').value = contact.organization || '';
    const tgEditInput = document.getElementById('adminClientTelegramIdInput');
    if (tgEditInput) tgEditInput.value = contact.telegram_user_id || contact.telegramUserId || '';
    document.getElementById('adminClientLangSelect').value = contact.language || '';
    document.getElementById('adminClientNotesInput').value = contact.notes || '';

    const titleEl = document.getElementById('adminClientModalTitle');
    if (titleEl) titleEl.textContent = t('clients_modal_edit_title', 'Mijoz Ma\'lumotlarini Tahrirlash');

    const delBtn = document.getElementById('adminClientDeleteBtn');
    if (delBtn) delBtn.style.display = 'inline-flex';

    const statusEl = document.getElementById('adminClientStatus');
    if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }

    modal.style.display = 'flex';
}

function smoothCloseDashboardModal(modalOrId, callback) {
    const el = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
    if (!el) {
        if (typeof callback === 'function') callback();
        return;
    }
    el.classList.add('modal-closing');
    setTimeout(() => {
        el.classList.remove('modal-closing');
        el.style.display = 'none';
        el.classList.remove('open', 'active');
        if (typeof callback === 'function') callback();
    }, 200);
}
window.smoothCloseDashboardModal = smoothCloseDashboardModal;

function closeAdminClientModal() {
    smoothCloseDashboardModal('adminClientModal');
}

async function handleAdminClientSubmit(e) {
    if (e) e.preventDefault();
    const origPhone = (document.getElementById('adminClientOrigPhone').value || '').trim();
    const phone = (document.getElementById('adminClientPhoneInput').value || '').trim();
    const name = (document.getElementById('adminClientNameInput').value || '').trim();
    const organization = (document.getElementById('adminClientOrgInput').value || '').trim();
    const language = (document.getElementById('adminClientLangSelect').value || '').trim();
    const notes = (document.getElementById('adminClientNotesInput').value || '').trim();
    const telegram_user_id = (document.getElementById('adminClientTelegramIdInput')?.value || '').trim();

    if (!phone) {
        alert("Telefon raqami kiritilishi shart!");
        return;
    }

    const saveBtn = document.getElementById('adminClientSaveBtn');
    const statusEl = document.getElementById('adminClientStatus');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const payload = { phone, name, organization, language, notes, telegram_user_id };
        const res = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data && data.success) {
            if (origPhone && origPhone !== phone) {
                try {
                    await fetch(`/api/contacts/${encodeURIComponent(origPhone)}`, { method: 'DELETE' });
                } catch (_) { }
            }

            closeAdminClientModal();
            await loadClientsTab(true);
        } else {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                statusEl.style.color = '#f87171';
                statusEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
                statusEl.textContent = data.error || 'Xatolik yuz berdi';
            }
        }
    } catch (err) {
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
            statusEl.style.color = '#f87171';
            statusEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            statusEl.textContent = 'Serverga ulanishda xatolik: ' + err.message;
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function deleteAdminClient(phone) {
    if (!phone) return;
    const confirmed = await showCustomConfirm({
        title: t('clients_btn_delete', 'O\'chirish'),
        message: `${phone} raqamli mijozni ro'yxatdan o'chirmoqchimisiz?`,
        okText: "Ha, o'chirilsin",
        cancelText: "Yo'q, qolsin"
    });

    if (!confirmed) return;

    try {
        const res = await fetch(`/api/contacts/${encodeURIComponent(phone)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data && data.success) {
            await loadClientsTab(true);
        } else {
            alert(data.error || "Mijozni o'chirib bo'lmadi");
        }
    } catch (err) {
        alert("O'chirishda xatolik: " + err.message);
    }
}

async function deleteAdminClientFromModal() {
    const origPhone = (document.getElementById('adminClientOrigPhone').value || '').trim();
    if (!origPhone) return;
    closeAdminClientModal();
    await deleteAdminClient(origPhone);
}

function formatCallerNumberOrOperator(callerId) {
    if (!callerId) return '-';
    const clean = String(callerId).trim();
    if (OPERATOR_NAMES_MAP && OPERATOR_NAMES_MAP[clean]) {
        return `${OPERATOR_NAMES_MAP[clean]} (${clean})`;
    }
    const contact = getClientContact(clean);
    if (contact) {
        const hasName = Boolean(contact.name && contact.name.trim());
        const hasOrg = Boolean(contact.organization && contact.organization.trim());
        if (hasName && hasOrg) {
            return `${clean} (${contact.name} • ${contact.organization})`;
        } else if (hasOrg) {
            return `${clean} (${contact.organization})`;
        } else if (hasName) {
            return `${clean} (${contact.name})`;
        }
    }
    return clean;
}

const expandedCallerKeys = new Set();

function isCallerExpanded(key) {
    return Boolean(key && expandedCallerKeys.has(String(key)));
}

function safeEscapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderExpandableCallerHtml(callerId, uniqueKey, maxLen = 25) {
    if (!callerId) return '<span>-</span>';
    const fullText = formatCallerNumberOrOperator(callerId);
    const safeKey = safeEscapeAttr(String(uniqueKey || callerId));
    const safeFull = safeEscapeAttr(fullText);

    // Agar matn uzunligi maxLen dan oshmasa (oddiy raqam yoki qisqa nom), limit va tugma kerak emas
    if (fullText.length <= maxLen) {
        return `<span class="caller-single-text" title="${safeFull}">${safeFull}</span>`;
    }

    const isExp = isCallerExpanded(uniqueKey);
    const truncText = fullText.slice(0, maxLen - 2).trim();
    const safeTrunc = safeEscapeAttr(truncText);

    return `
        <span class="caller-cell-content ${isExp ? 'is-expanded' : ''}" 
              data-caller-key="${safeKey}" 
              data-full-text="${safeFull}" 
              data-trunc-text="${safeTrunc}">
            <span class="caller-text" 
                  title="${safeFull}" 
                  onclick="toggleCallerExpand('${safeKey}', event)">${isExp ? safeFull : safeTrunc}</span>
            <button type="button" 
                    class="caller-expand-btn ${isExp ? 'is-expanded' : ''}" 
                    onclick="toggleCallerExpand('${safeKey}', event)" 
                    title="${isExp ? t('caller_collapse_title', "Qisqartirish (yig'ish)") : t('caller_expand_title', "To'liq ko'rish (pastga yoyish)")}">${isExp ? t('caller_collapse_btn', "▲ yig'ish") : '...'}</button>
        </span>
    `;
}

function toggleCallerExpand(key, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!key) return;
    const strKey = String(key);

    if (expandedCallerKeys.has(strKey)) {
        expandedCallerKeys.delete(strKey);
    } else {
        expandedCallerKeys.add(strKey);
    }

    const isExp = expandedCallerKeys.has(strKey);
    const cells = document.querySelectorAll('.caller-cell-content');
    cells.forEach(cell => {
        if (cell.getAttribute('data-caller-key') === strKey) {
            const fullText = cell.getAttribute('data-full-text') || '';
            const truncText = cell.getAttribute('data-trunc-text') || '';
            const phoneCell = cell.closest('.phone-cell');
            const tdEl = cell.closest('td');

            if (isExp) {
                cell.classList.add('is-expanded');
                if (phoneCell) phoneCell.classList.add('is-expanded');
                if (tdEl) tdEl.classList.add('cell-expanded');
                const textEl = cell.querySelector('.caller-text');
                if (textEl) textEl.textContent = fullText;
                const btnEl = cell.querySelector('.caller-expand-btn');
                if (btnEl) {
                    btnEl.classList.add('is-expanded');
                    btnEl.textContent = t('caller_collapse_btn', "▲ yig'ish");
                    btnEl.title = t('caller_collapse_title', "Qisqartirish (yig'ish)");
                }
            } else {
                cell.classList.remove('is-expanded');
                if (phoneCell) phoneCell.classList.remove('is-expanded');
                if (tdEl) tdEl.classList.remove('cell-expanded');
                const textEl = cell.querySelector('.caller-text');
                if (textEl) textEl.textContent = truncText;
                const btnEl = cell.querySelector('.caller-expand-btn');
                if (btnEl) {
                    btnEl.classList.remove('is-expanded');
                    btnEl.textContent = '...';
                    btnEl.title = t('caller_expand_title', "To'liq ko'rish (pastga yoyish)");
                }
            }
        }
    });
}

function formatHangupParty(party, isXfer) {
    if (isXfer) {
        return `<span style="color: #c084fc; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${isax('arrow-swap-horizontal', '', 'width: 11px; height: 11px; color: #c084fc;')} ${t('party_transfer', 'Transfer')}</span>`;
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
        return `<span style="color: #c084fc; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${isax('arrow-swap-horizontal', '', 'width: 11px; height: 11px; color: #c084fc;')} ${t('party_transfer', 'Transfer')}</span>`;
    }
    return `<span style="font-weight: 500;">${p}</span>`;
}

function renderAgentHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    if (!data || data.length === 0) {
        if (historySearchQuery && historyDateScope === 'today') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">${t('detail_no_call_number', "Bugun bu raqam bo'yicha qo'ng'iroq topilmadi")}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">${t('detail_no_call_hint', "Mijoz avvalgi kunlarda qo'ng'iroq qilgan bo'lishi mumkin.")}</div>
                        <button type="button" onclick="setHistoryScope('all')" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 18px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                            <span>♾️</span> ${t('hist_search_all_days', "Barcha kunlar bo'yicha qidirish")}
                        </button>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-dim); padding: 24px;">${t('hist_empty', "Qo'ng'iroqlar tarixi topilmadi")}</td></tr>`;
        }
        return;
    }

    const isAll = (historyDateScope === 'all') || (historyDateScope === 'range');

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = (historyCurrentPage - 1) * 20 + index + 1;
        const durSec = item.duration_sec || item.duration || 0;
        const isOut = item.category_3cx === 'Dialled' || item.status === 'OUTBOUND' || item.status === 'DIALLED';
        const isAns = item.category_3cx === 'Answered' || item.status === 'ANSWERED';
        const isMissed = item.category_3cx === 'Missed' || item.status === 'MISSED' || item.status === 'REJECT';

        let rowClass = 'recent-call-row';
        if (isMissed) {
            rowClass += ' miss';
        } else if (isOut) {
            rowClass += ' xfer';
        }

        const uniqueRowKey = `agent_${item.id || ''}_${item.caller_id || ''}_${item.event_time || index}`;
        const safeKey = String(uniqueRowKey).replace(/'/g, "\\'");
        const isChecked = selectedHistoryKeys.has(uniqueRowKey);
        if (isChecked) rowClass += ' row-selected';

        let statusBadge = '';
        if (isOut) {
            if (durSec > 0) {
                statusBadge = `<span class="badge badge-purple" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: #c084fc; margin: 0;"></span> ${t('status_dialled_connected', 'Chiquvchi (Bog\'langan)')}</span>`;
            } else {
                statusBadge = `<span class="badge badge-warning" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: #94a3b8; margin: 0;"></span> ${t('status_dialled_unconnected', 'Chiquvchi (Ulanmagan)')}</span>`;
            }
        } else if (isAns) {
            statusBadge = `<span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--ok, #2cc4ae); margin: 0;"></span> ${t('status_accepted', 'Qabul qilingan')}</span>`;
        } else if (item.status === 'REJECT') {
            statusBadge = `<span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--miss, #ff6b70); margin: 0;"></span> ${t('status_denied', 'Rad etilgan')}</span>`;
        } else if (isMissed) {
            statusBadge = `<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--miss, #ff6b70); margin: 0;"></span> ${t('status_missed', "O'tkazib yuborilgan")}</span>`;
        } else {
            statusBadge = `<span class="badge badge-warning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--wait, #f2b035); margin: 0;"></span> ${item.status_name || item.status}</span>`;
        }

        const dirBadge = isOut
            ? `<span class="badge badge-purple" style="display: inline-flex; align-items: center; gap: 4px;"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>`
            : `<span class="badge badge-info" style="display: inline-flex; align-items: center; gap: 4px;"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`;

        let timeHtml = '';
        if (item.event_time) {
            const spl = item.event_time.split(' ');
            const dateStr = spl[0] || '';
            const timeStr = spl[1] || item.event_time;
            if (isAll) {
                timeHtml = `<div style="font-weight: 700; color: #60a5fa; font-size: 11px; letter-spacing: 0.3px;">${dateStr}</div><div style="font-family: monospace; color: var(--mute, #8d9bb0); font-size: 11px;">${timeStr}</div>`;
            } else {
                timeHtml = `<div style="font-family: monospace; color: var(--mute, #8d9bb0); font-size: 12px;" title="${item.event_time}">${timeStr}</div>`;
            }
        } else {
            timeHtml = '—';
        }

        // --- Audio / Amal ustuni ---
        const isConnectedOut = isOut && durSec > 0;
        const hasAudio = ((isAns || isConnectedOut) && durSec > 0) || Boolean(item.recording);
        const safeRec = (item.recording || '').replace(/'/g, "\\'");
        const safeCaller = (item.caller_id || '').replace(/'/g, "\\'");
        const callKey = `${item.caller_id || ''}_${durSec}`;
        const isThisPlaying = currentlyPlayingCallKey === callKey;
        const isThisPaused = pausedCallKey === callKey;
        const isThisSearching = activeSearchingCallerId === (item.caller_id || '');

        const playBtnText = isThisSearching
            ? `${isax('timer')} ` + t('dyn_searching', 'Qidirilmoqda...')
            : (isThisPlaying ? `${isax('pause', '', 'width: 12px; height: 12px;')} ` + t('dyn_pause', "To'xtatish") : (isThisPaused ? `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_resume', 'Davom ettirish') : `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_listen', 'Tinglash')));

        let audioCell = '';
        if (hasAudio) {
            audioCell = `
                <div class="act">
                    <button type="button" class="btn p ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                            ${isThisSearching ? 'disabled' : ''} 
                            onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                            title="${isThisPlaying ? t('audio_pause_title', "To'xtatish (pauza)") : (isThisPaused ? t('audio_resume_title', 'Qolgan joyidan davom ettirish') : t('audio_play_title', 'Audioni tinglash'))}">
                        <span>${playBtnText}</span>
                    </button>
                    <button type="button" class="btn" 
                            onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                            title="${t('audio_detail_title', "Audio Explorer studiyasida to'liq pleyer bilan ochish")}">
                        <span>${isax('search-normal', '', 'width: 12px; height: 12px; vertical-align: middle;')} ${t('audio_detail_short', 'Detal')}</span>
                    </button>
                    <button type="button" class="btn btn-stt-matn" 
                            onclick="openCallTranscription('${safeRec}', '${safeCaller}', ${durSec}, '${item.event_time || ''}', this)" 
                            title="Speech-to-Text: Suhbat transkripsiyasini ochish">
                        <svg class="isax isax-document-text" style="width: 13px; height: 13px; vertical-align: middle;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-document-text"></use></svg>
                        <span>Matn</span>
                    </button>
                    ${renderVoiceAnalysisBadge(item.voiceAnalysis)}
                </div>
            `;
        } else {
            audioCell = `
                <div class="act">
                    <button type="button" class="btn" disabled style="opacity: 0.45; cursor: not-allowed;" title="${t('audio_none_title', "Suhbat bo'lmagan (ovoz yozuvi mavjud emas)")}">
                        <svg class="isax isax-close-circle" style="width: 12px; height: 12px; vertical-align: middle;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-close-circle"></use></svg>
                        <span>${t('audio_none', "Audio yo'q")}</span>
                    </button>
                </div>
            `;
        }

        const callerKey = `agent_${item.id || ''}_${item.caller_id || ''}_${item.time || item.event_time || index}`;
        const isExpCaller = isCallerExpanded(callerKey);
        const dirIcon = isOut ? '↗' : '↙';
        const dirClass = isOut ? 'out' : 'in';

        let hangupPartyDisplay = '—';
        if (item.hangupParty || item.hangup_party) {
            hangupPartyDisplay = formatHangupParty(item.hangupParty || item.hangup_party, isXfer);
        } else if (isOut) {
            if (durSec > 0) {
                hangupPartyDisplay = `<span style="color: #60a5fa; font-weight: 600;">${t('hangup_client', 'Mijoz')}</span>`;
            } else {
                hangupPartyDisplay = `<span style="color: var(--mute, #8d9bb0);">${t('status_no_answer', 'Javobsiz')}</span>`;
            }
        } else if (isAns) {
            hangupPartyDisplay = `<span style="color: #60a5fa; font-weight: 600;">${t('hangup_client', 'Mijoz')}</span>`;
        } else {
            hangupPartyDisplay = `<span style="color: var(--mute, #8d9bb0);">${t('status_abandoned', 'Navbatdan chiqdi')}</span>`;
        }

        const hostDisplay = item.hostname
            ? `<span style="display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: #93c5fd;">💻 ${item.hostname}</span>`
            : `<span style="color: var(--mute, #8d9bb0);">Desktop</span>`;

        return `
            <tr class="${rowClass}" data-call-key="${safeKey}">
                <td class="col-cb" data-col="cb" style="width: 38px; text-align: center; padding: 0 8px 0 12px;">
                    <input type="checkbox" class="history-row-cb" data-row-key="${safeKey}" ${isChecked ? 'checked' : ''} onchange="handleHistoryRowSelect('${safeKey}', '', '${safeCaller}', ${durSec}, '${item.event_time || ''}', this)" style="accent-color: #38bdf8; width: 15px; height: 15px; cursor: pointer; vertical-align: middle;">
                </td>
                <td class="col-num col-row-num" data-col="num" style="color: var(--mute, #8d9bb0); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td class="col-time" data-col="time">${timeHtml}</td>
                <td class="col-phone ${isExpCaller ? 'cell-expanded' : ''}" data-col="phone">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="dir ${dirClass}" title="${isOut ? t('dir_outbound', 'Chiquvchi') : t('dir_inbound', 'Kiruvchi')}">${dirIcon}</span>
                        <span class="num">${renderExpandableCallerHtml(item.caller_id, callerKey)}</span>
                    </div>
                </td>
                <td class="col-operator" data-col="operator" style="font-weight: 600; color: var(--ink, #e8edf5);">${formatOperatorDisplayName(item.operator_id)}</td>
                <td class="col-dir" data-col="dir">${dirBadge}</td>
                <td class="col-dur" data-col="dur" style="font-family: monospace; font-weight: 600; color: ${isAns ? 'var(--ink, #e8edf5)' : 'var(--mute, #8d9bb0)'};">${formatSeconds(durSec)}</td>
                <td class="col-wait" data-col="wait" style="font-size: 11px; color: var(--mute, #8d9bb0); text-align: center;" title="${t('agent_no_wait_title', '3CX Agent jurnalida navbatda kutish vaqti mavjud emas')}">—</td>
                <td class="col-status" data-col="status">${statusBadge}</td>
                <td class="col-hangup" data-col="hangup" style="font-size: 12px; color: var(--mute, #8d9bb0);">${hangupPartyDisplay}</td>
                <td class="col-host" data-col="host" style="color: var(--mute, #8d9bb0); font-size: 12px;">${hostDisplay}</td>
                <td class="col-action" data-col="action" style="text-align: right;">${audioCell}</td>
            </tr>
        `;
    }).join('');
}

function renderServerHistoryRowHtml(item, rowNum, isLiveNew = false) {
    const isAll = (historyDateScope === 'all') || (historyDateScope === 'range');
    const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
    const isOut = item.direction === 'outbound' && !isXfer;
    const isAns = item.status === 'ANSWERED';
    const durSec = item.duration || item.duration_sec || 0;
    const isConnectedOut = isOut && (durSec > 0 || Boolean(item.recording));
    const isUnconnected = !isAns && !isConnectedOut && !isXfer;

    let rowClass = 'recent-call-row';
    if (isXfer) {
        rowClass += ' xfer';
    } else if (item.status === 'BUSY' || item.status === 'NO ANSWER') {
        rowClass += ' miss';
    } else if (isUnconnected) {
        rowClass += ' lost';
    } else if (isOut) {
        rowClass += ' xfer';
    }
    if (isLiveNew) rowClass += ' live-call-new-row';

    const uniqueRowKey = item.uniqueid || (item.recording || (item.callerId + '_' + (item.time || '') + '_' + (item.duration || 0)));
    const safeKey = String(uniqueRowKey).replace(/'/g, "\\'");
    const isChecked = selectedHistoryKeys.has(uniqueRowKey);
    if (isChecked) rowClass += ' row-selected';

    let statusBadge = '';
    if (isXfer) {
        statusBadge = `<span class="badge badge-purple" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); display: inline-flex; align-items: center; gap: 4px;">${isax('arrow-swap-horizontal', '', 'width: 12px; height: 12px;')} ${t('status_transferred', 'Transfer qilingan')}</span>`;
    } else if (isAns) {
        statusBadge = `<span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--ok, #2cc4ae); margin: 0;"></span> ${t('status_answered', 'Qabul qilingan')}</span>`;
    } else if (isOut) {
        if (durSec > 0) {
            statusBadge = `<span class="badge badge-purple" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: #c084fc; margin: 0;"></span> ${t('status_dialled_connected', 'Chiquvchi (Bog\'langan)')}</span>`;
        } else if (item.status === 'BUSY') {
            statusBadge = `<span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--miss, #ff6b70); margin: 0;"></span> ${t('status_busy', 'Band')}</span>`;
        } else {
            statusBadge = `<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--miss, #ff6b70); margin: 0;"></span> ${t('status_no_answer', 'Javobsiz')}</span>`;
        }
    } else {
        statusBadge = `<span class="badge badge-warning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="dot" style="--c: var(--wait, #f2b035); margin: 0;"></span> ${t('status_abandoned', 'Navbatdan chiqdi')}</span>`;
    }

    const dirBadge = isXfer
        ? `<span class="badge badge-cyan" style="display: inline-flex; align-items: center; gap: 4px;">${isax('refresh', '', 'width: 12px; height: 12px;')} ${t('dir_transfer', 'transfer')}</span>`
        : (isOut
            ? `<span class="badge badge-purple" style="display: inline-flex; align-items: center; gap: 4px;"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>`
            : `<span class="badge badge-info" style="display: inline-flex; align-items: center; gap: 4px;"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`);

    let timeHtml = '';
    if (item.time) {
        const spl = String(item.time).split(' ');
        const dateStr = spl[0] || '';
        let timeStr = spl[1] || '';
        if (!timeStr) {
            try {
                const d = new Date(item.time);
                timeStr = d.toLocaleTimeString('uz-UZ', { hour12: false, timeZone: 'Asia/Tashkent' });
            } catch (e) {
                timeStr = item.time;
            }
        }
        if (isAll) {
            timeHtml = `<div style="font-weight: 700; color: #60a5fa; font-size: 11px; letter-spacing: 0.3px;">${dateStr}</div><div style="font-family: monospace; color: var(--mute, #8d9bb0); font-size: 11px;">${timeStr}</div>`;
        } else {
            timeHtml = `<div style="font-family: monospace; color: var(--mute, #8d9bb0); font-size: 12px;" title="${item.time}">${timeStr}</div>`;
        }
    } else {
        timeHtml = '—';
    }

    // --- Audio / Amal ustuni ---
    const hasAudio = ((isAns || isConnectedOut) && durSec > 0) || Boolean(item.recording);
    const safeRec = (item.recording || '').replace(/'/g, "\\'");
    const safeCaller = (item.callerId || '').replace(/'/g, "\\'");
    const timeVal = item.time || '';
    const callKey = `${item.callerId || ''}_${durSec}`;
    const isThisPlaying = currentlyPlayingCallKey === callKey;
    const isThisPaused = pausedCallKey === callKey;
    const isThisSearching = activeSearchingCallerId === (item.callerId || '');

    const playBtnText = isThisSearching
        ? `${isax('timer')} ` + t('dyn_searching', 'Qidirilmoqda...')
        : (isThisPlaying ? `${isax('pause', '', 'width: 12px; height: 12px;')} ` + t('dyn_pause', "To'xtatish") : (isThisPaused ? `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_resume', 'Davom ettirish') : `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_listen', 'Tinglash')));

    let audioCell = '';
    if (hasAudio) {
        audioCell = `
            <div class="act">
                <button type="button" class="btn p ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                        ${isThisSearching ? 'disabled' : ''} 
                        onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                        title="${isThisPlaying ? t('audio_pause_title', "To'xtatish (pauza)") : (isThisPaused ? t('audio_resume_title', 'Qolgan joyidan davom ettirish') : t('audio_play_title', 'Audioni tinglash'))}">
                    <span>${playBtnText}</span>
                </button>
                <button type="button" class="btn" 
                        onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                        title="${t('audio_detail_title', "Audio Explorer studiyasida to'liq pleyer bilan ochish")}">
                    <span>${isax('search-normal', '', 'width: 12px; height: 12px; vertical-align: middle;')} ${t('audio_detail_short', 'Detal')}</span>
                </button>
                <button type="button" class="btn btn-stt-matn" 
                        onclick="openCallTranscription('${safeRec}', '${safeCaller}', ${durSec}, '${timeVal}', this)" 
                        title="Speech-to-Text: Suhbat transkripsiyasini ochish">
                    <svg class="isax isax-document-text" style="width: 13px; height: 13px; vertical-align: middle;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-document-text"></use></svg>
                    <span>Matn</span>
                </button>
                ${renderVoiceAnalysisBadge(item.voiceAnalysis)}
            </div>
        `;
    } else {
        audioCell = `
            <div class="act">
                <button type="button" class="btn" disabled style="opacity: 0.45; cursor: not-allowed;" title="${t('audio_none_title', "Suhbat bo'lmagan (ovoz yozuvi mavjud emas)")}">
                    <svg class="isax isax-close-circle" style="width: 12px; height: 12px; vertical-align: middle;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-close-circle"></use></svg>
                    <span>${t('audio_none', "Audio yo'q")}</span>
                </button>
            </div>
        `;
    }

    let hangupDisplay = '—';
    if (item.hangupParty || item.cause) {
        hangupDisplay = formatHangupParty(item.hangupParty || item.cause, isXfer);
    } else if (isOut) {
        if (durSec > 0) {
            hangupDisplay = `<span style="color: #60a5fa; font-weight: 600;">${t('hangup_client', 'Mijoz')}</span>`;
        } else {
            hangupDisplay = `<span style="color: var(--mute, #8d9bb0);">${t('status_no_answer', 'Javobsiz')}</span>`;
        }
    } else if (isAns) {
        hangupDisplay = `<span style="color: #60a5fa; font-weight: 600;">${t('hangup_client', 'Mijoz')}</span>`;
    } else {
        hangupDisplay = `<span style="color: var(--mute, #8d9bb0);">${t('status_abandoned', 'Navbatdan chiqdi')}</span>`;
    }

    const callerKey = `hist_${item.recording || ''}_${item.callerId || ''}_${item.time || rowNum}`;
    const isExpCaller = isCallerExpanded(callerKey);
    const dirIcon = isOut ? '↗' : (isXfer ? '⇄' : '↙');
    const dirClass = isOut ? 'out' : (isXfer ? 'xfer' : 'in');

    const hostDisplay = item.hostname
        ? `<span style="display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: #93c5fd;">💻 ${item.hostname}</span>`
        : `<span style="color: var(--mute, #8d9bb0);">—</span>`;

    return `
        <tr class="${rowClass}" data-call-key="${safeKey}">
            <td class="col-cb" data-col="cb" style="width: 38px; text-align: center; padding: 0 8px 0 12px;">
                <input type="checkbox" class="history-row-cb" data-row-key="${safeKey}" ${isChecked ? 'checked' : ''} onchange="handleHistoryRowSelect('${safeKey}', '${safeRec}', '${safeCaller}', ${durSec}, '${timeVal}', this)" style="accent-color: #38bdf8; width: 15px; height: 15px; cursor: pointer; vertical-align: middle;">
            </td>
            <td class="col-num col-row-num" data-col="num" style="color: var(--mute, #8d9bb0); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
            <td class="col-time" data-col="time">${timeHtml}</td>
            <td class="col-phone ${isExpCaller ? 'cell-expanded' : ''}" data-col="phone">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="dir ${dirClass}" title="${isOut ? t('dir_outbound', 'Chiquvchi') : (isXfer ? t('dir_transfer', 'Transfer') : t('dir_inbound', 'Kiruvchi'))}">${dirIcon}</span>
                    <span class="num">${renderExpandableCallerHtml(item.callerId, callerKey)}</span>
                </div>
            </td>
            <td class="col-operator" data-col="operator" style="font-weight: 600; color: var(--ink, #e8edf5);">${formatOperatorDisplayName(item.operator)}</td>
            <td class="col-dir" data-col="dir">${dirBadge}</td>
            <td class="col-dur" data-col="dur" style="font-family: monospace; font-weight: 600; color: ${isAns ? 'var(--ink, #e8edf5)' : 'var(--mute, #8d9bb0)'};">${formatSeconds(durSec)}</td>
            <td class="col-wait" data-col="wait" style="font-family: monospace; font-weight: 600; color: ${(!isOut && item.waitSec) ? 'var(--wait, #f2b035)' : 'var(--mute, #8d9bb0)'};" title="${(!isOut && item.waitSec) ? tf('wait_title', { time: formatSeconds(item.waitSec) }, `Navbatda kutish: ${formatSeconds(item.waitSec)}`) : t('wait_title_none', 'Navbatda kutish vaqti mavjud emas')}">${isOut ? '—' : ((item.waitSec !== undefined && item.waitSec !== null && item.waitSec > 0) ? formatSeconds(item.waitSec) : (isAns ? '00:00' : '—'))}</td>
            <td class="col-status" data-col="status">${statusBadge}</td>
            <td class="col-hangup" data-col="hangup" style="font-size: 12px; color: var(--mute, #8d9bb0);">${hangupDisplay}</td>
            <td class="col-host" data-col="host" style="color: var(--mute, #8d9bb0); font-size: 12px;">${hostDisplay}</td>
            <td class="col-action" data-col="action" style="text-align: right;">${audioCell}</td>
        </tr>
    `;
}

function renderServerHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    if (!data || data.length === 0) {
        if (historySearchQuery && historyDateScope === 'today') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="12" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">${t('detail_no_call_number', "Bugun bu raqam bo'yicha qo'ng'iroq topilmadi")}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">${t('detail_no_call_hint', "Mijoz avvalgi kunlarda qo'ng'iroq qilgan bo'lishi mumkin.")}</div>
                        <button type="button" onclick="setHistoryScope('all')" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 18px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                            <span>♾️</span> ${t('hist_search_all_days', "Barcha kunlar bo'yicha qidirish")}
                        </button>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-dim); padding: 24px;">${t('hist_empty', "Qo'ng'iroqlar tarixi topilmadi")}</td></tr>`;
        }
        return;
    }

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = (historyCurrentPage - 1) * 20 + index + 1;
        return renderServerHistoryRowHtml(item, rowNum, false);
    }).join('');
}

function prependLiveHistoryRow(record) {
    if (!record) return;
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    // 1. Faqat foydalanuvchi "bugun", 1-sahifada va qidiruvsiz turganda yangi qo'ng'iroqni tepaga qo'shamiz.
    const todayStr = getTodayDateString();
    const activeDate = currentSelectedDate || todayStr;
    const isToday = (historyDateScope !== 'all') && (historyDateScope !== 'range') && (activeDate === todayStr);
    const isFirstPage = (historyCurrentPage === 1);
    const hasNoSearch = !historySearchQuery;

    if (!isToday || !isFirstPage || !hasNoSearch) {
        return;
    }

    // Status yoki direction filtri tanlangan bo'lsa, mos kelmasa qo'shmaymiz
    const statusVal = (document.getElementById('historyFilterStatus') || {}).value || 'all';
    const dirVal = (document.getElementById('historyFilterDirection') || {}).value || 'all';
    if (statusVal !== 'all' && record.status !== statusVal) return;
    if (dirVal !== 'all' && record.direction !== dirVal) return;

    // Dublikat tekshiruvi (agar bu qo'ng'iroq allaqachon jadvalda bo'lsa)
    const callKey = record.uniqueid || (record.recording || (record.callerId + '_' + (record.time || '') + '_' + (record.duration || 0)));
    const existing = tbody.querySelector(`tr[data-call-key="${(callKey || '').replace(/"/g, '\\"')}"]`);
    if (existing) return;

    // Agar bo'sh yoki spinner holati bo'lsa, uni tozalaymiz
    const emptyRow = tbody.querySelector('td[colspan]');
    if (emptyRow) {
        tbody.innerHTML = '';
    }

    // Yangi satr HTML ini yaratamiz va jadvalning eng yuqorisiga silliq qo'shamiz
    const newRowHtml = renderServerHistoryRowHtml(record, 1, true);
    tbody.insertAdjacentHTML('afterbegin', newRowHtml);

    // Barcha satrlar tartib raqamini (1..20) yangilaymiz (2-ustun: col-row-num)
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((r, idx) => {
        const numTd = r.querySelector('td.col-row-num') || r.querySelectorAll('td')[1];
        if (numTd) numTd.textContent = idx + 1;
    });

    // Sahifada maksimal 20 ta yozuv bo'lishi kerak, ortiqchasini (21-satrni) silliq olib tashlaymiz
    if (rows.length > 20) {
        tbody.lastElementChild.remove();
    }

    // currentHistoryData xotirasiga ham qo'shamiz
    if (Array.isArray(currentHistoryData)) {
        currentHistoryData.unshift(record);
        if (currentHistoryData.length > 20) {
            currentHistoryData.pop();
        }
    }

    // Jami yozuvlar hisoblagichini (historyCountInfo) 1 taga oshiramiz
    const countInfo = document.getElementById('historyCountInfo');
    if (countInfo && countInfo.innerText) {
        const match = countInfo.innerText.match(/\d+/);
        if (match) {
            const newTotal = parseInt(match[0], 10) + 1;
            countInfo.innerText = tf('hist_count_records', { n: newTotal }, `Jami: ${newTotal} ta yozuv`);
            historyTotalPages = Math.max(1, Math.ceil(newTotal / 20));
            const pageDisp = document.getElementById('pageNumberDisplay');
            if (pageDisp) {
                pageDisp.innerText = tf('hist_page', { page: historyCurrentPage, total: historyTotalPages }, `Sahifa ${historyCurrentPage} / ${historyTotalPages}`);
            }
            const pagControls = document.getElementById('historyPaginationControls');
            if (pagControls) {
                pagControls.style.display = historyTotalPages > 1 ? 'flex' : 'none';
            }
        }
    }
}

const renderHistoryTable = renderServerHistoryTable;

/* ==========================================================================
   History Selection & Batch Audio Action Bar
   ========================================================================== */
let selectedHistoryKeys = new Set();
let selectedHistoryRecords = new Map();

function handleHistoryRowSelect(rowKey, recFile, callerId, durSec, time, cb) {
    if (cb && cb.checked) {
        selectedHistoryKeys.add(rowKey);
        selectedHistoryRecords.set(rowKey, {
            rowKey,
            recording: recFile || '',
            callerId: callerId || '',
            duration: Number(durSec) || 0,
            time: time || ''
        });
        const tr = cb.closest('tr');
        if (tr) tr.classList.add('row-selected');
    } else {
        selectedHistoryKeys.delete(rowKey);
        selectedHistoryRecords.delete(rowKey);
        const tr = cb ? cb.closest('tr') : null;
        if (tr) tr.classList.remove('row-selected');
    }
    updateHistorySelectionBar();
}
window.handleHistoryRowSelect = handleHistoryRowSelect;

function toggleSelectAllHistory(checked) {
    const cbs = document.querySelectorAll('#historyTableBody input.history-row-cb');
    cbs.forEach(cb => {
        cb.checked = checked;
        const rowKey = cb.dataset.rowKey;
        const tr = cb.closest('tr');
        if (checked) {
            if (tr) tr.classList.add('row-selected');
            selectedHistoryKeys.add(rowKey);
            const found = currentHistoryData.find(item => {
                const uKey = item.uniqueid || (item.recording || (item.callerId + '_' + (item.time || '') + '_' + (item.duration || 0)));
                const aKey = `agent_${item.id || ''}_${item.caller_id || ''}_${item.event_time || ''}`;
                return uKey === rowKey || aKey === rowKey || String(item.id) === rowKey;
            });
            if (found) {
                selectedHistoryRecords.set(rowKey, {
                    rowKey,
                    recording: found.recording || '',
                    callerId: found.callerId || found.caller_id || '',
                    duration: found.duration || found.duration_sec || 0,
                    time: found.time || found.event_time || ''
                });
            } else {
                selectedHistoryRecords.set(rowKey, { rowKey, recording: '', callerId: '', duration: 0, time: '' });
            }
        } else {
            if (tr) tr.classList.remove('row-selected');
            selectedHistoryKeys.delete(rowKey);
            selectedHistoryRecords.delete(rowKey);
        }
    });
    updateHistorySelectionBar();
}
window.toggleSelectAllHistory = toggleSelectAllHistory;

function clearHistorySelection() {
    selectedHistoryKeys.clear();
    selectedHistoryRecords.clear();
    const allCb = document.getElementById('historySelectAllCb');
    if (allCb) {
        allCb.checked = false;
        allCb.indeterminate = false;
    }
    document.querySelectorAll('#historyTableBody input.history-row-cb').forEach(cb => {
        cb.checked = false;
        const tr = cb.closest('tr');
        if (tr) tr.classList.remove('row-selected');
    });
    updateHistorySelectionBar();
}
window.clearHistorySelection = clearHistorySelection;

function updateHistorySelectionBar() {
    const bar = document.getElementById('historySelectionBar');
    const countText = document.getElementById('historySelectedCountText');
    const audioBadge = document.getElementById('historySelectedAudioBadge');
    const allCb = document.getElementById('historySelectAllCb');
    if (!bar) return;

    const totalSelected = selectedHistoryKeys.size;
    let audioCount = 0;
    selectedHistoryRecords.forEach(rec => {
        if (rec.recording || rec.duration > 0) audioCount++;
    });

    if (totalSelected > 0) {
        bar.style.display = 'flex';
        if (countText) countText.textContent = `${totalSelected} ta tanlandi`;
        if (audioBadge) {
            audioBadge.textContent = `${audioCount} ta audio mavjud`;
            audioBadge.style.display = audioCount > 0 ? 'inline-flex' : 'none';
        }
    } else {
        bar.style.display = 'none';
    }

    const pageCbs = document.querySelectorAll('#historyTableBody input.history-row-cb');
    if (allCb && pageCbs.length > 0) {
        const allChecked = Array.from(pageCbs).every(cb => cb.checked);
        const someChecked = Array.from(pageCbs).some(cb => cb.checked);
        allCb.checked = allChecked;
        allCb.indeterminate = !allChecked && someChecked;
    }
}
window.updateHistorySelectionBar = updateHistorySelectionBar;

async function downloadSelectedHistoryAudio() {
    const audioFiles = [];
    selectedHistoryRecords.forEach(rec => {
        if (rec.recording) {
            audioFiles.push(rec.recording);
        } else if (rec.duration > 0 && rec.callerId) {
            audioFiles.push(`${rec.callerId}_${rec.duration}`);
        }
    });

    if (audioFiles.length === 0) {
        alert(t('zip_no_audio_selected', "Tanlangan qo'ng'iroqlar orasida ovoz yozuvi (audio) mavjud emas"));
        return;
    }

    const btn = document.getElementById('btnDownloadSelectedZip');
    const btnText = document.getElementById('btnDownloadSelectedZipText');
    const origText = btnText ? btnText.textContent : '';

    // 1 TA AUDIO TANLANGAN BO'LSA: Arxiv qilmasdan to'g'ridan-to'g'ri audioni tezkor yuklab olish!
    if (selectedHistoryRecords.size === 1) {
        const firstRec = Array.from(selectedHistoryRecords.values())[0];
        try {
            if (btn) btn.disabled = true;
            if (btnText) btnText.textContent = t('audio_downloading', "Audio yuklanmoqda...");

            let resolvedFile = firstRec.recording || '';
            const callKey = `${firstRec.callerId}_${firstRec.duration}`;
            if (!resolvedFile && typeof knownRecordingsCache !== 'undefined') {
                resolvedFile = knownRecordingsCache.get(callKey) || '';
            }

            // Agar hali keshda bo'lmasa, tezkor indeksdan qidirish (0.2ms)
            if (!resolvedFile && firstRec.callerId) {
                try {
                    const fastRes = await fetch(`/api/recordings/fast-find?callerId=${encodeURIComponent(firstRec.callerId)}&duration=${firstRec.duration || 0}`).then(r => r.json());
                    if (fastRes && fastRes.found && fastRes.recording) {
                        resolvedFile = fastRes.recording;
                        if (typeof knownRecordingsCache !== 'undefined') {
                            knownRecordingsCache.set(callKey, resolvedFile);
                        }
                    }
                } catch (e) { }
            }

            if (!resolvedFile) {
                alert(tf('audio_not_found_alert', { phone: firstRec.callerId }, `⚠️ "${firstRec.callerId}" raqamiga tegishli audio yozuv topilmadi.`));
                return;
            }

            // Brauzer orqali faylni to'g'ridan-to'g'ri yuklab olish
            const dlUrl = `/api/recordings/stream?file=${encodeURIComponent(resolvedFile)}&download=1`;
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = resolvedFile.split('/').pop().split('\\').pop() || 'recording.wav';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            alert(`Xatolik: ${err.message}`);
        } finally {
            if (btn) btn.disabled = false;
            if (btnText) btnText.textContent = origText;
        }
        return;
    }

    // BIR NECHTA AUDIO TANLANGAN BO'LSA: Fonda ZIP arxiv yaratish (audioRangeModal ochilmaydi!)
    try {
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = t('zip_starting', 'Arxivlash boshlanmoqda...');

        const res = await fetch('/api/recordings/zip-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: audioFiles,
                zipName: `Tanlangan_${audioFiles.length}_ta_ovoz.zip`
            })
        });
        const data = await res.json();
        if (!data.success || !data.jobId) {
            throw new Error(data.error || 'Arxivlash vazifasini yaratib bo‘lmadi');
        }

        // Fonda progress toast orqali kuzatish
        startTrackingZipJob(data.jobId);
    } catch (err) {
        alert(`Xatolik: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = origText;
    }
}
window.downloadSelectedHistoryAudio = downloadSelectedHistoryAudio;

function selectAllHistoryPageAndDownload() {
    toggleSelectAllHistory(true);
    downloadSelectedHistoryAudio();
}
window.selectAllHistoryPageAndDownload = selectAllHistoryPageAndDownload;

/* ==========================================================================
   Speech-to-Text (STT) Modal & Functions
   ========================================================================== */
let currentSttCallKey = '';
let currentSttRecFile = '';
let currentSttRawText = '';
let currentSttCleanedText = '';
let currentSttViewMode = 'cleaned'; // 'cleaned' | 'raw'
let currentSttIsEditing = false;

async function openCallTranscription(recFile, callerId, duration, time, btn) {
    const modal = document.getElementById('callTranscribeModal');
    if (!modal) return;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    currentSttRecFile = recFile || '';
    currentSttCallKey = `${callerId || ''}_${duration || 0}`;
    currentSttRawText = '';
    currentSttCleanedText = '';
    currentSttIsEditing = false;
    currentSttViewMode = 'cleaned';

    // 0. Agar recFile bo'sh bo'lsa, avval ma'lum bo'lgan keshdan tekshiramiz
    let resolvedRec = recFile || (typeof knownRecordingsCache !== 'undefined' ? knownRecordingsCache.get(currentSttCallKey) : '') || '';
    currentSttRecFile = resolvedRec || '';

    const metaEl = document.getElementById('sttCallMeta');
    if (metaEl) {
        metaEl.textContent = `Raqam: ${callerId || 'Noma‘lum'} • Davomiyligi: ${formatSeconds(duration || 0)} ${time ? '• ' + time : ''}`;
    }

    const audioEl = document.getElementById('sttModalAudio');
    if (audioEl) {
        if (currentSttRecFile) {
            audioEl.src = `/api/recordings/stream?file=${encodeURIComponent(currentSttRecFile)}`;
            audioEl.load();
        } else {
            audioEl.removeAttribute('src');
        }
    }

    const loadingBox = document.getElementById('sttLoadingBox');
    const errorBox = document.getElementById('sttErrorBox');
    const contentBox = document.getElementById('sttContentBox');
    const cacheBadge = document.getElementById('sttCacheBadge');
    const btnEdit = document.getElementById('btnEditStt');
    const btnReprocess = document.getElementById('btnReprocessAi');
    const btnCopy = document.getElementById('btnCopyStt');
    const btnSave = document.getElementById('btnSaveStt');
    const btnCancelEdit = document.getElementById('btnCancelEditStt');

    if (loadingBox) loadingBox.style.display = 'flex';
    if (errorBox) errorBox.style.display = 'none';
    if (contentBox) contentBox.style.display = 'none';
    if (cacheBadge) cacheBadge.style.display = 'none';
    if (btnEdit) btnEdit.style.display = 'none';
    if (btnReprocess) btnReprocess.style.display = 'none';
    if (btnCopy) btnCopy.style.display = 'none';
    if (btnSave) btnSave.style.display = 'none';
    if (btnCancelEdit) btnCancelEdit.style.display = 'none';

    // Agar recFile hali topilmagan bo'lsa, tezkor indeksdan qidirib ko'ramiz
    if (!currentSttRecFile && callerId) {
        try {
            const fastRes = await fetch(`/api/recordings/fast-find?callerId=${encodeURIComponent(callerId)}&duration=${duration || 0}`).then(r => r.json());
            if (fastRes && fastRes.found && fastRes.recording) {
                currentSttRecFile = fastRes.recording;
                if (typeof knownRecordingsCache !== 'undefined') knownRecordingsCache.set(currentSttCallKey, currentSttRecFile);
                if (audioEl) {
                    audioEl.src = `/api/recordings/stream?file=${encodeURIComponent(currentSttRecFile)}`;
                    audioEl.load();
                }
            }
        } catch (e) { }
    }

    try {
        const statsRes = await fetch('/api/recordings/transcribe/stats');
        const statsData = await statsRes.json();
        const learnedEl = document.getElementById('sttLearnedWordsCount');
        if (learnedEl && statsData.success) {
            learnedEl.textContent = statsData.learnedWordsCount ?? statsData.totalWords ?? '0';
        }
    } catch (e) { }

    try {
        const res = await fetch('/api/recordings/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recFile: currentSttRecFile,
                callerId: callerId || '',
                duration: duration || 0,
                callKey: currentSttCallKey
            })
        });
        const data = await res.json();

        if (loadingBox) loadingBox.style.display = 'none';

        if (data.recFile && (!currentSttRecFile || currentSttRecFile !== data.recFile)) {
            currentSttRecFile = data.recFile;
            if (typeof knownRecordingsCache !== 'undefined') knownRecordingsCache.set(currentSttCallKey, currentSttRecFile);
            if (audioEl && (!audioEl.src || audioEl.src.includes('undefined') || !audioEl.getAttribute('src'))) {
                audioEl.src = `/api/recordings/stream?file=${encodeURIComponent(currentSttRecFile)}`;
                audioEl.load();
            }
        }

        if (!data.success) {
            if (errorBox) {
                errorBox.style.display = 'block';
                const errMsg = document.getElementById('sttErrorMessage');
                if (errMsg) errMsg.textContent = data.error || data.message || 'Transkripsiya amalga oshmadi';
            }
            return;
        }

        currentSttCleanedText = data.text || data.rawText || '';
        currentSttRawText = data.rawText || data.text || '';

        if (contentBox) contentBox.style.display = 'flex';
        if (cacheBadge) cacheBadge.style.display = data.cached ? 'inline-block' : 'none';
        if (btnEdit) btnEdit.style.display = 'inline-flex';
        if (btnReprocess) btnReprocess.style.display = 'inline-flex';
        if (btnCopy) btnCopy.style.display = 'inline-flex';

        renderSttText();
    } catch (err) {
        if (loadingBox) loadingBox.style.display = 'none';
        if (errorBox) {
            errorBox.style.display = 'block';
            const errMsg = document.getElementById('sttErrorMessage');
            if (errMsg) errMsg.textContent = err.message || 'Tarmoq xatosi';
        }
    }
}
window.openCallTranscription = openCallTranscription;

function renderSttText() {
    const textBox = document.getElementById('sttTextBox');
    const statsLabel = document.getElementById('sttStatsLabel');
    const textToShow = (currentSttViewMode === 'raw') ? currentSttRawText : currentSttCleanedText;

    if (textBox) {
        textBox.textContent = textToShow || '(Matn bo‘sh)';
    }
    if (statsLabel) {
        const words = (textToShow || '').trim().split(/\s+/).filter(Boolean).length;
        statsLabel.textContent = `${words} ta so'z • ${textToShow ? textToShow.length : 0} ta belgi`;
    }
}

function switchSttViewMode(mode) {
    currentSttViewMode = mode;
    const tabCleaned = document.getElementById('sttTabCleaned');
    const tabRaw = document.getElementById('sttTabRaw');

    if (mode === 'cleaned') {
        if (tabCleaned) {
            tabCleaned.style.background = 'rgba(16, 185, 129, 0.2)';
            tabCleaned.style.borderColor = 'rgba(16, 185, 129, 0.5)';
            tabCleaned.style.color = '#34d399';
            tabCleaned.style.fontWeight = '600';
        }
        if (tabRaw) {
            tabRaw.style.background = 'transparent';
            tabRaw.style.borderColor = 'transparent';
            tabRaw.style.color = 'var(--text-dim)';
            tabRaw.style.fontWeight = 'normal';
        }
    } else {
        if (tabRaw) {
            tabRaw.style.background = 'rgba(16, 185, 129, 0.2)';
            tabRaw.style.borderColor = 'rgba(16, 185, 129, 0.5)';
            tabRaw.style.color = '#34d399';
            tabRaw.style.fontWeight = '600';
        }
        if (tabCleaned) {
            tabCleaned.style.background = 'transparent';
            tabCleaned.style.borderColor = 'transparent';
            tabCleaned.style.color = 'var(--text-dim)';
            tabCleaned.style.fontWeight = 'normal';
        }
    }
    renderSttText();
}
window.switchSttViewMode = switchSttViewMode;

function enableSttEditMode() {
    currentSttIsEditing = true;
    const textBox = document.getElementById('sttTextBox');
    const editArea = document.getElementById('sttEditTextArea');
    const btnEdit = document.getElementById('btnEditStt');
    const btnSave = document.getElementById('btnSaveStt');
    const btnCancel = document.getElementById('btnCancelEditStt');

    if (textBox) textBox.style.display = 'none';
    if (editArea) {
        editArea.style.display = 'block';
        editArea.value = currentSttCleanedText || currentSttRawText || '';
        editArea.focus();
    }
    if (btnEdit) btnEdit.style.display = 'none';
    if (btnSave) btnSave.style.display = 'inline-flex';
    if (btnCancel) btnCancel.style.display = 'inline-flex';
}
window.enableSttEditMode = enableSttEditMode;

function cancelSttEditMode() {
    currentSttIsEditing = false;
    const textBox = document.getElementById('sttTextBox');
    const editArea = document.getElementById('sttEditTextArea');
    const btnEdit = document.getElementById('btnEditStt');
    const btnSave = document.getElementById('btnSaveStt');
    const btnCancel = document.getElementById('btnCancelEditStt');

    if (textBox) textBox.style.display = 'block';
    if (editArea) editArea.style.display = 'none';
    if (btnEdit) btnEdit.style.display = 'inline-flex';
    if (btnSave) btnSave.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';
}
window.cancelSttEditMode = cancelSttEditMode;

async function saveSttManualEdit() {
    const editArea = document.getElementById('sttEditTextArea');
    const saveBtnText = document.getElementById('sttSaveBtnText');
    const newText = editArea ? editArea.value : '';

    try {
        if (saveBtnText) saveBtnText.textContent = 'Saqlanmoqda...';
        const res = await fetch('/api/recordings/transcribe/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callKey: currentSttCallKey,
                recFile: currentSttRecFile,
                formattedText: newText
            })
        });
        const data = await res.json();
        if (data.success) {
            currentSttCleanedText = newText;
            cancelSttEditMode();
            renderSttText();
        } else {
            alert(data.error || 'Saqlashda xatolik');
        }
    } catch (e) {
        alert(e.message);
    } finally {
        if (saveBtnText) saveBtnText.textContent = 'Saqlash';
    }
}
window.saveSttManualEdit = saveSttManualEdit;

async function reprocessSttWithAi() {
    const btn = document.getElementById('btnReprocessAi');
    const btnText = document.getElementById('sttAiTrainText');
    const orig = btnText ? btnText.textContent : '';

    try {
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'O‘qitilmoqda...';

        const res = await fetch('/api/recordings/transcribe/reprocess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callKey: currentSttCallKey,
                recFile: currentSttRecFile
            })
        });
        const data = await res.json();
        if (data.success && data.text) {
            currentSttCleanedText = data.text;
            renderSttText();
            try {
                const s = await fetch('/api/recordings/transcribe/stats').then(r => r.json());
                const count = s.learnedWordsCount ?? s.totalWords;
                if (count !== undefined) {
                    const el = document.getElementById('sttLearnedWordsCount');
                    if (el) el.textContent = count;
                }
            } catch (e) { }
            alert('AI muvaffaqiyatli o‘qitildi va matn yangilandi!');
        } else {
            alert(data.error || 'Qayta ishlash xatosi');
        }
    } catch (e) {
        alert(e.message);
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = orig;
    }
}
window.reprocessSttWithAi = reprocessSttWithAi;

function copySttTextToClipboard() {
    const textToShow = (currentSttViewMode === 'raw') ? currentSttRawText : currentSttCleanedText;
    if (!textToShow) return;
    navigator.clipboard.writeText(textToShow).then(() => {
        const copyText = document.getElementById('sttCopyBtnText');
        if (copyText) {
            const old = copyText.textContent;
            copyText.textContent = 'Nusxa olindi! ✓';
            setTimeout(() => { copyText.textContent = old; }, 2000);
        }
    });
}
window.copySttTextToClipboard = copySttTextToClipboard;

function closeCallTranscriptionModal() {
    smoothCloseDashboardModal('callTranscribeModal', () => {
        document.body.style.overflow = '';
        const audioEl = document.getElementById('sttModalAudio');
        if (audioEl) {
            audioEl.pause();
            audioEl.removeAttribute('src');
        }
    });
}
window.closeCallTranscriptionModal = closeCallTranscriptionModal;

let batchSttItems = [];
let batchSttRunning = false;

async function openBatchTranscribeModal() {
    const modal = document.getElementById('batchTranscribeModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // 1. Audio yozuvlari bor qatorlarni yig'ish
    batchSttItems = [];

    // Agar checkboxlar orqali tanlangan bo'lsa
    if (selectedHistoryRecords && selectedHistoryRecords.size > 0) {
        selectedHistoryRecords.forEach(item => {
            let rec = item.recording || '';
            const callKey = `${item.callerId || ''}_${item.duration || 0}`;
            if (!rec && typeof knownRecordingsCache !== 'undefined') {
                rec = knownRecordingsCache.get(callKey) || '';
            }
            if (rec || (item.duration > 0 && item.callerId)) {
                batchSttItems.push({
                    rowKey: item.rowKey,
                    recording: rec,
                    callerId: item.callerId || '',
                    duration: item.duration || 0,
                    time: item.time || '',
                    isCached: false
                });
            }
        });
    }

    // Agar checkbox tanlanmagan bo'lsa, jadvaldagi audio yozuvi mavjud barcha qo'ng'iroqlarni olamiz
    if (batchSttItems.length === 0 && Array.isArray(currentHistoryData)) {
        currentHistoryData.forEach(item => {
            let rec = item.recording || '';
            const callerId = item.callerId || item.caller_id || '';
            const dur = item.duration || item.duration_sec || 0;
            const callKey = `${callerId}_${dur}`;
            if (!rec && typeof knownRecordingsCache !== 'undefined') {
                rec = knownRecordingsCache.get(callKey) || '';
            }
            if (rec || (dur > 0 && callerId)) {
                const uKey = item.uniqueid || item.id || (rec + '_' + callerId + '_' + (item.time || item.calldate || item.event_time || ''));
                batchSttItems.push({
                    rowKey: String(uKey),
                    recording: rec,
                    callerId: callerId,
                    duration: dur,
                    time: item.time || item.calldate || item.event_time || '',
                    isCached: false
                });
            }
        });
    }

    await renderBatchSttModalUI();
}
window.openBatchTranscribeModal = openBatchTranscribeModal;

async function renderBatchSttModalUI() {
    const totalCountEl = document.getElementById('batchSttTotalCount');
    const cachedCountEl = document.getElementById('batchSttCachedCount');
    const pendingCountEl = document.getElementById('batchSttPendingCount');
    const emptyNotice = document.getElementById('batchSttEmptyNotice');
    const itemsList = document.getElementById('batchSttItemsList');
    const btnStart = document.getElementById('btnBatchStart');
    const btnStop = document.getElementById('btnBatchStop');
    const runningBadge = document.getElementById('batchSttRunningBadge');
    const progressStatus = document.getElementById('batchSttProgressStatusText');
    const progressPercent = document.getElementById('batchSttProgressPercent');
    const progressBar = document.getElementById('batchSttProgressBar');

    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnStop) btnStop.style.display = 'none';
    if (runningBadge) runningBadge.style.display = 'none';
    if (progressStatus) progressStatus.textContent = 'Jarayon boshlanishi kutilmoqda...';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressBar) progressBar.style.width = '0%';

    if (batchSttItems.length === 0) {
        if (totalCountEl) totalCountEl.textContent = '0';
        if (cachedCountEl) cachedCountEl.textContent = '0';
        if (pendingCountEl) pendingCountEl.textContent = '0';
        if (emptyNotice) emptyNotice.style.display = 'block';
        if (itemsList) itemsList.innerHTML = '';
        if (btnStart) btnStart.disabled = true;
        return;
    }

    if (emptyNotice) emptyNotice.style.display = 'none';
    if (btnStart) btnStart.disabled = false;

    // Keshda mavjudligini serverdan tekshirish
    try {
        const checkRes = await fetch('/api/recordings/transcribe/check-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keys: batchSttItems.map(i => i.rowKey),
                files: batchSttItems.map(i => i.recording).filter(Boolean),
                calls: batchSttItems.map(i => ({
                    rowKey: i.rowKey,
                    recording: i.recording,
                    callerId: i.callerId,
                    duration: i.duration
                }))
            })
        });
        const checkData = await checkRes.json();
        if (checkData && checkData.success && checkData.map) {
            batchSttItems.forEach(item => {
                const recBase = item.recording ? item.recording.split('/').pop().split('\\').pop() : '';
                const dur = Math.round(Number(item.duration) || 0);
                const callerKey = item.callerId && dur ? `${item.callerId}_${dur}` : '';
                const cleanCaller = item.callerId ? String(item.callerId).replace(/[^0-9]/g, '') : '';
                if (checkData.map[item.rowKey] ||
                    (item.recording && checkData.map[item.recording]) ||
                    (recBase && checkData.map[recBase]) ||
                    (callerKey && checkData.map[callerKey]) ||
                    (cleanCaller && dur && checkData.map[`${cleanCaller}_${dur}`]) ||
                    (item.callerId && checkData.map[item.callerId]) ||
                    (cleanCaller && checkData.map[cleanCaller])) {
                    item.isCached = true;
                }
            });
        }
    } catch (e) { }

    const total = batchSttItems.length;
    const cached = batchSttItems.filter(i => i.isCached).length;
    const pending = total - cached;

    if (totalCountEl) totalCountEl.textContent = total;
    if (cachedCountEl) cachedCountEl.textContent = cached;
    if (pendingCountEl) pendingCountEl.textContent = pending;

    // Elementlar ro'yxatini chiqarish
    if (itemsList) {
        let html = '';
        batchSttItems.forEach((item, idx) => {
            const timeStr = item.time ? (item.time.length > 10 ? item.time.slice(11, 19) : item.time) : '';
            const durText = item.duration ? formatSeconds(item.duration) : '00:00';
            const badgeHtml = item.isCached
                ? `<span id="batchSttBadge_${idx}" style="font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 6px; background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399;">Tayyor ✓</span>`
                : `<span id="batchSttBadge_${idx}" style="font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 6px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd;">Kutilmoqda</span>`;

            html += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                        <span style="font-size: 11px; color: var(--text-dim); font-family: monospace; width: 22px;">#${idx + 1}</span>
                        <strong style="color: #fff; font-size: 13px; font-family: monospace;">${item.callerId || 'Yashirin'}</strong>
                        <span style="font-size: 11px; color: var(--text-muted);">${timeStr}</span>
                        <span style="font-size: 11px; color: #38bdf8; font-family: monospace;">⏱ ${durText}</span>
                    </div>
                    <div style="flex-shrink: 0;">
                        ${badgeHtml}
                    </div>
                </div>
            `;
        });
        itemsList.innerHTML = html;
    }
}

async function startBatchTranscription() {
    if (batchSttRunning || batchSttItems.length === 0) return;
    batchSttRunning = true;

    const btnStart = document.getElementById('btnBatchStart');
    const btnStop = document.getElementById('btnBatchStop');
    const runningBadge = document.getElementById('batchSttRunningBadge');
    const progressStatus = document.getElementById('batchSttProgressStatusText');
    const progressPercent = document.getElementById('batchSttProgressPercent');
    const progressBar = document.getElementById('batchSttProgressBar');
    const skipCached = document.getElementById('batchSttSkipCached')?.checked ?? true;

    if (btnStart) btnStart.style.display = 'none';
    if (btnStop) btnStop.style.display = 'inline-flex';
    if (runningBadge) runningBadge.style.display = 'inline-flex';

    // Bajarilishi kerak bo'lgan vazifalar navbati
    const queue = [];
    batchSttItems.forEach((item, idx) => {
        if (skipCached && item.isCached) return;
        queue.push({ ...item, itemIndex: idx });
    });

    if (queue.length === 0) {
        if (progressStatus) progressStatus.textContent = "Barcha audio yozuvlar allaqachon matnga o'girilgan!";
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressBar) progressBar.style.width = '100%';
        if (btnStart) btnStart.style.display = 'inline-flex';
        if (btnStop) btnStop.style.display = 'none';
        if (runningBadge) runningBadge.style.display = 'none';
        batchSttRunning = false;
        return;
    }

    const totalToProcess = queue.length;
    let processedCount = 0;

    for (let i = 0; i < queue.length; i++) {
        if (!batchSttRunning) break;
        const task = queue[i];
        const badge = document.getElementById(`batchSttBadge_${task.itemIndex}`);

        if (badge) {
            badge.style.background = 'rgba(245, 158, 11, 0.25)';
            badge.style.borderColor = 'rgba(245, 158, 11, 0.5)';
            badge.style.color = '#fbbf24';
            badge.innerHTML = `<span class="sync-spinner" style="width: 8px; height: 8px; border-width: 1.5px; border-color: rgba(251, 191, 36, 0.3); border-top-color: #fbbf24; display: inline-block;"></span> O'girilmoqda...`;
        }
        if (progressStatus) {
            progressStatus.textContent = `[${i + 1}/${totalToProcess}] ${task.callerId || 'Mijoz'} audio yozuvi o'girilmoqda...`;
        }

        try {
            const res = await fetch('/api/recordings/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recFile: task.recording,
                    callerId: task.callerId || '',
                    duration: task.duration || 0,
                    callKey: task.rowKey
                })
            });
            const data = await res.json();
            if (data && data.success) {
                task.isCached = true;
                if (batchSttItems[task.itemIndex]) batchSttItems[task.itemIndex].isCached = true;
                if (badge) {
                    badge.style.background = 'rgba(16, 185, 129, 0.2)';
                    badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                    badge.style.color = '#34d399';
                    badge.textContent = 'Tayyor ✓';
                }
            } else {
                if (badge) {
                    badge.style.background = 'rgba(239, 68, 68, 0.2)';
                    badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    badge.style.color = '#f87171';
                    badge.textContent = 'Xato ✗';
                }
            }
        } catch (err) {
            if (badge) {
                badge.style.background = 'rgba(239, 68, 68, 0.2)';
                badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                badge.style.color = '#f87171';
                badge.textContent = 'Xato ✗';
            }
        }

        processedCount++;
        const pct = Math.round((processedCount / totalToProcess) * 100);
        if (progressPercent) progressPercent.textContent = `${pct}%`;
        if (progressBar) progressBar.style.width = `${pct}%`;

        // Update cached and pending count badges
        const cachedCount = batchSttItems.filter(item => item.isCached).length;
        const cachedEl = document.getElementById('batchSttCachedCount');
        const pendingEl = document.getElementById('batchSttPendingCount');
        if (cachedEl) cachedEl.textContent = cachedCount;
        if (pendingEl) pendingEl.textContent = Math.max(0, batchSttItems.length - cachedCount);
    }

    if (progressStatus) {
        progressStatus.textContent = batchSttRunning ? "Barcha audio yozuvlar muvaffaqiyatli yakunlandi!" : "Jarayon to'xtatildi.";
    }
    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnStop) btnStop.style.display = 'none';
    if (runningBadge) runningBadge.style.display = 'none';
    batchSttRunning = false;

    // Refresh history table badges so the newly transcribed calls show "Matn" button
    if (typeof loadHistoryData === 'function') {
        loadHistoryData();
    }
}
window.startBatchTranscription = startBatchTranscription;

function stopBatchTranscription() {
    batchSttRunning = false;
    const btnStart = document.getElementById('btnBatchStart');
    const btnStop = document.getElementById('btnBatchStop');
    const runningBadge = document.getElementById('batchSttRunningBadge');
    const progressStatus = document.getElementById('batchSttProgressStatusText');

    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnStop) btnStop.style.display = 'none';
    if (runningBadge) runningBadge.style.display = 'none';
    if (progressStatus) progressStatus.textContent = "To'xtatildi.";
}
window.stopBatchTranscription = stopBatchTranscription;

function closeBatchTranscribeModal() {
    batchSttRunning = false;
    smoothCloseDashboardModal('batchTranscribeModal', () => {
        document.body.style.overflow = '';
    });
}
window.closeBatchTranscribeModal = closeBatchTranscribeModal;

function copyBatchTranscriptions() {
    const listEl = document.getElementById('batchSttResultsList');
    if (!listEl) return;
    const textEls = listEl.querySelectorAll('.batch-stt-text, [data-stt-text]');
    const allTexts = [];
    if (textEls && textEls.length > 0) {
        textEls.forEach((el, idx) => {
            const txt = (el.getAttribute('data-stt-text') || el.textContent || '').trim();
            if (txt) allTexts.push(`[${idx + 1}] ${txt}`);
        });
    } else {
        const text = listEl.innerText.trim();
        if (text) allTexts.push(text);
    }

    if (allTexts.length === 0) {
        if (typeof showToast === 'function') showToast("Nusxa olish uchun transkripsiya matnlari mavjud emas", 'info');
        return;
    }

    const fullText = allTexts.join('\n\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullText).then(() => {
            if (typeof showToast === 'function') showToast("Barcha transkripsiyalar nusxalandi!", 'success');
        }).catch(() => {
            prompt("Matnni nusxalab oling:", fullText);
        });
    } else {
        prompt("Matnni nusxalab oling:", fullText);
    }
}
window.copyBatchTranscriptions = copyBatchTranscriptions;

function downloadBatchTranscriptionsTxt() {
    const listEl = document.getElementById('batchSttResultsList');
    if (!listEl) return;
    const textEls = listEl.querySelectorAll('.batch-stt-text, [data-stt-text]');
    const allTexts = [];
    if (textEls && textEls.length > 0) {
        textEls.forEach((el, idx) => {
            const txt = (el.getAttribute('data-stt-text') || el.textContent || '').trim();
            if (txt) allTexts.push(`--- Audio #${idx + 1} ---\n${txt}\n`);
        });
    } else {
        const text = listEl.innerText.trim();
        if (text) allTexts.push(text);
    }

    if (allTexts.length === 0) {
        if (typeof showToast === 'function') showToast("Yuklab olish uchun matn mavjud emas", 'info');
        return;
    }

    const blob = new Blob([allTexts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transkripsiyalar_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
window.downloadBatchTranscriptionsTxt = downloadBatchTranscriptionsTxt;

function onSttToastClick(event) {
    if (event && event.target && event.target.closest('#btnSttToastCancel')) {
        return;
    }
    if (typeof openBatchTranscribeModal === 'function') {
        openBatchTranscribeModal();
    }
}
window.onSttToastClick = onSttToastClick;

function cancelSttFromToast(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (typeof stopBatchTranscription === 'function') {
        stopBatchTranscription();
    }
    const toast = document.getElementById('sttProgressToast');
    if (toast) toast.classList.remove('active');
    if (typeof showToast === 'function') showToast("Transkripsiya bekor qilindi", 'info');
}
window.cancelSttFromToast = cancelSttFromToast;


/* ==========================================================================
   Audio Recordings Date Range Modal & Interactive Calendar
   ========================================================================== */
let audioRangeCalCurrentDate = new Date();

function openAudioRangeModal() {
    const modal = document.getElementById('audioRangeModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    if (startInp && !startInp.value) {
        setAudioRangePreset('last7');
    } else {
        onAudioRangeDateChange();
    }
}
window.openAudioRangeModal = openAudioRangeModal;

function closeAudioRangeModal() {
    smoothCloseDashboardModal('audioRangeModal', () => {
        document.body.style.overflow = '';
    });
}
window.closeAudioRangeModal = closeAudioRangeModal;

function setAudioRangePreset(preset) {
    const today = new Date();
    const todayStr = getTodayDateString();
    let startStr = todayStr;
    let endStr = todayStr;

    if (preset === 'today') {
        startStr = todayStr;
        endStr = todayStr;
    } else if (preset === 'last7') {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        startStr = d.toISOString().slice(0, 10);
        endStr = todayStr;
    } else if (preset === 'thisMonth') {
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        startStr = `${y}-${m}-01`;
        endStr = todayStr;
    } else if (preset === 'prevMonth') {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const y = prev.getFullYear();
        const m = String(prev.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, prev.getMonth() + 1, 0).getDate();
        startStr = `${y}-${m}-01`;
        endStr = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    }

    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    if (startInp) startInp.value = startStr;
    if (endInp) endInp.value = endStr;

    audioRangeCalCurrentDate = new Date(endStr || today);
    onAudioRangeDateChange();
}
window.setAudioRangePreset = setAudioRangePreset;

function triggerAudioRangeDatePicker(id) {
    const el = document.getElementById(id);
    if (!el) return;
    try {
        if (typeof el.showPicker === 'function') {
            el.showPicker();
        } else {
            el.focus();
        }
    } catch (e) {
        el.focus();
    }
}
window.triggerAudioRangeDatePicker = triggerAudioRangeDatePicker;

function onAudioRangeDateChange() {
    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    const startText = document.getElementById('audioRangeStartDateText');
    const endText = document.getElementById('audioRangeEndDateText');

    const sVal = startInp ? startInp.value : '';
    const eVal = endInp ? endInp.value : '';

    if (startText) startText.textContent = sVal ? formatDisplayDate(sVal) : '--.--.----';
    if (endText) endText.textContent = eVal ? formatDisplayDate(eVal) : '--.--.----';

    renderAudioRangeCalendar();
    updateAudioRangeInfo();
}
window.onAudioRangeDateChange = onAudioRangeDateChange;

function formatDisplayDate(iso) {
    if (!iso) return '--.--.----';
    const parts = iso.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return iso;
}
window.formatDisplayDate = formatDisplayDate;

function updateAudioRangeInfo() {
    const infoText = document.getElementById('audioRangeInfoText');
    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    if (!infoText) return;

    const sVal = startInp ? startInp.value : '';
    const eVal = endInp ? endInp.value : '';
    if (!sVal || !eVal) {
        infoText.textContent = "Sana oralig'ini tanlang";
        return;
    }

    const d1 = new Date(sVal);
    const d2 = new Date(eVal);
    const diffDays = Math.round(Math.abs((d2 - d1) / (1000 * 60 * 60 * 24))) + 1;
    infoText.textContent = `Tanlangan oraliq: ${formatDisplayDate(sVal)} dan ${formatDisplayDate(eVal)} gacha (${diffDays} kun)`;
}

function navAudioRangeCal(delta, event) {
    if (event) event.stopPropagation();
    audioRangeCalCurrentDate.setMonth(audioRangeCalCurrentDate.getMonth() + delta);
    renderAudioRangeCalendar();
}
window.navAudioRangeCal = navAudioRangeCal;

function renderAudioRangeCalendar() {
    const grid = document.getElementById('audioRangeCalDaysGrid');
    const titleEl = document.getElementById('audioRangeCalMonthTitle');
    if (!grid) return;

    const y = audioRangeCalCurrentDate.getFullYear();
    const m = audioRangeCalCurrentDate.getMonth();

    const monthNames = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentyabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    if (titleEl) titleEl.textContent = `${monthNames[m]} ${y}`;

    const firstDay = new Date(y, m, 1);
    let startDayOfWeek = firstDay.getDay() - 1; // 0=Du, 6=Ya
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    const sVal = startInp ? startInp.value : '';
    const eVal = endInp ? endInp.value : '';

    let html = '';
    for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div style="height: 28px;"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isStart = (dayStr === sVal);
        const isEnd = (dayStr === eVal);
        const isInRange = (sVal && eVal && dayStr >= sVal && dayStr <= eVal);

        let bg = 'transparent';
        let color = '#cbd5e1';
        let radius = '4px';

        if (isStart || isEnd) {
            bg = '#3b82f6';
            color = '#fff';
            radius = isStart && isEnd ? '6px' : (isStart ? '6px 0 0 6px' : '0 6px 6px 0');
        } else if (isInRange) {
            bg = 'rgba(59, 130, 246, 0.2)';
            color = '#93c5fd';
            radius = '0';
        }

        html += `
            <div onclick="selectAudioRangeCalDate('${dayStr}')" 
                 style="height: 28px; line-height: 28px; font-size: 11px; font-weight: 600; cursor: pointer; background: ${bg}; color: ${color}; border-radius: ${radius}; transition: background 0.15s;" 
                 onmouseover="if(!this.style.background.includes('rgb(59')) this.style.background='rgba(255,255,255,0.08)'" 
                 onmouseout="if(!this.style.background.includes('rgb(59')) this.style.background='${bg}'">
                ${d}
            </div>
        `;
    }

    grid.innerHTML = html;
}
window.renderAudioRangeCalendar = renderAudioRangeCalendar;

function selectAudioRangeCalDate(dateStr) {
    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    if (!startInp || !endInp) return;

    if (!startInp.value || (startInp.value && endInp.value && startInp.value !== endInp.value)) {
        startInp.value = dateStr;
        endInp.value = dateStr;
    } else if (startInp.value && startInp.value === endInp.value) {
        if (dateStr >= startInp.value) {
            endInp.value = dateStr;
        } else {
            endInp.value = startInp.value;
            startInp.value = dateStr;
        }
    }
    onAudioRangeDateChange();
}
window.selectAudioRangeCalDate = selectAudioRangeCalDate;

function applyAudioRangeToTable() {
    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    const sVal = startInp ? startInp.value : '';
    const eVal = endInp ? endInp.value : '';

    if (!sVal || !eVal) {
        alert("Iltimos, boshlanish va tugash sanasini tanlang");
        return;
    }

    historyDateScope = 'range';
    currentHistoryDateRange = `${sVal}_${eVal}`;
    updateHistoryScopeUI();
    closeAudioRangeModal();
    loadHistoryPage(1, historySearchQuery);
}
window.applyAudioRangeToTable = applyAudioRangeToTable;

let activeZipJobId = null;
let zipJobPollInterval = null;

async function submitAudioRangeDownload() {
    const startInp = document.getElementById('audioRangeStartDate');
    const endInp = document.getElementById('audioRangeEndDate');
    const searchInp = document.getElementById('audioRangeSearchInput');
    const sVal = startInp ? startInp.value : '';
    const eVal = endInp ? endInp.value : '';
    const searchVal = searchInp ? searchInp.value.trim() : '';

    if (!sVal || !eVal) {
        alert("Iltimos, boshlanish va tugash sanasini tanlang");
        return;
    }

    const btnSubmit = document.getElementById('btnSubmitAudioRange');
    const btnText = document.getElementById('audioRangeBtnText');
    const orig = btnText ? btnText.textContent : '';

    try {
        if (btnSubmit) btnSubmit.disabled = true;
        if (btnText) btnText.textContent = "Arxivlash boshlanmoqda...";

        const res = await fetch('/api/recordings/zip-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                startDate: sVal,
                endDate: eVal,
                search: searchVal,
                zipName: `Qongiroqlar_${sVal}_${eVal}.zip`
            })
        });
        const data = await res.json();
        if (!data.success || !data.jobId) {
            throw new Error(data.error || "Arxivlash vazifasini yaratib bo'lmadi");
        }

        startTrackingZipJob(data.jobId);
    } catch (e) {
        alert(`Xatolik: ${e.message}`);
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (btnText) btnText.textContent = orig;
    }
}
window.submitAudioRangeDownload = submitAudioRangeDownload;

function startTrackingZipJob(jobId) {
    activeZipJobId = jobId;
    const progressWrap = document.getElementById('audioRangeProgressWrap');
    const modal = document.getElementById('audioRangeModal');
    if (progressWrap && modal && modal.style.display !== 'none') {
        progressWrap.style.display = 'block';
    }

    const toast = document.getElementById('zipProgressToast');
    if (toast) {
        toast.style.display = 'flex';
        toast.classList.add('show');
        toast.classList.remove('completed');
        const toastTitle = document.getElementById('zipToastTitle');
        if (toastTitle) {
            toastTitle.innerHTML = `<svg class="isax isax-import" style="width: 15px; height: 15px; color: #38bdf8;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-import"></use></svg> <span>ZIP arxiv tayyorlanmoqda...</span>`;
        }
    }

    if (zipJobPollInterval) clearInterval(zipJobPollInterval);

    zipJobPollInterval = setInterval(async () => {
        if (!activeZipJobId) {
            clearInterval(zipJobPollInterval);
            return;
        }
        try {
            const res = await fetch(`/api/recordings/zip-jobs/${activeZipJobId}`);
            const data = await res.json();
            if (!data.success || !data.job) return;

            const job = data.job;
            const bar = document.getElementById('audioRangeProgressBar');
            const pct = document.getElementById('audioRangeProgressPercent');
            const statusText = document.getElementById('audioRangeProgressStatusText');
            const countEl = document.getElementById('audioRangeProgressCount');
            const sizeEl = document.getElementById('audioRangeProgressSize');
            const spinner = document.getElementById('audioRangeProgressSpinner');

            // Modal ichidagi progress (faqat ochiq bo'lsa)
            if (bar) bar.style.width = `${job.progress || 0}%`;
            if (pct) pct.textContent = `${job.progress || 0}%`;
            if (countEl) countEl.textContent = `${job.processed || 0} / ${job.total || 0} ta fayl`;
            if (sizeEl) sizeEl.textContent = job.fileSizeFormatted || '0 MB';

            // Floating Toast progress widget
            const toastPct = job.progress || 0;
            const toastCircle = document.getElementById('zipToastCircleProgress');
            const toastText = document.getElementById('zipToastCircleText');
            const toastSub = document.getElementById('zipToastSubtitle');
            const toastTitle = document.getElementById('zipToastTitle');

            if (toastCircle) {
                const offset = 106.81 - (106.81 * (toastPct / 100));
                toastCircle.style.strokeDashoffset = offset;
            }
            if (toastText) toastText.textContent = `${toastPct}%`;
            if (toastSub) {
                toastSub.textContent = `${job.processed || 0} / ${job.total || 0} ta fayl (${job.fileSizeFormatted || '0 MB'})`;
            }

            if (job.status === 'completed') {
                clearInterval(zipJobPollInterval);
                zipJobPollInterval = null;
                if (statusText) statusText.textContent = "Tayyor! Yuklab olinmoqda...";
                if (spinner) spinner.style.display = 'none';

                if (toastTitle) {
                    toastTitle.innerHTML = `<svg class="isax isax-tick-circle" style="width: 15px; height: 15px; color: #34d399;"><use href="/icons/iconsax/iconsax-sprite.svg#isax-tick-circle"></use></svg> <span>Tayyor! Yuklab olinmoqda...</span>`;
                }
                if (toast) toast.classList.add('completed');

                window.location.href = `/api/recordings/zip-jobs/${activeZipJobId}/download`;
                setTimeout(() => {
                    if (progressWrap) progressWrap.style.display = 'none';
                    if (toast) {
                        toast.style.display = 'none';
                        toast.classList.remove('show', 'completed');
                    }
                    activeZipJobId = null;
                }, 3500);
            } else if (job.status === 'failed' || job.status === 'cancelled') {
                clearInterval(zipJobPollInterval);
                zipJobPollInterval = null;
                const errMsg = `Arxivlash ${job.status === 'cancelled' ? 'bekor qilindi' : 'to‘xtadi'}: ${job.error || ''}`;
                if (statusText) statusText.textContent = errMsg;
                if (spinner) spinner.style.display = 'none';
                if (toastSub) toastSub.textContent = errMsg;
                setTimeout(() => {
                    if (toast) {
                        toast.style.display = 'none';
                        toast.classList.remove('show');
                    }
                    activeZipJobId = null;
                }, 4000);
            } else {
                if (statusText) statusText.textContent = `Fonda yig'ilmoqda (${job.added || 0} ta fayl qo'shildi)...`;
            }
        } catch (e) {
            console.error('Zip poll error:', e);
        }
    }, 1500);
}

async function cancelAudioZipJob(skipPrompt = false) {
    if (!activeZipJobId) return;
    if (!skipPrompt && !confirm("Arxivlash jarayonini to'xtatmoqchimisiz?")) return;

    try {
        await fetch(`/api/recordings/zip-jobs/${activeZipJobId}/cancel`, { method: 'POST' });
    } catch (e) { }

    if (zipJobPollInterval) {
        clearInterval(zipJobPollInterval);
        zipJobPollInterval = null;
    }
    activeZipJobId = null;
    const progressWrap = document.getElementById('audioRangeProgressWrap');
    if (progressWrap) progressWrap.style.display = 'none';
    const toast = document.getElementById('zipProgressToast');
    if (toast) {
        toast.style.display = 'none';
        toast.classList.remove('show', 'completed');
    }
}
window.cancelAudioZipJob = cancelAudioZipJob;

function onAudioRangeSearchChange() {
    const input = document.getElementById('audioRangeSearchInput');
    const resetBtn = document.getElementById('audioRangeFilterResetBtn');
    if (resetBtn) {
        resetBtn.style.display = (input && input.value.trim()) ? 'inline-block' : 'none';
    }
}
window.onAudioRangeSearchChange = onAudioRangeSearchChange;

function clearAudioRangeFilter() {
    const input = document.getElementById('audioRangeSearchInput');
    const resetBtn = document.getElementById('audioRangeFilterResetBtn');
    if (input) input.value = '';
    if (resetBtn) resetBtn.style.display = 'none';
}
window.clearAudioRangeFilter = clearAudioRangeFilter;

let dashboardRecentCallsList = [];

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
}

function updateRecentOperatorsDataList() {
    const dl = document.getElementById('recentOperatorsList');
    if (!dl) return;

    // Har bir operator uchun faqat bitta toza variant (masalan: "Oybek (101)")
    const opMap = new Map(); // opId -> "Ism (ID)"

    // 1. Jonli currentOperators dan olamiz
    if (Array.isArray(currentOperators)) {
        currentOperators.forEach(op => {
            const opId = String(op.id || '').trim();
            if (!opId) return;
            const clean = typeof getCleanOperatorName === 'function'
                ? getCleanOperatorName(op.realName || op.name, opId)
                : (op.realName || op.name || `Operator ${opId}`);
            opMap.set(opId, `${clean} (${opId})`);
        });
    }

    // 2. Mavjud qo'ng'iroqlar buferidan ham operatorlarni to'ldiramiz (agar ro'yxatda bo'lmasa)
    if (Array.isArray(dashboardRecentCallsList)) {
        dashboardRecentCallsList.forEach(c => {
            if (c.operator) {
                const formatted = typeof formatOperatorDisplayName === 'function'
                    ? formatOperatorDisplayName(c.operator)
                    : String(c.operator);
                const m = formatted.match(/\((\d+)\)/);
                const opId = m ? m[1] : String(c.operator).trim();
                if (!opMap.has(opId)) {
                    opMap.set(opId, formatted);
                }
            }
        });
    }

    const options = Array.from(opMap.values())
        .sort((a, b) => a.localeCompare(b, 'uz'))
        .map(label => `<option value="${escapeHtml(label)}"></option>`)
        .join('');

    dl.innerHTML = options;
}

let dashboardRecentSegFilter = 'all';
let dashboardRecentPage = 1;
const DASHBOARD_RECENT_PAGE_SIZE = 15;
let currentRecentSortColumn = 'time';
let currentRecentSortDirection = 'desc';

function setDashboardRecentSegFilter(filterVal) {
    dashboardRecentSegFilter = filterVal || 'all';
    dashboardRecentPage = 1;
    const seg = document.getElementById('recentCallsSeg');
    if (seg) {
        seg.querySelectorAll('button').forEach(btn => {
            const st = btn.getAttribute('data-status');
            if (st === dashboardRecentSegFilter) {
                btn.classList.add('on');
            } else {
                btn.classList.remove('on');
            }
        });
    }
    applyDashboardRecentFilters();
}
if (typeof window !== 'undefined') {
    window.setDashboardRecentSegFilter = setDashboardRecentSegFilter;
}

function changeRecentPage(target) {
    if (target === 'prev' || target === -1) {
        dashboardRecentPage = Math.max(1, dashboardRecentPage - 1);
    } else if (target === 'next') {
        dashboardRecentPage += 1;
    } else {
        const p = parseInt(target, 10);
        if (!isNaN(p) && p >= 1) {
            dashboardRecentPage = p;
        }
    }
    if (dashboardRecentPage < 1) dashboardRecentPage = 1;
    applyDashboardRecentFilters();
}
if (typeof window !== 'undefined') {
    window.changeRecentPage = changeRecentPage;
}

function sortDashboardTable(column) {
    if (currentRecentSortColumn === column) {
        currentRecentSortDirection = currentRecentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentRecentSortColumn = column;
        currentRecentSortDirection = (column === 'time' || column === 'duration') ? 'desc' : 'asc';
    }

    updateSortIcons();
    applyDashboardRecentFilters();
}

function updateSortIcons() {
    const columns = ['time', 'callerId', 'operator', 'duration', 'waitSec', 'status'];
    columns.forEach(col => {
        const iconEl = document.getElementById(`sort-icon-${col}`);
        if (!iconEl) return;

        if (col === currentRecentSortColumn) {
            iconEl.innerHTML = currentRecentSortDirection === 'asc' ? '▲' : '▼';
            iconEl.style.opacity = '1';
            iconEl.style.color = 'var(--accent, #6c8cff)';
        } else {
            iconEl.innerHTML = '↕';
            iconEl.style.opacity = '0.35';
            iconEl.style.color = 'inherit';
        }
    });
}

function applyDashboardRecentFilters(resetPage = false) {
    if (resetPage) dashboardRecentPage = 1;

    const opInput = document.getElementById('recentFilterOperator');
    const clearBtn = document.getElementById('btnClearRecentFilters');
    const opVal = opInput ? opInput.value.trim().toLowerCase() : '';

    const hasActiveFilter = Boolean(opVal || dashboardRecentSegFilter !== 'all');
    if (clearBtn) {
        clearBtn.style.display = hasActiveFilter ? 'inline-flex' : 'none';
    }

    const filtered = dashboardRecentCallsList.filter(item => {
        // 1. Operator / Raqam qidiruvi (Ism, raqam yoki "Ism (101)" bo'yicha)
        if (opVal) {
            const opRaw = String(item.operator || '').toLowerCase();
            const opFormatted = String(typeof formatOperatorDisplayName === 'function' ? formatOperatorDisplayName(item.operator) : '').toLowerCase();
            const callerRaw = String(item.callerId || '').toLowerCase();

            const match = opRaw.includes(opVal) ||
                opFormatted.includes(opVal) ||
                callerRaw.includes(opVal) ||
                opVal.includes(opRaw) ||
                (opFormatted && opVal.includes(opFormatted));
            if (!match) {
                return false;
            }
        }

        const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
        const isOut = item.direction === 'outbound' && !isXfer;
        const isQueueOnly = !item.operatorExten && (!item.operator || item.operator === 'Navbat' || item.operator.includes('Navbat') || item.operator.includes('Operatorga ulanmadi') || item.operator === '-');
        const isAns = (item.status === 'ANSWERED') && !isQueueOnly;

        // 2. Segmented pill filter: all | missed | abandoned | transfer
        if (dashboardRecentSegFilter === 'missed') {
            if (isAns) return false;
            if (isQueueOnly) return false;
        } else if (dashboardRecentSegFilter === 'abandoned') {
            if (!isQueueOnly && isAns) return false;
            if (isOut) return false;
            if (isAns) return false;
        } else if (dashboardRecentSegFilter === 'transfer') {
            if (!isXfer) return false;
        }

        return true;
    });

    // Saralash (Ustun bo'yicha sorting)
    filtered.sort((a, b) => {
        let valA, valB;

        switch (currentRecentSortColumn) {
            case 'time':
                valA = new Date(a.time || 0).getTime();
                valB = new Date(b.time || 0).getTime();
                break;
            case 'callerId':
                valA = String(a.callerId || '');
                valB = String(b.callerId || '');
                break;
            case 'operator':
                valA = String(typeof formatOperatorDisplayName === 'function' ? formatOperatorDisplayName(a.operator || '') : (a.operator || '')).toLowerCase();
                valB = String(typeof formatOperatorDisplayName === 'function' ? formatOperatorDisplayName(b.operator || '') : (b.operator || '')).toLowerCase();
                break;
            case 'duration':
                valA = parseInt(a.duration || 0, 10);
                valB = parseInt(b.duration || 0, 10);
                break;
            case 'waitSec':
                valA = parseInt(a.waitSec || 0, 10);
                valB = parseInt(b.waitSec || 0, 10);
                break;
            case 'status':
                valA = String(a.status || '');
                valB = String(b.status || '');
                break;
            default:
                valA = new Date(a.time || 0).getTime();
                valB = new Date(b.time || 0).getTime();
        }

        if (valA < valB) return currentRecentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentRecentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / DASHBOARD_RECENT_PAGE_SIZE));
    if (dashboardRecentPage > totalPages) dashboardRecentPage = totalPages;
    if (dashboardRecentPage < 1) dashboardRecentPage = 1;

    const startIdx = (dashboardRecentPage - 1) * DASHBOARD_RECENT_PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + DASHBOARD_RECENT_PAGE_SIZE);

    renderDashboardRecentTable(pageItems, hasActiveFilter, totalFiltered, dashboardRecentPage, totalPages);
}

function resetDashboardRecentFilters() {
    const opInput = document.getElementById('recentFilterOperator');
    if (opInput) opInput.value = '';
    dashboardRecentSegFilter = 'all';
    const seg = document.getElementById('recentCallsSeg');
    if (seg) {
        seg.querySelectorAll('button').forEach(btn => {
            if (btn.getAttribute('data-status') === 'all') btn.classList.add('on');
            else btn.classList.remove('on');
        });
    }
    currentRecentSortColumn = 'time';
    currentRecentSortDirection = 'desc';
    dashboardRecentPage = 1;
    updateSortIcons();
    applyDashboardRecentFilters();
}
if (typeof window !== 'undefined') {
    window.sortDashboardTable = sortDashboardTable;
    window.applyDashboardRecentFilters = applyDashboardRecentFilters;
    window.resetDashboardRecentFilters = resetDashboardRecentFilters;
}

function renderDashboardRecentTable(data, hasActiveFilter = false, totalFiltered = 0, currentPage = 1, totalPages = 1) {
    const tbody = document.getElementById('dashboardCallsTable');
    if (!tbody) return;

    // Update pagination controls
    const countInfo = document.getElementById('recentTotalCount');
    if (countInfo) {
        countInfo.textContent = `Jami: ${totalFiltered} ta yozuv`;
    }
    const btnPrev = document.getElementById('recentBtnPrev');
    const btnNext = document.getElementById('recentBtnNext');
    if (btnPrev) btnPrev.disabled = (currentPage <= 1);
    if (btnNext) btnNext.disabled = (currentPage >= totalPages);

    const pageNumbersEl = document.getElementById('recentPageNumbers');
    if (pageNumbersEl) {
        if (totalPages <= 1) {
            pageNumbersEl.innerHTML = '';
        } else {
            let pagesHtml = '';
            let startP = Math.max(1, currentPage - 2);
            let endP = Math.min(totalPages, startP + 4);
            if (endP - startP < 4) {
                startP = Math.max(1, endP - 4);
            }
            for (let p = startP; p <= endP; p++) {
                pagesHtml += `<button type="button" class="btn ${p === currentPage ? 'p' : ''}" onclick="changeRecentPage(${p})">${p}</button>`;
            }
            pageNumbersEl.innerHTML = pagesHtml;
        }
    }

    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state" style="text-align: center; color: var(--mute, #8d9bb0); padding: 32px 16px; font-size: 13px;">
                    ${hasActiveFilter ? '🔍 Tanlangan filtr bo\'yicha qo\'ng\'iroqlar topilmadi' : 'Hozircha qo\'ng\'iroqlar yo\'q'}
                </td>
            </tr>
        `;
        return;
    }

    try {
        tbody.innerHTML = data.map((item, index) => {
            const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
            const isOut = item.direction === 'outbound' && !isXfer;
            const isQueueOnly = !item.operatorExten && (!item.operator || item.operator === 'Navbat' || item.operator.includes('Navbat') || item.operator.includes('Operatorga ulanmadi') || item.operator === '-');
            const isAns = (item.status === 'ANSWERED') && !isQueueOnly;

            // Row status class matching Call Center — yangi dizayn: miss | lost | xfer
            let rowClass = '';
            if (isXfer) {
                rowClass = 'xfer';
            } else if (isOut && (!isAns || item.status === 'BUSY')) {
                rowClass = 'miss';
            } else if (!isAns) {
                rowClass = 'lost';
            }

            // Direction arrow icon
            let dirClass = 'in';
            let dirTitle = 'Kiruvchi';
            let dirIcon = isax('import', '', 'width: 12px; height: 12px;');
            if (isXfer) {
                dirClass = 'xfer';
                dirTitle = 'Transfer';
                dirIcon = isax('arrow-swap-horizontal', '', 'width: 12px; height: 12px;');
            } else if (isOut) {
                dirClass = 'out';
                dirTitle = 'Chiquvchi';
                dirIcon = isax('export', '', 'width: 12px; height: 12px;');
            }

            // Caller Phone
            const callerKey = `rec_${item.recording || ''}_${item.callerId || ''}_${item.time || index}`;
            const callerHtml = typeof renderExpandableCallerHtml === 'function'
                ? renderExpandableCallerHtml(item.callerId, callerKey)
                : (item.callerId || '');

            // Operator
            let opCellHtml = '';
            const opDisplayName = typeof formatOperatorDisplayName === 'function' ? formatOperatorDisplayName(item.operator) : (item.operator || '-');
            if (isQueueOnly) {
                opCellHtml = `<span class="slow" style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer', '', 'width: 12px; height: 12px;')} ${t('op_not_connected', 'Operatorga ulanmadi')}</span>`;
            } else {
                opCellHtml = `<span>${opDisplayName}</span>`;
            }

            // Duration & Wait
            const durSec = item.duration || 0;
            const waitSecVal = item.waitSec || 0;
            const waitCellHtml = isOut
                ? `<td class="mut">—</td>`
                : (waitSecVal > 30
                    ? `<td class="slow">${formatSeconds(waitSecVal)}</td>`
                    : `<td>${formatSeconds(waitSecVal)}</td>`);

            // Status dot + label
            let statusColor = 'var(--ok, #2cc4ae)';
            let statusText = 'Javob berilgan';
            if (isXfer) {
                statusColor = 'var(--accent, #6c8cff)';
                statusText = 'Transfer qilingan';
            } else if (isOut) {
                if (item.status === 'BUSY') {
                    statusColor = 'var(--miss, #ff6b70)';
                    statusText = 'Band';
                } else if (!isAns) {
                    statusColor = 'var(--miss, #ff6b70)';
                    statusText = 'Javobsiz';
                }
            } else if (!isAns) {
                statusColor = 'var(--wait, #f2b035)';
                statusText = 'Navbatdan chiqdi';
            }

            // Audio Actions
            const isConnectedOut = isOut && durSec > 0;
            const hasAudio = ((item.status === 'ANSWERED' || isConnectedOut) && durSec > 0) || Boolean(item.recording);
            const safeRec = (item.recording || '').replace(/'/g, "\\'");
            const safeCaller = (item.callerId || '').replace(/'/g, "\\'");
            const callKey = `${item.callerId || ''}_${durSec}`;
            const isThisPlaying = typeof currentlyPlayingCallKey !== 'undefined' && currentlyPlayingCallKey === callKey;
            const isThisPaused = typeof pausedCallKey !== 'undefined' && pausedCallKey === callKey;
            const isThisSearching = typeof activeSearchingCallerId !== 'undefined' && activeSearchingCallerId === item.callerId;

            const playBtnText = isThisSearching
                ? `${isax('timer', '', 'width: 12px; height: 12px;')} Qidirilmoqda...`
                : (isThisPlaying
                    ? `${isax('pause', '', 'width: 12px; height: 12px;')} To‘xtatish`
                    : (isThisPaused
                        ? `${isax('play', '', 'width: 12px; height: 12px;')} Davom`
                        : `${isax('play', '', 'width: 12px; height: 12px;')} Tinglash`));

            const audioActionHtml = hasAudio
                ? `<button type="button" class="btn p btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                           ${isThisSearching ? 'disabled' : ''} 
                           onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                           title="${isThisPlaying ? 'To\'xtatish' : (isThisPaused ? 'Davom ettirish' : 'Audioni tinglash')}">
                       <span>${playBtnText}</span>
                   </button>
                   <button type="button" class="btn" 
                           onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                           title="${t('audio_detail_title', "Audio Explorer studiyasida to'liq pleyer bilan ochish")}">
                       <span>${isax('document-text', '', 'width: 12px; height: 12px;')} Detal</span>
                   </button>`
                : `<button type="button" class="btn" disabled>
                       <span class="mut">${isax('close-circle', '', 'width: 12px; height: 12px;')} Audio yo‘q</span>
                   </button>`;

            const timeStr = item.time ? new Date(item.time).toLocaleTimeString('uz-UZ', { hour12: false, timeZone: 'Asia/Tashkent' }) : '--:--:--';

            return `
                <tr class="${rowClass}">
                    <td>${timeStr}</td>
                    <td>
                        <span class="dir ${dirClass}" title="${dirTitle}">${dirIcon}</span><span class="num" onclick="copyCallbackPhone('${item.callerId}', this, event)" style="cursor: pointer;" title="Nusxalash: ${item.callerId}">${callerHtml}</span>
                    </td>
                    <td>${opCellHtml}</td>
                    <td>${formatSeconds(durSec)}</td>
                    ${waitCellHtml}
                    <td><span class="dot" style="--c: ${statusColor};"></span>${statusText}</td>
                    <td><div class="act">${audioActionHtml}</div></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('renderDashboardRecentTable error:', err);
    }
}

// Barcha ochiq jadvallarni bir zumda yangilash (dashboard + history)
function refreshAllActiveTables() {
    applyDashboardRecentFilters();
    // History tab ham ochiq bo'lsa, u yerdagi audio tugmalarni ham yangilaymiz
    if (currentHistoryData && currentHistoryData.length > 0) {
        if (historyDataSource === 'agent') {
            renderAgentHistoryTable(currentHistoryData);
        } else {
            renderServerHistoryTable(currentHistoryData);
        }
    }
}

async function playDashboardRecording(recFile, callerId, duration, btn) {
    const callKey = `${callerId}_${duration}`;
    const audio = getNativeAudio();

    // 0. Keshda oldin topilgan bo'lsa, o'shandan foydalanamiz
    recFile = recFile || knownRecordingsCache.get(callKey) || '';

    // 1. Agar aynan shu audio hozir ijro etilayotgan bo'lsa -> Pauza qilamiz
    if (currentlyPlayingCallKey === callKey && !audio.paused) {
        audio.pause();
        pausedCallKey = callKey;
        currentlyPlayingCallKey = null;
        currentlyPlayingBtn = null;
        refreshAllActiveTables();
        return;
    }

    // 2. Agar aynan shu audio pauzada turgan bo'lsa -> Qaytadan qidirmasdan DAVOM ETTIRAMIZ (Resume)
    if (pausedCallKey === callKey && audio.src && !audio.ended && audio.currentTime > 0) {
        pausedCallKey = null;
        currentlyPlayingCallKey = callKey;
        currentlyPlayingBtn = btn;
        audio.play().then(() => {
            updatePlayerPlayState(true);
        }).catch(() => { });
        refreshAllActiveTables();
        return;
    }

    // 3. Agar boshqa audio bosilgan bo'lsa -> avvalgisini to'liq to'xtatamiz (STOP)
    pausedCallKey = null;
    try {
        audio.pause();
        audio.currentTime = 0;
    } catch (e) { }

    // Avvalgi qidiruvni bekor qilish (Abort)
    if (activeRecordingSearchController) {
        try {
            activeRecordingSearchController.abort();
        } catch (e) { }
        activeRecordingSearchController = null;
    }
    activeSearchingCallerId = null;

    if (recFile) {
        currentlyPlayingCallKey = callKey;
        currentlyPlayingBtn = btn;
        knownRecordingsCache.set(callKey, recFile);
        refreshAllActiveTables();
        const displayName = `${isax('call')} ${callerId} (${formatSeconds(duration || 0)})`;
        playAudioFile(displayName, recFile, (duration || 0) * 16000, false);
        return;
    }

    // 4. Serverdan qidirish (faqat birinchi marta 1 ta qidiruv bo'ladi, keyin keshlanadi)
    activeSearchingCallerId = callerId;
    activeRecordingSearchBtn = btn;
    activeRecordingSearchController = new AbortController();
    const currentController = activeRecordingSearchController;
    refreshAllActiveTables();

    try {
        let matchedRecording = null;
        let matchedDuration = duration;

        // 1-bosqich: Fast-Index tekshiruvi (RAM dagi indeksdan 0.2ms da topadi!)
        try {
            const fastRes = await fetch(`/api/recordings/fast-find?callerId=${encodeURIComponent(callerId)}&duration=${duration || 0}`, {
                signal: currentController.signal
            }).then(r => r.json());
            if (fastRes && fastRes.found && fastRes.recording) {
                matchedRecording = fastRes.recording;
                matchedDuration = fastRes.duration || duration;
            }
        } catch (fastErr) { }

        // 2-bosqich: Agar tezkor indeksdan topilmasa, CDR bazasidan qidirish
        if (!matchedRecording) {
            const targetItem = dashboardRecentCallsList.find(i => i.callerId === callerId);
            let dateParam = '';
            if (targetItem && targetItem.time) {
                const d = String(targetItem.time).slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                    dateParam = `&date=${d}`;
                }
            }
            const res = await fetch(`/api/calls/details?search=${encodeURIComponent(callerId)}&limit=5${dateParam}`, {
                signal: currentController.signal
            });
            const data = await res.json();
            const matched = data && data.data && data.data.find(c => c.recording && c.recording.length > 0);
            if (matched && matched.recording) {
                matchedRecording = matched.recording;
                matchedDuration = matched.duration || duration;
            }
        }

        if (matchedRecording) {
            knownRecordingsCache.set(callKey, matchedRecording);
            const targetItem = dashboardRecentCallsList.find(i => i.callerId === callerId);
            if (targetItem) targetItem.recording = matchedRecording;

            currentlyPlayingCallKey = callKey;
            currentlyPlayingBtn = btn;
            refreshAllActiveTables();
            const displayName = `${isax('call')} ${callerId} (${formatSeconds(matchedDuration || duration || 0)})`;
            playAudioFile(displayName, matchedRecording, (matchedDuration || duration || 0) * 16000, false);
        } else {
            alert(tf('audio_not_found_alert', { phone: callerId }, `⚠️ "${callerId}" raqamiga tegishli audio yozuv topilmadi yoki suhbat amalga oshmagan (0 soniya).`));
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        alert(t('audio_download_error', 'Audio yozuvni yuklashda xatolik yuz berdi: ') + e.message);
    } finally {
        if (activeSearchingCallerId === callerId) {
            activeSearchingCallerId = null;
            activeRecordingSearchBtn = null;
            activeRecordingSearchController = null;
            refreshAllActiveTables();
        }
    }
}

function addRecentDashboardRow(record) {
    if (!record) return;
    dashboardRecentCallsList.unshift(record);
    if (dashboardRecentCallsList.length > 200) {
        dashboardRecentCallsList.pop();
    }
    updateRecentOperatorsDataList();
    applyDashboardRecentFilters();
}

/* ==========================================================================
   Helper Functions (formatSeconds & formatDuration defined at top)
   ========================================================================== */

async function loadInitialData() {
    setDateFilterLoading(true);
    try {
        const [statsRes, opRes, queueRes, statusRes, recentRes] = await Promise.all([
            fetch('/api/stats').then(r => r.json()).catch(() => null),
            fetch('/api/operators').then(r => r.json()).catch(() => []),
            fetch('/api/queues').then(r => r.json()).catch(() => []),
            fetch('/api/status').then(r => r.json()).catch(() => null),
            fetch('/api/calls/recent').then(r => r.json()).catch(() => null)
        ]);

        if (statsRes) updateStatsUI(statsRes);
        if (opRes) renderOperators(opRes);
        if (queueRes) renderQueues(queueRes);
        if (statusRes) {
            updateAmiStatus(statusRes.amiConnected);
            updateSftpStatus(statusRes.sftpConnected);
        }
        const recentCalls = Array.isArray(recentRes) ? recentRes : (recentRes && Array.isArray(recentRes.data) ? recentRes.data : []);
        if (recentCalls.length > 0) {
            dashboardRecentCallsList = [...recentCalls];
            updateRecentOperatorsDataList();
            applyDashboardRecentFilters();
        }
        if (typeof loadTabAgentOperators === 'function') {
            await loadTabAgentOperators();
        }
    } catch (e) {
        console.warn('Dastlabki yuklash xatosi:', e);
    } finally {
        setDateFilterLoading(false);
    }
}

/* ==========================================================================
   7. Interactive Drill-down Detail Modal Logic (KPI & Operator Details)
   ========================================================================== */
let currentDetailAudio = null;
let detailState = {
    type: 'all',
    operatorExt: '',
    title: '',
    page: 1,
    limit: 50,
    search: '',
    totalPages: 1,
    total: 0,
    rawCalls: [],
    category: null,      // 'answered' | 'outbound' | null — operator modalidagi pill filtri
    sortKey: null,        // 'time' | 'callerId' | 'operator' | 'duration' | 'status' | 'direction'
    sortDir: 'asc',
    currentOp: null
};

function closeDetailModal() {
    if (currentDetailAudio) {
        currentDetailAudio.pause();
        currentDetailAudio = null;
    }
    smoothCloseDashboardModal('detailModal');
}

let detailSearchTimeout = null;
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
    const btnCloseBtn = document.getElementById('btnCloseDetailModalBtn');
    const modal = document.getElementById('detailModal');
    const limitSelect = document.getElementById('detailLimitSelect');
    const searchInput = document.getElementById('detailSearchInput');
    const prevBtn = document.getElementById('detailPrevPage');
    const nextBtn = document.getElementById('detailNextPage');

    if (btnClose) btnClose.onclick = closeDetailModal;
    if (btnCloseBtn) btnCloseBtn.onclick = closeDetailModal;
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closeDetailModal();
        };
    }

    if (limitSelect) {
        limitSelect.onchange = (e) => {
            detailState.limit = parseInt(e.target.value, 10) || 100;
            detailState.page = 1;
            fetchAndRenderDetailCalls();
        };
    }

    if (searchInput) {
        searchInput.oninput = (e) => {
            handleDetailSearch(e.target.value);
        };
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
}

// Global Escape listener
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetailModal();
});

// Run initialization immediately or on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDetailModalEvents);
} else {
    initDetailModalEvents();
}

// Sahifadagi tafsilotlar jadvalini (yuklangan xom qatorlarga) pill-filtr va ustun-saralashni qo'llab render qiladi.
// Tarmoqqa murojaat qilmaydi — faqat detailState.rawCalls ustida ishlaydi (tez, instant filtr/sort).
function getFilteredSortedDetailCalls() {
    let calls = detailState.rawCalls.slice();

    const isTransferCall = (c) => Boolean(
        c.direction === 'transfer' ||
        (c.hangupParty && String(c.hangupParty).toLowerCase().includes('transfer')) ||
        (c.operator && (c.operator.includes('➔') || c.operator.includes('->') || c.operator.includes('→')))
    );

    if (detailState.category === 'answered') {
        calls = calls.filter(c => c.direction !== 'outbound' && c.status === 'ANSWERED' && !isTransferCall(c));
    } else if (detailState.category === 'outbound') {
        calls = calls.filter(c => c.direction === 'outbound' && c.status === 'ANSWERED');
    } else if (detailState.category === 'transfer') {
        calls = calls.filter(c => isTransferCall(c));
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

// Operator modalidagi "Qabul qilingan / Chiquvchi / Rad etilgan" pillarni bosganda filtr sifatida ishlaydi.
function filterDetailByCategory(cat) {
    if (cat === 'denied') {
        // "Rad etilgan" ma'lumotlari boshqa manbadan keladi — haqiqiy qayta so'rov kerak
        detailState.type = (detailState.type === 'denied') ? 'operator' : 'denied';
        detailState.category = null;
        detailState.page = 1;
        fetchAndRenderDetailCalls();
        return;
    }
    if (detailState.type === 'denied') {
        // "Rad etilgan" rejimidan chiqib, operator ro'yxatiga qaytish va tanlangan kategoriyani qo'llash
        detailState.type = 'operator';
        detailState.category = cat;
        detailState.page = 1;
        fetchAndRenderDetailCalls();
        return;
    }
    detailState.category = (detailState.category === cat) ? null : cat;
    renderDetailTableBody();
    renderOperatorSummaryPills();
}
window.filterDetailByCategory = filterDetailByCategory;

function sortArrow(key) {
    // Belgi doim chiqadi va kengligi o'zgarmaydi — saralanganda sarlavha matni siljimaydi
    if (detailState.sortKey !== key) return '<span class="sort-icon">↕</span>';
    return detailState.sortDir === 'asc'
        ? '<span class="sort-icon" style="color: #38bdf8; opacity: 1;">▲</span>'
        : '<span class="sort-icon" style="color: #38bdf8; opacity: 1;">▼</span>';
}

function sortableTh(label, key, extraStyle = '') {
    return `<th class="sortable-th" style="${extraStyle}" onclick="sortDetailTable('${key}')" title="${t('sort_click_title', 'Saralash uchun bosing')}">${label}${sortArrow(key)}</th>`;
}

function renderDetailTableBody() {
    const bodyEl = document.getElementById('detailModalBody');
    const countBadge = document.getElementById('detailCountBadge');
    if (!bodyEl) return;

    const calls = getFilteredSortedDetailCalls();

    if (countBadge) {
        const filtered = calls.length !== detailState.rawCalls.length;
        countBadge.innerText = filtered
            ? tf('detail_filter_total', { total: detailState.total, count: calls.length }, `Jami: ${detailState.total} ta qo'ng'iroq (Filtr: ${calls.length} ta ko'rsatilmoqda)`)
            : tf('detail_total_calls', { total: detailState.total, count: calls.length }, `Jami: ${detailState.total} ta qo'ng'iroq (Ko'rsatilmoqda: ${calls.length} ta)`);
    }

    if (calls.length === 0) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                ${t('detail_empty_note', "Ushbu turkum bo'yicha hech qanday qo'ng'iroq topilmadi.")}
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
                    <th>${t('col_audio', 'Audio')}</th>
                </tr>
            </thead>
            <tbody>
                ${calls.map((c, index) => {
        const rowNum = index + 1;
        const isAns = c.status === 'ANSWERED';
        const isOut = c.direction === 'outbound';
        const isXfer = c.direction === 'transfer' ||
            (c.hangupParty && String(c.hangupParty).toLowerCase().includes('transfer')) ||
            (c.operator && (c.operator.includes('➔') || c.operator.includes('->') || c.operator.includes('→')));

        let durText = '';
        if (detailState.type === 'abandoned') {
            durText = `<span style="font-weight: 700; color: #fbbf24; font-family: monospace; font-size: 13px;">${formatSeconds(c.waitSec || c.duration || 0)}</span>`;
        } else if (isXfer) {
            durText = `<span style="font-weight: 700; color: #c084fc;">${t('talk_prefix', 'Suhbat:')} ${formatSeconds(c.duration)}</span>`;
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
        if (isXfer) {
            statusBadge = `<span class="badge" style="background: rgba(168, 85, 247, 0.22); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.45); font-size: 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px;">${isax('arrow-swap-horizontal', '', 'width: 10px; height: 10px; color: #c084fc;')} ${t('status_transferred', 'Transfer qilingan')}</span>`;
        } else if (isOut) {
            if (isAns) {
                statusBadge = `<span class="badge badge-success" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('kpi_answered_calls', 'Muvaffaqiyatli')}</span>`;
            } else if (c.status === 'BUSY') {
                statusBadge = `<span class="badge badge-danger" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('status_busy', 'Band')}</span>`;
            } else {
                statusBadge = `<span class="badge badge-danger" style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;">${isax('call-slash', '', 'width: 11px; height: 11px;')} ${t('status_no_answer', 'Javobsiz')}</span>`;
            }
        } else {
            if (isAns) {
                statusBadge = `<span class="badge badge-success" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('status_answered', 'Javob berilgan')}</span>`;
            } else if (c.status === 'BUSY') {
                statusBadge = `<span class="badge badge-danger" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('status_busy', 'Band')}</span>`;
            } else {
                statusBadge = `<span class="badge badge-warning" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('status_abandoned', 'Navbatdan chiqdi')}</span>`;
            }
        }

        const directionBadge = isXfer
            ? `<span class="badge" style="background: rgba(168, 85, 247, 0.22); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.5); font-size: 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px;">${isax('arrow-swap-horizontal', '', 'width: 11px; height: 11px; color: #c084fc;')} ${t('dir_transfer', 'Transfer')}</span>`
            : (isOut
                ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 10px;"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>`
                : `<span class="badge badge-info" style="font-size: 10px;"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`);

        let rowStyle = '';
        if (isXfer) {
            rowStyle = 'background: rgba(168, 85, 247, 0.14); border-left: 4px solid #c084fc; box-shadow: inset 0 0 16px rgba(168, 85, 247, 0.08);';
        } else if (isOut) {
            rowStyle = 'background: rgba(56, 189, 248, 0.08); border-left: 3px solid #38bdf8;';
        } else if (!isAns) {
            rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
        }

        let hangupDisplay = formatHangupParty(c.hangupParty, isXfer);
        const callerKey = `opmodal_${c.recording || ''}_${c.callerId || ''}_${c.time || index}`;
        const isExpCaller = isCallerExpanded(callerKey);

        return `
                        <tr style="${rowStyle}">
                            <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                            <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${new Date(c.time).toLocaleTimeString('uz-UZ', { hour12: false, timeZone: 'Asia/Tashkent' })}</td>
                            <td class="${isExpCaller ? 'cell-expanded' : ''}">
                                <div class="phone-cell ${isOut ? 'outbound' : ''} ${isExpCaller ? 'is-expanded' : ''}">
                                    <span class="phone-icon">${isOut ? isax('export') : (isXfer ? isax('arrow-swap-horizontal', '', 'width: 12px; height: 12px; color: #c084fc;') : isax('call'))}</span>
                                    ${renderExpandableCallerHtml(c.callerId, callerKey)}
                                </div>
                            </td>
                            <td style="white-space: nowrap;">${directionBadge}</td>
                            <td style="white-space: nowrap;">
                                ${(c.operator || '').includes('IVR') || (c.operator || '').includes('Avtojavob') || (c.operator || '').includes('Navbatga kirmasdan')
                ? `<span style="color: #94a3b8; font-style: italic; display: inline-flex; align-items: center; gap: 4px;">${(c.operator || '').includes('Navbatga kirmasdan') ? isax('logout', '', 'width: 12px; height: 12px;') : isax('cpu', '', 'width: 12px; height: 12px;')} ${c.operator}</span>`
                : (isXfer
                    ? `<span style="font-weight: 700; color: #e9d5ff; display: inline-flex; align-items: center; gap: 6px; background: rgba(168, 85, 247, 0.16); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(168, 85, 247, 0.35);">${isax('arrow-swap-horizontal', '', 'width: 12px; height: 12px; color: #c084fc;')} ${c.operator}</span>`
                    : `<span style="font-weight: 600; color: var(--text-main);">${c.operator}</span>`
                )
            }
                            </td>
                            <td style="white-space: nowrap;">${durText}</td>
                            <td style="white-space: nowrap;">${statusBadge}</td>
                            <td style="white-space: nowrap; font-size: 12px;">${hangupDisplay}</td>
                            <td style="white-space: nowrap;">
                                ${c.recording ? `
                                    <button class="btn-action" style="padding: 3px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="playCallAudio('${c.recording}', this)">
                                        ${isax('play', '', 'width: 12px; height: 12px;')} ${t('audio_listen', 'Tinglash')}
                                    </button>
                                ` : `<span style="color: var(--text-dim); font-size: 11px;">${t('audio_not_available', 'Mavjud emas')}</span>`}
                            </td>
                        </tr>
                    `;
    }).join('')}
            </tbody>
        </table>
    `;
}

async function fetchAndRenderDetailCalls() {
    const bodyEl = document.getElementById('detailModalBody');
    const countBadge = document.getElementById('detailCountBadge');
    const pageInd = document.getElementById('detailPageIndicator');
    const prevBtn = document.getElementById('detailPrevPage');
    const nextBtn = document.getElementById('detailNextPage');

    bodyEl.innerHTML = `
        <div class="modal-loading-box">
            <div class="modal-spinner-ring"></div>
            <div class="modal-loading-text">${t('detail_loading', "Ma'lumotlar yuklanmoqda...")}</div>
        </div>
    `;

    try {
        const todayStr = getTodayDateString();
        const activeDate = currentSelectedDate || todayStr;

        const queryParams = new URLSearchParams({
            type: detailState.type,
            operator: detailState.operatorExt,
            page: detailState.page,
            limit: detailState.limit,
            search: detailState.search,
            date: activeDate
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
        bodyEl.innerHTML = `<div style="color: var(--danger); padding: 20px;">${tf('hist_error', { msg: err.message }, `Xatolik: ${err.message}`)}</div>`;
    }
}

async function openCallsDetail(type, title) {
    const modal = document.getElementById('detailModal');
    const titleEl = document.getElementById('detailModalTitle');
    const subTitleEl = document.getElementById('detailModalSubtitle');
    const summaryEl = document.getElementById('detailOperatorSummary');
    const searchInput = document.getElementById('detailSearchInput');

    detailState.type = type;
    detailState.operatorExt = '';
    detailState.title = title;
    detailState.page = 1;
    detailState.search = '';
    detailState.category = null;
    detailState.sortKey = null;
    detailState.sortDir = 'asc';
    detailState.currentOp = null;

    if (searchInput) searchInput.value = '';

    const isToday = !currentSelectedDate || currentSelectedDate === getTodayDateString();
    titleEl.innerHTML = `${isax('chart')} ${title}`;
    subTitleEl.innerText = isToday ? t('detail_today_subtitle', "Bugungi kun bo'yicha saralangan qo'ng'iroqlar tafsiloti") : tf('detail_date_subtitle', { date: currentSelectedDate }, `${currentSelectedDate} sanasi bo'yicha saralangan qo'ng'iroqlar tafsiloti`);
    summaryEl.style.display = 'none';
    summaryEl.innerHTML = '';

    modal.style.display = 'flex';
    fetchAndRenderDetailCalls();
}

// Operatorlar modalidagi ustki pillarni (Qabul qilingan / Chiquvchi / Rad etilgan / ...) chizadi.
// Bosiladigan pillar joriy filtrga qarab faol ko'rinishda (halqa) chiziladi.
function renderOperatorSummaryPill(label, valueHtml, colorRgb, borderRgb, category) {
    const isActive = category && ((category === 'denied' && detailState.type === 'denied') || (category !== 'denied' && detailState.category === category));
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
    const transferredIn = op.transferredIn || 0;
    const transferredOut = op.transferredOut || 0;

    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-right: 20px;">
            <div class="operator-avatar" style="width: 48px; height: 48px; font-size: 15px; background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
                ${op.id}
            </div>
            <div>
                <h4 style="font-size: 16px; font-weight: 700; color: #fff;">${cleanName}</h4>
                <span style="font-size: 12px; color: var(--text-dim);">${t('op_sum_internal', 'Ichki raqam:')} ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
            </div>
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
            ${renderOperatorSummaryPill(t('op_sum_answered', 'Qabul qilingan'), `<b style="font-size: 14px; color: var(--success);">${op.answered || 0} ${t('unit_item', 'ta')}</b>`, '16, 185, 129', '16, 185, 129', 'answered')}
            ${renderOperatorSummaryPill(t('dir_outbound', 'Chiquvchi'), `<b style="font-size: 14px; color: #38bdf8;">${op.outbound || 0} ${t('unit_item', 'ta')}</b>`, '56, 189, 248', '56, 189, 248', 'outbound')}
            ${renderOperatorSummaryPill('Transfer', `<b style="font-size: 14px; color: #c084fc; display: inline-flex; align-items: center; gap: 4px;"><span style="color: #22c55e;" title="Kiruvchi transfer">${isax('arrow-down', '', 'width: 10px; height: 10px;')} ${transferredIn}</span><span style="color: rgba(255,255,255,0.3);">|</span><span style="color: #38bdf8;" title="Chiquvchi transfer">${isax('arrow-up', '', 'width: 10px; height: 10px;')} ${transferredOut}</span></b>`, '168, 85, 247', '168, 85, 247', 'transfer')}
            ${renderOperatorSummaryPill(t('status_denied', 'Rad etilgan'), `<b style="font-size: 14px; color: var(--danger);">${op.denied || 0} ${t('unit_item', 'ta')}</b>`, '239, 68, 68', '239, 68, 68', 'denied')}
            <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">${t('op_card_total_talk', 'Umumiy suhbat:')}</span>
                <b style="font-size: 14px; color: #fff;">${formatSeconds(op.totalDurationSec || 0)}</b>
            </div>
            <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">${t('op_card_avg_talk', "O'rtacha suhbat:")}</span>
                <b style="font-size: 14px; color: #fbbf24;">${formatSeconds(op.avgDurationSec || 0)}</b>
            </div>
            <div style="background: rgba(148, 163, 184, 0.1); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">${t('op_sum_line_status', 'Liniya holati:')}</span>
                <b style="font-size: 12px; color: ${op.presence === 'ready' ? 'var(--success)' : (op.presence === 'talking' ? '#38bdf8' : (op.presence === 'paused' || op.paused ? '#fbbf24' : 'var(--danger)'))};">
                    ${op.presence === 'ready' ? '🟢 ' + t('op_status_ready', 'Qabul qilishga tayyor') : (op.presence === 'talking' ? '🔵 ' + t('status_talking', 'Hozir suhbatda') : (op.presence === 'paused' || op.paused ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('pause', '', 'width: 12px; height: 12px;')} Pauzada (Tanaffus)</span>` : '🔴 ' + t('op_status_offline', 'Offline')))}
                </b>
            </div>
            <button type="button" 
                    onclick="toggleOperatorPause('${op.id}', ${!(op.paused || op.presence === 'paused')}, event)" 
                    class="btn-detail-pause ${(op.paused || op.presence === 'paused') ? 'unpause' : 'pause'}">
                ${(op.paused || op.presence === 'paused') ? `${isax('play', '', 'width: 13px; height: 13px;')} Pauzadan chiqarish (Ishga qaytish)` : `${isax('pause', '', 'width: 13px; height: 13px;')} Tanaffusga (Pauzaga) qo\'yish`}
            </button>
        </div>
    `;
}

async function openOperatorDetail(operatorId) {
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

    titleEl.innerHTML = `${isax('user')} ` + tf('detail_op_title', { name: cleanName }, `${cleanName} — Tafsilotlar & Bugungi Suhbatlar`);
    subTitleEl.innerText = t('detail_subtitle_op_activity', 'Operatorning kunlik faolligi, intizomi va audio yozuvlari');

    renderOperatorSummaryPills();

    modal.style.display = 'flex';
    fetchAndRenderDetailCalls();
}

function openQueueDetail() {
    const modal = document.getElementById('detailModal');
    const titleEl = document.getElementById('detailModalTitle');
    const subTitleEl = document.getElementById('detailModalSubtitle');
    const summaryEl = document.getElementById('detailOperatorSummary');
    const bodyEl = document.getElementById('detailModalBody');
    const countBadge = document.getElementById('detailCountBadge');
    const pageInd = document.getElementById('detailPageIndicator');

    titleEl.innerHTML = t('detail_queue_title', '👥 Navbatda Kutayotganlar (Real-time)');
    subTitleEl.innerText = t('detail_queue_subtitle', "Ayni daqiqada navbatda turgan mijozlar ro'yxati");
    summaryEl.style.display = 'none';
    summaryEl.innerHTML = '';

    const waiters = currentQueues.flatMap(q => (q.callersWaiting || []).map(c => ({ ...c, queueName: q.name })));
    countBadge.innerText = tf('detail_queue_count', { n: waiters.length }, `Jami: ${waiters.length} ta mijoz kutmoqda`);
    if (pageInd) pageInd.innerText = '1 / 1';

    if (waiters.length === 0) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                ${t('detail_queue_empty_note', "Hozircha navbatda kutayotgan mijozlar yo'q. Barcha qo'ng'iroqlar operatorlarga ulangan yoki navbat bo'sh.")}
            </div>
        `;
    } else {
        bodyEl.innerHTML = `
            <table class="detail-table">
                <thead>
                    <tr>
                        <th>${t('detail_col_position', "O'rni")}</th>
                        <th>${t('detail_col_client_phone', 'Mijoz Raqami')}</th>
                        <th>${t('detail_col_queue_name', 'Navbat Nomi')}</th>
                        <th>${t('detail_col_wait_time', 'Kutish Vaqti')}</th>
                        <th>${t('detail_col_channel', 'Kanal')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${waiters.map(w => `
                        <tr>
                            <td style="font-weight: 700; color: #fbbf24;">#${w.position || 1}</td>
                            <td style="white-space: nowrap;">
                                <div class="phone-cell">
                                    <span class="phone-icon">${isax('call')}</span>
                                    <span>${w.callerId}</span>
                                </div>
                            </td>
                            <td><span class="badge badge-info">${w.queueName || t('live_default_queue', 'Asosiy Navbat')}</span></td>
                            <td style="font-weight: 600; color: var(--warning);">${w.waitSec ? formatSeconds(w.waitSec) : t('wait_status', 'Kutmoqda...')}</td>
                            <td style="font-size: 11px; color: var(--text-dim);">${w.channel || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    modal.style.display = 'flex';
}

let currentDetailBtn = null;

function playCallAudio(recordingFile, btn) {
    if (!recordingFile) {
        alert(t('audio_missing_alert', "Ushbu qo'ng'iroqda audio yozuv mavjud emas (suhbat bo'lmagan)"));
        return;
    }

    const recBase = recordingFile.split('/').pop();
    playAudioFile(recBase, recordingFile, 0);
}

/* ==========================================================================
   8. 3CX Desktop Agent Logs Modal
   ========================================================================== */
let agentLogsCurrentPage = 1;
let agentLogsTotalPages = 1;

function openAgentLogsModal() {
    const modal = document.getElementById('agentLogsModal');
    if (modal) {
        modal.style.display = 'flex';
        loadAgentLogs(1);
    }
}

function closeAgentLogsModal() {
    smoothCloseDashboardModal('agentLogsModal');
}

function changeAgentLogsPage(delta) {
    const target = agentLogsCurrentPage + delta;
    if (target >= 1 && target <= agentLogsTotalPages) {
        loadAgentLogs(target);
    }
}

async function loadAgentLogs(page = 1) {
    agentLogsCurrentPage = page;
    const bodyEl = document.getElementById('agentLogsModalBody');
    const filterEl = document.getElementById('agentLogsOperatorFilter');
    const totalEl = document.getElementById('agentLogsTotalCount');
    const pageEl = document.getElementById('agentLogsPageIndicator');
    const prevBtn = document.getElementById('agentLogsPrevBtn');
    const nextBtn = document.getElementById('agentLogsNextBtn');

    const opId = filterEl ? filterEl.value : '';
    let url = `/api/agent/logs?page=${page}&limit=50`;
    if (opId) url += `&operatorId=${encodeURIComponent(opId)}`;

    if (bodyEl) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                ${t('logs_loading', 'Yuklanmoqda...')}
            </div>
        `;
    }

    try {
        const res = await fetch(url);
        const json = await res.json();

        agentLogsTotalPages = json.totalPages || 1;
        if (pageEl) pageEl.innerText = `${json.page || 1} / ${agentLogsTotalPages}`;
        if (totalEl) totalEl.innerText = tf('logs_total_events', { n: json.total || 0 }, `Jami: ${json.total || 0} ta hodisa`);
        if (prevBtn) prevBtn.disabled = (json.page <= 1);
        if (nextBtn) nextBtn.disabled = (json.page >= agentLogsTotalPages);

        if (!json.data || json.data.length === 0) {
            bodyEl.innerHTML = `
                <div style="text-align: center; padding: 50px; color: var(--text-muted); font-size: 13px;">
                    ${t('logs_no_records', "3CX Desktop Agent tomonidan hozircha qo'ng'iroq qayd etilmadi.")}<br>
                    <span style="font-size: 11px; opacity: 0.7;">${t('logs_empty_hint', "Qo'ng'iroqlar amalga oshirilganda bu yerda real-time paydo bo'ladi.")}</span>
                </div>
            `;
            return;
        }

        const opNames = {
            '101': 'Oybek',
            '103': 'Feruza',
            '106': 'Ubaydullayeva Gulchehra',
            '111': 'Nozima',
            '114': 'Maxmudbek',
            '119': 'Muattar',
            '120': 'Navruzoy'
        };

        const rowsHtml = json.data.map((r, index) => {
            const rowNum = (json.page - 1) * 50 + index + 1;
            const opName = opNames[String(r.operator_id)] || `Operator ${r.operator_id}`;
            const opDisplay = `${opName} (${r.operator_id})`;

            let typeBadge = '';
            const evtType = (r.event_type || '').toUpperCase();
            const dur = parseInt(r.duration_sec || 0, 10);

            const isDialled = evtType === 'DIALLED' || evtType === 'OUTBOUND';
            if (evtType === 'REJECT') {
                typeBadge = `<span class="status-badge failed" style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('logs_status_denied', 'Rad etildi')}</span>`;
            } else if (isDialled) {
                if (dur > 0) {
                    typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-weight: 700;"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'Chiquvchi')}</span>`;
                } else {
                    typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);"><i class="badge-dir-icon outbound"></i> ${t('logs_status_outbound_unconnected', 'Chiquvchi (Ulanmagan)')}</span>`;
                }
            } else if (evtType === 'MISSED' || dur === 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">${t('logs_status_missed', "⚠️ O'tkazib yuborildi")}</span>`;
            } else if (evtType === 'ANSWERED' || dur > 0) {
                typeBadge = `<span class="status-badge answered">${t('logs_status_answered', '🟢 Javob berildi')}</span>`;
            } else if (evtType === 'RINGING' || evtType === 'INCOMING') {
                typeBadge = `<span class="status-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'Kiruvchi')}</span>`;
            } else {
                typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3);">${t('logs_status_ended', '📴 Tugadi')}</span>`;
            }

            const durFormatted = formatSeconds(dur);

            return `
                <tr>
                    <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                    <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${r.event_time || ''}</td>
                    <td style="font-weight: 600; color: var(--text-main); white-space: nowrap;">${opDisplay}</td>
                    <td style="white-space: nowrap;">
                        <div class="phone-cell">
                            <span class="phone-icon">${isax('call')}</span>
                            <span>${r.caller_id || t('logs_hidden_caller', 'Yashirin')}</span>
                        </div>
                    </td>
                    <td style="white-space: nowrap;">${typeBadge}</td>
                    <td style="white-space: nowrap; font-weight: 600;">${durFormatted}</td>
                    <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">💻 ${r.hostname || '-'}</td>
                    <td style="color: var(--text-muted); font-size: 11px; white-space: nowrap;">${r.details || '-'}</td>
                </tr>
            `;
        }).join('');

        bodyEl.innerHTML = `
            <div class="table-container" style="max-height: calc(88vh - 200px); overflow-y: auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width: 45px; text-align: center;">№</th>
                            <th>${t('logs_col_time', 'Qayd Vaqti')}</th>
                            <th>${t('set_col_operator', 'Operator')}</th>
                            <th>${t('logs_col_phone', 'Mijoz Raqami')}</th>
                            <th>${t('logs_col_event', 'Hodisa Turi')}</th>
                            <th>${t('logs_col_talk', 'Suhbat Vaqti')}</th>
                            <th>${t('logs_col_pc', 'Kompyuter (PC)')}</th>
                            <th>${t('logs_col_details', '3CX Tarixi')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--danger);">
                ${tf('logs_load_failed', { msg: err.message }, `Ma'lumotlarni yuklab bo'lmadi: ${err.message}`)}
            </div>
        `;
    }
}

/* ==========================================================================
   12. Operators Tab — 3CX Desktop Agent Operatorlar Nazorati (/operators)
   ========================================================================== */
let tabAgentOperatorsData = [];
let selectedTabAgentOpId = null;
let tabOperatorLogsPage = 1;
const tabOperatorLogsLimit = 50;

async function loadTabAgentOperators(targetDate = null) {
    const grid = document.getElementById('tabOperatorsGrid');
    try {
        lastTabOpsFingerprint = '';
        const todayStr = getTodayDateString();
        const activeDate = (typeof targetDate === 'string' && targetDate) ? targetDate : (currentSelectedDate || todayStr);
        const urlDateParam = (activeDate === todayStr) ? '' : `?date=${encodeURIComponent(activeDate)}`;
        const res = await fetch(`/api/agent/operator-stats${urlDateParam}`);
        tabAgentOperatorsData = await res.json();
        renderTabAgentOperators(tabAgentOperatorsData);
    } catch (e) {
        console.error('loadTabAgentOperators error:', e.message);
    }
}

async function loadSyncStatus() {
    try {
        const res = await fetch('/api/agent/sync-status');
        const data = await res.json();
        const textEl = document.getElementById('lastSyncTimeText');
        if (textEl && data) {
            textEl.innerText = data.lastSyncTime || t('date_yesterday_21', 'Kecha 21:00');
        }
    } catch (e) {
        console.warn('loadSyncStatus xatosi:', e);
    }
}

async function triggerCdrSync() {
    const btn = document.getElementById('btnCdrSync');
    const originalText = btn ? btn.innerHTML : '';
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('sync_in_progress', 'Sinxronlanmoqda...')}</span>`;
        }
        const todayStr = getTodayDateString();
        const activeDate = currentSelectedDate || todayStr;
        const res = await fetch('/api/agent/sync-from-cdr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: activeDate })
        });
        const data = await res.json();
        if (data.success) {
            const textEl = document.getElementById('lastSyncTimeText');
            if (textEl && data.lastSyncTime) {
                textEl.innerText = data.lastSyncTime;
            }
            alert(`Sinxronizatsiya muvaffaqiyatli yakunlandi!\n\nAsterisk CDR dan ${data.addedCount} ta yetishmayotgan qo'ng'iroq tiklandi.`);
            await loadTabAgentOperators(activeDate);
            if (typeof loadTabAgentLogs === 'function') loadTabAgentLogs();
        } else {
            alert(tf('sync_result', { msg: data.message || data.error || t('unknown_error', "Noma'lum xatolik") }));
        }
    } catch (err) {
        console.error('triggerCdrSync xatolik:', err);
        alert(t('sync_error', '❌ Sinxronizatsiya vaqtida xatolik yuz berdi: ') + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// --- EXPORT MODAL & SANA ORALIG'I (RANGE) EXPORT LOGIKASI ---

let exportCalYear = 2026;
let exportCalMonth = 8; // Sentyabr (0-indexed)
let exportRangeSelectionStep = 0; // 0 = start tanlanadi, 1 = end tanlanadi

function triggerExportDatePicker(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    try {
        if (typeof el.showPicker === 'function') {
            el.showPicker();
            return;
        }
    } catch (err) { }
    el.focus();
}

function navExportCal(dir, e) {
    if (e) e.stopPropagation();
    exportCalMonth += dir;
    if (exportCalMonth < 0) {
        exportCalMonth = 11;
        exportCalYear--;
    } else if (exportCalMonth > 11) {
        exportCalMonth = 0;
        exportCalYear++;
    }
    renderExportRangeCalendar();
}

function onExportCalDateClick(clickedDate) {
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    if (!startInput || !endInput) return;

    if (exportRangeSelectionStep === 0) {
        startInput.value = clickedDate;
        endInput.value = clickedDate;
        exportRangeSelectionStep = 1;
    } else {
        if (clickedDate < startInput.value) {
            startInput.value = clickedDate;
        } else {
            endInput.value = clickedDate;
            exportRangeSelectionStep = 0;
        }
    }
    updateExportRangeBadge();
}

function renderExportRangeCalendar() {
    const titleEl = document.getElementById('exportCalMonthTitle');
    const gridEl = document.getElementById('exportCalDaysGrid');
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    if (!titleEl || !gridEl || !startInput || !endInput) return;

    titleEl.innerText = `${getMonthName(exportCalMonth)} ${exportCalYear}`;
    gridEl.innerHTML = '';

    const startDate = startInput.value;
    const endDate = endInput.value;
    const todayStr = getTodayDateString();

    const firstDay = new Date(exportCalYear, exportCalMonth, 1);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const daysInMonth = new Date(exp
... [truncated for diff preview]