/**
 * Call Center Dashboard & Audio Explorer Frontend Logic
 * Includes: WaveSurfer.js Waveform, Real-time AMI monitoring, SQLite CDR Pagination, and IVR Robot detection
 */

// Global State
let socket = null;
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

// Transfer Modal State
let activeTransferChannel = null;

// Chart.js Instances
let callVolumeChart = null;
let callDistributionChart = null;
let callDistributionChart2D = null;
let operatorChart = null;
let pieChartMode = localStorage.getItem('pie_chart_mode') || '3d';
let latestPieData = [0, 0, 0, 0];

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
function runInit() {
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
    initDeployWatcher();

    // Avtomatik har 5 soniyada yangilash (foydalanuvchi bosishi shart emas)
    setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'refresh_channels' }));
        }
    }, 5000);
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
   1. Tab Navigation & SPA Client Routing
   ========================================================================== */
const ROUTE_MAP = {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/explorer': 'explorer',
    '/audio': 'explorer',
    '/operators': 'operators',
    '/history': 'history',
    '/clients': 'clients',
    '/customers': 'clients',
    '/mijozlar': 'clients'
};

function getTabTitle(tab) {
    const suffix = ' | Call Center AI';
    const map = {
        dashboard: t('tab_dashboard', 'Dashboard'),
        explorer: t('tab_explorer', 'Audio Explorer'),
        operators: t('tab_operators', 'Operatorlar'),
        history: t('tab_history', "Qo'ng'iroqlar Tarixi"),
        clients: t('tab_clients', 'Mijozlar')
    };
    return (map[tab] || 'Call Center') + suffix;
}

function switchRoute(tabName, pushState = true) {
    const validTabs = ['dashboard', 'explorer', 'operators', 'history', 'clients'];
    const target = validTabs.includes(tabName) ? tabName : (ROUTE_MAP['/' + tabName] || 'dashboard');
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

    if (target === 'explorer' && explorerFilesData.length === 0) {
        loadExplorerPath('');
    } else if (target === 'history') {
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
        snd.play().catch(() => {});
    } catch (err) {}
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
                    label: t('chart_series_inbound', 'Jami Kiruvchi (Inbound)'),
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
                    label: t('chart_series_answered', 'Javob berilgan (Answered)'),
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
                        label: function(context) {
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
                borderColor: 'rgba(59, 130, 246, 0.4)',
                borderRadius: 8,
                style: { color: '#ffffff', fontSize: '13px' },
                pointFormat: '<b>{point.y} ta</b> ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    allowPointSelect: false,
                    cursor: 'default',
                    depth: 35,
                    size: '80%',
                    slicedOffset: 0,
                    startAngle: -45,
                    center: ['50%', '48%'],
                    dataLabels: {
                        enabled: true,
                        distance: 12,
                        format: '<b style="color: #f8fafc; font-size: 11px;">{point.name}</b>: <span style="color: #38bdf8; font-weight: 600;">{point.percentage:.1f}%</span>',
                        connectorColor: 'rgba(255, 255, 255, 0.3)',
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
                    { name: t('chart_slice_abandoned_resolved', 'Gaplashildi'), y: 0, color: '#38bdf8', sliced: false, selected: false },
                    { name: t('chart_slice_outbound', 'Chiquvchi'), y: 0, color: '#a855f7', sliced: false, selected: false }
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

    // Diagramma rejimini (2D yoki 3D) dastlabki yuklash
    setChartMode(pieChartMode);
}

/**
 * 2D (Donut) va 3D (Highcharts Pie) o'rtasida rejimni almashtirish
 */
function setChartMode(mode) {
    pieChartMode = mode === '2d' ? '2d' : '3d';
    try {
        localStorage.setItem('pie_chart_mode', pieChartMode);
    } catch (e) {}

    const el3D = document.getElementById('callDistributionChartContainer');
    const el2DBox = document.getElementById('callDistribution2DContainer');
    const btn2D = document.getElementById('btnChartMode2D');
    const btn3D = document.getElementById('btnChartMode3D');

    if (btn2D && btn3D) {
        if (pieChartMode === '2d') {
            btn2D.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btn2D.style.color = '#ffffff';
            btn2D.style.boxShadow = '0 2px 6px rgba(37, 99, 235, 0.35)';

            btn3D.style.background = 'transparent';
            btn3D.style.color = 'var(--text-muted)';
            btn3D.style.boxShadow = 'none';
        } else {
            btn3D.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btn3D.style.color = '#ffffff';
            btn3D.style.boxShadow = '0 2px 6px rgba(37, 99, 235, 0.35)';

            btn2D.style.background = 'transparent';
            btn2D.style.color = 'var(--text-muted)';
            btn2D.style.boxShadow = 'none';
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

        const elCanvas = document.getElementById('callDistributionChart2D');
        if (!callDistributionChart2D && elCanvas) {
            const ctxDist = elCanvas.getContext('2d');
            callDistributionChart2D = new Chart(ctxDist, {
                type: 'doughnut',
                data: {
                    labels: [
                        t('chart_slice_success', 'Muvaffaqiyatli'),
                        t('chart_slice_abandoned_pending', 'Kutilmoqda'),
                        t('chart_slice_abandoned_resolved', 'Gaplashildi'),
                        t('chart_slice_outbound', 'Chiquvchi')
                    ],
                    datasets: [{
                        data: latestPieData,
                        backgroundColor: ['#10b981', '#f59e0b', '#38bdf8', '#a855f7'],
                        borderColor: '#1e293b',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#94a3b8', font: { family: 'Inter' } }
                        }
                    }
                }
            });
        } else if (callDistributionChart2D) {
            callDistributionChart2D.data.datasets[0].data = latestPieData;
            callDistributionChart2D.update();
            setTimeout(() => {
                if (callDistributionChart2D && typeof callDistributionChart2D.resize === 'function') {
                    callDistributionChart2D.resize();
                }
            }, 10);
        }
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
    }
}
window.setChartMode = setChartMode;

/* ==========================================================================
   3. WebSocket Connection & Real-Time Updates
   ========================================================================== */
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket ulandi');
        updateAmiStatus(true);
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

function handleWsMessage(msg) {
    if (msg.type === 'server_version' && msg.data) {
        handleServerBuildId(msg.data.buildId);
    } else if (msg.type === 'initial_state') {
        if (msg.data && msg.data.serverVersion && msg.data.serverVersion.buildId) {
            handleServerBuildId(msg.data.serverVersion.buildId);
        }
        updateAmiStatus(msg.data.amiStatus);
        updateSftpStatus(msg.data.sftpStatus);
        updateStatsUI(msg.data.stats);
        if (msg.data.conversations) renderActiveConversations(msg.data.conversations);
        if (msg.data.queues) renderQueues(msg.data.queues);
        if (msg.data.operators) renderOperators(msg.data.operators);
        if (msg.data.callHistory) {
            dashboardRecentCallsList = Array.isArray(msg.data.callHistory) ? [...msg.data.callHistory] : [];
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
    if (itemActiveCall && itemActiveCall.operator) {
        return itemActiveCall;
    }
    const target9 = getPhone9(phone);
    if (!target9) return null;

    // 1. Faol suhbatlar (talking)
    if (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations)) {
        for (const conv of currentConversations) {
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
    if (typeof currentOperators !== 'undefined' && Array.isArray(currentOperators)) {
        for (const op of currentOperators) {
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
        if (filter === 'today') {
            btnToday.style.background = 'var(--primary)';
            btnToday.style.color = '#fff';
            btnAll.style.background = 'transparent';
            btnAll.style.color = 'var(--text-dim)';
        } else {
            btnAll.style.background = 'var(--primary)';
            btnAll.style.color = '#fff';
            btnToday.style.background = 'transparent';
            btnToday.style.color = 'var(--text-dim)';
        }
    }
    renderCallbacks(currentCallbacksList);
}

function switchAdminCallbackTab(tab) {
    if (tab !== 'pending' && tab !== 'unreachable' && tab !== 'resolved') return;
    adminCbTab = tab;

    const btnPending = document.getElementById('adminCbTabPending');
    const btnUnreachable = document.getElementById('adminCbTabUnreachable');
    const btnResolved = document.getElementById('adminCbTabResolved');

    if (btnPending && btnUnreachable) {
        btnPending.style.background = 'rgba(100, 116, 139, 0.15)';
        btnPending.style.borderColor = 'rgba(100, 116, 139, 0.3)';
        btnPending.style.color = '#94a3b8';

        btnUnreachable.style.background = 'rgba(100, 116, 139, 0.15)';
        btnUnreachable.style.borderColor = 'rgba(100, 116, 139, 0.3)';
        btnUnreachable.style.color = '#94a3b8';

        if (btnResolved) {
            btnResolved.style.background = 'rgba(100, 116, 139, 0.15)';
            btnResolved.style.borderColor = 'rgba(100, 116, 139, 0.3)';
            btnResolved.style.color = '#94a3b8';
        }

        if (tab === 'pending') {
            btnPending.style.background = 'rgba(245, 158, 11, 0.18)';
            btnPending.style.borderColor = 'rgba(245, 158, 11, 0.45)';
            btnPending.style.color = '#fbbf24';
        } else if (tab === 'unreachable') {
            btnUnreachable.style.background = 'rgba(239, 68, 68, 0.18)';
            btnUnreachable.style.borderColor = 'rgba(239, 68, 68, 0.45)';
            btnUnreachable.style.color = '#f87171';
        } else if (tab === 'resolved' && btnResolved) {
            btnResolved.style.background = 'rgba(16, 185, 129, 0.18)';
            btnResolved.style.borderColor = 'rgba(16, 185, 129, 0.45)';
            btnResolved.style.color = '#34d399';
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
        if (!c || !c.call_time) return false;
        if (!c.call_time.startsWith(todayStr)) return false;
        if (c.status === 'resolved' && c.dismissed_at && !c.dismissed_at.startsWith(todayStr)) return false;
        return true;
    };

    const dateFiltered = (adminCbDateFilter === 'today')
        ? currentCallbacksList.filter(isTodayCallback)
        : currentCallbacksList;

    // 2. Kategoriya bo'yicha ajratish: Kutilmoqda vs Bog'lanib bo'lmadi vs Gaplashildi
    const pendingList = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && (!c.outbound_attempts || c.outbound_attempts === 0));
    const unreachableList = dateFiltered.filter(c => (c.status === 'pending' || !c.status) && c.outbound_attempts && c.outbound_attempts > 0);
    const resolvedList = dateFiltered.filter(c => c.status === 'resolved');

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
        const isNewestItem = (index === 0 && (adminCbTab === 'pending' || !adminCbTab));

        let badgeLabel = isIvr ? t('callback_source_ivr', 'Ish vaqti emas') : t('callback_source_abandoned', 'Navbatdan chiqdi');
        let badgeStyle = isIvr 
            ? 'background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35);'
            : 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);';
        let badgeIcon = isIvr ? isax('moon') : isax('timer');

        if (isResolved) {
            badgeLabel = "Gaplashildi";
            badgeStyle = 'background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);';
            badgeIcon = isax('tick-circle');
        }

        let timeDisplay = item.call_time || '';
        if (timeDisplay.includes(' ')) {
            const parts = timeDisplay.split(' ');
            const dateP = parts[0];
            const timeP = parts[1].slice(0, 5);
            if (dateP === todayStr) {
                timeDisplay = timeP;
            } else {
                timeDisplay = `${dateP.slice(5)} ${timeP}`;
            }
        }

        let resTimeDisplay = item.updated_at || item.dismissed_at || item.call_time || '';
        if (resTimeDisplay.includes(' ')) {
            const parts = resTimeDisplay.split(' ');
            resTimeDisplay = (parts[0] === todayStr) ? parts[1].slice(0, 5) : `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
        }

        const activeCall = findActiveCallForPhone(phone, item.activeCall);
        const isActive = Boolean(activeCall);

        const relTime = getAdminCallbackRelativeTime(item.call_time);

        // Tartib raqami (#1, #2, #3...)
        let orderBadge = '';
        if (isNewestItem) {
            orderBadge = `
                <span style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.4)); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.6); font-size: 9.5px; font-weight: 800; padding: 1.5px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35); text-transform: uppercase;">
                    ${isax('flash', '', 'width: 10px; height: 10px; color: #34d399;')} ${t('cb_order_newest', '#1 Eng yangi')}
                </span>
            `;
        } else {
            orderBadge = `
                <span style="background: rgba(255, 255, 255, 0.08); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.12); font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 4px; display: inline-flex; align-items: center;">
                    #${index + 1}
                </span>
            `;
        }

        let cardBorder = '';
        if (isActive) {
            cardBorder = 'border: 1.5px solid #10b981; border-left: 3.5px solid #10b981; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(15, 23, 42, 0.9)); box-shadow: 0 0 14px rgba(16, 185, 129, 0.25);';
        } else if (isResolved) {
            cardBorder = 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.85)); border: 1px solid rgba(16, 185, 129, 0.25); border-left: 3px solid #10b981;';
        } else if (isUnreachable) {
            const outAttempts = item.outbound_attempts || 1;
            const borderCol = outAttempts >= 3 ? '#ef4444' : (outAttempts === 2 ? '#f97316' : '#eab308');
            cardBorder = `background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(239, 68, 68, 0.25); border-left: 3px solid ${borderCol};`;
        } else if (isNewestItem) {
            cardBorder = 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(30, 41, 59, 0.85)); border: 1.5px solid rgba(16, 185, 129, 0.45); border-left: 3.5px solid #10b981; box-shadow: 0 0 14px rgba(16, 185, 129, 0.2);';
        } else {
            cardBorder = `background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.85)); border: 1px solid rgba(245, 158, 11, 0.28); border-left: 3px solid ${isIvr ? '#a855f7' : '#f59e0b'};`;
        }

        const titleText = isActive 
            ? `${activeCall.operator} hozirda ushbu mijoz bilan ${activeCall.state === 'ringing' ? "bog'lanmoqda" : "gaplashmoqda"}!`
            : "Raqamni nusxalash";

        // Urinishlar belgisi
        let retryBadge = '';
        let lastOutboundInfo = '';
        if (isResolved) {
            // 1. Yo'nalish va hal bo'lish holati
            const resType = item.resolution_type || '';
            const disBy = item.dismissed_by || '';
            const isOutbound = (resType === 'operator_outbound') || disBy.includes('outbound') || disBy === 'realtime_outbound_bridge';
            const isInbound = (resType === 'client_inbound') || disBy.includes('inbound') || disBy === 'realtime_agent_connect';

            let resTitle = "Aloqa o'rnatildi";
            let resIcon = isax('tick-circle', '', 'width: 11px; height: 11px; color: #34d399;');
            let resColor = '#34d399';

            if (isOutbound) {
                resTitle = "Operator aloqaga chiqdi";
                resIcon = isax('call-calling', '', 'width: 11px; height: 11px; color: #10b981;');
                resColor = '#10b981';
            } else if (isInbound) {
                resTitle = "Mijoz qayta bog'landi";
                resIcon = isax('call-received', '', 'width: 11px; height: 11px; color: #38bdf8;');
                resColor = '#38bdf8';
            }

            // 2. Operator ma'lumotini to'g'ri shakllantirish (aslo NULL chiqmasin)
            let opRaw = item.last_outbound_operator || '';
            if (opRaw === 'NULL' || opRaw === 'null' || opRaw === '\\N') opRaw = '';

            const KNOWN_OPS = {
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

            let opDisplayName = '';
            if (opRaw && !/^\d{2,4}$/.test(opRaw.trim())) {
                opDisplayName = opRaw.trim();
            } else {
                let ext = opRaw ? opRaw.trim() : '';
                if (!ext && disBy) {
                    const m = disBy.match(/(\d{2,4})/);
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

            // Takroriy qavslarni tozalash (masalan Feruza (103) (103) -> Feruza (103))
            if (opDisplayName) {
                opDisplayName = opDisplayName.replace(/\((\d+)\)\s*\(\1\)/g, '($1)').replace(/\s+/g, ' ').trim();
            }

            if (!opDisplayName) {
                opDisplayName = isInbound ? "Navbat orqali ulangan" : (isOutbound ? "Operator aloqada" : "Muvaffaqiyatli bog'langan");
            }

            lastOutboundInfo = `
                <div style="background: rgba(15, 23, 42, 0.65); border: 1px dashed rgba(16, 185, 129, 0.28); border-radius: 6px; padding: 5px 8px; margin-top: 3px; font-size: 10px; display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-dim); display: inline-flex; align-items: center; gap: 4px;">
                            ${resIcon} Holat:
                        </span>
                        <span style="color: ${resColor}; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                            ${resTitle}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-dim); display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('user', '', 'width: 10px; height: 10px; opacity: 0.7;')} Operator:
                        </span>
                        <span style="color: #38bdf8; font-weight: 600;">${opDisplayName}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-dim); display: inline-flex; align-items: center; gap: 4px;">
                            ${isax('clock', '', 'width: 10px; height: 10px; opacity: 0.7;')} Dastlabki vaqt:
                        </span>
                        <span style="color: #94a3b8; font-weight: 500;">${timeDisplay}</span>
                    </div>
                </div>
            `;
        } else if (isUnreachable) {
            const outAttempts = item.outbound_attempts || 1;
            let retryStyle = 'background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);';
            let retryIcon = isax('warning-2', '', 'width: 11px; height: 11px;');
            if (outAttempts === 2) {
                retryStyle = 'background: rgba(249, 115, 22, 0.2); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.4);';
                retryIcon = isax('warning-2', '', 'width: 11px; height: 11px;');
            } else if (outAttempts >= 3) {
                retryStyle = 'background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);';
                retryIcon = isax('close-circle', '', 'width: 11px; height: 11px;');
            }

            retryBadge = `
                <span style="padding: 1px 5px; border-radius: 4px; font-weight: 700; font-size: 9.5px; ${retryStyle}">
                    ${retryIcon} ${outAttempts} marta urinildi
                </span>
            `;

            let outTimeDisplay = item.last_outbound_time || '';
            if (outTimeDisplay.includes(' ')) {
                const parts = outTimeDisplay.split(' ');
                outTimeDisplay = (parts[0] === todayStr) ? parts[1].slice(0, 5) : `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`;
            }

            lastOutboundInfo = `
                <div style="background: rgba(15, 23, 42, 0.6); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 5px; padding: 4px 7px; margin-top: 2px; font-size: 10px; display: flex; flex-direction: column; gap: 2px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-dim);">Operator:</span>
                        <span style="color: #38bdf8; font-weight: 600;">${item.last_outbound_operator || 'Operator'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-dim);">Urinish:</span>
                        <span style="color: #f1f5f9; font-weight: 600;">${outTimeDisplay || timeDisplay}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--text-dim);">Natija:</span>
                        <span style="color: #fb7185; font-weight: 600;">${item.last_outbound_cause || 'Javob bermadi'}</span>
                    </div>
                </div>
            `;
        }

        html += `
            <div class="callback-card ${isActive ? 'callback-card-talking' : ''}" id="cb-card-${item.id}" style="${cardBorder} border-radius: 8px; padding: 7px 10px; display: flex; flex-direction: column; gap: 4px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" title="${titleText}">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 5px;">
                    <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="copyCallbackPhone('${phone}', this)" title="Raqamni nusxalash">
                        ${orderBadge}
                        <span style="font-size: 12px; font-weight: 700; color: #fff; letter-spacing: 0.3px;">${formattedPhone}</span>
                        ${!isActive ? (retryBadge || `<span style="font-size: 10px; opacity: 0.6; display: inline-flex;">${isax('clipboard-text', '', 'width: 11px; height: 11px;')}</span>`) : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        ${isActive ? `
                            <div class="callback-active-badge" title="${activeCall.operator} ${activeCall.stateLabel}">
                                <img src="/img/calling-green.png" alt="Calling" />
                                <span>${activeCall.operator}</span>
                            </div>
                        ` : ''}
                        <button type="button" class="btn-cb-delete" onclick="deleteCallback(${item.id}, event)" title="${t('dyn_delete', 'O\'chirish')}" style="background: transparent; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; padding: 2px 5px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.15s;" onmouseover="this.style.color='#ef4444'; this.style.background='rgba(239, 68, 68, 0.15)'" onmouseout="this.style.color='#94a3b8'; this.style.background='transparent'">
                            ${isax('close', '', 'width: 12px; height: 12px;')}
                        </button>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; margin-top: 1px;">
                    <span style="padding: 1px 6px; border-radius: 4px; font-weight: 600; font-size: 9.5px; ${badgeStyle}">
                        ${badgeIcon} ${badgeLabel}
                    </span>
                    <div style="display: flex; align-items: center; gap: 4px; color: var(--text-dim); font-size: 10.5px;">
                        <span style="display: inline-flex; align-items: center; gap: 3px;">
                            ${isax('clock', '', 'width: 11px; height: 11px; opacity: 0.7;')}
                            ${isResolved ? resTimeDisplay : timeDisplay}
                            ${relTime && !isResolved ? `<strong style="color: ${isNewestItem ? '#34d399' : '#cbd5e1'}; font-weight: 600; margin-left: 2px;">(${relTime})</strong>` : ''}
                        </span>
                    </div>
                </div>
                ${lastOutboundInfo}
                ${isActive ? `
                    <div class="callback-active-subrow">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span class="active-dot"></span>
                            <span>${activeCall.operator}</span>
                        </div>
                        <span style="color: #a7f3d0; font-weight: 500; font-size: 9.5px;">${activeCall.state === 'ringing' ? "Qo'ng'iroq qilinmoqda..." : "Suhbatlashmoqda..."}</span>
                    </div>
                ` : ''}
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

function copyCallbackPhone(phone, el) {
    if (!phone) return;

    const onSuccess = () => {
        if (typeof showToast === 'function') showToast(`${phone} nusxalandi!`, 'info');
        if (el) {
            const orig = el.innerHTML;
            el.innerHTML = `<span style="font-size: 11px; color: #10b981; font-weight: 700;">✓ Nusxalandi</span>`;
            setTimeout(() => { el.innerHTML = orig; }, 1200);
        }
    };

    // 1-usul: modern Clipboard API (faqat HTTPS yoki localhost'da mavjud)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(phone).then(onSuccess).catch(() => fallbackCopyCallbackPhone(phone, onSuccess));
        return;
    }
    fallbackCopyCallbackPhone(phone, onSuccess);
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
            window.prompt('Brauzer ruxsat bermadi. Raqamni qo\'lda nusxalang:', phone);
        }
    } catch (e) {
        window.prompt('Brauzer ruxsat bermadi. Raqamni qo\'lda nusxalang:', phone);   
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
    } catch (e) {}
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

    // Taqsimot ma'lumotlarini saqlash
    latestPieData = [answeredCalls, abandonedPending, abandonedResolved, outboundCalls];

    // Update 3D Pie Chart (Highcharts 3D)
    if (callDistributionChart && typeof callDistributionChart.series !== 'undefined' && callDistributionChart.series[0]) {
        if (callDistributionChart.series[0].points) {
            callDistributionChart.series[0].points.forEach(p => {
                if (p && p.slice && p.sliced) p.slice(false);
            });
        }
        const total = answeredCalls + abandonedPending + abandonedResolved + outboundCalls;
        if (total === 0) {
            callDistributionChart.series[0].setData([
                { name: t('chart_slice_abandoned_pending', 'Kutilmoqda'), y: 1, color: '#334155', sliced: false, selected: false }
            ]);
        } else {
            callDistributionChart.series[0].setData([
                { name: t('chart_slice_success', 'Muvaffaqiyatli'), y: answeredCalls, color: '#10b981', sliced: false, selected: false },
                { name: t('chart_slice_abandoned_pending', 'Kutilmoqda'), y: abandonedPending, color: '#f59e0b', sliced: false, selected: false },
                { name: t('chart_slice_abandoned_resolved', 'Gaplashildi'), y: abandonedResolved, color: '#38bdf8', sliced: false, selected: false },
                { name: t('chart_slice_outbound', 'Chiquvchi'), y: outboundCalls, color: '#a855f7', sliced: false, selected: false }
            ], true, { duration: 600 });
        }
    }

    // Update 2D Donut Chart (Chart.js)
    if (callDistributionChart2D && callDistributionChart2D.data && callDistributionChart2D.data.datasets[0]) {
        callDistributionChart2D.data.datasets[0].data = [answeredCalls, abandonedPending, abandonedResolved, outboundCalls];
        callDistributionChart2D.update();
    }
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
        if (playerEl) playerEl.classList.add('is-playing');
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconPause) iconPause.style.display = 'block';
        if (subtitle) subtitle.innerText = 'Ijro etilmoqda...';
        pausedCallKey = null;
    } else {
        if (playerEl) playerEl.classList.remove('is-playing');
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
                aud.play().catch(() => {});
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
            aud.play().catch(() => {});
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
            speedPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const rate = parseFloat(pill.getAttribute('data-rate'));
            const aud = getNativeAudio();
            aud.playbackRate = rate;
            if (playbackRateSelect) playbackRateSelect.value = rate.toString();
        });
    });

    // Download Button in player
    const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
    if (btnDownloadCurrent) {
        btnDownloadCurrent.addEventListener('click', () => {
            if (!activeAudioFilePath) return;
            const a = document.createElement('a');
            a.href = `/api/recordings/stream?file=${encodeURIComponent(activeAudioFilePath)}`;
            a.download = activeAudioFileName || 'recording.wav';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
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
                    aud.play().catch(() => {});
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
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

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
 * Visualizer Waveform Canvas: 100% ishonchli, darhol ishga tushadigan interaktiv to'lqin
 */
function renderInteractiveWaveform(audio, fileName, sizeBytes) {
    const waveContainer = document.getElementById('waveform');
    if (!waveContainer) return;

    waveContainer.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'waveform-interactive-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '86px';
    canvas.style.cursor = 'pointer';
    canvas.style.display = 'block';
    waveContainer.appendChild(canvas);

    // Canvas o'lchamlari
    const rect = waveContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(300, rect.width || waveContainer.clientWidth || 800);
    const height = 86;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const barWidth = 3;
    const barGap = 2;
    const totalBarWidth = barWidth + barGap;
    const barCount = Math.floor(width / totalBarWidth);

    // Fayl nomi va hajmiga asoslangan organik nutq to'lqini
    let seed = 0;
    for (let i = 0; i < fileName.length; i++) {
        seed = (seed * 31 + fileName.charCodeAt(i)) & 0xFFFFFFFF;
    }
    if (sizeBytes) seed = (seed ^ sizeBytes) & 0xFFFFFFFF;

    function pseudoRandom() {
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (seed >>> 0) / 4294967296;
    }

    currentWaveBars = [];
    let prevHeight = 0.35;
    for (let i = 0; i < barCount; i++) {
        const raw = pseudoRandom();
        const speechEnvelope = 0.25 + 0.65 * Math.sin((i / barCount) * Math.PI * 4.5);
        let h = (prevHeight * 0.45 + raw * 0.55) * Math.abs(speechEnvelope);
        h = Math.max(0.08, Math.min(0.95, h));
        prevHeight = h;
        currentWaveBars.push(h);
    }

    function drawWave() {
        ctx.clearRect(0, 0, width, height);

        const curTime = audio.currentTime || 0;
        const totalDur = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? audio.duration
            : Math.max(1, (sizeBytes - 44) / 16000);

        // Tepada boshi va oxiri vaqtlarini yangilash
        const waveRulerStart = document.getElementById('waveRulerStart');
        if (waveRulerStart) waveRulerStart.innerText = '00:00';
        const waveRulerEnd = document.getElementById('waveRulerEnd');
        if (waveRulerEnd && totalDur > 0) {
            waveRulerEnd.innerText = formatDuration(totalDur);
        }
        
        const progress = Math.max(0, Math.min(1, curTime / totalDur));
        const playedIndex = Math.floor(progress * barCount);
        const midY = 32;

        for (let i = 0; i < barCount; i++) {
            const x = i * totalBarWidth;
            const barH = Math.max(4, currentWaveBars[i] * 54);
            const y = midY - barH / 2;

            const isPlayed = i <= playedIndex;
            ctx.fillStyle = isPlayed ? '#38bdf8' : '#334155';

            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x, y, barWidth, barH, 1.5);
            } else {
                ctx.rect(x, y, barWidth, barH);
            }
            ctx.fill();
        }

        // Ko'rsatkich (cursor chizig'i)
        const cursorX = Math.max(1, Math.min(width - 2, progress * width));
        ctx.fillStyle = '#818cf8';
        ctx.fillRect(cursorX - 0.75, 0, 1.5, 64);

        // Vertikal chiziq tagida joriy vaqt (current time badge)
        const curTimeStr = formatDuration(curTime);
        const badgeW = curTimeStr.length > 5 ? 56 : 42;
        const badgeH = 17;
        const badgeY = 66;
        const badgeX = Math.max(2, Math.min(width - badgeW - 2, cursorX - badgeW / 2));

        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
        } else {
            ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();
        ctx.stroke();

        // Kichik ko'rsatkich nuqtasi
        ctx.fillStyle = '#818cf8';
        ctx.beginPath();
        ctx.arc(cursorX, 64, 2, 0, Math.PI * 2);
        ctx.fill();

        // Joriy vaqt matni
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(curTimeStr, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5);
        ctx.restore();
    }

    drawWave();

    // To'lqinni bosganda o'sha soniyaga sakrash (Seek)
    canvas.onclick = (e) => {
        const clickRect = canvas.getBoundingClientRect();
        const clickX = e.clientX - clickRect.left;
        const ratio = Math.max(0, Math.min(1, clickX / clickRect.width));
        const totalDur = (audio.duration && isFinite(audio.duration) && audio.duration > 0)
            ? audio.duration
            : (sizeBytes - 44) / 16000;
        if (totalDur > 0) {
            audio.currentTime = ratio * totalDur;
            drawWave();
        }
    };

    if (fallbackWaveAnim) {
        clearInterval(fallbackWaveAnim);
    }
    fallbackWaveAnim = setInterval(() => {
        drawWave();
    }, 60);
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
        btnDownloadCurrent.onclick = () => {
            const a = document.createElement('a');
            a.href = `/api/recordings/stream?file=${encodeURIComponent(filePath)}`;
            const rawName = filePath ? filePath.split('/').pop().split('\\').pop() : (fileName ? fileName.replace(/<[^>]*>/g, '').trim() : 'audio.wav');
            a.download = rawName.endsWith('.wav') ? rawName : (rawName ? rawName + '.wav' : 'audio.wav');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
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
    } catch (e) {}
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
            audio.play().catch(() => {});
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

        const recToDownload = resolvedRec || activeAudioFilePath;
        const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
        if (btnDownloadCurrent && recToDownload) {
            btnDownloadCurrent.style.display = 'inline-flex';
            btnDownloadCurrent.onclick = () => {
                const a = document.createElement('a');
                a.href = `/api/recordings/stream?file=${encodeURIComponent(recToDownload)}`;
                const rawName = recToDownload ? recToDownload.split('/').pop().split('\\').pop() : (displayName ? displayName.replace(/<[^>]*>/g, '').trim() : 'audio.wav');
                a.download = rawName.endsWith('.wav') ? rawName : (rawName ? rawName + '.wav' : 'audio.wav');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            };
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
    } catch (e) {}

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
        } catch (fastErr) {}

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

    // 1. Tugagan (yo'qolgan) suhbatlarni topish va ularni swipe-out (o'ngga silliq siljish) animatsiyasi bilan olib tashlash
    const existingCards = container.querySelectorAll('.compact-channel-card');
    let hasSwipingOut = false;

    existingCards.forEach(card => {
        const key = card.getAttribute('data-channel-key');
        if (key && !newKeyMap.has(key)) {
            if (!card.classList.contains('swiping-out')) {
                hasSwipingOut = true;
                card.classList.add('swiping-out');
                setTimeout(() => {
                    if (card.parentNode) {
                        card.remove();
                    }
                    checkActiveChannelsEmpty();
                }, 1200);
            }
        }
    });

    function checkActiveChannelsEmpty() {
        const remaining = container.querySelectorAll('.compact-channel-card:not(.swiping-out)');
        if (remaining.length === 0) {
            const emptyEl = container.querySelector('.empty-channels-placeholder');
            if (!emptyEl) {
                container.innerHTML = `
                    <div class="empty-channels-placeholder" style="text-align: center; color: var(--text-dim); padding: 12px; font-size: 11px; animation: fadeIn 0.3s ease;">
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

    // 2. Yangi suhbatlarni qo'shish yoki mavjudlarini yangilash
    currentConversations.forEach(c => {
        const key = getConversationKey(c);
        const existingCard = container.querySelector(`.compact-channel-card[data-channel-key="${key}"]:not(.swiping-out)`);

        const isTalking = c.stateType === 'talking';
        const isOutbound = c.direction === 'outbound';
        const isQueue = (c.operator === 'Navbatda kutmoqda' || !c.operatorExten) && !isOutbound;

        let badgeClass = 'badge-warning';
        let badgeText = c.state;

        if (isTalking) {
            badgeClass = isOutbound ? 'badge-info' : 'badge-success';
            badgeText = isOutbound ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('export', '', 'width: 12px; height: 12px;')} ${t('live_badge_outbound', 'Chiquvchi')}</span>` : `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('import', '', 'width: 12px; height: 12px;')} ${t('live_badge_inbound', 'Kiruvchi')}</span>`;
        } else if (isQueue) {
            badgeClass = 'badge-warning';
            badgeText = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('live_badge_queue', 'Navbatda kutmoqda')}</span>`;
        } else {
            badgeClass = isOutbound ? 'badge-info' : 'badge-info';
            badgeText = isOutbound ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('call')} ${t('live_badge_dialing', 'Chiquvchi chaqiruv')}</span>` : `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('call')} ${t('live_badge_ringing', 'Chaqirilmoqda')}</span>`;
        }

        const opText = isQueue ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('live_badge_queue', 'Navbatda kutmoqda')}</span>` : `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('headphone', '', 'width: 12px; height: 12px;')} ${c.operator}</span>`;

        if (existingCard) {
            // Holat o'zgargan bo'lsa sinflar va yozuvlarni yangilash
            existingCard.className = `compact-channel-card ${isTalking ? 'talking' : 'ringing'}`;
            const badgeEl = existingCard.querySelector('.badge');
            if (badgeEl) {
                badgeEl.className = `badge ${badgeClass}`;
                badgeEl.innerHTML = badgeText;
            }
            const opEl = existingCard.querySelector('.chan-op span');
            if (opEl) {
                opEl.innerHTML = opText;
            }
            const switchBtn = existingCard.querySelector('.btn-action');
            if (switchBtn) switchBtn.title = t('live_switch_title', "Boshqa operatorga yo'naltirish (Switch / Transfer)");
            const endBtn = existingCard.querySelector('.btn-end-call');
            if (endBtn) endBtn.title = t('live_endcall_title', "Qo'ng'iroqni tugatish (End Call)");
        } else {
            // Yangi kelgan suhbat kartasini qo'shish (chapdan silliq kirib keladi)
            const cardEl = document.createElement('div');
            cardEl.className = `compact-channel-card ${isTalking ? 'talking' : 'ringing'} swiping-in`;
            cardEl.setAttribute('data-channel-key', key);
            cardEl.innerHTML = `
                <div class="chan-left">
                    <div class="chan-number" style="display: flex; align-items: center; gap: 4px;">${isax('call')} ${formatCallerNumberOrOperator(c.callerId)}</div>
                    <div class="chan-op">
                        <span>${opText}</span>
                    </div>
                </div>
                <div class="chan-right">
                    <span class="badge ${badgeClass}" style="font-size: 10px; padding: 2px 6px;">
                        ${badgeText}
                    </span>
                    <!-- Transfer / Switch Button -->
                    <button class="btn-action" style="padding: 3px 6px; background: rgba(99, 102, 241, 0.25); border-color: rgba(99, 102, 241, 0.5); color: #818cf8; display: inline-flex; align-items: center; justify-content: center;" onclick="openTransferModal('${c.channel}', '${c.callerId}')" title="${t('live_switch_title', "Boshqa operatorga yo'naltirish (Switch / Transfer)")}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="20" y1="7" x2="4" y2="7"></line>
                            <polyline points="10 3 4 7 10 11"></polyline>
                            <line x1="4" y1="17" x2="20" y2="17"></line>
                            <polyline points="14 13 20 17 14 21"></polyline>
                        </svg>
                    </button>
                    <!-- End Call / Hangup Button -->
                    <button class="btn-end-call" onclick="hangupChannel('${c.channel}')" title="${t('live_endcall_title', "Qo'ng'iroqni tugatish (End Call)")}">
                        <svg width="22" height="22" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="48" fill="#e11d48"/>
                            <path d="M22 58 C 21 53, 25 45, 36 41 C 45 38, 55 38, 64 41 C 75 45, 79 53, 78 58 C 77 62, 72 63, 67 58 C 63 54, 59 47, 50 47 C 41 47, 37 54, 33 58 C 28 63, 23 62, 22 58 Z" fill="#ffffff"/>
                        </svg>
                    </button>
                </div>
            `;
            container.appendChild(cardEl);
            setTimeout(() => {
                cardEl.classList.remove('swiping-in');
            }, 400);
        }
    });
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

    listEl.innerHTML = allWaiters.map(w => `
        <div class="queue-caller-pill">
            <span style="font-weight: 600; color: #fff; display: inline-flex; align-items: center; gap: 4px;">${isax('call')} ${w.callerId}</span>
            <span style="color: #818cf8; font-size: 10px; font-weight: 600;">${tf('live_position', { n: w.position || 1 }, `Navbatda #${w.position || 1}`)}</span>
        </div>
    `).join('');
}

async function hangupChannel(channel) {
    if (!confirm(t('live_hangup_confirm', 'Haqiqatan ham ushbu kanalni uzmoqchimisiz?'))) return;

    // Tugatish bosilganda darhol o'ngga swipe-out animatsiyasini qo'llash
    const card = document.querySelector(`.compact-channel-card[data-channel-key="${channel}"]`);
    if (card && !card.classList.contains('swiping-out')) {
        card.classList.add('swiping-out');
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
        modal.style.display = 'none';
        activeTransferChannel = null;
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

const EXCLUDED_OPERATOR_IDS = new Set(['1234', '1111', '1324', '1001', '1000', '402', '401', '170', '161', '118', '115', '160', '66', '110', '213', '116']);

// Operator guruhi holati (main: 100-199 | secondary: 200+ | all: barchasi)
let currentOperatorGroup = 'main';
try {
    const savedGroup = localStorage.getItem('callcenter_op_group');
    if (savedGroup && ['main', 'secondary', 'all'].includes(savedGroup)) {
        currentOperatorGroup = savedGroup;
    }
} catch (e) {}

function switchOperatorGroup(group) {
    if (!['main', 'secondary', 'all'].includes(group)) return;
    currentOperatorGroup = group;
    try {
        localStorage.setItem('callcenter_op_group', group);
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
    if (pres === 'ready') return 2; // 2. Onlayn / Qabul qilishga tayyor
    if (pres === 'talking') return 3; // 3. Suhbatda
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

window.toggleOperatorPause = async function(operatorId, shouldPause, event) {
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
        if (pres === 'talking') countTalking++;
        else if (pres === 'offline') countOffline++;
        else countReady++;

        if (op.agentConnected) countAgentOnline++;
    });

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
            : (currentOperatorGroup === 'main' ? "Asosiy (100-199)" : "operatorlar");
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

    let predictedNextOpId = null;
    if (readyOps.length > 0) {
        readyOps.sort((a, b) => {
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
        predictedNextOpId = readyOps[0].id;
    }

    grid.innerHTML = currentOperators.map(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing') && pres !== 'talking';
        const isOutbound = ringingCallerStr.startsWith('📤') || (op.ringingCaller && String(op.ringingCaller).startsWith('📤'));

        // Operator presence'i offline bo'lsa ham (masalan ish vaqti tugab, SIP ro'yxatdan chiqqan bo'lsa)
        // uning suhbati hali davom etayotgan bo'lishi mumkin — shuni Jonli Monitor ma'lumotidan topamiz
        const activeConv = (typeof currentConversations !== 'undefined' && Array.isArray(currentConversations))
            ? currentConversations.find(c => String(c.operatorExten) === String(op.id))
            : null;

        let cardClass = 'operator-card clickable-card';
        let statusBadge = '';
        let avatarBg = '';
        let talkingTimerHtml = '';

        if (ringingNow) {
            operatorTalkingSinceMap.delete(op.id);
            const ringLabel = isOutbound ? "Chiquvchi chaqiruv..." : t('op_status_ringing', 'Jiringlamoqda');
            statusBadge = `<span class="status-badge badge-ringing" style="${isOutbound ? 'background: rgba(14, 165, 233, 0.15); border-color: rgba(14, 165, 233, 0.4); color: #38bdf8;' : ''}"><span class="badge-dot pulse-ring" style="${isOutbound ? 'background: #38bdf8; box-shadow: 0 0 6px #38bdf8;' : ''}"></span> ${ringLabel}</span>`;
            avatarBg = isOutbound ? 'linear-gradient(135deg, #0284c7, #0369a1)' : 'linear-gradient(135deg, #ec4899, #be185d)';
            cardClass += isOutbound ? ' status-ringing status-active call-outbound-ringing' : ' status-ringing status-active call-ringing';
        } else if (pres === 'talking') {
            const isOutbound = op.ringingCaller && String(op.ringingCaller).startsWith('📤');
            const talkLabel = isOutbound ? "Chiquvchi suhbat" : t('status_talking', 'Hozir suhbatda');
            statusBadge = `<span class="status-badge badge-talking"><span class="badge-dot pulse"></span> ${talkLabel}</span>`;
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
                <div class="talking-live-timer ${initWarnClass}" data-talking-since="${talkingSince}" title="${t('live_talking_duration', 'Hozirgi suhbat davomiyligi')}">
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
                    <div class="talking-live-timer ${initWarnClass}" data-talking-since="${convSince}" title="${t('live_talking_duration', 'Hozirgi suhbat davomiyligi')}">
                        <span class="timer-icon">⏱️</span>
                        <span class="timer-digits">${initialDisplay}</span>
                    </div>
                `;
            } else {
                statusBadge = `<span class="status-badge badge-offline"><span class="badge-dot"></span> ${t('op_status_offline', 'Offline')}</span>`;
            }
            avatarBg = avatarBg || 'linear-gradient(135deg, #64748b, #475569)';
        } else if (pres === 'paused' || op.paused) {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = `<span class="status-badge badge-paused"><span class="badge-dot pulse-pause"></span> ${t('op_status_paused', 'Pauzada')}</span>`;
            avatarBg = 'linear-gradient(135deg, #d97706, #b45309)';
            cardClass += ' status-paused';
        } else {
            operatorTalkingSinceMap.delete(op.id);
            statusBadge = `<span class="status-badge badge-ready"><span class="badge-dot"></span> ${t('wait_status', 'Kutmoqda')}</span>`;
            avatarBg = 'linear-gradient(135deg, #10b981, #059669)';
            cardClass += ' status-ready status-active';
        }
        const answered = op.answered || 0;
        const totalScore = (op.grandTotal !== undefined && op.grandTotal !== null) ? op.grandTotal : answered;

        // Yulduzlar soni (Jami bo'yicha: 1-9: 1★, 10-19: 2★, 20-29: 3★, 30-39: 4★, 40+: 5★)
        let stars = '';
        if (totalScore >= 40) {
            stars = '⭐⭐⭐⭐⭐';
        } else if (totalScore >= 30) {
            stars = '⭐⭐⭐⭐';
        } else if (totalScore >= 20) {
            stars = '⭐⭐⭐';
        } else if (totalScore >= 10) {
            stars = '⭐⭐';
        } else if (totalScore >= 1) {
            stars = '⭐';
        }

        let mvpBadge = '';
        if (op.id === top1Id && totalScore > 0) {
            mvpBadge = getDiamondWreathBadgeHtml();
            cardClass += ' mvp-diamond';
            avatarBg = 'linear-gradient(135deg, #0284c7, #0369a1)';
        } else if (op.id === top2Id && totalScore > 0) {
            mvpBadge = getGoldWreathBadgeHtml();
            cardClass += ' mvp-gold';
            avatarBg = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else if (op.id === top3Id && totalScore > 0) {
            mvpBadge = getSilverWreathBadgeHtml();
            cardClass += ' mvp-silver';
            avatarBg = 'linear-gradient(135deg, #94a3b8, #475569)';
        } else if (stars === '⭐') {
            mvpBadge = `<span class="mvp-badge npc" title="${t('op_star_1_title', '1 ta yulduzli operator')}">🤖 NPC</span>`;
        }

        const isNextInLine = (op.id === predictedNextOpId) && (pres === 'ready') && !ringingNow;
        if (isNextInLine) {
            cardClass += ' next-in-line';
        }
        const nextInLineBadgeHtml = isNextInLine ? `
            <div class="next-call-corner-badge" title="${t('op_next_call_title', '🎯 100% Keyingi qo\'ng\'iroq kutilmoqda (Fewest calls navbatida #1)')}">
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
        const isMaxmudbek = (String(op.id) === '114' || cleanName.toLowerCase().includes('maxmudbek'));
        const avatarClickAttr = isMaxmudbek 
            ? `onclick="if(window.handleMaxmudbekClick){handleMaxmudbekClick(event);}" class="operator-avatar maxmudbek-clickable" style="background: ${avatarBg};" title="Maxmudbek • Qora ro'yxat (Blacklist) boshqaruvi"` 
            : `class="operator-avatar" style="background: ${avatarBg};"`;
        const nameClickAttr = isMaxmudbek 
            ? `onclick="if(window.handleMaxmudbekClick){handleMaxmudbekClick(event);}" class="maxmudbek-name-clickable" style="font-size: 15px; font-weight: 700;" title="Maxmudbek • Qora ro'yxat (Blacklist) boshqaruvi"` 
            : `style="font-size: 15px; font-weight: 700;"`;

        return `
            <div class="${cardClass}" onclick="openOperatorDetail('${op.id}')" title="${tf('op_card_click_detail', { name: cleanName }, `${cleanName} tafsilotlarini va suhbatlarini ko'rish uchun bosing`)}">
                ${ringingNow ? `<div class="call-live-strip ${isOutbound ? 'outbound-ringing' : 'ringing'}"></div>` : ((pres === 'talking' || activeConv) ? '<div class="call-live-strip talking"></div>' : '')}
                ${nextInLineBadgeHtml}
                <div class="operator-head">
                    <div ${avatarClickAttr}>${op.id}</div>
                    <div style="flex: 1; min-width: 0;">
                        <!-- 1-qator: Operator ismi (chapda) va Holat nishoni (o'ngda: Kutmoqda / Suhbatda / etc) -->
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <h4 ${nameClickAttr} style="margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cleanName}</h4>
                            <div style="flex-shrink: 0;">
                                ${statusBadge}
                            </div>
                        </div>
                        <!-- 2-qator: MVP nishoni (chapda) va Kutmoqdani tagida Pauza tugmasi (o'ngda) -->
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 4px; min-height: 24px;">
                            <div style="display: flex; align-items: center; gap: 6px; min-height: 20px;">
                                ${mvpBadge}
                            </div>
                            <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                                ${talkingTimerHtml}
                                <button type="button" 
                                        onclick="toggleOperatorPause('${op.id}', ${!(op.paused || pres === 'paused')}, event)" 
                                        class="op-card-pause-btn ${(op.paused || pres === 'paused') ? 'is-paused' : ''}" 
                                        title="${(op.paused || pres === 'paused') ? 'Pauzadan chiqarish (Ishga qaytish)' : 'Pauzaga qo\'yish (Tanaffus)'}">
                                    <span style="display: inline-flex; align-items: center; gap: 4px;">${(op.paused || pres === 'paused') ? `${isax('play', '', 'width: 12px; height: 12px;')} Qaytish` : `${isax('pause', '', 'width: 12px; height: 12px;')} Pauza`}</span>
                                </button>
                            </div>
                        </div>
                        <!-- 3-qator: Exten va Yulduzchalar -->
                        <div class="operator-meta-sub" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 2px 4px; margin-top: 3px;">
                            <span style="font-size: 11px; color: var(--text-dim); white-space: nowrap;">Exten: ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
                            ${generateStarRatingHtml(totalScore, cleanName)}
                        </div>
                    </div>
                </div>

                <div class="op-stat-row" style="padding-bottom: 7px; margin-bottom: 7px; border-bottom: 1px solid rgba(16, 185, 129, 0.25);">
                    <span style="font-weight: 800; color: #6ee7b7; display: inline-flex; align-items: center; gap: 4px;" title="Jami = Qabul qilingan + Chiquvchi + Transfer oxirida hal qilgan">${t('op_card_grand_total', 'Jami:')} ${isax('chart', '', 'width: 13px; height: 13px;')}</span>
                    <span class="op-stat-val" style="font-size: 15px; font-weight: 900; color: #34d399;" title="Jami = Qabul qilingan + Chiquvchi + Transfer oxirida hal qilgan">${(op.grandTotal !== undefined && op.grandTotal !== null) ? op.grandTotal : ((op.answered || 0) + (op.outbound || 0) + (op.transferResolved || 0))} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_desktop_agent', 'Desktop Agent:')}</span>
                    <span class="op-stat-val" style="font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'}; ${op.agentConnected ? 'box-shadow: 0 0 6px #10b981;' : ''}"></span>
                        <span style="color: ${op.agentConnected ? 'var(--success)' : 'var(--text-dim)'};">${op.agentConnected ? t('op_card_agent_active', 'Faol') : t('op_card_agent_off', "O'chiq")}</span>
                        ${op.agentConnected ? `<span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_desktop_name', 'Desktop nomi:')}</span>
                    <span class="op-stat-val" style="font-size: 11px; font-weight: 600; color: ${op.agentHostname ? '#93c5fd' : 'var(--text-dim)'}; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${op.agentHostname || t('op_card_unknown_host', 'Aniqlanmagan')}">
                        ${op.agentHostname || '—'}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_accepted', 'Qabul qilingan:')}</span>
                    <span class="op-stat-val" style="color: var(--success); font-weight: 700;">${op.answered || 0} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_outbound', 'Chiquvchi:')}</span>
                    <span class="op-stat-val" style="color: ${(op.outbound || 0) > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">${op.outbound || 0} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_transfer_out', 'Transfer (uzatgan):')}</span>
                    <span class="op-stat-val" style="color: ${(op.transferredOut || 0) > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">${op.transferredOut || 0} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_transfer_in', 'Transfer (olgan):')}</span>
                    <span class="op-stat-val" style="color: ${(op.transferredIn || 0) > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">${op.transferredIn || 0} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_missed', "O'tkazib yuborilgan:")}</span>
                    <span class="op-stat-val" style="color: ${(op.missed || 0) > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-weight: 700;">${op.missed || 0} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_total_talk', 'Umumiy suhbat:')}</span>
                    <span class="op-stat-val" style="font-weight: 700; color: ${op.totalDurationSec > 7200 ? '#fcd34d' : 'var(--text-main)'};">
                        ${formatSeconds(op.totalDurationSec || 0)} ${op.totalDurationSec > 7200 ? '🔥' : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_avg_talk', "O'rtacha suhbat:")}</span>
                    <span class="op-stat-val">${formatSeconds(op.avgDurationSec || 0)}</span>
                </div>
                ${activeConv ? (() => {
                    const cInfo = (typeof getClientContact === 'function') ? getClientContact(activeConv.callerId) : null;
                    const cText = cInfo ? ((cInfo.name && cInfo.organization) ? `${cInfo.name} • ${cInfo.organization}` : (cInfo.organization || cInfo.name || '')) : '';
                    return `
                    <div class="op-stat-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(16, 185, 129, 0.35);">
                        <span style="color: #6ee7b7; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${isax('call')} Hozir suhbatda:</span>
                        <span class="op-stat-val" style="color: #34d399; font-weight: 800; font-variant-numeric: tabular-nums;" title="Davom etayotgan suhbat (Jonli Monitor)">${formatCallerNumberOrOperator(activeConv.callerId)}</span>
                    </div>
                    ${cText ? `
                    <div style="font-size: 11px; color: #f59e0b; font-weight: 600; padding: 3px 8px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 5px; margin-top: 4px; word-break: break-word; line-height: 1.35;" title="${cText}">
                        ${isax('location')} ${cText}
                    </div>
                    ` : ''}
                    `;
                })() : ''}
            </div>
        `;
    }).join('');

    // Yangi kartalardagi jonli taymerlarni darhol hisoblab ko'rsatish
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

/* ==========================================================================
   7. Call History & Dual-Source Pagination (3CX Agent Default + Server CDR)
   ========================================================================== */
let historyDataSource = 'agent'; // Default: 'agent' (3CX Desktop Agent), 'server' (Issabel Asterisk CDR)
let historyDateScope = 'today'; // 'today' (Tanlangan sana), 'all' (Barcha kunlar / butun arxiv)

function updateHistoryScopeUI() {
    const btnAll = document.getElementById('btnHistoryScopeAll');
    if (!btnAll) return;

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
window.updateHistoryScopeUI = updateHistoryScopeUI;

function toggleHistoryScopeAll() {
    historyDateScope = (historyDateScope === 'all') ? 'today' : 'all';
    updateHistoryScopeUI();
    loadHistoryPage(1, historySearchQuery);
}
window.toggleHistoryScopeAll = toggleHistoryScopeAll;

function setHistoryScope(scope) {
    historyDateScope = (scope === 'all') ? 'all' : 'today';
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
        if (thLast) {
            thLast.innerText = t('set_col_host', 'Kompyuter (Host)');
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
        if (thLast) {
            thLast.innerText = t('hist_col_hangup', 'Kim tugatdi?');
        }
    }

    loadHistoryPage(1, historySearchQuery);
}
window.setHistorySource = setHistorySource;

function initHistoryPagination() {
    const input = document.getElementById('historySearchInput');
    let searchTimeout = null;

    if (input) {
        input.addEventListener('input', (e) => {
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
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;"><div class="spinner" style="margin: 0 auto 8px;"></div> ${t('hist_loading_calls', "Qo'ng'iroqlar tarixi yuklanmoqda...")}</td></tr>`;
    }

    try {
        const isAll = (historyDateScope === 'all');
        const todayStr = getTodayDateString();
        const activeDate = currentSelectedDate || todayStr;
        const dateParam = isAll ? 'all' : ((activeDate === todayStr) ? 'today' : activeDate);

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
        }
    } catch (e) {
        if (tbody && !isSilent) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--danger); padding: 20px;">${tf('hist_error', { msg: e.message }, `Xatolik yuz berdi: ${e.message}`)}</td></tr>`;
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

    // Agar foydalanuvchi Zuhra opa (AI ovoz) ni tanlasa, avtomatik Server CDR ga o'tkazamiz
    // Chunki ovoz tahlillari to'liq server CDR bazasida saqlanadi
    if (speakerVal === 'zuhra' && historyDataSource !== 'server') {
        setHistorySource('server');
        return;
    }

    if (historyDataSource === 'server') {
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
            const isAns = item.status === 'ANSWERED' || item.category_3cx === 'Answered';
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
    if (opStr.includes('➔')) {
        const parts = opStr.split('➔').map(p => p.trim());
        const formattedParts = parts.map(p => {
            const match = p.match(/\b(10[1-9]|11[0-9]|120)\b/);
            if (match) {
                const ext = match[1];
                const name = OPERATOR_NAMES_MAP[ext];
                if (name && !p.includes(name)) return `${name} (${ext})`;
            }
            return p;
        });
        return formattedParts.join(` <span style="color: #38bdf8; font-weight: 700; margin: 0 3px; display: inline-flex; align-items: center;">${isax('arrow-right')}</span> `);
    }
    const match = String(opStr).match(/\b(10[1-9]|11[0-9]|120)\b/);
    if (match) {
        const ext = match[1];
        const name = OPERATOR_NAMES_MAP[ext];
        if (name) return `${name} (${ext})`;
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
    } catch (e) {}
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
            if (!phone.includes(query) && !name.includes(query) && !org.includes(query) && !notes.includes(query) && !lang.includes(query)) {
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

function closeAdminClientModal() {
    const modal = document.getElementById('adminClientModal');
    if (modal) modal.style.display = 'none';
}

async function handleAdminClientSubmit(e) {
    if (e) e.preventDefault();
    const origPhone = (document.getElementById('adminClientOrigPhone').value || '').trim();
    const phone = (document.getElementById('adminClientPhoneInput').value || '').trim();
    const name = (document.getElementById('adminClientNameInput').value || '').trim();
    const organization = (document.getElementById('adminClientOrgInput').value || '').trim();
    const language = (document.getElementById('adminClientLangSelect').value || '').trim();
    const notes = (document.getElementById('adminClientNotesInput').value || '').trim();

    if (!phone) {
        alert("Telefon raqami kiritilishi shart!");
        return;
    }

    const saveBtn = document.getElementById('adminClientSaveBtn');
    const statusEl = document.getElementById('adminClientStatus');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const payload = { phone, name, organization, language, notes };
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
                } catch (_) {}
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
        return `<span style="color: #38bdf8; font-weight: 600;">${t('party_transfer', 'Transfer (Operatorga)')}</span>`;
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
        return `<span style="color: #38bdf8; font-weight: 600;">${t('party_transfer', 'Transfer (Operatorga)')}</span>`;
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
                    <td colspan="10" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
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
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;">${t('hist_empty', "Qo'ng'iroqlar tarixi topilmadi")}</td></tr>`;
        }
        return;
    }

    const isAll = (historyDateScope === 'all');

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = (historyCurrentPage - 1) * 20 + index + 1;
        const isOut = item.category_3cx === 'Dialled' || item.status === 'OUTBOUND' || item.status === 'DIALLED';
        const isAns = item.category_3cx === 'Answered' || item.status === 'ANSWERED';
        
        let statusBadge = '';
        if (isAns) {
            statusBadge = `<span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('status_accepted', 'Qabul qilingan')}</span>`;
        } else if (item.status === 'REJECT') {
            statusBadge = `<span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('status_denied', 'Rad etilgan')}</span>`;
        } else if (item.category_3cx === 'Missed' || item.status === 'MISSED') {
            statusBadge = `<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 ${t('status_missed', "O'tkazib yuborilgan")}</span>`;
        } else {
            statusBadge = `<span class="badge badge-warning">${item.status_name || item.status}</span>`;
        }

        const dirBadge = isOut 
            ? `<span class="badge badge-purple"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>` 
            : `<span class="badge badge-info"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`;

        let timeHtml = '';
        if (item.event_time) {
            const spl = item.event_time.split(' ');
            const dateStr = spl[0] || '';
            const timeStr = spl[1] || item.event_time;
            if (isAll) {
                timeHtml = `<div style="font-weight: 700; color: #60a5fa; font-size: 11px; letter-spacing: 0.3px;">${dateStr}</div><div style="font-family: monospace; color: var(--text-muted); font-size: 11px;">${timeStr}</div>`;
            } else {
                timeHtml = `<div style="font-family: monospace; color: var(--text-muted); font-size: 12px;" title="${item.event_time}">${timeStr}</div>`;
            }
        } else {
            timeHtml = '-';
        }

        // --- Audio / Amal ustuni ---
        const durSec = item.duration_sec || 0;
        const hasAudio = isAns && durSec > 0;
        const safeCaller = (item.caller_id || '').replace(/'/g, "\\'");
        const callKey = `${item.caller_id || ''}_${durSec}`;
        const isThisPlaying = currentlyPlayingCallKey === callKey;
        const isThisPaused = pausedCallKey === callKey;
        const isThisSearching = activeSearchingCallerId === (item.caller_id || '');

        const playBtnText = isThisSearching 
            ? `${isax('timer')} ` + t('dyn_searching', 'Qidirilmoqda...')
            : (isThisPlaying ? `${isax('pause', '', 'width: 12px; height: 12px;')} ` + t('dyn_pause', "To'xtatish") : (isThisPaused ? `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_resume', 'Davom ettirish') : `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_listen', 'Tinglash')));

        const audioCell = hasAudio 
            ? `<div style="display: inline-flex; align-items: center; gap: 6px;">
                   <button class="btn-action btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                           ${isThisSearching ? 'disabled' : ''} 
                           onclick="playDashboardRecording('', '${safeCaller}', ${durSec}, this)" 
                           style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; padding: 4px 10px; font-size: 11px;" 
                           title="${isThisPlaying ? t('audio_pause_title', "To'xtatish (pauza)") : (isThisPaused ? t('audio_resume_title', 'Qolgan joyidan davom ettirish') : t('audio_play_title', 'Audioni tinglash'))}">
                       <span>${playBtnText}</span>
                   </button>
                   <button class="btn-action" 
                           onclick="openInExplorerStudio('', '${safeCaller}', ${durSec}, this)" 
                           style="padding: 4px 8px; font-size: 11px; background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #c7d2fe; display: inline-flex; align-items: center; gap: 4px;" 
                           title="${t('audio_detail_title', "Audio Explorer studiyasida to'liq pleyer bilan ochish")}">
                       <span>${t('audio_detail_short', '🔍 Detal')}</span>
                   </button>
                   ${renderVoiceAnalysisBadge(item.voiceAnalysis)}
               </div>`
            : `<span class="badge" style="background: rgba(100, 116, 139, 0.12); color: var(--text-dim); font-size: 11px; padding: 4px 8px; border: 1px dashed rgba(148, 163, 184, 0.2);" title="${t('audio_none_title', "Suhbat bo'lmagan (ovoz yozuvi mavjud emas)")}">
                   <span style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('audio_none', "Audio yo'q")}</span>
               </span>`;

        let rowStyle = '';
        if (isOut) {
            rowStyle = 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
        } else if (item.category_3cx === 'Missed' || item.status === 'MISSED' || item.status === 'REJECT') {
            rowStyle = 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444;';
        }

        const callerKey = `agent_${item.id || ''}_${item.caller_id || ''}_${item.time || item.event_time || index}`;
        const isExpCaller = isCallerExpanded(callerKey);

        return `
            <tr style="${rowStyle}">
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td>${timeHtml}</td>
                <td class="${isExpCaller ? 'cell-expanded' : ''}">
                    <div class="phone-cell ${isOut ? 'outbound' : ''} ${isExpCaller ? 'is-expanded' : ''}">
                        <span class="phone-icon">${isOut ? isax('export') : isax('call')}</span>
                        ${renderExpandableCallerHtml(item.caller_id, callerKey)}
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator_id)}</td>
                <td>${dirBadge}</td>
                <td style="font-family: monospace; font-weight: 600; color: ${isAns ? 'var(--text-main)' : 'var(--text-dim)'};">${formatSeconds(durSec)}</td>
                <td style="font-size: 11px; color: var(--text-dim); text-align: center;" title="${t('agent_no_wait_title', '3CX Agent jurnalida navbatda kutish vaqti mavjud emas')}">—</td>
                <td>${statusBadge}</td>
                <td style="color: var(--text-muted); font-size: 12px;">
                    <span style="display: inline-flex; align-items: center; gap: 4px;">
                        <span>💻</span> ${item.hostname || 'Desktop'}
                    </span>
                </td>
                <td>${audioCell}</td>
            </tr>
        `;
    }).join('');
}

function renderServerHistoryRowHtml(item, rowNum, isLiveNew = false) {
    const isAll = (historyDateScope === 'all');
    const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
    const isOut = item.direction === 'outbound' && !isXfer;
    const isAns = item.status === 'ANSWERED';

    // "Operatorga ulanmadi / Navbatdan chiqdi" (olovrang), "Chiquvchi" (binafsharang), "Transfer" (moviy/cyan) fon
    const isUnconnected = !isAns && !isOut && !isXfer;
    let rowStyle = '';
    if (isXfer) {
        rowStyle = 'background: rgba(14, 165, 233, 0.08); border-left: 3px solid #0ea5e9;';
    } else if (isOut) {
        rowStyle = (item.status === 'BUSY')
            ? 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444;'
            : 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
    } else if (isUnconnected) {
        rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
    }

    const statusBadge = isAns 
        ? `<span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('status_answered', 'Javob berilgan')}</span>` 
        : (isOut 
            ? (item.status === 'BUSY' ? `<span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('status_busy', 'Band')}</span>` : `<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 ${t('status_no_answer', 'Javobsiz')}</span>`)
            : `<span class="badge badge-warning" style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('status_abandoned', 'Navbatdan chiqdi')}</span>`);
    const dirBadge = isXfer
        ? `<span class="badge badge-cyan" style="display: inline-flex; align-items: center; gap: 4px;">${isax('refresh', '', 'width: 12px; height: 12px;')} ${t('dir_transfer', 'transfer')}</span>`
        : (isOut 
            ? `<span class="badge badge-purple"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>` 
            : `<span class="badge badge-info"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`);

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
            timeHtml = `<div style="font-weight: 700; color: #60a5fa; font-size: 11px; letter-spacing: 0.3px;">${dateStr}</div><div style="font-family: monospace; color: var(--text-muted); font-size: 11px;">${timeStr}</div>`;
        } else {
            timeHtml = `<div style="font-family: monospace; color: var(--text-muted); font-size: 12px;" title="${item.time}">${timeStr}</div>`;
        }
    } else {
        timeHtml = '-';
    }

    // --- Audio / Amal ustuni ---
    const durSec = item.duration || 0;
    const hasAudio = isAns && (durSec > 0 || Boolean(item.recording));
    const safeRec = (item.recording || '').replace(/'/g, "\\'");
    const safeCaller = (item.callerId || '').replace(/'/g, "\\'");
    const callKey = `${item.callerId || ''}_${durSec}`;
    const isThisPlaying = currentlyPlayingCallKey === callKey;
    const isThisPaused = pausedCallKey === callKey;
    const isThisSearching = activeSearchingCallerId === (item.callerId || '');

    const playBtnText = isThisSearching 
        ? `${isax('timer')} ` + t('dyn_searching', 'Qidirilmoqda...')
        : (isThisPlaying ? `${isax('pause', '', 'width: 12px; height: 12px;')} ` + t('dyn_pause', "To'xtatish") : (isThisPaused ? `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_resume', 'Davom ettirish') : `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_listen', 'Tinglash')));

    const audioCell = hasAudio 
        ? `<div style="display: inline-flex; align-items: center; gap: 6px;">
               <button class="btn-action btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                       ${isThisSearching ? 'disabled' : ''} 
                       onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                       style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; padding: 4px 10px; font-size: 11px;" 
                       title="${isThisPlaying ? t('audio_pause_title', "To'xtatish (pauza)") : (isThisPaused ? t('audio_resume_title', 'Qolgan joyidan davom ettirish') : t('audio_play_title', 'Audioni tinglash'))}">
                   <span>${playBtnText}</span>
               </button>
               <button class="btn-action" 
                       onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                       style="padding: 4px 8px; font-size: 11px; background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #c7d2fe; display: inline-flex; align-items: center; gap: 4px;" 
                       title="${t('audio_detail_title', "Audio Explorer studiyasida to'liq pleyer bilan ochish")}">
                   <span>${t('audio_detail_short', '🔍 Detal')}</span>
               </button>
               ${renderVoiceAnalysisBadge(item.voiceAnalysis)}
           </div>`
        : `<span class="badge" style="background: rgba(100, 116, 139, 0.12); color: var(--text-dim); font-size: 11px; padding: 4px 8px; border: 1px dashed rgba(148, 163, 184, 0.2);" title="${t('audio_none_title', "Suhbat bo'lmagan (ovoz yozuvi mavjud emas)")}">
               <span style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('audio_none', "Audio yo'q")}</span>
           </span>`;

    const hangupDisplay = formatHangupParty(item.hangupParty || item.cause, isXfer);

    const callerKey = `hist_${item.recording || ''}_${item.callerId || ''}_${item.time || rowNum}`;
    const isExpCaller = isCallerExpanded(callerKey);
    const uniqueRowKey = item.uniqueid || (item.recording || (item.callerId + '_' + (item.time || '') + '_' + (item.duration || 0)));
    const animClass = isLiveNew ? ' live-call-new-row' : '';

    return `
        <tr style="${rowStyle}" class="${animClass}" data-call-key="${uniqueRowKey}">
            <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
            <td>${timeHtml}</td>
            <td class="${isExpCaller ? 'cell-expanded' : ''}">
                <div class="phone-cell ${isOut ? 'outbound' : ''} ${isExpCaller ? 'is-expanded' : ''}">
                    <span class="phone-icon">${isOut ? isax('export') : isax('call')}</span>
                    ${renderExpandableCallerHtml(item.callerId, callerKey)}
                </div>
            </td>
            <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator)}</td>
            <td>${dirBadge}</td>
            <td>${formatSeconds(durSec)}</td>
            <td style="font-family: monospace; font-weight: 600; color: #f59e0b;" title="${item.waitSec ? tf('wait_title', { time: formatSeconds(item.waitSec) }, `Navbatda kutish: ${formatSeconds(item.waitSec)}`) : t('wait_title_none', 'Navbatda kutish vaqti mavjud emas')}">${item.waitSec ? formatSeconds(item.waitSec) : '—'}</td>
            <td>${statusBadge}</td>
            <td style="font-size: 12px;">${hangupDisplay}</td>
            <td>${audioCell}</td>
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
                    <td colspan="10" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
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
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;">${t('hist_empty', "Qo'ng'iroqlar tarixi topilmadi")}</td></tr>`;
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
    // Agar foydalanuvchi eski sanalarni yoki eski sahifalarni (2-sahifa+) yoki qidiruv natijalarini ko'rayotgan bo'lsa,
    // o'qish jarayoni aslo buzilmaydi va jadval miltillamaydi!
    const todayStr = getTodayDateString();
    const activeDate = currentSelectedDate || todayStr;
    const isToday = (historyDateScope !== 'all') && (activeDate === todayStr);
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

    // Barcha satrlar tartib raqamini (1..20) yangilaymiz
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((r, idx) => {
        const firstTd = r.querySelector('td:first-child');
        if (firstTd) firstTd.textContent = idx + 1;
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

let dashboardRecentCallsList = [];

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

    // Har bir operatordan faqat 1 ta yozuv, alifbo tartibida
    const uniqueDisplayNames = Array.from(opMap.values()).sort((a, b) => a.localeCompare(b));
    dl.innerHTML = uniqueDisplayNames.map(name => `<option value="${name}">`).join('');
}

let currentRecentSortColumn = 'time';
let currentRecentSortDirection = 'desc';

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
    const columns = ['time', 'callerId', 'direction', 'operator', 'duration', 'waitSec', 'status', 'hangupParty'];
    columns.forEach(col => {
        const iconEl = document.getElementById(`sort-icon-${col}`);
        if (!iconEl) return;

        if (col === currentRecentSortColumn) {
            iconEl.innerHTML = currentRecentSortDirection === 'asc' ? '▲' : '▼';
            iconEl.style.opacity = '1';
            iconEl.style.color = '#38bdf8';
        } else {
            iconEl.innerHTML = '↕';
            iconEl.style.opacity = '0.35';
            iconEl.style.color = 'inherit';
        }
    });
}

function applyDashboardRecentFilters() {
    const opInput = document.getElementById('recentFilterOperator');
    const statusSelect = document.getElementById('recentFilterStatus');
    const dirSelect = document.getElementById('recentFilterDirection');
    const clearBtn = document.getElementById('btnClearRecentFilters');

    const opVal = opInput ? opInput.value.trim().toLowerCase() : '';
    const statusVal = statusSelect ? statusSelect.value : 'all';
    const dirVal = dirSelect ? dirSelect.value : 'all';

    const hasActiveFilter = Boolean(opVal || statusVal !== 'all' || dirVal !== 'all');
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

        // 2. Holati (answered vs missed/busy/etc)
        if (statusVal !== 'all') {
            const isQueueOnly = !item.operatorExten && (!item.operator || item.operator === 'Navbat' || item.operator.includes('Navbat') || item.operator.includes('Operatorga ulanmadi') || item.operator === '-');
            const isAns = (item.status === 'ANSWERED') && !isQueueOnly;
            if (statusVal === 'answered' && !isAns) return false;
            if (statusVal === 'missed' && isAns) return false;
        }

        // 3. Yo'nalishi (inbound vs outbound vs transfer)
        if (dirVal !== 'all') {
            const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
            const isOut = item.direction === 'outbound' && !isXfer;
            if (dirVal === 'transfer' && !isXfer) return false;
            if (dirVal === 'inbound' && (isOut || isXfer)) return false;
            if (dirVal === 'outbound' && (!isOut || isXfer)) return false;
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
            case 'direction':
                valA = String(a.direction || '');
                valB = String(b.direction || '');
                break;
            case 'operator':
                valA = String(formatOperatorDisplayName(a.operator || '')).toLowerCase();
                valB = String(formatOperatorDisplayName(b.operator || '')).toLowerCase();
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
            case 'hangupParty':
                valA = String(a.hangupParty || '');
                valB = String(b.hangupParty || '');
                break;
            default:
                valA = new Date(a.time || 0).getTime();
                valB = new Date(b.time || 0).getTime();
        }

        if (valA < valB) return currentRecentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentRecentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const limit = hasActiveFilter ? 40 : 20;
    renderDashboardRecentTable(filtered.slice(0, limit), hasActiveFilter);
}

function resetDashboardRecentFilters() {
    const opInput = document.getElementById('recentFilterOperator');
    const statusSelect = document.getElementById('recentFilterStatus');
    const dirSelect = document.getElementById('recentFilterDirection');
    if (opInput) opInput.value = '';
    if (statusSelect) statusSelect.value = 'all';
    if (dirSelect) dirSelect.value = 'all';
    currentRecentSortColumn = 'time';
    currentRecentSortDirection = 'desc';
    updateSortIcons();
    applyDashboardRecentFilters();
}

function renderDashboardRecentTable(data, hasActiveFilter = false) {
    const tbody = document.getElementById('dashboardCallsTable');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; color: var(--text-dim); padding: 32px 16px; font-size: 13px;">
                    ${hasActiveFilter ? '🔍 Tanlangan filtrlar bo\'yicha qo\'ng\'iroqlar topilmadi' : 'Hozircha qo\'ng\'iroqlar yo\'q'}
                </td>
            </tr>
        `;
        return;
    }

    try {
        tbody.innerHTML = data.map((item, index) => {
            const rowNum = index + 1;
            const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
            const isOut = item.direction === 'outbound' && !isXfer;
            
            const isQueueOnly = !item.operatorExten && (!item.operator || item.operator === 'Navbat' || item.operator.includes('Navbat') || item.operator.includes('Operatorga ulanmadi') || item.operator === '-');
            const isAns = (item.status === 'ANSWERED') && !isQueueOnly;

            const statusBadge = isAns 
                ? `<span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('status_answered', 'Javob berilgan')}</span>` 
                : (isOut 
                    ? (item.status === 'BUSY' ? `<span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('status_busy', 'Band')}</span>` : `<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;">${isax('call-slash', '', 'width: 11px; height: 11px;')} ${t('status_no_answer', 'Javobsiz')}</span>`)
                    : `<span class="badge badge-warning" style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('status_abandoned', 'Navbatdan chiqdi')}</span>`);
            const dirBadge = isXfer
                ? `<span class="badge badge-cyan" style="display: inline-flex; align-items: center; gap: 4px;">${isax('refresh', '', 'width: 12px; height: 12px;')} ${t('dir_transfer', 'transfer')}</span>`
                : (isOut
                    ? `<span class="badge badge-purple"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>`
                    : `<span class="badge badge-info"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`);

            const opDisplayName = typeof formatOperatorDisplayName === 'function' ? formatOperatorDisplayName(item.operator) : (item.operator || '-');
            const opCellHtml = isQueueOnly
                ? `<span style="color: #f59e0b; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} ${t('op_not_connected', 'Operatorga ulanmadi')}</span>`
                : `<span style="font-weight: 600; color: var(--text-main);">${opDisplayName}</span>`;

            // "Operatorga ulanmadi / Navbatdan chiqdi" (olovrang), "Chiquvchi" (binafsharang), "Transfer" (moviy/cyan) fon
            const isUnconnected = isQueueOnly && !isOut && !isXfer;
            let rowStyle = '';
            if (isXfer) {
                rowStyle = 'background: rgba(14, 165, 233, 0.08); border-left: 3px solid #0ea5e9;';
            } else if (isOut) {
                rowStyle = (item.status === 'BUSY')
                    ? 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444;'
                    : 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
            } else if (isUnconnected || !isAns) {
                rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
            }

            const hasAudio = (item.status === 'ANSWERED' && (item.duration || 0) > 0) || Boolean(item.recording);
            const safeRec = (item.recording || '').replace(/'/g, "\\'");
            const safeCaller = (item.callerId || '').replace(/'/g, "\\'");
            const durSec = item.duration || 0;
            const waitSecVal = item.waitSec || 0;
            const waitCellHtml = isOut
                ? `<td style="font-size: 11px; color: var(--text-dim); text-align: center;" title="${t('wait_none_outbound_title', "Chiquvchi qo'ng'iroqda navbat yo'q")}">—</td>`
                : `<td style="font-family: monospace; font-weight: 600; color: #f59e0b;" title="${typeof tf === 'function' ? tf('wait_title', { time: formatSeconds(waitSecVal) }, `Navbatda kutish: ${formatSeconds(waitSecVal)}`) : `Navbatda kutish: ${formatSeconds(waitSecVal)}`}">${formatSeconds(waitSecVal)}</td>`;

            const callKey = `${item.callerId || ''}_${durSec}`;
            const isThisPlaying = typeof currentlyPlayingCallKey !== 'undefined' && currentlyPlayingCallKey === callKey;
            const isThisPaused = typeof pausedCallKey !== 'undefined' && pausedCallKey === callKey;
            const isThisSearching = typeof activeSearchingCallerId !== 'undefined' && activeSearchingCallerId === item.callerId;

            const playBtnText = isThisSearching 
                ? `${isax('timer')} ` + t('dyn_searching', 'Qidirilmoqda...')
                : (isThisPlaying ? `${isax('pause', '', 'width: 12px; height: 12px;')} ` + t('dyn_pause', "To'xtatish") : (isThisPaused ? `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_resume', 'Davom ettirish') : `${isax('play', '', 'width: 12px; height: 12px;')} ` + t('dyn_listen', 'Tinglash')));

            const audioCell = hasAudio 
                ? `<div style="display: inline-flex; align-items: center; gap: 6px;">
                       <button class="btn-action btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                               ${isThisSearching ? 'disabled' : ''} 
                               onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                               style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; padding: 4px 10px; font-size: 11px;" 
                               title="${isThisPlaying ? t('audio_pause_title', "To'xtatish (pauza)") : (isThisPaused ? t('audio_resume_title', 'Qolgan joyidan davom ettirish') : t('audio_play_title', 'Audioni tinglash'))}">
                           <span>${playBtnText}</span>
                       </button>
                       <button class="btn-action" 
                               onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                               style="padding: 4px 8px; font-size: 11px; background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #c7d2fe; display: inline-flex; align-items: center; gap: 4px;" 
                               title="${t('audio_detail_title', "Audio Explorer studiyasida to'liq pleyer bilan ochish")}">
                           <span>${t('audio_detail_short', '🔍 Detal')}</span>
                       </button>
                   </div>`
                : `<span class="badge" style="background: rgba(100, 116, 139, 0.12); color: var(--text-dim); font-size: 11px; padding: 4px 8px; border: 1px dashed rgba(148, 163, 184, 0.2);" title="${t('audio_none_title', "Suhbat bo'lmagan (ovoz yozuvi mavjud emas)")}">
                       <span style="display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('audio_none', "Audio yo'q")}</span>
                   </span>`;

            const hangupDisplay = typeof formatHangupParty === 'function' 
                ? formatHangupParty(item.hangupParty || item.cause, isXfer) 
                : (item.hangupParty || item.cause || '-');

            const callerKey = `rec_${item.recording || ''}_${item.callerId || ''}_${item.time || index}`;
            const isExpCaller = typeof isCallerExpanded === 'function' ? isCallerExpanded(callerKey) : false;

            const timeStr = item.time ? new Date(item.time).toLocaleTimeString('uz-UZ', { hour12: false, timeZone: 'Asia/Tashkent' }) : '--:--:--';

            return `
                <tr style="${rowStyle}">
                    <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                    <td>${timeStr}</td>
                    <td class="${isExpCaller ? 'cell-expanded' : ''}">
                        <div class="phone-cell ${isOut ? 'outbound' : ''} ${isExpCaller ? 'is-expanded' : ''}">
                            <span class="phone-icon">${isOut ? isax('export') : isax('call')}</span>
                            ${typeof renderExpandableCallerHtml === 'function' ? renderExpandableCallerHtml(item.callerId, callerKey) : (item.callerId || '')}
                        </div>
                    </td>
                    <td>${dirBadge}</td>
                    <td>${opCellHtml}</td>
                    <td>${formatSeconds(item.duration || 0)}</td>
                    ${waitCellHtml}
                    <td>${statusBadge}</td>
                    <td style="font-size: 12px;">
                        ${hangupDisplay}
                    </td>
                    <td>
                        ${audioCell}
                    </td>
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
        }).catch(() => {});
        refreshAllActiveTables();
        return;
    }

    // 3. Agar boshqa audio bosilgan bo'lsa -> avvalgisini to'liq to'xtatamiz (STOP)
    pausedCallKey = null;
    try {
        audio.pause();
        audio.currentTime = 0;
    } catch (e) {}

    // Avvalgi qidiruvni bekor qilish (Abort)
    if (activeRecordingSearchController) {
        try {
            activeRecordingSearchController.abort();
        } catch (e) {}
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
        } catch (fastErr) {}

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
        if (Array.isArray(recentRes) && recentRes.length > 0 && dashboardRecentCallsList.length === 0) {
            dashboardRecentCallsList = [...recentRes];
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
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
    if (currentDetailAudio) {
        currentDetailAudio.pause();
        currentDetailAudio = null;
    }
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

    if (detailState.category === 'answered') {
        calls = calls.filter(c => c.direction !== 'outbound' && c.status === 'ANSWERED');
    } else if (detailState.category === 'outbound') {
        calls = calls.filter(c => c.direction === 'outbound' && c.status === 'ANSWERED');
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

                    const directionBadge = isOut
                        ? `<span class="badge badge-purple" style="font-size: 10px;"><i class="badge-dir-icon outbound"></i> ${t('dir_outbound', 'chiquvchi')}</span>`
                        : `<span class="badge badge-info" style="font-size: 10px;"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'kiruvchi')}</span>`;

                    let rowStyle = '';
                    if (isOut) {
                        rowStyle = 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
                    } else if (!isAns) {
                        rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
                    }

                    let hangupDisplay = formatHangupParty(c.hangupParty, c.direction === 'transfer');
                    const callerKey = `opmodal_${c.recording || ''}_${c.callerId || ''}_${c.time || index}`;
                    const isExpCaller = isCallerExpanded(callerKey);

                    return `
                        <tr style="${rowStyle}">
                            <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                            <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${new Date(c.time).toLocaleTimeString('uz-UZ', { hour12: false, timeZone: 'Asia/Tashkent' })}</td>
                            <td class="${isExpCaller ? 'cell-expanded' : ''}">
                                <div class="phone-cell ${isOut ? 'outbound' : ''} ${isExpCaller ? 'is-expanded' : ''}">
                                    <span class="phone-icon">${isOut ? isax('export') : isax('call')}</span>
                                    ${renderExpandableCallerHtml(c.callerId, callerKey)}
                                </div>
                            </td>
                            <td style="white-space: nowrap;">${directionBadge}</td>
                            <td style="white-space: nowrap;">
                                ${(c.operator || '').includes('IVR') || (c.operator || '').includes('Avtojavob') || (c.operator || '').includes('Navbatga kirmasdan')
                                    ? `<span style="color: #94a3b8; font-style: italic; display: inline-flex; align-items: center; gap: 4px;">${(c.operator || '').includes('Navbatga kirmasdan') ? isax('logout', '', 'width: 12px; height: 12px;') : isax('cpu', '', 'width: 12px; height: 12px;')} ${c.operator}</span>`
                                    : `<span style="font-weight: 600; color: var(--text-main);">${c.operator}</span>`
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
    const modal = document.getElementById('agentLogsModal');
    if (modal) {
        modal.style.display = 'none';
    }
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
    } catch(err) {}
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

    const daysInMonth = new Date(exportCalYear, exportCalMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(exportCalYear, exportCalMonth, 0).getDate();

    // 1. Previous month trailing days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const d = daysInPrevMonth - i;
        const cell = document.createElement('div');
        cell.innerText = d;
        cell.style.cssText = 'height: 28px; line-height: 28px; font-size: 11px; color: rgba(255,255,255,0.18); user-select: none;';
        gridEl.appendChild(cell);
    }

    // 2. Current month days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const fullDateStr = `${exportCalYear}-${String(exportCalMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.innerText = dayNum;
        cell.dataset.date = fullDateStr;

        const isStart = (startDate && fullDateStr === startDate);
        const isEnd = (endDate && fullDateStr === endDate);
        const isInRange = (startDate && endDate && fullDateStr > startDate && fullDateStr < endDate);
        const isToday = (fullDateStr === todayStr);

        let cellStyle = 'height: 28px; line-height: 28px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; position: relative; user-select: none;';

        if (isStart && isEnd) {
            cellStyle += 'background: linear-gradient(135deg, #2563eb, #10b981) !important; color: #ffffff !important; font-weight: 700; border-radius: 7px; box-shadow: 0 2px 8px rgba(37,99,235,0.45);';
        } else if (isStart) {
            cellStyle += 'background: #2563eb !important; color: #ffffff !important; font-weight: 700; border-radius: 7px 0 0 7px; box-shadow: 0 2px 8px rgba(37,99,235,0.4);';
        } else if (isEnd) {
            cellStyle += 'background: #10b981 !important; color: #ffffff !important; font-weight: 700; border-radius: 0 7px 7px 0; box-shadow: 0 2px 8px rgba(16,185,129,0.4);';
        } else if (isInRange) {
            cellStyle += 'background: rgba(59, 130, 246, 0.22) !important; color: #93c5fd !important; font-weight: 600; border-radius: 0;';
        } else {
            cellStyle += 'color: #e2e8f0; border-radius: 6px;';
            if (isToday) {
                cellStyle += 'border: 1px solid rgba(59, 130, 246, 0.6); font-weight: 700; color: #60a5fa;';
            }
        }

        cell.style.cssText = cellStyle;

        cell.addEventListener('mouseenter', () => {
            if (!isStart && !isEnd && !isInRange) {
                cell.style.background = 'rgba(255, 255, 255, 0.12)';
            }
        });
        cell.addEventListener('mouseleave', () => {
            if (!isStart && !isEnd && !isInRange) {
                cell.style.background = 'transparent';
            }
        });

        cell.addEventListener('click', (e) => {
            e.stopPropagation();
            onExportCalDateClick(fullDateStr);
        });

        gridEl.appendChild(cell);
    }

    // 3. Trailing cells for next month
    const totalCells = startDayOfWeek + daysInMonth;
    const remaining = (totalCells <= 35 ? 35 : 42) - totalCells;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
        const cell = document.createElement('div');
        cell.innerText = dayNum;
        cell.style.cssText = 'height: 28px; line-height: 28px; font-size: 11px; color: rgba(255,255,255,0.18); user-select: none;';
        gridEl.appendChild(cell);
    }
}

function openExportModal() {
    const modal = document.getElementById('exportModal');
    if (!modal) return;

    const todayStr = getTodayDateString();
    const activeDate = currentSelectedDate || todayStr;
    const startOfMonth = `${activeDate.slice(0, 7)}-01`;

    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');

    if (startInput) startInput.value = startOfMonth;
    if (endInput) endInput.value = activeDate;

    if (activeDate) {
        const [ay, am] = activeDate.split('-').map(Number);
        exportCalYear = ay;
        exportCalMonth = am - 1;
    }
    exportRangeSelectionStep = 0;

    updateExportRangeBadge();
    modal.style.display = 'flex';
}

function closeExportModal() {
    const modal = document.getElementById('exportModal');
    if (modal) modal.style.display = 'none';
}

function setExportPreset(preset) {
    const todayStr = getTodayDateString();
    const [y, m] = todayStr.split('-').map(Number);
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    if (!startInput || !endInput) return;

    if (preset === 'today') {
        startInput.value = todayStr;
        endInput.value = todayStr;
        exportCalYear = y;
        exportCalMonth = m - 1;
    } else if (preset === 'last7') {
        const dt = new Date();
        dt.setDate(dt.getDate() - 6);
        const y7 = dt.getFullYear();
        const m7 = String(dt.getMonth() + 1).padStart(2, '0');
        const d7 = String(dt.getDate()).padStart(2, '0');
        startInput.value = `${y7}-${m7}-${d7}`;
        endInput.value = todayStr;
        exportCalYear = y;
        exportCalMonth = m - 1;
    } else if (preset === 'thisMonth') {
        startInput.value = `${todayStr.slice(0, 7)}-01`;
        endInput.value = todayStr;
        exportCalYear = y;
        exportCalMonth = m - 1;
    } else if (preset === 'prevMonth') {
        const prevMonthDate = new Date(y, m - 2, 1);
        const py = prevMonthDate.getFullYear();
        const pm = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(py, prevMonthDate.getMonth() + 1, 0).getDate();
        startInput.value = `${py}-${pm}-01`;
        endInput.value = `${py}-${pm}-${String(lastDay).padStart(2, '0')}`;
        exportCalYear = py;
        exportCalMonth = parseInt(pm, 10) - 1;
    }
    exportRangeSelectionStep = 0;
    updateExportRangeBadge();
}

function onExportDateChange() {
    const startInput = document.getElementById('exportStartDate');
    if (startInput && startInput.value) {
        const [y, m] = startInput.value.split('-').map(Number);
        exportCalYear = y;
        exportCalMonth = m - 1;
    }
    updateExportRangeBadge();
}

function formatIsoToUzDate(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '--.--.----';
    const parts = isoStr.split('-');
    if (parts.length < 3) return isoStr;
    const [y, m, d] = parts;
    return `${d}.${m}.${y}`;
}

function updateExportRangeBadge() {
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    const textEl = document.getElementById('exportRangeText');
    const startText = document.getElementById('exportStartDateText');
    const endText = document.getElementById('exportEndDateText');
    if (!startInput || !endInput) return;

    const s = startInput.value;
    const e = endInput.value;

    if (startText && s) startText.innerText = formatIsoToUzDate(s);
    if (endText && e) endText.innerText = formatIsoToUzDate(e);

    renderExportRangeCalendar();

    if (!textEl) return;
    if (!s || !e) {
        textEl.innerText = 'Iltimos, ikkala sanani ham tanlang';
        return;
    }

    const d1 = new Date(s);
    const d2 = new Date(e);
    if (d1 > d2) {
        textEl.innerHTML = `<span style="color: #f87171; font-weight: 600;">${t('export_err_start_after_end', "⚠️ Boshlanish sanasi tugash sanasidan katta bo'lishi mumkin emas!")}</span>`;
        return;
    }

    const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    const [sy, sm, sd] = s.split('-');
    const [ey, em, ed] = e.split('-');
    textEl.innerHTML = tf('export_range_text', { days: diffDays, start: `${sd}.${sm}.${sy}`, end: `${ed}.${em}.${ey}` }, `Tanlangan oraliq: <b>${diffDays} kun</b> (${sd}.${sm}.${sy} — ${ed}.${em}.${ey})`);
}

let pendingExportRange = { startDate: '', endDate: '' };

function submitRangeExport() {
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    if (!startInput || !endInput) return;

    let s = startInput.value;
    let e = endInput.value;

    if (!s || !e) {
        alert(t('export_alert_select_dates', "Iltimos, boshlanish va tugash sanasini tanlang!"));
        return;
    }

    if (s > e) {
        const tmp = s;
        s = e;
        e = tmp;
        startInput.value = s;
        endInput.value = e;
    }

    pendingExportRange = { startDate: s, endDate: e };

    // Sana matnini ko'rsatish
    const [sy, sm, sd] = s.split('-');
    const [ey, em, ed] = e.split('-');
    const subtitleEl = document.getElementById('exportChoiceSubtitle');
    if (subtitleEl) {
        subtitleEl.innerText = `Tanlangan oraliq: ${sd}.${sm}.${sy} — ${ed}.${em}.${ey}`;
    }

    // Sana tanlash oynasini yopib, 3 ta tugmali hisobot turini tanlash oynasini ochish
    closeExportModal();
    openExportChoiceModal();
}

let selectedExportLang = 'uz';

function setExportLanguage(lang) {
    if (lang !== 'uz' && lang !== 'ru') lang = 'uz';
    selectedExportLang = lang;

    const btnUz = document.getElementById('btnExportLangUz');
    const btnRu = document.getElementById('btnExportLangRu');
    const hintEl = document.getElementById('exportLangHint');

    if (btnUz && btnRu) {
        if (lang === 'uz') {
            btnUz.style.background = '#3b82f6';
            btnUz.style.color = '#fff';
            btnUz.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.5)';
            btnRu.style.background = 'transparent';
            btnRu.style.color = '#94a3b8';
            btnRu.style.boxShadow = 'none';
        } else {
            btnRu.style.background = '#3b82f6';
            btnRu.style.color = '#fff';
            btnRu.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.5)';
            btnUz.style.background = 'transparent';
            btnUz.style.color = '#94a3b8';
            btnUz.style.boxShadow = 'none';
        }
    }

    if (hintEl) {
        hintEl.innerText = lang === 'ru' 
            ? 'Excel файл будет выгружен на русском языке' 
            : "Excel fayli o'zbek tilida shakllantiriladi";
    }

    updateExportModalTexts();
}

function updateExportModalTexts() {
    const isRu = selectedExportLang === 'ru';

    // Subtitle date update
    if (pendingExportRange && pendingExportRange.startDate && pendingExportRange.endDate) {
        const [sy, sm, sd] = pendingExportRange.startDate.split('-');
        const [ey, em, ed] = pendingExportRange.endDate.split('-');
        const subtitleEl = document.getElementById('exportChoiceSubtitle');
        if (subtitleEl) {
            const prefix = isRu ? 'Выбранный период:' : 'Tanlangan oraliq:';
            subtitleEl.innerText = `${prefix} ${sd}.${sm}.${sy} — ${ed}.${em}.${ey}`;
        }
    }

    // Modal Title
    const titleEl = document.querySelector('#exportChoiceModal [data-i18n="export_choice_title"]');
    if (titleEl) {
        titleEl.innerText = isRu ? 'Какой отчет хотите скачать?' : 'Qaysi hisobotni yuklab olmoqchisiz?';
    }

    // Button 1: All
    const allTitleEl = document.querySelector('#btnExportChoiceAll [data-i18n="export_choice_all"]');
    const allBadgeEl = document.querySelector('#btnExportChoiceAll [data-i18n="export_opt_all_badge"]');
    const allDescEl = document.querySelector('#btnExportChoiceAll [data-i18n="export_opt_all_desc"]');
    if (allTitleEl) allTitleEl.innerText = isRu ? 'Общий отчет' : 'Umumiy hisobot';
    if (allBadgeEl) allBadgeEl.innerText = isRu ? 'Все' : 'BARCHASI';
    if (allDescEl) allDescEl.innerText = isRu ? 'Полный объединенный отчет по всем группам операторов 100–199 и 200+' : 'Barcha operatorlar (100–199 va 200+) bitta umumiy jadvalda';

    // Button 2: Main
    const mainTitleEl = document.querySelector('#btnExportChoiceMain [data-i18n="export_choice_main"]');
    const mainDescEl = document.querySelector('#btnExportChoiceMain [data-i18n="export_opt_main_desc"]');
    if (mainTitleEl) mainTitleEl.innerText = isRu ? 'Основные операторы' : 'Asosiy operatorlar';
    if (mainDescEl) mainDescEl.innerText = isRu ? 'Отчет только по основным операторам с 100 по 199' : "Faqat 100 dan 199 gacha bo'lgan asosiy operatorlar hisoboti";

    // Button 3: Secondary (Zangiota)
    const secTitleEl = document.querySelector('#btnExportChoiceSec [data-i18n="export_choice_sec"]');
    const secDescEl = document.querySelector('#btnExportChoiceSec [data-i18n="export_opt_sec_desc"]');
    if (secTitleEl) secTitleEl.innerText = isRu ? 'Операторы Зангиота 42' : 'Zangiota 42 operatorlari';
    if (secDescEl) secDescEl.innerText = isRu ? 'Отчет только по операторам 200+ (Зангиота 42)' : 'Faqat 200 va undan yuqori (Zangiota 42) operatorlar hisoboti';

    // Footer buttons
    const backBtnText = document.querySelector('#exportChoiceModal [data-i18n="export_btn_back"]');
    const cancelBtnText = document.querySelector('#exportChoiceModal [data-i18n="export_btn_cancel"]');
    if (backBtnText) backBtnText.innerText = isRu ? 'Изменить дату' : "Sanani o'zgartirish";
    if (cancelBtnText) cancelBtnText.innerText = isRu ? 'Отмена' : 'Bekor qilish';
}

function openExportChoiceModal() {
    const modal = document.getElementById('exportChoiceModal');
    if (modal) modal.style.display = 'flex';

    // Tizimning hozirgi tiliga mos holda tanlash
    try {
        const sysLang = (typeof getCurrentLang === 'function') ? getCurrentLang() : 'uz';
        setExportLanguage(sysLang === 'ru' ? 'ru' : 'uz');
    } catch (e) {
        setExportLanguage('uz');
    }
}

function closeExportChoiceModal() {
    const modal = document.getElementById('exportChoiceModal');
    if (modal) modal.style.display = 'none';
}

function backToDateRangeModal() {
    closeExportChoiceModal();
    openExportModal();
}

function executeExportDownload(group = 'all') {
    const s = pendingExportRange.startDate;
    const e = pendingExportRange.endDate;
    if (!s || !e) return;

    const isRu = selectedExportLang === 'ru';
    const loadingMsg = isRu ? 'Отчет подготавливается и скачивается...' : 'Hisobot tayyorlanmoqda va yuklanmoqda...';

    let btnId = 'btnExportChoiceAll';
    if (group === 'main') btnId = 'btnExportChoiceMain';
    else if (group === 'secondary') btnId = 'btnExportChoiceSec';

    const btn = document.getElementById(btnId);
    let originalHtml = '';
    if (btn) {
        btn.disabled = true;
        originalHtml = btn.innerHTML;
        btn.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; gap: 10px; padding: 6px;">
                <span style="width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite;"></span>
                <span style="font-size: 14px; font-weight: 600; color: #fff;">${loadingMsg}</span>
            </div>
        `;
    }

    const downloadUrl = `/api/export/excel?startDate=${encodeURIComponent(s)}&endDate=${encodeURIComponent(e)}&group=${encodeURIComponent(group)}&lang=${encodeURIComponent(selectedExportLang)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;

    let groupSuffix = '_Umumiy';
    if (isRu) {
        groupSuffix = group === 'main' ? '_Основные' : (group === 'secondary' ? '_Зангиота_42' : '_Общий');
    } else {
        groupSuffix = group === 'main' ? '_Asosiy' : (group === 'secondary' ? '_Zangiota_42' : '_Umumiy');
    }
    const langSuffix = isRu ? '_RU' : '_UZ';

    a.download = `Call_Center_Export_${s}_${e}${groupSuffix}${langSuffix}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
        closeExportChoiceModal();
    }, 2000);
}

function downloadExcelReport(targetMonth = null) {
    // Agar to'g'ridan-to'g'ri chaqirilsa, modalni ochish
    openExportModal();
}


function filterTabAgentLogsByOperator(opId) {
    selectedTabAgentOpId = opId ? String(opId) : null;
    const titleEl = document.getElementById('operatorSelectedTitle');
    const selectEl = document.getElementById('tabAgentLogOpSelect');
    if (selectEl && selectEl.value !== (selectedTabAgentOpId || '')) {
        selectEl.value = selectedTabAgentOpId || '';
    }
    if (titleEl) {
        if (!selectedTabAgentOpId) {
            titleEl.innerText = t('agent_info_default', "Agent ma'lumotlari");
        } else {
            const op = tabAgentOperatorsData.find(o => String(o.id) === selectedTabAgentOpId);
            titleEl.innerText = op ? tf('agent_info_title', { name: op.name }, `${op.name} — Agent ma'lumotlari`) : tf('agent_info_title', { name: `Operator ${selectedTabAgentOpId}` }, `Operator ${selectedTabAgentOpId} — Agent ma'lumotlari`);
        }
    }
    if (tabAgentOperatorsData && tabAgentOperatorsData.length > 0) {
        renderTabAgentOperators(tabAgentOperatorsData);
    }
    loadTabOperatorLogs(selectedTabAgentOpId, 1);
}

let lastTabOpsFingerprint = '';
function renderTabAgentOperators(operators) {
    const grid = document.getElementById('tabOperatorsGrid');
    if (!grid) return;

    if (!operators || operators.length === 0) {
        grid.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; padding: 16px;">${t('tab_ops_no_data', "Hozircha 3CX Desktop Agent ma'lumotlari mavjud emas.")}</div>`;
        lastTabOpsFingerprint = '';
        return;
    }

    const currentFingerprint = JSON.stringify(operators) + '_' + selectedTabAgentOpId;
    if (currentFingerprint === lastTabOpsFingerprint && grid.children.length > 0) {
        return; // Ma'lumotlar o'zgarmagan bo'lsa DOM qayta chizilmaydi, kartochkalar mutlaqo statik turadi
    }
    lastTabOpsFingerprint = currentFingerprint;

    // Top 1 operatorni aniqlash (MVP reyting) jami qo'ng'iroqlar bo'yicha
    const getOpScore = (o) => {
        if (!o) return 0;
        const ans = o.answered || 0;
        const out = o.outbound || 0;
        if (o.grandTotal !== undefined && o.grandTotal !== null) {
            return Math.max(o.grandTotal, ans + out);
        }
        return ans + out;
    };
    const sortedByScore = [...operators]
        .filter(op => (getOpScore(op) > 0) || (op.totalDurationSec || 0) > 0)
        .sort((a, b) => (getOpScore(b) - getOpScore(a)) || ((b.totalDurationSec || 0) - (a.totalDurationSec || 0)));

    const top1Id = sortedByScore[0] ? sortedByScore[0].id : null;
    const top2Id = sortedByScore[1] ? sortedByScore[1].id : null;
    const top3Id = sortedByScore[2] ? sortedByScore[2].id : null;

    let countAgentOnline = 0;
    let totalAns = 0;
    let totalOutbound = 0;
    let totalMissed = 0;

    // Operator select dropdown
    const selectEl = document.getElementById('tabAgentLogOpSelect');
    if (selectEl && (!selectEl.options || selectEl.options.length <= 1)) {
        operators.forEach(op => {
            const opt = document.createElement('option');
            opt.value = op.id;
            opt.innerText = `${op.name || op.realName || op.id}`;
            opt.style.background = '#0f172a';
            opt.style.color = '#ffffff';
            selectEl.appendChild(opt);
        });
    }

    // Stabil tartib: faqat raqam (id) bo'yicha, kartochkalar sakrab joyini o'zgartirmaydi
    const sortedOps = (operators || [])
        .slice().sort((a, b) => {
            const idA = parseInt(a.id, 10) || 0;
            const idB = parseInt(b.id, 10) || 0;
            return idA - idB;
        });

    grid.innerHTML = sortedOps.map(op => {
        if (op.agentConnected) countAgentOnline++;
        const answered = op.answered || 0;
        const outbound = op.outbound || 0;
        const missed = op.missed || 0;
        totalAns += answered;
        totalOutbound += outbound;
        totalMissed += missed;

        const grandTotal = (op.grandTotal !== undefined && op.grandTotal !== null)
            ? Math.max(op.grandTotal, answered + outbound)
            : (answered + outbound);

        const totalScore = grandTotal;

        let stars = '';
        if (totalScore >= 40) {
            stars = '⭐⭐⭐⭐⭐';
        } else if (totalScore >= 30) {
            stars = '⭐⭐⭐⭐';
        } else if (totalScore >= 20) {
            stars = '⭐⭐⭐';
        } else if (totalScore >= 10) {
            stars = '⭐⭐';
        } else if (totalScore >= 1) {
            stars = '⭐';
        }

        const isDiamond = op.id === top1Id && totalScore > 0;
        const isGold = op.id === top2Id && totalScore > 0;
        const isSilver = op.id === top3Id && totalScore > 0;
        let mvpBadge = '';
        let avatarBg = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
        let cardMvpClass = '';
        if (isDiamond) {
            mvpBadge = getDiamondWreathBadgeHtml();
            avatarBg = 'linear-gradient(135deg, #0284c7, #0369a1)';
            cardMvpClass = ' mvp-diamond';
        } else if (isGold) {
            mvpBadge = getGoldWreathBadgeHtml();
            avatarBg = 'linear-gradient(135deg, #f59e0b, #d97706)';
            cardMvpClass = ' mvp-gold';
        } else if (isSilver) {
            mvpBadge = getSilverWreathBadgeHtml();
            avatarBg = 'linear-gradient(135deg, #94a3b8, #475569)';
            cardMvpClass = ' mvp-silver';
        } else if (stars === '⭐') {
            mvpBadge = `<span class="mvp-badge npc" title="${t('op_star_1_title', '1 ta yulduzli operator')}">🤖 NPC</span>`;
        }

        const isSelected = selectedTabAgentOpId === String(op.id);
        const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

        return `
            <div class="operator-card clickable-card static-operator-card ${cardMvpClass} ${isSelected ? 'is-selected' : ''}" 
                 onclick="filterTabAgentLogsByOperator('${op.id}')" 
                 title="${tf('op_card_click_3cx_detail', { name: cleanName }, `${cleanName} tafsilotlarini va 3CX jurnallarini ko'rish uchun bosing`)}">
                <div class="operator-head">
                    <div class="operator-avatar" style="background: ${avatarBg};">${op.id}</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <h4 style="font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cleanName}</h4>
                                ${mvpBadge}
                            </div>
                            <span class="badge" style="font-size: 11px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-dim);">#${op.id}</span>
                        </div>
                        <div class="operator-meta-sub" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 2px 4px; margin-top: 2px;">
                            <span style="font-size: 11px; color: var(--text-dim); white-space: nowrap;">${t('op_card_exten', 'Exten:')} ${op.id}</span>
                            ${generateStarRatingHtml(totalScore, cleanName)}
                        </div>
                    </div>
                </div>

                <div class="op-stat-row" style="padding-bottom: 7px; margin-bottom: 7px; border-bottom: 1px solid rgba(16, 185, 129, 0.25);">
                    <span style="font-weight: 800; color: #6ee7b7; display: inline-flex; align-items: center; gap: 4px;" title="Jami = Qabul qilingan + Chiquvchi + Transfer oxirida hal qilgan">${t('op_card_grand_total', 'Jami:')} ${isax('chart', '', 'width: 13px; height: 13px;')}</span>
                    <span class="op-stat-val" style="font-size: 15px; font-weight: 900; color: #34d399;" title="Jami = Qabul qilingan + Chiquvchi + Transfer oxirida hal qilgan">${grandTotal} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_desktop_agent', 'Desktop Agent:')}</span>
                    <span class="op-stat-val" style="font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'}; ${op.agentConnected ? 'box-shadow: 0 0 6px #10b981;' : ''}"></span>
                        <span style="color: ${op.agentConnected ? 'var(--success)' : 'var(--text-dim)'};">${op.agentConnected ? t('op_card_agent_active', 'Faol') : t('op_card_agent_off', "O'chiq")}</span>
                        ${op.agentConnected ? `<span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_desktop_name', 'Desktop nomi:')}</span>
                    <span class="op-stat-val" style="font-size: 11px; font-weight: 600; color: ${op.agentHostname ? '#93c5fd' : 'var(--text-dim)'}; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${op.agentHostname || t('op_card_unknown_host', 'Aniqlanmagan')}">
                        ${op.agentHostname || '—'}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_accepted', 'Qabul qilingan:')}</span>
                    <span class="op-stat-val" style="color: var(--success); font-weight: 700;">${answered} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_outbound', 'Chiquvchi:')}</span>
                    <span class="op-stat-val" style="color: ${outbound > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">${outbound} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_missed', "O'tkazib yuborilgan:")}</span>
                    <span class="op-stat-val" style="color: ${missed > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-weight: 700;">${missed} ${t('unit_item', 'ta')}</span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_total_talk', 'Umumiy suhbat:')}</span>
                    <span class="op-stat-val" style="font-weight: 700; color: ${op.totalDurationSec > 7200 ? '#fcd34d' : 'var(--text-main)'};">
                        ${formatSeconds(op.totalDurationSec || 0)} ${op.totalDurationSec > 7200 ? '🔥' : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>${t('op_card_avg_talk', "O'rtacha suhbat:")}</span>
                    <span class="op-stat-val">${formatSeconds(op.avgDurationSec || 0)}</span>
                </div>
            </div>
        `;
    }).join('');

    // Update Summary badges
    const elReady = document.getElementById('tabOpCountReady');
    const elAgent = document.getElementById('tabOpCountAgent');
    const elAns = document.getElementById('tabOpTotalAnswered');
    const elOut = document.getElementById('tabOpTotalOutbound');
    const elMiss = document.getElementById('tabOpTotalMissed');

    if (elReady) elReady.innerText = `${operators.length} ${t('unit_item', 'ta')}`;
    if (elAgent) elAgent.innerText = `${countAgentOnline} ${t('unit_item', 'ta')}`;
    if (elAns) elAns.innerText = `${totalAns} ${t('unit_item', 'ta')}`;
    if (elOut) elOut.innerText = `${totalOutbound} ${t('unit_item', 'ta')}`;
    if (elMiss) elMiss.innerText = `${totalMissed} ${t('unit_item', 'ta')}`;

    // Asosiy sahifadagi (Dashboard) O'tkazib yuborilgan (Missed) KPI kartochkasini ham sinxronlashtirish
    const elKpiMissed = document.getElementById('kpiMissed');
    if (elKpiMissed) {
        elKpiMissed.innerText = totalMissed;
    }

    // Operatorlar bo'yicha grafikni 3CX agent ma'lumotlari bilan yangilash (animatsiyasiz tezkor)
    if (operatorChart && sortedOps.length > 0) {
        operatorChart.data.labels = sortedOps.map(o => getCleanOperatorName(o.realName || o.name, o.id));
        operatorChart.data.datasets[0].data = sortedOps.map(o => o.answered || 0);
        if (operatorChart.data.datasets[1]) {
            operatorChart.data.datasets[1].data = sortedOps.map(o => o.outbound || 0);
        }
        if (operatorChart.data.datasets[2]) {
            operatorChart.data.datasets[2].data = sortedOps.map(o => o.missed || 0);
        }
        operatorChart.update('none');
    }
}

async function loadTabOperatorLogs(opId, page = 1) {
    const container = document.getElementById('tabOperatorLogsContainer');
    const totalEl = document.getElementById('tabOperatorLogsTotal');
    if (!container) return;

    tabOperatorLogsPage = page;
    container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            <div class="spinner" style="margin: 0 auto 12px;"></div>
            ${t('logs_tab_loading', '3CX Desktop Agent jurnali yuklanmoqda...')}
        </div>
    `;

    try {
        const todayStr = getTodayDateString();
        const activeDate = currentSelectedDate || todayStr;
        const dateParam = (activeDate === todayStr) ? 'today' : activeDate;
        let url = `/api/agent/logs?page=${page}&limit=${tabOperatorLogsLimit}&date=${encodeURIComponent(dateParam)}`;
        if (opId) url += `&operatorId=${encodeURIComponent(opId)}`;

        const res = await fetch(url);
        const json = await res.json();

        if (totalEl) totalEl.innerText = tf('logs_total_records', { n: json.total || 0 }, `Jami qaydlar: ${json.total || 0} ta`);

        if (!json.data || json.data.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-dim); background: rgba(0,0,0,0.2); border-radius: var(--radius-sm);">
                    <div style="font-size: 32px; margin-bottom: 8px;">📭</div>
                    ${t('logs_tab_empty', "3CX Desktop Agent tomonidan ushbu operator bo'yicha hali yangi qo'ng'iroq qayd etilmagan.")}
                </div>
                <div style="padding: 12px 16px; border-top: 1px solid var(--border-color); font-size: 13px; color: var(--text-muted); font-weight: 600;">
                    ${t('logs_total_records_zero', 'Jami qaydlar: 0 ta')}
                </div>
            `;
            return;
        }

        const rowsHtml = json.data.map((r, index) => {
            const rowNum = (page - 1) * tabOperatorLogsLimit + index + 1;
            const op = currentOperators.find(o => String(o.id) === String(r.operator_id));
            // op.name serverdan allaqachon "Ibrohim (116)" shaklida keladi —
            // ustiga yana (${op.id}) qo'shilsa "Ibrohim (116) (116)" bo'lib qoladi.
            // Shuning uchun toza ismni (realName) ishlatamiz.
            const opDisplay = op ? `${op.realName || op.name}` : `Ext: ${r.operator_id}`;

            let typeBadge = '';
            const statusKey = r.status || r.event_type;
            const dur = parseInt(r.duration_sec || 0, 10);

            const isDialled = statusKey === 'OUTBOUND' || statusKey === 'DIALLED' || r.category_3cx === 'Dialled';

            if (statusKey === 'REJECT') {
                typeBadge = `<span class="status-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">${isax('close-circle')} ${t('logs_status_denied_deny', 'Rad etildi (Deny)')}</span>`;
            } else if (isDialled) {
                if (dur > 0) {
                    typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-weight: 700;"><i class="badge-dir-icon outbound"></i> ${t('logs_status_outbound_dialled', 'Chiquvchi (Dialled)')}</span>`;
                } else {
                    typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);"><i class="badge-dir-icon outbound"></i> ${t('logs_status_outbound_unconnected', 'Chiquvchi (Ulanmagan)')}</span>`;
                }
            } else if (statusKey === 'MISSED' || dur === 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">${t('logs_status_missed', "⚠️ O'tkazib yuborildi")}</span>`;
            } else if (statusKey === 'ANSWERED' || dur > 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">${isax('call')} ${t('logs_status_answered_phone', 'Javob berildi')}</span>`;
            } else {
                typeBadge = `<span class="status-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);"><i class="badge-dir-icon inbound"></i> ${t('dir_inbound', 'Kiruvchi')}</span>`;
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

        const totalCount = json.total || 0;
        let paginationControls = '';
        if (json.totalPages > 1) {
            paginationControls = `
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="btn-action" ${page <= 1 ? 'disabled style="opacity: 0.4;"' : ''} onclick="loadTabOperatorLogs('${opId || ''}', ${page - 1})">
                        ${t('hist_prev', '⬅ Oldingi')}
                    </button>
                    <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${tf('logs_page', { page: page, total: json.totalPages }, `Sahifa ${page} / ${json.totalPages}`)}</span>
                    <button class="btn-action" ${page >= json.totalPages ? 'disabled style="opacity: 0.4;"' : ''} onclick="loadTabOperatorLogs('${opId || ''}', ${page + 1})">
                        ${t('hist_next', 'Keyingi ➡')}
                    </button>
                </div>
            `;
        }

        const bottomBarHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid var(--border-color); background: rgba(15, 23, 42, 0.4); margin-top: 4px;">
                <div id="tabOperatorLogsTotal" style="font-size: 13px; color: var(--text-muted); font-weight: 600;">
                    ${tf('logs_total_records', { n: totalCount }, `Jami qaydlar: ${totalCount} ta`)}
                </div>
                ${paginationControls}
            </div>
        `;

        container.innerHTML = `
            <div class="table-container" style="overflow-x: auto;">
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
            ${bottomBarHtml}
        `;
    } catch (err) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--danger);">
                ${tf('hist_error', { msg: err.message }, `Xatolik: ${err.message}`)}
            </div>
        `;
    }
}

function refreshOperatorsTabLogs() {
    loadTabOperatorLogs(selectedCompareOpId, tabOperatorLogsPage);
}

/* ============================================================
   ⚙️ SOZLAMALAR VA AGENT OTA UPDATE BOSHQARUVI
   ============================================================ */
function openAgentSettingsModal() {
    const modal = document.getElementById('agentSettingsModal');
    if (modal) {
        modal.style.display = 'flex';
        loadAgentSettings();
    }
}

function closeAgentSettingsModal() {
    const modal = document.getElementById('agentSettingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Global window ga bog'lash
window.openAgentSettingsModal = openAgentSettingsModal;
window.closeAgentSettingsModal = closeAgentSettingsModal;
window.loadAgentSettings = loadAgentSettings;
window.submitNewRelease = submitNewRelease;

async function loadAgentSettings() {
    const tbody = document.getElementById('agentSettingsTableBody');
    const curVerEl = document.getElementById('settingsCurrentVersionBadge');
    const urlEl = document.getElementById('settingsUpdateUrl');

    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">${t('logs_loading', 'Yuklanmoqda...')}</td></tr>`;

    try {
        const res = await fetch('/api/agent/status-all');
        const data = await res.json();

        if (data.releaseConfig) {
            if (curVerEl) curVerEl.innerText = `v${data.releaseConfig.latestVersion}`;
            if (urlEl) urlEl.innerText = data.releaseConfig.updateUrl || '/downloads/agent.exe';
        }

        if (!data.operators || data.operators.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">${t('transfer_no_ops', 'Operatorlar topilmadi')}</td></tr>`;
            return;
        }

        const rows = data.operators.map(op => {
            let statusBadge = '';
            let verBadge = '';

            if (op.agentConnected) {
                if (op.isLatest) {
                    statusBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${t('set_latest', "Eng so'nggi")}</span>`;
                } else {
                    statusBadge = `<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 11px; animation: pulse 2s infinite;">${t('logs_updating', '⚠️ Yangilanmoqda...')}</span>`;
                }
                verBadge = `<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 8px; border-radius: 12px; font-weight: 700; font-size: 11px;">v${op.agentVersion || '1.0.0'}</span>`;
            } else {
                statusBadge = `<span style="color: var(--text-dim); font-size: 11px;">${t('set_offline_agent', "⚪ O'chiq (Offline)")}</span>`;
                verBadge = `<span style="color: var(--text-dim); font-size: 11px;">—</span>`;
            }

            return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                    <td style="padding: 10px 14px; font-weight: 700; color: #fff;">
                        ${op.name}
                    </td>
                    <td style="padding: 10px 14px; color: var(--text-muted);">
                        ${op.exten} <span style="font-size: 11px; color: var(--text-dim);">(${op.ip || '-'})</span>
                    </td>
                    <td style="padding: 10px 14px;">
                        ${op.agentConnected 
                            ? `<span style="color: #10b981; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981;"></span>${t('set_status_active', '🟢 Faol')}</span>` 
                            : `<span style="color: var(--text-dim);">${t('set_status_off', "⚪ O'chiq")}</span>`}
                    </td>
                    <td style="padding: 10px 14px; color: var(--text-dim);">
                        ${op.agentHostname || '—'}
                    </td>
                    <td style="padding: 10px 14px;">
                        ${verBadge}
                    </td>
                    <td style="padding: 10px 14px;">
                        ${statusBadge}
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rows;

        // OTA Yangilanish Loglarini ham yuklab ko'rsatish
        try {
            const logsRes = await fetch('/api/agent/update-logs');
            const logsData = await logsRes.json();
            if (logsData.logs && logsData.logs.length > 0) {
                const otaContainer = document.getElementById('otaLogsContainer');
                if (otaContainer) {
                    otaContainer.innerHTML = '';
                    logsData.logs.slice().reverse().forEach(appendOtaLog);
                }
            }
        } catch (e) {}

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--danger);">${tf('hist_error', { msg: err.message }, `Xatolik: ${err.message}`)}</td></tr>`;
    }
}

async function submitNewRelease() {
    const input = document.getElementById('newReleaseVersionInput');
    const ver = input ? input.value.trim() : '';

    if (!ver) {
        alert(t('set_release_input_required', 'Iltimos, yangi versiya raqamini kiriting! (Masalan: 1.0.1)'));
        return;
    }

    if (!confirm(tf('set_release_confirm', { ver: ver }, `Haqiqatan ham yangi v${ver} versiyasini e'lon qilmoqchimisiz?\n\nBarcha ulangan operatorlarning kompyuteridagi agentlar fon rejimida avtomatik ravishda ushbu versiyaga yangilanadi.`))) {
        return;
    }

    try {
        const res = await fetch('/api/agent/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: ver,
                releaseNotes: `Admin tomonidan ${new Date().toLocaleTimeString()} da e'lon qilindi`
            })
        });
        const result = await res.json();
        if (result.success) {
            alert(`🎉 v${ver} versiyasi muvaffaqiyatli e'lon qilindi!\n\nAgentlar avtomatik yangilanishni boshlaydi.`);
            if (input) input.value = '';
            loadAgentSettings();
        } else {
            alert(t('transfer_error_prefix', 'Xatolik: ') + (result.error || t('unknown_error', "Noma'lum xatolik")));
        }
    } catch (err) {
        alert(`Server bilan aloqa xatoligi: ${err.message}`);
    }
}

/* ==========================================================================
   Date Filtering & Interactive Windows/Fluent Dark Calendar Logic
   ========================================================================== */

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const monthName = getMonthName(m - 1);
    return `${d}-${monthName}, ${y}`;
}

function toggleCalendarPopup(e) {
    if (e) e.stopPropagation();
    const popup = document.getElementById('fluentCalendarPopup');
    const triggerBtn = document.getElementById('calTriggerBtn');
    if (!popup) return;
    const isHidden = popup.style.display === 'none' || !popup.style.display;
    popup.style.display = isHidden ? 'block' : 'none';
    if (triggerBtn) triggerBtn.classList.toggle('active', isHidden);
    if (isHidden) {
        updateCalendarClock();
        const todayStr = getTodayDateString();
        const activeDate = currentSelectedDate || todayStr;
        const nativeInput = document.getElementById('calDateNativeInput');
        if (nativeInput) nativeInput.value = activeDate;
        const displayEl = document.getElementById('calSelectedDisplay');
        if (displayEl) {
            displayEl.innerText = (activeDate === todayStr)
                ? tf('date_today_paren', { date: formatDateDisplay(todayStr) }, `Bugun (${formatDateDisplay(todayStr)})`)
                : formatDateDisplay(activeDate);
        }
        renderCalendarMatrix();
    }
}
window.toggleCalendarPopup = toggleCalendarPopup;

function onNativeDateChanged(val, e) {
    if (e) e.stopPropagation();
    if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        selectDate(val);
    }
}
window.onNativeDateChanged = onNativeDateChanged;

function closeCalendarPopup(e) {
    if (e) e.stopPropagation();
    const popup = document.getElementById('fluentCalendarPopup');
    const triggerBtn = document.getElementById('calTriggerBtn');
    if (popup) popup.style.display = 'none';
    if (triggerBtn) triggerBtn.classList.remove('active');
}
window.closeCalendarPopup = closeCalendarPopup;

function changeCalendarMonth(delta, e) {
    if (e) e.stopPropagation();
    calViewMonth += delta;
    if (calViewMonth < 0) {
        calViewMonth = 11;
        calViewYear--;
    } else if (calViewMonth > 11) {
        calViewMonth = 0;
        calViewYear++;
    }
    renderCalendarMatrix();
}
window.changeCalendarMonth = changeCalendarMonth;

function quickSelectDate(preset, e) {
    if (e) e.stopPropagation();
    if (preset === 'today') {
        const today = getTodayDateString();
        const [y, m] = today.split('-').map(Number);
        calViewYear = y;
        calViewMonth = m - 1;
        selectDate(today);
    } else if (preset === 'yesterday') {
        const now = new Date();
        now.setDate(now.getDate() - 1);
        const yesterdayStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
        const [y, m] = yesterdayStr.split('-').map(Number);
        calViewYear = y;
        calViewMonth = m - 1;
        selectDate(yesterdayStr);
    }
}
window.quickSelectDate = quickSelectDate;

function resetToToday(e) {
    if (e) e.stopPropagation();
    selectDate(getTodayDateString());
}
window.resetToToday = resetToToday;

function refreshCurrentDateData(e) {
    if (e) e.stopPropagation();
    loadDateData(currentSelectedDate || getTodayDateString());
}
window.refreshCurrentDateData = refreshCurrentDateData;

function initDateFilter() {
    const todayStr = getTodayDateString();
    currentSelectedDate = todayStr;

    const [curY, curM] = todayStr.split('-').map(Number);
    calViewYear = curY;
    calViewMonth = curM - 1;

    // Elements
    const triggerBtn = document.getElementById('calTriggerBtn');
    const popup = document.getElementById('fluentCalendarPopup');

    // Live clock update
    updateCalendarClock();
    if (calClockTimer) clearInterval(calClockTimer);
    calClockTimer = setInterval(updateCalendarClock, 1000);

    // Initial label
    const labelEl = document.getElementById('calSelectedLabel');
    if (labelEl) {
        labelEl.innerText = tf('date_today_paren', { date: formatDateDisplay(todayStr) }, `Bugun (${formatDateDisplay(todayStr)})`);
    }

    // Render initial calendar matrix
    renderCalendarMatrix();
    if (typeof updateHistoryScopeUI === 'function') {
        updateHistoryScopeUI();
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (popup && triggerBtn && !popup.contains(e.target) && !triggerBtn.contains(e.target)) {
            popup.style.display = 'none';
            triggerBtn.classList.remove('active');
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popup && triggerBtn) {
            popup.style.display = 'none';
            triggerBtn.classList.remove('active');
        }
    });
}

function updateCalendarClock() {
    const clockEl = document.getElementById('calClock');
    if (!clockEl) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false });
    clockEl.innerText = timeStr;
}

function renderCalendarMatrix() {
    const titleEl = document.getElementById('calMonthTitle');
    const gridEl = document.getElementById('calDaysMatrix');
    if (!titleEl || !gridEl) return;

    titleEl.innerText = `${getMonthName(calViewMonth)} ${calViewYear}`;
    gridEl.innerHTML = '';

    const todayStr = getTodayDateString();
    const activeDateStr = currentSelectedDate || todayStr;

    const firstDay = new Date(calViewYear, calViewMonth, 1);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6; // Monday = 0

    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calViewYear, calViewMonth, 0).getDate();

    // 1. Previous month trailing days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const dayNum = daysInPrevMonth - i;
        const prevMonth = calViewMonth === 0 ? 11 : calViewMonth - 1;
        const prevYear = calViewMonth === 0 ? calViewYear - 1 : calViewYear;
        const fullDateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

        const cell = createDayCell(dayNum, fullDateStr, true, todayStr, activeDateStr);
        gridEl.appendChild(cell);
    }

    // 2. Current month days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const fullDateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const cell = createDayCell(dayNum, fullDateStr, false, todayStr, activeDateStr);
        gridEl.appendChild(cell);
    }

    // 3. Next month leading days (fill up grid to complete weeks)
    const totalCellsSoFar = startDayOfWeek + daysInMonth;
    const remainingCells = (totalCellsSoFar <= 35 ? 35 : 42) - totalCellsSoFar;
    for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
        const nextMonth = calViewMonth === 11 ? 0 : calViewMonth + 1;
        const nextYear = calViewMonth === 11 ? calViewYear + 1 : calViewYear;
        const fullDateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

        const cell = createDayCell(dayNum, fullDateStr, true, todayStr, activeDateStr);
        gridEl.appendChild(cell);
    }
}

function createDayCell(dayNum, fullDateStr, isOtherMonth, todayStr, activeDateStr) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    cell.innerText = dayNum;
    cell.dataset.date = fullDateStr;

    if (isOtherMonth) cell.classList.add('other-month');
    if (fullDateStr === todayStr) cell.classList.add('is-today');
    if (fullDateStr === activeDateStr) cell.classList.add('is-selected');

    cell.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDate(fullDateStr);
    });

    return cell;
}

function selectDate(dateStr) {
    currentSelectedDate = dateStr;
    const todayStr = getTodayDateString();
    const isToday = !dateStr || dateStr === todayStr;

    // Close popup
    const popup = document.getElementById('fluentCalendarPopup');
    const triggerBtn = document.getElementById('calTriggerBtn');
    if (popup) popup.style.display = 'none';
    if (triggerBtn) triggerBtn.classList.remove('active');

    // Update label and popup display
    const labelEl = document.getElementById('calSelectedLabel');
    const displayEl = document.getElementById('calSelectedDisplay');
    const nativeInput = document.getElementById('calDateNativeInput');
    const formattedText = isToday ? tf('date_today_paren', { date: formatDateDisplay(dateStr) }, `Bugun (${formatDateDisplay(dateStr)})`) : formatDateDisplay(dateStr);

    if (labelEl) labelEl.innerText = formattedText;
    if (displayEl) displayEl.innerText = formattedText;
    if (nativeInput) nativeInput.value = dateStr;

    // Update quick buttons
    const todayBtn = document.getElementById('btnQuickToday');
    const yestBtn = document.getElementById('btnQuickYesterday');
    const now = new Date();
    now.setDate(now.getDate() - 1);
    const yesterdayStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);

    if (todayBtn) todayBtn.classList.toggle('active', isToday);
    if (yestBtn) yestBtn.classList.toggle('active', dateStr === yesterdayStr);

    // Update mode badge
    const badgeEl = document.getElementById('calModeBadge');
    const modeText = document.getElementById('calModeText');
    const backTodayBtn = document.getElementById('btnBackToday');
    const hintEl = document.getElementById('calStatusHint');

    if (badgeEl && modeText) {
        if (isToday) {
            badgeEl.className = 'cal-mode-badge live';
            modeText.innerText = 'Jonli (Real-time)';
            if (backTodayBtn) backTodayBtn.style.display = 'none';
            if (hintEl) hintEl.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('flash', '', 'width: 12px; height: 12px;')} Real-time jonli monitoring faol</span>`;
        } else {
            badgeEl.className = 'cal-mode-badge archive';
            modeText.innerText = `Arxiv: ${dateStr}`;
            if (backTodayBtn) backTodayBtn.style.display = 'inline-block';
            if (hintEl) hintEl.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('flash', '', 'width: 12px; height: 12px;')} ${dateStr} sanasi hisoboti ko'rsatilmoqda</span>`;
        }
    }

    // Sync view year/month
    const [y, m] = dateStr.split('-').map(Number);
    calViewYear = y;
    calViewMonth = m - 1;
    renderCalendarMatrix();

    if (typeof updateHistoryScopeUI === 'function') {
        historyDateScope = 'today';
        updateHistoryScopeUI();
    }

    // Load data for this date
    loadDateData(dateStr);
}
window.selectDate = selectDate;

let dateFilterLoadingTimer = null;

function setDateFilterLoading(isLoading, targetDate = '') {
    const progressBar = document.getElementById('calProgressBar');
    const refreshBtn = document.getElementById('calRefreshBtn');
    const refreshText = document.getElementById('calRefreshText');
    const statusHint = document.getElementById('calStatusHint');
    const kpiGrid = document.querySelector('.kpi-grid');
    const tabOpGrid = document.getElementById('tabOperatorsGrid');
    const tabOpBadges = [
        document.getElementById('tabOpCountReady'),
        document.getElementById('tabOpCountAgent'),
        document.getElementById('tabOpTotalAnswered'),
        document.getElementById('tabOpTotalMissed')
    ];

    if (dateFilterLoadingTimer) {
        clearTimeout(dateFilterLoadingTimer);
        dateFilterLoadingTimer = null;
    }

    if (isLoading) {
        if (progressBar) progressBar.style.display = 'block';
        if (refreshBtn) {
            refreshBtn.classList.add('is-loading');
            refreshBtn.disabled = true;
        }
        if (refreshText) refreshText.innerText = t('logs_loading', 'Yuklanmoqda...');
        if (statusHint) {
            statusHint.innerHTML = `<span class="cal-loading-badge"><span class="fluent-spinner"></span> ${t('datefilter_loading', "Serverdan ma'lumot yuklanmoqda...")}</span>`;
        }
        if (kpiGrid) kpiGrid.classList.add('is-loading');

        // Watchdog xavfsizlik: tarmoq qotib qolganda ham cheksiz qolmasligi uchun (30 soniya)
        dateFilterLoadingTimer = setTimeout(() => {
            setDateFilterLoading(false, targetDate);
        }, 30000);
    } else {
        if (progressBar) progressBar.style.display = 'none';
        if (refreshBtn) {
            refreshBtn.classList.remove('is-loading');
            refreshBtn.disabled = false;
        }
        if (refreshText) refreshText.innerText = t('srv_refresh_btn', 'Yangilash');
        if (kpiGrid) {
            kpiGrid.classList.remove('is-loading');
            kpiGrid.querySelectorAll('h3').forEach(el => {
                el.classList.remove('number-pop');
                void el.offsetWidth; // trigger reflow
                el.classList.add('number-pop');
            });
        }
        if (tabOpGrid) {
            tabOpGrid.classList.remove('is-loading');
        }
        tabOpBadges.forEach(el => {
            if (el) {
                el.classList.remove('number-pop');
                void el.offsetWidth;
                el.classList.add('number-pop');
            }
        });
        if (statusHint) {
            const isToday = !targetDate || targetDate === getTodayDateString();
            statusHint.innerHTML = `<span style="color: #34d399; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">${isax('tick-circle')} ${tf('srv_data_loaded', { date: isToday ? t('date_today', 'Bugun') : targetDate }, `Ma'lumotlar yuklandi (${isToday ? 'Bugun' : targetDate})`)}</span>`;
            setTimeout(() => {
                if (statusHint && statusHint.innerText.includes('yuklandi')) {
                    statusHint.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('flash', '', 'width: 12px; height: 12px;')} ${isToday ? t('datefilter_live', 'Real-time jonli monitoring faol') : tf('datefilter_report', { date: targetDate }, `${targetDate} sanasi hisoboti`)}</span>`;
                }
            }, 3000);
        }
    }
}
window.setDateFilterLoading = setDateFilterLoading;

async function loadDateData(dateStr) {
    const isToday = !dateStr || dateStr === getTodayDateString();
    const urlDateParam = isToday ? '' : `?date=${encodeURIComponent(dateStr)}`;

    setDateFilterLoading(true, dateStr);

    try {
        const activeTab = document.documentElement.getAttribute('data-tab') || 'dashboard';

        if (activeTab === 'operators') {
            // 1. Agar Operatorlar tabi ochiq bo'lsa
            await Promise.all([
                typeof loadTabAgentOperators === 'function' ? loadTabAgentOperators(dateStr) : Promise.resolve(),
                typeof loadTabOperatorLogs === 'function' ? loadTabOperatorLogs(selectedTabAgentOpId, 1) : Promise.resolve(),
                fetch(`/api/stats${urlDateParam}`).then(r => r.json()).then(s => { if (s) updateStatsUI(s); }).catch(() => {}),
                fetch(`/api/operators${urlDateParam}`).then(r => r.json()).then(o => { if (o) renderOperators(o); }).catch(() => {})
            ]);
        } else if (activeTab === 'history') {
            // 2. Qo'ng'iroqlar tarixi tabi
            if (typeof loadHistoryPage === 'function') {
                await loadHistoryPage(1, historySearchQuery);
            }
        } else if (activeTab === 'explorer') {
            // 3. Audio Explorer
            if (typeof loadExplorerPath === 'function') {
                await loadExplorerPath(typeof currentPath !== 'undefined' ? currentPath : '');
            }
        } else {
            // 4. Asosiy Dashboard: barcha ma'lumotlar to'liq kelguncha kutish
            const [statsRes, opRes] = await Promise.all([
                fetch(`/api/stats${urlDateParam}`).then(r => r.json()).catch(() => null),
                fetch(`/api/operators${urlDateParam}`).then(r => r.json()).catch(() => []),
                typeof loadTabAgentOperators === 'function' ? loadTabAgentOperators(dateStr).catch(() => {}) : Promise.resolve()
            ]);
            if (statsRes) updateStatsUI(statsRes);
            if (opRes) renderOperators(opRes);
        }
    } catch (err) {
        console.error('loadDateData xatolik:', err);
    } finally {
        setDateFilterLoading(false, dateStr);
    }
}

/* =========================================================================
   SERVER STATUS MODAL & MONITORING
   ========================================================================= */
let srvStatusInterval = null;

function openServerStatusModal() {
    const modal = document.getElementById('serverStatusModal');
    if (!modal) return;
    modal.style.display = 'flex';
    fetchServerStatus();

    // Har 5 soniyada jonli yangilab turish (modal ochiqligida)
    if (srvStatusInterval) clearInterval(srvStatusInterval);
    srvStatusInterval = setInterval(() => {
        if (modal.style.display === 'flex') {
            fetchServerStatus(true);
        } else {
            clearInterval(srvStatusInterval);
        }
    }, 5000);
}

function closeServerStatusModal() {
    const modal = document.getElementById('serverStatusModal');
    if (modal) modal.style.display = 'none';
    if (srvStatusInterval) {
        clearInterval(srvStatusInterval);
        srvStatusInterval = null;
    }
}

async function fetchServerStatus(isBackgroundRefresh = false) {
    const loadingState = document.getElementById('srvLoadingState');
    const loadedState = document.getElementById('srvLoadedState');
    const headerSub = document.getElementById('srvHeaderSub');

    if (!isBackgroundRefresh && loadingState && loadedState) {
        loadingState.style.display = 'block';
        loadedState.style.display = 'none';
    }

    try {
        const res = await fetch('/api/system/status');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (headerSub && data.os) {
            headerSub.textContent = `${data.os.hostname} • ${data.os.platform} (${data.os.arch}) • Uptime: ${data.os.uptimeFormatted}`;
        }

        // PM2
        const pm2El = document.getElementById('srvPm2Badge');
        if (pm2El && data.pm2) {
            if (data.pm2.isManagedByPm2) {
                pm2El.innerHTML = `<span style="color: #10b981;">🟢 PM2 (${data.pm2.name} #${data.pm2.pmId})</span>`;
            } else {
                pm2El.innerHTML = `<span style="color: #f59e0b;" title="Lokalda to'g'ridan-to'g'ri ishlamoqda. Productionda PM2 ishlatiladi">🟡 Direct / Dev</span>`;
            }
        }

        // PID, Uptime, Node
        const pidEl = document.getElementById('srvPid');
        if (pidEl && data.process) pidEl.textContent = `PID ${data.process.pid}`;

        const uptimeEl = document.getElementById('srvUptime');
        if (uptimeEl && data.process) uptimeEl.textContent = data.process.uptimeFormatted || '--';

        const nodeEl = document.getElementById('srvNodeVer');
        if (nodeEl && data.process) nodeEl.textContent = data.process.nodeVersion || '--';

        // CPU
        const cpuPercentEl = document.getElementById('srvCpuPercent');
        const cpuBarEl = document.getElementById('srvCpuBar');
        const cpuModelEl = document.getElementById('srvCpuModel');
        if (data.os && data.os.cpu) {
            const cpuPct = data.os.cpu.usagePercent || 0;
            if (cpuPercentEl) cpuPercentEl.textContent = `${cpuPct}%`;
            if (cpuBarEl) cpuBarEl.style.width = `${Math.min(100, Math.max(2, cpuPct))}%`;
            if (cpuModelEl) cpuModelEl.textContent = `(${data.os.cpu.cores} yadro, ${data.os.cpu.speedMHz}MHz)`;
        }

        // RAM
        const ramPercentEl = document.getElementById('srvRamPercent');
        const ramBarEl = document.getElementById('srvRamBar');
        const ramDetailEl = document.getElementById('srvRamDetail');
        if (data.os && data.os.memory) {
            const ramPct = data.os.memory.usedPercent || 0;
            if (ramPercentEl) ramPercentEl.textContent = `${ramPct}%`;
            if (ramBarEl) ramBarEl.style.width = `${Math.min(100, Math.max(2, ramPct))}%`;
            if (ramDetailEl) ramDetailEl.textContent = `(${data.os.memory.usedFormatted} / ${data.os.memory.totalFormatted})`;
        }

        // DISK
        const diskPercentEl = document.getElementById('srvDiskPercent');
        const diskBarEl = document.getElementById('srvDiskBar');
        const diskDetailEl = document.getElementById('srvDiskDetail');
        if (data.disk) {
            const diskPct = data.disk.usedPercent || 0;
            if (diskPercentEl) diskPercentEl.textContent = `${diskPct}%`;
            if (diskBarEl) diskBarEl.style.width = `${Math.min(100, Math.max(2, diskPct))}%`;
            if (diskDetailEl) diskDetailEl.textContent = tf('srv_disk_detail', { used: data.disk.usedFormatted, free: data.disk.freeFormatted, total: data.disk.totalFormatted }, `(${data.disk.usedFormatted} band / ${data.disk.freeFormatted} bo'sh - Jami ${data.disk.totalFormatted})`);

            // Jismoniy disk (Physical Drive) ma'lumotlari
            const physBadge = document.getElementById('srvPhysicalDiskTypeBadge');
            const physModel = document.getElementById('srvPhysicalDiskModel');
            if (data.disk.physical) {
                if (physBadge) {
                    const isHdd = data.disk.physical.type === 'HDD';
                    physBadge.textContent = isHdd ? `HDD (${data.disk.physical.rpm || '7200 RPM'})` : t('srv_disk_ssd', 'SSD (Tezkor)');
                    physBadge.style.background = isHdd ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)';
                    physBadge.style.color = isHdd ? '#fbbf24' : '#10b981';
                    physBadge.style.borderColor = isHdd ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)';
                }
                if (physModel) {
                    physModel.textContent = `${data.disk.physical.model} • ${data.disk.physical.sizeFormatted || '1 TB'}`;
                }
            }

            // Issabel PBX & Ovozlar xotirasi (Audio Storage)
            const audioContainer = document.getElementById('srvAudioDiskContainer');
            const audioDetailEl = document.getElementById('srvAudioDiskDetail');
            const audioPercentEl = document.getElementById('srvAudioDiskPercent');
            const audioBarEl = document.getElementById('srvAudioDiskBar');
            if (data.disk.audioStorage) {
                const aud = data.disk.audioStorage;
                if (audioContainer) audioContainer.style.display = 'block';
                if (audioDetailEl) audioDetailEl.textContent = tf('srv_disk_detail', { used: aud.usedFormatted, free: aud.freeFormatted, total: aud.totalFormatted }, `(${aud.usedFormatted} band / ${aud.freeFormatted} bo'sh - Jami ${aud.totalFormatted})`);
                if (audioPercentEl) audioPercentEl.textContent = `${aud.usedPercent}%`;
                if (audioBarEl) audioBarEl.style.width = `${Math.min(100, Math.max(2, aud.usedPercent))}%`;
            }
        }

        // SERVICES
        const servicesList = document.getElementById('srvServicesList');
        if (servicesList && data.services) {
            servicesList.innerHTML = Object.entries(data.services).map(([key, srv]) => {
                const isOnline = srv.connected;
                const statusColor = isOnline ? '#10b981' : '#ef4444';
                const statusText = isOnline ? 'ONLINE' : 'OFFLINE';
                const icon = isOnline ? '🟢' : '🔴';

                return `
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <div style="font-size: 12px; font-weight: 600; color: #fff;">${srv.name}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${key.toUpperCase()} protokol</div>
                        </div>
                        <span style="font-size: 11px; font-weight: 700; color: ${statusColor}; background: ${isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 3px 8px; border-radius: 6px; border: 1px solid ${statusColor}44;">
                            ${icon} ${statusText}
                        </span>
                    </div>
                `;
            }).join('');
        }

        // PROXMOX VMS
        const vmsList = document.getElementById('srvVmsList');
        if (vmsList && Array.isArray(data.vms)) {
            vmsList.innerHTML = data.vms.map(vm => {
                const isRunning = vm.status === 'running';
                const statusColor = isRunning ? '#10b981' : '#ef4444';
                const statusText = isRunning ? 'ISHLAMOQDA' : (vm.status === 'stopped' ? 'TO\'XTATILGAN' : vm.status.toUpperCase());
                const icon = isRunning ? '🟢' : '🔴';

                const actionBtn = isRunning
                    ? `<button onclick="triggerVmAction(${vm.id}, 'stop')" class="btn-action" style="padding: 4px 10px; font-size: 11px; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;">${isax('pause', '', 'width: 12px; height: 12px;')} To'xtatish</button>`
                    : `<button onclick="triggerVmAction(${vm.id}, 'start')" class="btn-action" style="padding: 4px 10px; font-size: 11px; background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4); color: #86efac; display: inline-flex; align-items: center; gap: 4px;">${isax('play', '', 'width: 12px; height: 12px;')} Yoqish</button>`;

                return `
                    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <div>
                            <div style="font-size: 13px; font-weight: 700; color: #fff;">${vm.name} <span style="font-size: 11px; color: #60a5fa;">(VM ${vm.id})</span></div>
                            <div style="font-size: 11px; color: var(--text-muted);">${vm.desc || ''}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 11px; font-weight: 700; color: ${statusColor}; background: ${isRunning ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 3px 8px; border-radius: 6px; border: 1px solid ${statusColor}44;">
                                ${icon} ${statusText}
                            </span>
                            ${actionBtn}
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (loadingState) loadingState.style.display = 'none';
        if (loadedState) loadedState.style.display = 'flex';
    } catch (err) {
        console.error('Server status olishda xatolik:', err);
        if (headerSub) headerSub.textContent = t('transfer_error_prefix', 'Xatolik: ') + err.message;
        if (loadingState) {
            loadingState.innerHTML = `<div style="color: #ef4444; padding: 20px;">Server holatini olib bo'lmadi: ${err.message}</div>`;
        }
    }
}

async function triggerVmRecovery() {
    const btn = document.getElementById('btnRecoverVms');
    const logBox = document.getElementById('srvVmLogBox');
    if (!confirm("Diqqat! Proxmox LVM thin pool tiklanadi va Kerio Control (200) hamda Issabel PBX (101) virtual mashinalari ishga tushiriladi.\n\nTasdiqlaysizmi?")) {
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 4px;">${isax('timer')} Bajarilmoqda...</span>`;
    }
    if (logBox) {
        logBox.style.display = 'block';
        logBox.textContent = `[${new Date().toLocaleTimeString()}] LVM tiklash va VMlarni yoqish so'rovi yuborildi. Iltimos, kuting (bu 5-15 soniya vaqt olishi mumkin)...`;
    }

    try {
        const res = await fetch('/api/system/vms/recover', { method: 'POST' });
        const data = await res.json();
        if (logBox) {
            logBox.textContent = data.output || JSON.stringify(data, null, 2);
        }
        if (data.success) {
            if (typeof showNotification === 'function') {
                showNotification('Kerio va Issabel VMlari muvaffaqiyatli ishga tushirildi!', 'success');
            } else {
                alert('Kerio va Issabel VMlari muvaffaqiyatli ishga tushirildi!');
            }
        } else {
            alert(t('transfer_error_prefix', 'Xatolik: ') + (data.error || t('unknown_error', "Noma'lum xatolik")));
        }
        await fetchServerStatus(true);
    } catch (err) {
        if (logBox) logBox.textContent += `\n${t('srv_request_error', "❌ So'rov yuborishda xatolik: ")}${err.message}`;
        alert(t('srv_connect_error', 'Serverga ulanishda xatolik: ') + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `${isax('flash', '', 'width: 14px; height: 14px;')} Svet o'chib yonganda: 1-Bosishda LVM Fix + VMlarni Yoqish`;
        }
    }
}

async function triggerVmAction(vmid, action) {
    const actName = action === 'start' ? 'ishga tushirish' : 'to\'xtatish';
    if (!confirm(`VM ${vmid} ni ${actName}ni tasdiqlaysizmi?`)) return;

    try {
        const res = await fetch(`/api/system/vms/${vmid}/${action}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            await fetchServerStatus(true);
        } else {
            alert(t('transfer_error_prefix', 'Xatolik: ') + (data.error || t('unknown_error', "Noma'lum xatolik")));
        }
    } catch (err) {            alert(t('transfer_error_prefix', 'Xatolik: ') + err.message);
    }
}

// Language change reactive listener — tilni o'zgartirganda ochiq jadval va operatorlarni qayta render qilish
window.addEventListener('languageChanged', () => {
    // 1. Grafiklarni (Chart.js) yangi tilga moslash
    try {
        if (typeof callVolumeChart !== 'undefined' && callVolumeChart && callVolumeChart.data && callVolumeChart.data.datasets) {
            if (callVolumeChart.data.datasets[0]) callVolumeChart.data.datasets[0].label = t('chart_series_inbound', 'Jami Kiruvchi (Inbound)');
            if (callVolumeChart.data.datasets[1]) callVolumeChart.data.datasets[1].label = t('chart_series_answered', 'Javob berilgan (Answered)');
            callVolumeChart.update();
        }
        if (typeof operatorChart !== 'undefined' && operatorChart && operatorChart.data && operatorChart.data.datasets) {
            if (operatorChart.data.datasets[0]) operatorChart.data.datasets[0].label = t('chart_series_accepted', 'Qabul qilingan (Answered)');
            if (operatorChart.data.datasets[1]) operatorChart.data.datasets[1].label = t('chart_series_outbound', 'Chiquvchi (Outbound)');
            if (operatorChart.data.datasets[2]) operatorChart.data.datasets[2].label = t('chart_series_missed', "O'tkazib yuborilgan");
            operatorChart.update();
        }
    } catch (e) {}

    // 2. Ochiq detail modal jadvalini qayta chizish
    const modal = document.getElementById('detailModal');
    if (modal && modal.style.display !== 'none') {
        if (typeof renderDetailTableBody === 'function' && detailState && detailState.rawCalls && detailState.rawCalls.length > 0) {
            renderDetailTableBody();
        }
        if (typeof renderOperatorSummaryPills === 'function' && detailState && detailState.currentOp) {
            renderOperatorSummaryPills();
        }
    }

    // 3. Operatorlar, navbat, liniyalar va jadvallarni yangi tilga moslash
    try {
        if (typeof renderActiveConversations === 'function' && currentConversations) {
            renderActiveConversations(currentConversations);
        }
        updateAmiStatus(lastAmiConnected);
        updateSftpStatus(lastSftpConnected);
        if (typeof renderTabAgentOperators === 'function' && tabAgentOperatorsData && tabAgentOperatorsData.length > 0) {
            lastTabOpsFingerprint = '';
            renderTabAgentOperators(tabAgentOperatorsData);
        }
        if (typeof renderQueues === 'function' && currentQueues) renderQueues(currentQueues);
        if (currentHistoryData && currentHistoryData.length > 0) {
            if (historyDataSource === 'agent') renderAgentHistoryTable(currentHistoryData);
            else renderServerHistoryTable(currentHistoryData);
        }
        if (typeof updateHistoryScopeUI === 'function') updateHistoryScopeUI();
        if (typeof applyDashboardRecentFilters === 'function') applyDashboardRecentFilters();
        if (typeof renderCalendarMatrix === 'function') renderCalendarMatrix();
        if (typeof renderExportRangeCalendar === 'function') {
            const expCalModal = document.getElementById('exportModal');
            if (expCalModal && expCalModal.style.display !== 'none') {
                renderExportRangeCalendar();
                updateExportRangeBadge();
            }
        }
    } catch (e) {}
});

// ============================
// QUEUE INFO: Asterisk Navbat Taqqoslash (Vertical Bar Chart + RAM +/-)
// ============================
let _queueInfoModalOpen = false;
let _queueInfoFilter = 'all'; // 'all' | 'active'
let _queueOperatorGroup = 'main'; // 'main' (100-199) | 'secondary' (200+) | 'all'
let _queueDbSyncEnabled = true;

async function fetchQueueSyncSettings() {
    try {
        const res = await fetch('/api/queue/sync-settings');
        const data = await res.json();
        if (data && data.success && data.enabled !== undefined) {
            _queueDbSyncEnabled = Boolean(data.enabled);
            updateQueueSyncSwitchUI(_queueDbSyncEnabled);
        }
    } catch (e) {
        console.warn('fetchQueueSyncSettings xatolik:', e);
    }
}

async function toggleQueueDbSync(enabled) {
    _queueDbSyncEnabled = Boolean(enabled);
    updateQueueSyncSwitchUI(_queueDbSyncEnabled);
    try {
        const res = await fetch('/api/queue/sync-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: _queueDbSyncEnabled })
        });
        const data = await res.json();
        if (data && data.success && data.enabled !== undefined) {
            _queueDbSyncEnabled = Boolean(data.enabled);
            updateQueueSyncSwitchUI(_queueDbSyncEnabled);
        }
        updateQueueInfoModal();
        updateQueueInfoSummaryBadge();
    } catch (err) {
        console.error('Error toggling queue DB sync:', err);
    }
}

function updateQueueSyncSwitchUI(enabled) {
    const toggle = document.getElementById('toggleQueueDbSync');
    const slider = document.getElementById('sliderQueueDbSync');
    const knob = document.getElementById('knobQueueDbSync');
    const label = document.getElementById('labelQueueDbSync');
    if (toggle) toggle.checked = enabled;
    if (slider) {
        slider.style.backgroundColor = enabled ? '#10b981' : '#334155';
        slider.style.borderColor = enabled ? 'rgba(16, 185, 129, 0.5)' : 'rgba(255, 255, 255, 0.15)';
        slider.style.boxShadow = enabled ? '0 0 8px rgba(16, 185, 129, 0.35)' : 'none';
    }
    if (knob) {
        knob.style.transform = enabled ? 'translateX(18px)' : 'translateX(0px)';
    }
    if (label) {
        label.textContent = enabled ? 'ON' : 'OFF';
        label.style.color = enabled ? '#34d399' : '#94a3b8';
    }
}

async function triggerQueueSyncNow() {
    const btn = document.getElementById('btnQueueSyncNow');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.textContent = '...';
        btn.disabled = true;
    }
    try {
        const res = await fetch('/api/queue/sync-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data && data.success) {
            if (btn) btn.textContent = '✓ Sinxronlandi';
            setTimeout(() => {
                if (btn) {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            }, 1200);
            updateQueueInfoModal();
            updateQueueInfoSummaryBadge();
        } else {
            if (btn) {
                btn.textContent = 'Xato';
                setTimeout(() => { if (btn) { btn.textContent = originalText; btn.disabled = false; } }, 1200);
            }
        }
    } catch (e) {
        console.error('triggerQueueSyncNow xatolik:', e);
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

function openQueueInfoModal() {
    const modal = document.getElementById('queueInfoModal');
    if (!modal) return;
    _queueInfoModalOpen = true;
    modal.style.display = 'flex';
    // Serverdagi joriy DB sinxronizatsiya sozlamasini olish
    fetchQueueSyncSettings();
    // Joriy ekranda tanlangan guruh bo'yicha ochish
    if (typeof currentOperatorGroup !== 'undefined' && ['main', 'secondary', 'all'].includes(currentOperatorGroup)) {
        setQueueOperatorGroup(currentOperatorGroup);
    } else {
        setQueueOperatorGroup(_queueOperatorGroup);
    }
}

function closeQueueInfoModal() {
    const modal = document.getElementById('queueInfoModal');
    if (!modal) return;
    _queueInfoModalOpen = false;
    modal.style.display = 'none';
}

function setQueueOperatorGroup(group) {
    _queueOperatorGroup = group || 'main';
    const btnMain = document.getElementById('btnQueueGroupMain');
    const btnSec = document.getElementById('btnQueueGroupSec');
    const btnAll = document.getElementById('btnQueueGroupAll');
    if (btnMain) {
        btnMain.style.background = _queueOperatorGroup === 'main' ? '#6366f1' : 'transparent';
        btnMain.style.color = _queueOperatorGroup === 'main' ? '#fff' : '#94a3b8';
    }
    if (btnSec) {
        btnSec.style.background = _queueOperatorGroup === 'secondary' ? '#6366f1' : 'transparent';
        btnSec.style.color = _queueOperatorGroup === 'secondary' ? '#fff' : '#94a3b8';
    }
    if (btnAll) {
        btnAll.style.background = _queueOperatorGroup === 'all' ? '#6366f1' : 'transparent';
        btnAll.style.color = _queueOperatorGroup === 'all' ? '#fff' : '#94a3b8';
    }
    updateQueueInfoModal();
}

function setQueueInfoFilter(filter) {
    _queueInfoFilter = filter || 'all';
    const btnAll = document.getElementById('btnQueueFilterAll');
    const btnActive = document.getElementById('btnQueueFilterActive');
    if (btnAll) {
        btnAll.style.background = _queueInfoFilter === 'all' ? 'rgba(99, 102, 241, 0.4)' : 'transparent';
        btnAll.style.color = _queueInfoFilter === 'all' ? '#e0e7ff' : '#94a3b8';
    }
    if (btnActive) {
        btnActive.style.background = _queueInfoFilter === 'active' ? 'rgba(99, 102, 241, 0.4)' : 'transparent';
        btnActive.style.color = _queueInfoFilter === 'active' ? '#e0e7ff' : '#94a3b8';
    }
    updateQueueInfoModal();
}

// Escape tugmasi bosilganda modalni yopish
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _queueInfoModalOpen) {
        closeQueueInfoModal();
    }
});

/**
 * Asterisk navbatidagi (RAM) operator callsTaken qiymatini o'zgartirish (+1, -1 yoki aniq son)
 */
async function adjustQueueCalls(opId, delta = 1, customVal = null, reset = false) {
    try {
        const body = { operatorId: opId, delta: delta };
        if (customVal !== null && customVal !== undefined && !isNaN(customVal)) {
            body.value = Number(customVal);
        }
        if (reset) {
            body.reset = true;
        }

        // Optimistik UI yangilanish — foydalanuvchi darhol son oshganini ko'radi
        const rawOps = window._rawLastOperators || [];
        const targetOp = rawOps.find(o => String(o.id) === String(opId));
        if (targetOp) {
            if (body.value !== undefined) {
                targetOp.callsTaken = Math.max(0, body.value);
            } else {
                targetOp.callsTaken = Math.max(0, (Number(targetOp.callsTaken) || 0) + delta);
            }
            updateQueueInfoModal();
            updateQueueInfoSummaryBadge();
        }

        const res = await fetch('/api/queue/adjust-calls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data && data.success && data.operator) {
            if (targetOp) targetOp.callsTaken = data.operator.callsTaken;
            updateQueueInfoModal();
            updateQueueInfoSummaryBadge();
        }
    } catch (err) {
        console.error('Error adjusting queue calls:', err);
    }
}

/**
 * Aniq qiymat kiritish uchun qulay prompt
 */
function promptCustomQueueCalls(opId, currentVal, opName) {
    const res = prompt(`${opName} (${opId}) uchun callsTaken qiymatini kiriting:\n(Bo'sh qoldirsangiz — qo'lda belgilangan qiymat bekor qilinib, Asterisk haqiqiy hisobiga qaytadi)`, currentVal);
    if (res === null) return; // Bekor qilindi
    const trimmed = res.trim();
    if (trimmed === '') {
        // Bo'sh kiritildi — ofsetni tozalash (Asterisk haqiqiy qiymatiga qaytish)
        if (confirm(`${opName} uchun qo'lda belgilangan qiymat bekor qilinsinmi?\n(Asterisk haqiqiy hisobiga qaytadi)`)) {
            adjustQueueCalls(opId, 0, null, true);
        }
        return;
    }
    const n = parseInt(trimmed, 10);
    if (!isNaN(n) && n >= 0) {
        adjustQueueCalls(opId, 0, n);
    }
}

function updateQueueInfoModal() {
    const container = document.getElementById('queueModalBarsContainer');
    const quickStatsEl = document.getElementById('queueModalQuickStats');
    if (!container) return;

    const rawOps = window._rawLastOperators || [];
    const allOps = rawOps.slice();

    // 100-199 (Asosiy) va 200+ (Zangiota 42) guruhlarga ajratish
    const mainOps = allOps.filter(op => {
        const num = parseInt(op.id, 10);
        return !isNaN(num) && num >= 100 && num < 200;
    });
    const secOps = allOps.filter(op => {
        const num = parseInt(op.id, 10);
        return !isNaN(num) && num >= 200;
    });

    // Guruh tugmalaridagi hisoblagichlarni yangilash
    const elCountMain = document.getElementById('queueGroupCountMain');
    const elCountSec = document.getElementById('queueGroupCountSec');
    const elCountAll = document.getElementById('queueGroupCountAll');
    if (elCountMain) elCountMain.textContent = mainOps.length;
    if (elCountSec) elCountSec.textContent = secOps.length;
    if (elCountAll) elCountAll.textContent = allOps.length;

    // Tanlangan guruh bo'yicha operatorlarni olish
    let groupOps = allOps;
    if (_queueOperatorGroup === 'secondary') {
        groupOps = secOps;
    } else if (_queueOperatorGroup === 'all') {
        groupOps = allOps;
    } else {
        groupOps = mainOps; // Default: 100-199 Asosiy
    }

    // Status bo'yicha filtrlash (Hammasi yoki Faqat Faol)
    let ops = groupOps;
    if (_queueInfoFilter === 'active') {
        ops = groupOps.filter(op => op.presence !== 'offline');
    }

    // Saralash: Faol operatorlar avval (fewestcalls tartibida), so'ng offline operatorlar (fewestcalls tartibida)
    const presenceRank = { 'ready': 1, 'ringing': 2, 'talking': 3, 'paused': 4, 'offline': 5 };
    ops.sort((a, b) => {
        const rA = presenceRank[a.presence] || 5;
        const rB = presenceRank[b.presence] || 5;
        const isAOffline = a.presence === 'offline';
        const isBOffline = b.presence === 'offline';
        if (isAOffline !== isBOffline) {
            return isAOffline ? 1 : -1;
        }
        const cA = (a.callsTaken !== null && a.callsTaken !== undefined) ? Number(a.callsTaken) : 0;
        const cB = (b.callsTaken !== null && b.callsTaken !== undefined) ? Number(b.callsTaken) : 0;
        if (cA !== cB) return cA - cB;
        return Number(a.id) - Number(b.id);
    });

    if (ops.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 13px; padding: 50px; width: 100%;">Bu guruhda operatorlar mavjud emas</div>';
        if (quickStatsEl) quickStatsEl.innerHTML = '';
        return;
    }

    // Maksimal son (ustunlar proporsional balandligi uchun)
    const counts = groupOps.map(op => (op.callsTaken !== null && op.callsTaken !== undefined) ? Number(op.callsTaken) : 0);
    const maxCalls = Math.max(1, ...counts);

    // Keyingi bo'sh operator (Next Target) — aynan shu guruhdagi ready holatidagi eng kam callsTaken ga ega operator
    const readyOps = groupOps.filter(op => op.presence === 'ready');
    const minReadyCalls = readyOps.length > 0 ? Math.min(...readyOps.map(o => Number(o.callsTaken) || 0)) : -1;
    const nextTargetOp = readyOps.find(o => (Number(o.callsTaken) || 0) === minReadyCalls);

    // Quick stats subheader
    if (quickStatsEl) {
        const groupTitle = _queueOperatorGroup === 'secondary' ? 'Zangiota 42' : (_queueOperatorGroup === 'all' ? 'Umumiy' : 'Asosiy (100–199)');
        quickStatsEl.innerHTML = `
            <span>Guruh: <b style="color: #c7d2fe;">${groupTitle}</b></span>
            <span>Ko'rsatilmoqda: <b style="color: #f1f5f9;">${ops.length}</b> ta</span>
            <span>Bo'sh (Ready): <b style="color: #34d399;">${readyOps.length}</b> ta</span>
            ${_queueDbSyncEnabled ? `<span style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; padding: 1px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" title="Asterisk RAM sonlari bazadagi bugungi Jami qo'ng'iroqlardan olinmoqda (svet o'chsa ham nollanmaydi)">⚡ DB Sinxron: ON (Bugungi Jami)</span>` : `<span style="background: rgba(148, 163, 184, 0.15); border: 1px solid rgba(148, 163, 184, 0.3); color: #94a3b8; padding: 1px 8px; border-radius: 6px; font-weight: 700;" title="Asterisk xom RAM qiymatlari">Asterisk RAM: Sof</span>`}
            ${nextTargetOp ? `<span style="background: rgba(16, 185, 129, 0.2); padding: 2px 10px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7;">👉 Keyingi navbat: <b>${(nextTargetOp.realName || nextTargetOp.name).replace(/\\s*\\(\\d+\\)\\s*$/, '')}</b> (${nextTargetOp.callsTaken || 0} ta)</span>` : ''}
        `;
    }

    // Holat ranglari va nomlari — "talking" uchun KO'K (Cyan/Sky blue)
    const statusConfig = {
        'ready': {
            label: "Bo'sh",
            color: '#10b981',
            glow: 'rgba(16, 185, 129, 0.4)',
            bgGrad: 'linear-gradient(180deg, #10b981 0%, #047857 100%)',
            cardBg: 'rgba(16, 185, 129, 0.06)',
            border: 'rgba(16, 185, 129, 0.3)'
        },
        'talking': {
            label: "Suhbatda",
            color: '#38bdf8', // KO'K (Cyan/Sky blue neon)
            glow: 'rgba(56, 189, 248, 0.45)',
            bgGrad: 'linear-gradient(180deg, #38bdf8 0%, #0284c7 100%)',
            cardBg: 'rgba(56, 189, 248, 0.08)',
            border: 'rgba(56, 189, 248, 0.35)'
        },
        'ringing': {
            label: "Chalinmoqda",
            color: '#f59e0b',
            glow: 'rgba(245, 158, 11, 0.4)',
            bgGrad: 'linear-gradient(180deg, #f59e0b 0%, #b45309 100%)',
            cardBg: 'rgba(245, 158, 11, 0.06)',
            border: 'rgba(245, 158, 11, 0.3)'
        },
        'paused': {
            label: "Tanaffusda",
            color: '#8b5cf6',
            glow: 'rgba(139, 92, 246, 0.35)',
            bgGrad: 'linear-gradient(180deg, #8b5cf6 0%, #5b21b6 100%)',
            cardBg: 'rgba(139, 92, 246, 0.06)',
            border: 'rgba(139, 92, 246, 0.3)'
        },
        'offline': {
            label: "Offline",
            color: '#64748b',
            glow: 'rgba(100, 116, 139, 0.2)',
            bgGrad: 'linear-gradient(180deg, #475569 0%, #1e293b 100%)',
            cardBg: 'rgba(100, 116, 139, 0.04)',
            border: 'rgba(100, 116, 139, 0.2)'
        }
    };

    const CHART_BAR_MAX_HEIGHT = 170; // px

    let html = '';
    ops.forEach(op => {
        const calls = (op.callsTaken !== null && op.callsTaken !== undefined) ? Number(op.callsTaken) : 0;
        const manualOffset = Number(op.callsTakenOverride || 0); // Qo'lda belgilangan ofset (0 bo'lmasa — qo'lda o'zgartirilgan)
        const name = op.realName || op.name || `Operator ${op.id}`;
        const shortName = name.replace(/\s*\(\d+\)\s*$/, '');
        const st = statusConfig[op.presence] || statusConfig['offline'];
        const isNext = nextTargetOp && String(nextTargetOp.id) === String(op.id);
        const isOffline = op.presence === 'offline';

        // Balandlik hisobi (eng kam 18px bo'lsin, shunda raqam yoki chiziq yaxshi ko'rinadi)
        const barHeightPx = Math.max(18, Math.round((calls / maxCalls) * CHART_BAR_MAX_HEIGHT));

        html += `
        <div style="flex: 0 0 102px; width: 102px; min-width: 102px; max-width: 102px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding: 10px 6px 12px; border-radius: 14px; background: ${isNext ? 'rgba(16, 185, 129, 0.12)' : st.cardBg}; border: 1px solid ${isNext ? 'rgba(16, 185, 129, 0.6)' : st.border}; transition: all 0.25s ease; position: relative; ${isNext ? 'box-shadow: 0 0 20px rgba(16, 185, 129, 0.25);' : ''} ${isOffline ? 'opacity: 0.75;' : ''}">
            
            ${isNext ? `
            <div style="position: absolute; top: -11px; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 10px; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.5); letter-spacing: 0.5px; text-transform: uppercase;">
                ⭐ Keyingi
            </div>` : ''}

            <!-- Calls Taken Number (Katta raqam ustun tepasida) -->
            <div onclick="promptCustomQueueCalls('${op.id}', ${calls}, '${shortName}')" title="Bosing: qiymatni o'zgartirish. Bo'sh qoldirsangiz qo'lda belgilangan qiymat bekor qilinadi" style="cursor: pointer; display: flex; flex-direction: column; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 20px; font-weight: 900; color: ${isNext ? '#34d399' : (manualOffset !== 0 ? '#fbbf24' : (isOffline ? '#94a3b8' : '#f8fafc'))}; font-variant-numeric: tabular-nums; text-shadow: 0 0 10px ${st.glow}; line-height: 1;">
                    ${calls}
                </span>
                <span style="font-size: 9px; color: #94a3b8; font-weight: 600; text-transform: uppercase; margin-top: 2px;">ta</span>
                ${manualOffset !== 0 ? `<span title="Qo'lda belgilangan: ${manualOffset > 0 ? '+' : ''}${manualOffset} (Asterisk xom hisobi ustidan). Bo'sh qiymat kiritsangiz haqiqiy hisobga qaytadi." style="font-size: 8px; font-weight: 800; color: #fbbf24; background: rgba(251, 191, 36, 0.12); border: 1px solid rgba(251, 191, 36, 0.35); border-radius: 6px; padding: 1px 5px; margin-top: 3px;">${isax('edit', '', 'width: 9px; height: 9px;')} ${manualOffset > 0 ? '+' : ''}${manualOffset}</span>` : ''}
            </div>

            <!-- Vertikal Ustun (Bar) -->
            <div style="width: 100%; height: ${CHART_BAR_MAX_HEIGHT}px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 12px; position: relative;">
                <!-- Orqa fon yo'lagi (Track) -->
                <div style="position: absolute; inset: 0 16%; background: rgba(255, 255, 255, 0.04); border-radius: 8px; border: 1px dashed rgba(255, 255, 255, 0.08);"></div>
                
                <!-- Rangli to'ldiruvchi ustun -->
                <div style="width: 58%; height: ${barHeightPx}px; background: ${st.bgGrad}; border-radius: 8px 8px 5px 5px; box-shadow: 0 0 16px ${st.glow}; position: relative; z-index: 2; transition: height 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.25);">
                    <!-- Yuqori yaltirash chizig'i -->
                    <div style="width: 100%; height: 3px; background: rgba(255, 255, 255, 0.6);"></div>
                    <!-- VU-metr uslubidagi ichki segment chiziqlar -->
                    <div style="width: 100%; height: 100%; background: repeating-linear-gradient(0deg, transparent, transparent 6px, rgba(0, 0, 0, 0.2) 6px, rgba(0, 0, 0, 0.2) 8px); pointer-events: none;"></div>
                </div>
            </div>

            <!-- Operator Status Nishoni -->
            <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 6px; padding: 2px 6px; border-radius: 6px; background: rgba(0, 0, 0, 0.35);">
                <span style="width: 7px; height: 7px; border-radius: 50%; background: ${st.color}; box-shadow: 0 0 6px ${st.color};"></span>
                <span style="font-size: 10px; font-weight: 700; color: ${st.color};">${st.label}</span>
            </div>

            <!-- Operator Ismi & Exten -->
            <div style="text-align: center; width: 100%; margin-bottom: 10px;">
                <div style="font-size: 11px; font-weight: 700; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${name}">
                    ${shortName}
                </div>
                <div style="font-size: 10px; color: #94a3b8; font-weight: 600;">
                    ${op.id}
                </div>
            </div>

            <!-- RAM Qiymatini O'zgartirish Tugmalari (+ / -) -->
            <div style="display: flex; align-items: center; gap: 3px; width: 100%; justify-content: center; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.07);">
                <button onclick="adjustQueueCalls('${op.id}', -1)" title="RAM sonini -1 kamaytirish" style="width: 25px; height: 25px; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; font-size: 14px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.3)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.15)'">
                    −
                </button>
                <button onclick="promptCustomQueueCalls('${op.id}', ${calls}, '${shortName}')" title="Aniq son kiritish" style="flex: 1; height: 25px; border-radius: 6px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #c7d2fe; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;" onmouseover="this.style.background='rgba(99, 102, 241, 0.3)'" onmouseout="this.style.background='rgba(99, 102, 241, 0.15)'">
                    ${isax('edit', '', 'width: 13px; height: 13px;')}
                </button>
                <button onclick="adjustQueueCalls('${op.id}', 1)" title="RAM soniga +1 qo'shish" style="width: 25px; height: 25px; border-radius: 6px; background: linear-gradient(135deg, #10b981, #059669); border: 1px solid rgba(16, 185, 129, 0.6); color: #fff; font-size: 14px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                    +
                </button>
            </div>

        </div>
        `;
    });

    container.innerHTML = html;
}

// renderOperators chaqirilganda queue info modal ham yangilansin
const _origRenderOperators = renderOperators;
renderOperators = function(operators) {
    _origRenderOperators(operators);
    if (_queueInfoModalOpen) updateQueueInfoModal();
    updateQueueInfoSummaryBadge();
};

function updateQueueInfoSummaryBadge() {
    const summaryEl = document.getElementById('queueInfoSummary');
    if (!summaryEl) return;
    const rawOps = window._rawLastOperators || [];
    let ops = rawOps.filter(op => op.presence !== 'offline');
    if (ops.length === 0) ops = rawOps.slice();

    ops.sort((a, b) => {
        const cA = (a.callsTaken !== null && a.callsTaken !== undefined) ? Number(a.callsTaken) : 0;
        const cB = (b.callsTaken !== null && b.callsTaken !== undefined) ? Number(b.callsTaken) : 0;
        if (cA !== cB) return cA - cB;
        return Number(a.id) - Number(b.id);
    });

    if (ops.length === 0) {
        summaryEl.textContent = '—';
        return;
    }
    const counts = ops.map(op => (op.callsTaken !== null && op.callsTaken !== undefined) ? Number(op.callsTaken) : 0);
    summaryEl.textContent = counts.join(' · ');
}

// Initialize Application after all components and functions are loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit);
} else {
    runInit();
}

