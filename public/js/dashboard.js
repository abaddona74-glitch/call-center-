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
let latestPieData = [0, 0, 0];

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
    initHeaderClock();

    // Avtomatik har 5 soniyada yangilash (foydalanuvchi bosishi shart emas)
    setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'refresh_channels' }));
        }
    }, 5000);
}

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
    '/history': 'history'
};

const TAB_TITLES = {
    dashboard: "Dashboard | Call Center AI",
    explorer: "Audio Explorer | Call Center AI",
    operators: "Operatorlar | Call Center AI",
    history: "Qo'ng'iroqlar Tarixi | Call Center AI"
};

function switchRoute(tabName, pushState = true) {
    const validTabs = ['dashboard', 'explorer', 'operators', 'history'];
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

    if (TAB_TITLES[target]) {
        document.title = TAB_TITLES[target];
    }

    const canonicalPath = target === 'dashboard' ? '/' : `/${target}`;
    if (pushState && window.location.pathname !== canonicalPath) {
        window.history.pushState({ tab: target }, '', canonicalPath);
    }

    if (target === 'explorer' && explorerFilesData.length === 0) {
        loadExplorerPath('');
    } else if (target === 'history') {
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
                    label: 'Jami Kiruvchi (Inbound)',
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
                    label: 'Javob berilgan (Answered)',
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
                name: 'Qo\'ng\'iroqlar',
                data: [
                    { name: 'Muvaffaqiyatli', y: 1, color: '#10b981', sliced: false, selected: false },
                    { name: 'Navbatdan chiqdi', y: 0, color: '#f59e0b', sliced: false, selected: false },
                    { name: 'Chiquvchi', y: 0, color: '#a855f7', sliced: false, selected: false }
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
                    label: 'Qabul qilingan (Answered)',
                    data: [],
                    backgroundColor: '#10b981',
                    borderRadius: 6
                },
                {
                    label: 'Chiquvchi (Outbound)',
                    data: [],
                    backgroundColor: '#38bdf8',
                    borderRadius: 6
                },
                {
                    label: 'O\'tkazib yuborilgan',
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
                    labels: ['Muvaffaqiyatli', 'Navbatdan chiqdi', 'Chiquvchi'],
                    datasets: [{
                        data: latestPieData,
                        backgroundColor: ['#10b981', '#f59e0b', '#a855f7'],
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
        console.log('✅ WebSocket ulandi');
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
    if (msg.type === 'initial_state') {
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
    } else if (msg.type === 'queue_update') {
        renderQueues(msg.data);
    } else if (msg.type === 'operators_update') {
        const todayStr = getTodayDateString();
        const isArchive = currentSelectedDate && currentSelectedDate !== todayStr;
        if (isArchive) {
            // Arxiv sanada turganda, operatorlarning tanlangan sanadagi answered/missed/duration statistikalarini
            // bugungi jonli hisoblagichlar bilan ustiga yozmaslik kerak!
            // Faqat real-vaqtdagi ulanish (presence, ringingCaller, ip, agentConnected) yangilanadi:
            if (currentOperators && currentOperators.length > 0 && Array.isArray(msg.data)) {
                const freshMap = new Map(msg.data.map(o => [String(o.id), o]));
                currentOperators.forEach(op => {
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
                renderOperators(currentOperators);
            }
        } else {
            renderOperators(msg.data);
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
            }
        } else {
            tabAgentOperatorsData = msg.data;
            renderTabAgentOperators(tabAgentOperatorsData);
        }
    } else if (msg.type === 'agent_ota_log') {
        appendOtaLog(msg.data);
    } else if (msg.type === 'call_hangup') {
        addRecentDashboardRow(msg.data);
        const histTab = document.getElementById('tab-history');
        if (histTab && histTab.classList.contains('active')) {
            loadHistoryPage(historyCurrentPage, historySearchQuery);
        }
    }
}

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

function updateAmiStatus(connected) {
    const badge = document.getElementById('amiStatusBadge');
    const text = document.getElementById('amiStatusText');
    if (connected) {
        badge.className = 'status-pill online';
        text.innerText = 'AMI: Ulangan';
    } else {
        badge.className = 'status-pill offline';
        text.innerText = 'AMI: Uzilgan';
    }
}

function updateSftpStatus(connected) {
    const badge = document.getElementById('sftpStatusBadge');
    const text = document.getElementById('sftpStatusText');
    if (connected) {
        badge.className = 'status-pill online';
        text.innerText = 'SFTP: Faol';
    } else {
        badge.className = 'status-pill offline';
        text.innerText = 'SFTP: Offline';
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

    // Taqsimot ma'lumotlarini saqlash
    latestPieData = [answeredCalls, abandonedCalls, outboundCalls];

    // Update 3D Pie Chart (Highcharts 3D)
    if (callDistributionChart && typeof callDistributionChart.series !== 'undefined' && callDistributionChart.series[0]) {
        if (callDistributionChart.series[0].points) {
            callDistributionChart.series[0].points.forEach(p => {
                if (p && p.slice && p.sliced) p.slice(false);
            });
        }
        const total = answeredCalls + abandonedCalls + outboundCalls;
        if (total === 0) {
            callDistributionChart.series[0].setData([
                { name: 'Kutilmoqda', y: 1, color: '#334155', sliced: false, selected: false }
            ]);
        } else {
            callDistributionChart.series[0].setData([
                { name: 'Muvaffaqiyatli', y: answeredCalls, color: '#10b981', sliced: false, selected: false },
                { name: 'Navbatdan chiqdi', y: abandonedCalls, color: '#f59e0b', sliced: false, selected: false },
                { name: 'Chiquvchi', y: outboundCalls, color: '#a855f7', sliced: false, selected: false }
            ], true, { duration: 600 });
        }
    }

    // Update 2D Donut Chart (Chart.js)
    if (callDistributionChart2D && callDistributionChart2D.data && callDistributionChart2D.data.datasets[0]) {
        callDistributionChart2D.data.datasets[0].data = [answeredCalls, abandonedCalls, outboundCalls];
        callDistributionChart2D.update();
    }
}

// Background Auto-Refresh Polling (Har 5 soniyada yangilab turadi)
setInterval(async () => {
    try {
        if (currentSelectedDate && currentSelectedDate !== getTodayDateString()) {
            return;
        }
        const res = await fetch('/api/stats');
        const stats = await res.json();
        if (stats && !stats.error) {
            updateStatsUI(stats);
        }

        // Agar Operatorlar (3CX Desktop Agent) tabi ochiq bo'lsa, uni ham har 5 soniyada yangilab turish
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
}

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
            filterExplorerFiles(query);
        });
    }
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
        if (data.directories && data.directories.length > 0) {
            if (foldersGrid) {
                foldersGrid.innerHTML = data.directories.map(d => `
                    <div class="folder-card" onclick="loadExplorerPath('${d.path.replace(/\\/g, '/')}', true)">
                        <div class="folder-icon">📁</div>
                        <div class="folder-name">${d.name}</div>
                    </div>
                `).join('');
            }
        } else {
            if (foldersGrid) foldersGrid.innerHTML = '';
        }

        // Render Files
        explorerFilesData = data.files || [];
        renderExplorerFilesTable(explorerFilesData);
    } catch (err) {
        if (filesTbody) {
            filesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 20px;">Xatolik: ${err.message}</td></tr>`;
        }
    }
}

function updateBreadcrumbs(subPath) {
    const container = document.getElementById('explorerBreadcrumbs');
    if (!container) return;
    const parts = subPath ? subPath.split('/').filter(Boolean) : [];

    let html = `<span class="breadcrumb-item ${parts.length === 0 ? 'active' : ''}" onclick="loadExplorerPath('', true)">📁 monitor</span>`;
    
    let accumulated = '';
    parts.forEach((p, idx) => {
        accumulated = accumulated ? `${accumulated}/${p}` : p;
        const isLast = idx === parts.length - 1;
        html += ` <span>/</span> <span class="breadcrumb-item ${isLast ? 'active' : ''}" onclick="loadExplorerPath('${accumulated}', true)">${p}</span>`;
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
            label: '🚫 Bo\'sh (0 soniya)',
            badgeClass: 'badge-danger',
            desc: 'Qo\'ng\'iroq ulanmasdan uzilgan, ovoz yozilmagan'
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
            label: '🤖 Faqat Navbat (Robot)',
            badgeClass: 'badge-warning',
            desc: 'Mijoz faqat navbat robotini eshitgan, operator bilan suhbat bo\'lmagan'
        };
    }

    return {
        isEmpty: false,
        isRobot: false,
        label: '🎧 Suhbat (Human Talk)',
        badgeClass: 'badge-success',
        desc: 'Mijoz va operator o\'rtasidagi haqiqiy suhbat'
    };
}

function estimateAudioDuration(sizeBytes) {
    if (!sizeBytes || sizeBytes <= 44) return "00:00 (Bo'sh)";
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
        filesTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">Qidiruv bo'yicha audio fayllar topilmadi</td></tr>`;
        return;
    }

    if (tableWrapper) {
        tableWrapper.style.display = 'block';
    }

    filesTbody.innerHTML = files.map(file => {
        const fileDate = file.modifyTime ? new Date(file.modifyTime).toLocaleString() : 'Bugun';
        const analysis = classifyAudioFile(file.name, file.size);
        const durationText = estimateAudioDuration(file.size);

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--secondary);">🎵</span>
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
                    <span style="font-family: monospace; font-weight: 600; color: ${analysis.isEmpty ? 'var(--text-muted)' : '#38bdf8'}; font-size: 13px;">
                        ⏱ ${durationText}
                    </span>
                </td>
                <td style="color: var(--text-muted); font-size: 12px;">${fileDate}</td>
                <td>
                    ${analysis.isEmpty ? `
                        <button class="btn-action" style="opacity: 0.5; cursor: not-allowed;" onclick="alert('Ushbu audio fayl bo\\'sh (0 soniya, suhbat bo\\'lmagan)')" title="Yozuv bo'sh">
                            🚫 Bo'sh
                        </button>
                    ` : `
                        <button class="btn-action" onclick="playAudioFile('${file.name}', '${file.path.replace(/\\\\/g, '/')}', ${file.size || 0})">
                            ▶ Eshitish
                        </button>
                    `}
                    <a class="btn-action" href="/api/recordings/stream?file=${encodeURIComponent(file.path)}" download="${file.name}" style="text-decoration: none;">
                        ⬇ Yuklab olish
                    </a>
                </td>
            </tr>
        `;
    }).join('');
}

function filterExplorerFiles(query) {
    let filtered = explorerFilesData;

    if (query) {
        filtered = filtered.filter(f => f.name.toLowerCase().includes(query));
    }

    renderExplorerFilesTable(filtered);
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
    canvas.style.height = '72px';
    canvas.style.cursor = 'pointer';
    canvas.style.display = 'block';
    waveContainer.appendChild(canvas);

    // Canvas o'lchamlari
    const rect = waveContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(300, rect.width || waveContainer.clientWidth || 800);
    const height = 72;
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
        
        const progress = Math.max(0, Math.min(1, curTime / totalDur));
        const playedIndex = Math.floor(progress * barCount);
        const midY = height / 2;

        for (let i = 0; i < barCount; i++) {
            const x = i * totalBarWidth;
            const barH = Math.max(4, currentWaveBars[i] * (height - 8));
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
        const cursorX = progress * width;
        ctx.fillStyle = '#818cf8';
        ctx.fillRect(Math.min(width - 2, cursorX), 0, 2, height);
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
        alert("⚠️ Ushbu audio fayl bo'sh (suhbat bo'lmagan yoki qo'ng'iroq operatorga ulanmasdan uzilgan).");
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

    if (playerFileName) playerFileName.innerText = fileName;

    const subtitle = document.getElementById('playerStatusSubtitle');
    if (subtitle) {
        const sz = (typeof formatBytes === 'function' && sizeBytes) ? formatBytes(sizeBytes) : (sizeBytes ? (Math.round(sizeBytes / 1024) + ' KB') : '');
        subtitle.innerText = sz ? `Fayl hajmi: ${sz} • Yuklanmoqda...` : 'Audio yuklanmoqda...';
        subtitle.style.color = '';
    }

    const btnDownloadCurrent = document.getElementById('btnDownloadCurrentAudio');
    if (btnDownloadCurrent) {
        btnDownloadCurrent.style.display = 'inline-flex';
        btnDownloadCurrent.onclick = () => {
            const a = document.createElement('a');
            a.href = `/api/recordings/stream?file=${encodeURIComponent(filePath)}`;
            a.download = fileName;
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
        }
    }
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
        }
    };

    audio.ontimeupdate = () => {
        if (playerCurrentTime) playerCurrentTime.innerText = formatDuration(audio.currentTime);
    };

    audio.onerror = () => {
        updatePlayerPlayState(false);
        if (subtitle) {
            subtitle.innerText = '⚠️ Ovoz faylini ochib bo\'lmadi yoki suhbat yozuvi mavjud emas';
            subtitle.style.color = '#f87171';
        }
    };

    audio.onplay = () => {
        updatePlayerPlayState(true);
        if (subtitle) {
            subtitle.innerText = 'Audio ijro etilmoqda';
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
            if (subtitle) subtitle.innerText = 'Ijro yakunlandi';
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
    const expBtn = document.querySelector('.nav-tabs a[data-tab="explorer"]');
    if (expBtn) expBtn.click();

    const playerCard = document.getElementById('modernMusicPlayer');
    const audio = getNativeAudio();

    // 1. Avvalgi ijro etilayotgan audioni darhol to'xtatamiz
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
        playerFileName.innerText = callerId ? `📞 ${callerId} (Yuklanmoqda...)` : 'Audio yuklanmoqda...';
    }
    if (playerCurrentTime) playerCurrentTime.innerText = '00:00';
    if (playerDuration) playerDuration.innerText = duration ? formatDuration(duration) : '--:--';

    const subtitle = document.getElementById('playerStatusSubtitle');
    if (subtitle) {
        subtitle.innerText = '⏳ Audio serverdan qidirilmoqda va tayyorlanmoqda...';
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
        btn.innerHTML = '<span>⏳...</span>';
        btn.disabled = true;
    }

    if (!callerId) {
        if (btn) {
            btn.innerHTML = '<span>🔍 Detal</span>';
            btn.disabled = false;
        }
        return;
    }

    const callKey = `${callerId}_${duration}`;
    let resolvedRec = recFile || knownRecordingsCache.get(callKey);

    try {
        if (resolvedRec) {
            const displayName = `📞 ${callerId} (${formatSeconds(duration || 0)})`;
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

            const displayName = `📞 ${callerId} (${formatSeconds(matchedDuration || duration || 0)})`;
            playAudioFile(displayName, matchedRecording, (matchedDuration || duration || 0) * 16000, true);
        } else {
            if (subtitle) {
                subtitle.innerText = '⚠️ Ushbu suhbat uchun audio yozuv topilmadi';
                subtitle.style.color = '#f87171';
            }
            if (playerFileName) playerFileName.innerText = `📞 ${callerId} (Yozuv yo'q)`;
            alert(`⚠️ "${callerId}" raqamiga tegishli audio yozuv topilmadi.`);
        }
    } catch (e) {
        if (subtitle) {
            subtitle.innerText = '⚠️ Yuklashda xatolik yuz berdi';
            subtitle.style.color = '#f87171';
        }
        alert('Audio ochishda xatolik: ' + e.message);
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
                        Hozircha faol suhbatlar yo'q
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
        const isQueue = c.operator === 'Navbatda kutmoqda' || !c.operatorExten;

        let badgeClass = 'badge-warning';
        let badgeText = c.state;

        if (isTalking) {
            badgeClass = 'badge-success';
            badgeText = '🟢 Suhbatda';
        } else if (isQueue) {
            badgeClass = 'badge-warning';
            badgeText = '⏳ Navbatda kutmoqda';
        } else {
            badgeClass = 'badge-info';
            badgeText = '📞 Chaqirilmoqda';
        }

        if (existingCard) {
            // Holat o'zgargan bo'lsa sinflar va yozuvlarni yangilash
            existingCard.className = `compact-channel-card ${isTalking ? 'talking' : 'ringing'}`;
            const badgeEl = existingCard.querySelector('.badge');
            if (badgeEl) {
                badgeEl.className = `badge ${badgeClass}`;
                badgeEl.innerText = badgeText;
            }
            const opEl = existingCard.querySelector('.chan-op span');
            if (opEl) {
                opEl.innerText = `🎧 ${c.operator}`;
            }
        } else {
            // Yangi kelgan suhbat kartasini qo'shish (chapdan silliq kirib keladi)
            const cardEl = document.createElement('div');
            cardEl.className = `compact-channel-card ${isTalking ? 'talking' : 'ringing'} swiping-in`;
            cardEl.setAttribute('data-channel-key', key);
            cardEl.innerHTML = `
                <div class="chan-left">
                    <div class="chan-number">📞 ${formatCallerNumberOrOperator(c.callerId)}</div>
                    <div class="chan-op">
                        <span>🎧 ${c.operator}</span>
                    </div>
                </div>
                <div class="chan-right">
                    <span class="badge ${badgeClass}" style="font-size: 10px; padding: 2px 6px;">
                        ${badgeText}
                    </span>
                    <!-- Transfer / Switch Button -->
                    <button class="btn-action" style="padding: 3px 6px; background: rgba(99, 102, 241, 0.25); border-color: rgba(99, 102, 241, 0.5); color: #818cf8; display: inline-flex; align-items: center; justify-content: center;" onclick="openTransferModal('${c.channel}', '${c.callerId}')" title="Boshqa operatorga yo'naltirish (Switch / Transfer)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="20" y1="7" x2="4" y2="7"></line>
                            <polyline points="10 3 4 7 10 11"></polyline>
                            <line x1="4" y1="17" x2="20" y2="17"></line>
                            <polyline points="14 13 20 17 14 21"></polyline>
                        </svg>
                    </button>
                    <!-- End Call / Hangup Button -->
                    <button class="btn-end-call" onclick="hangupChannel('${c.channel}')" title="Qo'ng'iroqni tugatish (End Call)">
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
            if (c.operator === 'Navbatda kutmoqda' || !c.operatorExten) {
                const alreadyIn = allWaiters.some(w => w.callerId === c.callerId);
                if (!alreadyIn) {
                    allWaiters.push({
                        callerId: c.callerId,
                        position: allWaiters.length + 1,
                        queueName: 'Asosiy Navbat'
                    });
                    totalWaiters++;
                }
            }
        });
    }

    countBadge.innerText = `${totalWaiters} ta`;
    const kpiQueue = document.getElementById('kpiQueueWaiting');
    if (kpiQueue) kpiQueue.innerText = totalWaiters;

    if (allWaiters.length === 0) {
        listEl.innerHTML = `
            <div style="color: var(--text-dim); font-size: 11px; text-align: center; padding: 4px;">
                ${totalWaiters > 0 ? `${totalWaiters} ta mijoz navbatda kutmoqda` : 'Hozircha navbatda kutayotganlar yo\'q'}
            </div>
        `;
        return;
    }

    listEl.innerHTML = allWaiters.map(w => `
        <div class="queue-caller-pill">
            <span style="font-weight: 600; color: #fff;">📞 ${w.callerId}</span>
            <span style="color: #818cf8; font-size: 10px; font-weight: 600;">Navbatda #${w.position || 1}</span>
        </div>
    `).join('');
}

async function hangupChannel(channel) {
    if (!confirm(`Haqiqatan ham ushbu kanalni uzmoqchimisiz?`)) return;

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
                        Hozircha faol suhbatlar yo'q
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
        alert('Uzishda xatolik: ' + e.message);
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
            alert('Operator tanlanmadi!');
            return;
        }

        try {
            btnConfirm.innerText = 'O\'tkazilmoqda...';
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
                alert(`✅ Qo'ng'iroq Operator ${targetExten} ga muvaffaqiyatli o'tkazildi!`);
                closeModal();
            } else {
                alert('Xatolik: ' + (data.error || 'O\'tkazib bo\'lmadi'));
            }
        } catch (err) {
            alert('Transfer xatosi: ' + err.message);
        } finally {
            btnConfirm.innerText = '✓ O\'tkazish';
            btnConfirm.disabled = false;
        }
    });
}

function openTransferModal(channel, callerId) {
    activeTransferChannel = channel;
    const modal = document.getElementById('transferModal');
    const callerDisplay = document.getElementById('transferCallerDisplay');
    const select = document.getElementById('transferOperatorSelect');

    callerDisplay.innerText = callerId || 'Mijoz';

    // Populate operators (ready ones first)
    if (currentOperators.length === 0) {
        select.innerHTML = `<option value="">Operatorlar topilmadi</option>`;
    } else {
        select.innerHTML = currentOperators.map(op => {
            const pres = op.presence || 'ready';
            const icon = pres === 'ready' ? '🟢' : (pres === 'talking' ? '🟡' : '🔴');
            const stateText = pres === 'ready' ? '(Tayyor / On-hook)' : (pres === 'talking' ? '(Suhbatda)' : '(Offline)');
            return `
                <option value="${op.id}">
                    ${icon} Operator ${op.id} ${stateText}
                </option>
            `;
        }).join('');
    }

    modal.style.display = 'flex';
}

const EXCLUDED_OPERATOR_IDS = new Set(['1111', '1324', '1001', '1000', '402', '401', '207', '202', '201', '170', '161', '118', '115', '160', '66', '110', '213']);

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

function generateStarRatingHtml(answered, operatorName) {
    if (!answered || answered < 1) {
        return '';
    }

    let stars = '';
    let currentLevel = 0;
    let nextStarNeeded = 0;

    if (answered > 35) {
        stars = '⭐⭐⭐⭐⭐';
        currentLevel = 5;
    } else if (answered >= 25) {
        stars = '⭐⭐⭐⭐';
        currentLevel = 4;
        nextStarNeeded = 36 - answered;
    } else if (answered >= 16) {
        stars = '⭐⭐⭐';
        currentLevel = 3;
        nextStarNeeded = 25 - answered;
    } else if (answered >= 11) {
        stars = '⭐⭐';
        currentLevel = 2;
        nextStarNeeded = 16 - answered;
    } else if (answered >= 1) {
        stars = '⭐';
        currentLevel = 1;
        nextStarNeeded = 11 - answered;
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
                        <span class="level-range">&gt; 35 ta</span>
                        <span class="level-desc">Super Elita</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 4 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐⭐</span>
                        <span class="level-range">25 - 35 ta</span>
                        <span class="level-desc">Yetakchi</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 3 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐⭐</span>
                        <span class="level-range">16 - 24 ta</span>
                        <span class="level-desc">Tajribali</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 2 ? 'current-level' : ''}">
                        <span class="level-stars">⭐⭐</span>
                        <span class="level-range">11 - 15 ta</span>
                        <span class="level-desc">O'rta daraja</span>
                    </div>
                    <div class="star-level-row ${currentLevel === 1 ? 'current-level' : ''}">
                        <span class="level-stars">⭐</span>
                        <span class="level-range">1 - 10 ta</span>
                        <span class="level-desc">Boshlang'ich</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderOperators(operators) {
    currentOperators = (operators || [])
        .filter(op => !EXCLUDED_OPERATOR_IDS.has(String(op.id)))
        .slice().sort((a, b) => {
            const rA = getPresenceRank(a);
            const rB = getPresenceRank(b);
            if (rA !== rB) return rA - rB;
            return parseInt(a.id, 10) - parseInt(b.id, 10);
        });
    const grid = document.getElementById('operatorsGrid');

    // Eng faol operatorni aniqlash (MVP reyting)
    const sortedByScore = [...currentOperators]
        .filter(op => (op.answered || 0) > 0 || (op.totalDurationSec || 0) > 0)
        .sort((a, b) => (b.answered || 0) - (a.answered || 0) || (b.totalDurationSec || 0) - (a.totalDurationSec || 0));

    const top1Id = sortedByScore[0] ? sortedByScore[0].id : null;

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
        grid.innerHTML = `
            <div style="color: var(--text-muted); font-size: 13px; padding: 16px;">
                Hozircha operatorlar faoliyati aniqlanmadi. Qo'ng'iroqlar bo'lganda avtomatik qo'shiladi.
            </div>
        `;
        return;
    }

    grid.innerHTML = currentOperators.map(op => {
        const pres = op.presence || 'ready';
        const ringingCallerStr = op.ringingCaller ? String(op.ringingCaller).trim() : '';
        const ringingNow = (pres === 'ringing' || (ringingCallerStr !== '' && !ringingCallerStr.includes('Yashirin'))) && pres !== 'talking';

        let cardClass = 'operator-card clickable-card';
        let statusBadge = '';
        let avatarBg = '';

        if (ringingNow) {
            statusBadge = '<span class="status-badge badge-ringing"><span class="badge-dot pulse-ring"></span> Jiringlamoqda</span>';
            avatarBg = 'linear-gradient(135deg, #ec4899, #be185d)';
            cardClass += ' status-ringing status-active call-ringing';
        } else if (pres === 'talking') {
            statusBadge = '<span class="status-badge badge-talking"><span class="badge-dot pulse"></span> Suhbatda</span>';
            avatarBg = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
            cardClass += ' status-talking status-active call-talking';
        } else if (pres === 'offline') {
            statusBadge = '<span class="status-badge badge-offline"><span class="badge-dot"></span> Offline</span>';
            avatarBg = 'linear-gradient(135deg, #64748b, #475569)';
            cardClass += ' status-offline';
        } else {
            statusBadge = '<span class="status-badge badge-ready"><span class="badge-dot"></span> Kutmoqda</span>';
            avatarBg = 'linear-gradient(135deg, #10b981, #059669)';
            cardClass += ' status-ready status-active';
        }
        const answered = op.answered || 0;

        // Yulduzlar soni (Qabul qilingan qo'ng'iroqlar soniga qarab)
        let stars = '';
        if (answered > 35) {
            stars = '⭐⭐⭐⭐⭐';
        } else if (answered >= 25) {
            stars = '⭐⭐⭐⭐';
        } else if (answered >= 16) {
            stars = '⭐⭐⭐';
        } else if (answered >= 11) {
            stars = '⭐⭐';
        } else if (answered >= 1) {
            stars = '⭐';
        }

        let mvpBadge = '';
        if (op.id === top1Id && answered > 0) {
            mvpBadge = `<span class="mvp-badge gold" title="Bugungi eng faol yetakchi operator">👑 MVP</span>`;
            cardClass += ' mvp-gold';
            avatarBg = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else if (stars === '⭐') {
            mvpBadge = `<span class="mvp-badge npc" title="1 ta yulduzli operator">🤖 NPC</span>`;
        }

        const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

        return `
            <div class="${cardClass}" onclick="openOperatorDetail('${op.id}')" title="${cleanName} tafsilotlarini va suhbatlarini ko'rish uchun bosing">
                ${ringingNow ? '<div class="call-live-strip ringing"></div>' : (pres === 'talking' ? '<div class="call-live-strip talking"></div>' : '')}
                <div class="operator-head">
                    <div class="operator-avatar" style="background: ${avatarBg};">${op.id}</div>
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <h4 style="font-size: 15px; font-weight: 700;">${cleanName}</h4>
                                ${mvpBadge}
                            </div>
                            ${statusBadge}
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
                        ${op.agentConnected ? `<span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : ''}
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
                    <span>O'tkazib yuborilgan:</span>
                    <span class="op-stat-val" style="color: ${(op.missed || 0) > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-weight: 700;">${op.missed || 0} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>Umumiy suhbat:</span>
                    <span class="op-stat-val" style="font-weight: 700; color: ${op.totalDurationSec > 7200 ? '#fcd34d' : 'var(--text-main)'};">
                        ${formatSeconds(op.totalDurationSec || 0)} ${op.totalDurationSec > 7200 ? '🔥' : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>O'rtacha suhbat:</span>
                    <span class="op-stat-val">${formatSeconds(op.avgDurationSec || 0)}</span>
                </div>
            </div>
        `;
    }).join('');

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
let historyDateScope = 'today'; // 'today' (Faqat bugun / tanlangan sana), 'all' (Barcha kunlar / butun arxiv)

function setHistoryScope(scope) {
    historyDateScope = (scope === 'all') ? 'all' : 'today';

    const btnToday = document.getElementById('btnHistoryScopeToday');
    const btnAll = document.getElementById('btnHistoryScopeAll');
    const badge = document.getElementById('historyScopeBadge');

    if (historyDateScope === 'all') {
        if (btnToday) {
            btnToday.style.background = 'transparent';
            btnToday.style.color = 'var(--text-muted)';
            btnToday.style.boxShadow = 'none';
        }
        if (btnAll) {
            btnAll.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btnAll.style.color = '#fff';
            btnAll.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.35)';
        }
        if (badge) {
            badge.innerText = '♾️ Barcha kunlar (Arxiv)';
            badge.style.background = 'rgba(59, 130, 246, 0.15)';
            badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            badge.style.color = '#60a5fa';
        }
    } else {
        if (btnToday) {
            btnToday.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btnToday.style.color = '#fff';
            btnToday.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.35)';
        }
        if (btnAll) {
            btnAll.style.background = 'transparent';
            btnAll.style.color = 'var(--text-muted)';
            btnAll.style.boxShadow = 'none';
        }
        if (badge) {
            badge.innerText = '📅 Faqat bugun';
            badge.style.background = 'rgba(59, 130, 246, 0.15)';
            badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            badge.style.color = '#60a5fa';
        }
    }

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
            badge.innerText = '⚡ 3CX Desktop Agent (Tezkor)';
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            badge.style.color = '#34d399';
        }
        if (desc) {
            desc.innerText = "Operator kompyuterlaridagi 3CX Desktop Agent to'plagan aniq qo'ng'iroqlar jurnali (Lokal tezkor baza).";
        }
        if (thLast) {
            thLast.innerText = 'Kompyuter (Host)';
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
            badge.innerText = '🌐 Issabel Server (Asterisk CDR)';
            badge.style.background = 'rgba(59, 130, 246, 0.15)';
            badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            badge.style.color = '#60a5fa';
        }
        if (desc) {
            desc.innerText = "Issabel Asterisk server bazasidagi barcha kiruvchi va chiquvchi CDR qo'ng'iroqlar jurnali.";
        }
        if (thLast) {
            thLast.innerText = 'Kim tugatdi?';
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
}

let currentHistoryData = [];

async function loadHistoryPage(page = 1, search = '') {
    const tbody = document.getElementById('historyTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;"><div class="spinner" style="margin: 0 auto 8px;"></div> Qo'ng'iroqlar tarixi yuklanmoqda...</td></tr>`;
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

            if (pageDisp) pageDisp.innerText = `Sahifa ${historyCurrentPage} / ${historyTotalPages}`;
            if (countInfo) countInfo.innerText = `Jami: ${result.total || 0} ta yozuv`;
            if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
            if (nextBtn) nextBtn.disabled = historyCurrentPage >= historyTotalPages;
            if (pagControls) pagControls.style.display = historyTotalPages > 1 ? 'flex' : 'none';

            currentHistoryData = result.data || [];
            applyHistoryFilters();
        } else {
            // 2. Issabel Asterisk CDR Server bazasidan
            const statusVal = (document.getElementById('historyFilterStatus') || {}).value || 'all';
            const dirVal = (document.getElementById('historyFilterDirection') || {}).value || 'all';
            const hasFilter = statusVal !== 'all' || dirVal !== 'all';
            const clearBtn = document.getElementById('btnClearHistoryFilters');
            if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';

            let url = `/api/history?page=${page}&limit=20&search=${encodeURIComponent(search)}&date=${encodeURIComponent(dateParam)}`;
            if (dirVal !== 'all') url += `&direction=${encodeURIComponent(dirVal)}`;
            if (statusVal !== 'all') url += `&status=${encodeURIComponent(statusVal)}`;

            const res = await fetch(url);
            const result = await res.json();

            historyCurrentPage = result.page || 1;
            historyTotalPages = result.totalPages || 1;

            const pageDisp = document.getElementById('pageNumberDisplay');
            const countInfo = document.getElementById('historyCountInfo');
            const prevBtn = document.getElementById('btnPrevPage');
            const nextBtn = document.getElementById('btnNextPage');
            const pagControls = document.getElementById('historyPaginationControls');

            if (pageDisp) pageDisp.innerText = `Sahifa ${historyCurrentPage} / ${historyTotalPages}`;
            if (countInfo) countInfo.innerText = `Jami: ${result.total || 0} ta yozuv`;
            if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
            if (nextBtn) nextBtn.disabled = historyCurrentPage >= historyTotalPages;
            if (pagControls) pagControls.style.display = historyTotalPages > 1 ? 'flex' : 'none';

            currentHistoryData = result.data || [];
            renderServerHistoryTable(currentHistoryData);
        }
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--danger); padding: 20px;">Xatolik yuz berdi: ${e.message}</td></tr>`;
        }
    }
}

const OPERATOR_NAMES_MAP = {
    '101': 'Oybek',
    '103': 'Feruza',
    '106': 'Gulchehra',
    '111': 'Nozima',
    '114': 'Maxmudbek',
    '116': 'Ibrohim',
    '119': 'Muattar',
    '120': 'Navruzoy'
};

// History jadvalini client-side yoki server-side filtrlash
function applyHistoryFilters() {
    const statusVal = (document.getElementById('historyFilterStatus') || {}).value || 'all';
    const dirVal = (document.getElementById('historyFilterDirection') || {}).value || 'all';

    // Clear tugmasi ko'rinishini boshqarish
    const hasFilter = statusVal !== 'all' || dirVal !== 'all';
    const clearBtn = document.getElementById('btnClearHistoryFilters');
    if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';

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
        return true;
    });

    renderAgentHistoryTable(filtered);
}

function resetHistoryFilters() {
    const s = document.getElementById('historyFilterStatus');
    const d = document.getElementById('historyFilterDirection');
    if (s) s.value = 'all';
    if (d) d.value = 'all';
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
    if (!opStr || opStr === 'Navbat' || opStr === '-') return 'Navbat';
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
        return formattedParts.join(' <span style="color: #38bdf8; font-weight: 700; margin: 0 3px;">➔</span> ');
    }
    const match = String(opStr).match(/\b(10[1-9]|11[0-9]|120)\b/);
    if (match) {
        const ext = match[1];
        const name = OPERATOR_NAMES_MAP[ext];
        if (name) return `${name} (${ext})`;
    }
    return opStr;
}

function formatCallerNumberOrOperator(callerId) {
    if (!callerId) return '-';
    const clean = String(callerId).trim();
    if (OPERATOR_NAMES_MAP && OPERATOR_NAMES_MAP[clean]) {
        return `${OPERATOR_NAMES_MAP[clean]} (${clean})`;
    }
    return clean;
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
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Bugun bu raqam bo'yicha qo'ng'iroq topilmadi</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">Mijoz avvalgi kunlarda qo'ng'iroq qilgan bo'lishi mumkin.</div>
                        <button type="button" onclick="setHistoryScope('all')" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 18px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                            <span>♾️</span> Barcha kunlar bo'yicha qidirish
                        </button>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;">3CX Desktop Agent bo'yicha qo'ng'iroqlar jurnali bo'sh</td></tr>`;
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
            statusBadge = '<span class="badge badge-success">✅ Qabul qilingan</span>';
        } else if (item.status === 'REJECT') {
            statusBadge = '<span class="badge badge-danger">🚫 Rad etilgan</span>';
        } else if (item.category_3cx === 'Missed' || item.status === 'MISSED') {
            statusBadge = '<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 O\'tkazib yuborilgan</span>';
        } else {
            statusBadge = `<span class="badge badge-warning">${item.status_name || item.status}</span>`;
        }

        const dirBadge = isOut 
            ? '<span class="badge badge-purple"><i class="badge-dir-icon outbound"></i> chiquvchi</span>' 
            : '<span class="badge badge-info"><i class="badge-dir-icon inbound"></i> kiruvchi</span>';

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
            ? '⏳ Qidirilmoqda...' 
            : (isThisPlaying ? '⏸ To\'xtatish' : (isThisPaused ? '▶ Davom ettirish' : '▶ Tinglash'));

        const audioCell = hasAudio 
            ? `<div style="display: inline-flex; align-items: center; gap: 6px;">
                   <button class="btn-action btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                           ${isThisSearching ? 'disabled' : ''} 
                           onclick="playDashboardRecording('', '${safeCaller}', ${durSec}, this)" 
                           style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; padding: 4px 10px; font-size: 11px;" 
                           title="${isThisPlaying ? 'To\'xtatish (pauza)' : (isThisPaused ? 'Qolgan joyidan davom ettirish' : 'Audioni tinglash')}">
                       <span>${playBtnText}</span>
                   </button>
                   <button class="btn-action" 
                           onclick="openInExplorerStudio('', '${safeCaller}', ${durSec}, this)" 
                           style="padding: 4px 8px; font-size: 11px; background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #c7d2fe; display: inline-flex; align-items: center; gap: 4px;" 
                           title="Audio Explorer studiyasida to'liq pleyer bilan ochish">
                       <span>🔍 Detal</span>
                   </button>
               </div>`
            : `<span class="badge" style="background: rgba(100, 116, 139, 0.12); color: var(--text-dim); font-size: 11px; padding: 4px 8px; border: 1px dashed rgba(148, 163, 184, 0.2);" title="Suhbat bo'lmagan (ovoz yozuvi mavjud emas)">
                   🚫 Audio yo'q
               </span>`;

        let rowStyle = '';
        if (isOut) {
            rowStyle = 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
        } else if (item.category_3cx === 'Missed' || item.status === 'MISSED' || item.status === 'REJECT') {
            rowStyle = 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444;';
        }

        return `
            <tr style="${rowStyle}">
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td style="text-align: left;">${timeHtml}</td>
                <td>
                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                        <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                        <span style="font-weight: 600;">${formatCallerNumberOrOperator(item.caller_id)}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator_id)}</td>
                <td>${dirBadge}</td>
                <td style="font-family: monospace; font-weight: 600; color: ${isAns ? 'var(--text-main)' : 'var(--text-dim)'};">${formatSeconds(durSec)}</td>
                <td style="font-size: 11px; color: var(--text-dim); text-align: center;" title="3CX Agent jurnalida navbatda kutish vaqti mavjud emas">—</td>
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

function renderServerHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    if (!data || data.length === 0) {
        if (historySearchQuery && historyDateScope === 'today') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
                        <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Bugun bu raqam bo'yicha qo'ng'iroq topilmadi</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">Mijoz avvalgi kunlarda qo'ng'iroq qilgan bo'lishi mumkin.</div>
                        <button type="button" onclick="setHistoryScope('all')" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 18px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                            <span>♾️</span> Barcha kunlar bo'yicha qidirish
                        </button>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;">Issabel serverida qo'ng'iroqlar jurnali bo'sh</td></tr>`;
        }
        return;
    }

    const isAll = (historyDateScope === 'all');

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = (historyCurrentPage - 1) * 20 + index + 1;
        const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
        const isOut = item.direction === 'outbound' && !isXfer;
        const isAns = item.status === 'ANSWERED';

        // "Operatorga ulanmadi / Navbatdan chiqdi" (olovrang), "Chiquvchi" (binafsharang), "Transfer" (moviy/cyan) fon
        const isUnconnected = !isAns && !isOut && !isXfer && (item.status === 'ABANDONED' || item.status === 'NO ANSWER' || (item.operator && item.operator.includes('Operatorga ulanmadi')));
        let rowStyle = '';
        if (isXfer) {
            rowStyle = 'background: rgba(14, 165, 233, 0.08); border-left: 3px solid #0ea5e9;';
        } else if (isOut) {
            rowStyle = 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
        } else if (isUnconnected) {
            rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
        } else if (item.status === 'BUSY') {
            rowStyle = 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444;';
        }

        const statusBadge = isAns 
            ? '<span class="badge badge-success">✅ Javob berilgan</span>' 
            : (item.status === 'BUSY' ? '<span class="badge badge-danger">🚫 Band</span>' : (isOut ? '<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 Javobsiz</span>' : '<span class="badge badge-warning">⏳ Navbatdan chiqdi</span>'));
        const dirBadge = isXfer
            ? '<span class="badge badge-cyan"><i class="fas fa-random"></i> 🔀 transfer</span>'
            : (isOut 
                ? '<span class="badge badge-purple"><i class="badge-dir-icon outbound"></i> chiquvchi</span>' 
                : '<span class="badge badge-info"><i class="badge-dir-icon inbound"></i> kiruvchi</span>');

        let timeHtml = '';
        if (item.time) {
            const spl = String(item.time).split(' ');
            const dateStr = spl[0] || '';
            let timeStr = spl[1] || '';
            if (!timeStr) {
                try {
                    const d = new Date(item.time);
                    timeStr = d.toLocaleTimeString();
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
            ? '⏳ Qidirilmoqda...' 
            : (isThisPlaying ? '⏸ To\'xtatish' : (isThisPaused ? '▶ Davom ettirish' : '▶ Tinglash'));

        const audioCell = hasAudio 
            ? `<div style="display: inline-flex; align-items: center; gap: 6px;">
                   <button class="btn-action btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                           ${isThisSearching ? 'disabled' : ''} 
                           onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                           style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; padding: 4px 10px; font-size: 11px;" 
                           title="${isThisPlaying ? 'To\'xtatish (pauza)' : (isThisPaused ? 'Qolgan joyidan davom ettirish' : 'Audioni tinglash')}">
                       <span>${playBtnText}</span>
                   </button>
                   <button class="btn-action" 
                           onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                           style="padding: 4px 8px; font-size: 11px; background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #c7d2fe; display: inline-flex; align-items: center; gap: 4px;" 
                           title="Audio Explorer studiyasida to'liq pleyer bilan ochish">
                       <span>🔍 Detal</span>
                   </button>
               </div>`
            : `<span class="badge" style="background: rgba(100, 116, 139, 0.12); color: var(--text-dim); font-size: 11px; padding: 4px 8px; border: 1px dashed rgba(148, 163, 184, 0.2);" title="Suhbat bo'lmagan (ovoz yozuvi mavjud emas)">
                   🚫 Audio yo'q
               </span>`;

        const hangupDisplay = isXfer
            ? '<span style="color: #38bdf8; font-weight: 600;">🔀 Transfer (Operatorga)</span>'
            : (item.hangupParty || item.cause || 'Normal');

        return `
            <tr style="${rowStyle}">
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td style="text-align: left;">${timeHtml}</td>
                <td>
                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                        <span class="phone-icon">${isOut ? '📤' : (isXfer ? '🔀' : '📞')}</span>
                        <span>${formatCallerNumberOrOperator(item.callerId)}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator)}</td>
                <td>${dirBadge}</td>
                <td>${formatSeconds(durSec)}</td>
                <td style="font-family: monospace; font-weight: 600; color: #f59e0b;" title="Navbatda kutish vaqti${item.waitSec ? ': ' + formatSeconds(item.waitSec) : ' mavjud emas'}">${item.waitSec ? formatSeconds(item.waitSec) : '—'}</td>
                <td>${statusBadge}</td>
                <td style="color: var(--text-muted); font-size: 12px;">${hangupDisplay}</td>
                <td>${audioCell}</td>
            </tr>
        `;
    }).join('');
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
    const columns = ['time', 'callerId', 'direction', 'operator', 'duration', 'status', 'hangupParty'];
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

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = index + 1;
        const isXfer = item.direction === 'transfer' || (item.hangupParty && item.hangupParty.toLowerCase().includes('transfer'));
        const isOut = item.direction === 'outbound' && !isXfer;
        
        const isQueueOnly = !item.operatorExten && (!item.operator || item.operator === 'Navbat' || item.operator.includes('Navbat') || item.operator.includes('Operatorga ulanmadi') || item.operator === '-');
        const isAns = (item.status === 'ANSWERED') && !isQueueOnly;

        const statusBadge = isAns 
            ? '<span class="badge badge-success">✅ Javob berilgan</span>' 
            : (item.status === 'BUSY' ? '<span class="badge badge-danger">🚫 Band</span>' : (isOut ? '<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 Javobsiz</span>' : '<span class="badge badge-warning">⏳ Navbatdan chiqdi</span>'));
        const dirBadge = isXfer
            ? '<span class="badge badge-cyan">🔀 transfer</span>'
            : (isOut
                ? '<span class="badge badge-purple"><i class="badge-dir-icon outbound"></i> chiquvchi</span>'
                : '<span class="badge badge-info"><i class="badge-dir-icon inbound"></i> kiruvchi</span>');

        const opDisplayName = formatOperatorDisplayName(item.operator);
        const opCellHtml = isQueueOnly
            ? '<span style="color: #f59e0b; font-size: 12px; font-weight: 500;">⏳ Operatorga ulanmadi</span>'
            : `<span style="font-weight: 600; color: var(--text-main);">${opDisplayName}</span>`;

        // "Operatorga ulanmadi / Navbatdan chiqdi" (olovrang), "Chiquvchi" (binafsharang), "Transfer" (moviy/cyan) fon
        const isUnconnected = isQueueOnly && !isOut && !isXfer;
        let rowStyle = '';
        if (isXfer) {
            rowStyle = 'background: rgba(14, 165, 233, 0.08); border-left: 3px solid #0ea5e9;';
        } else if (isOut) {
            rowStyle = 'background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7;';
        } else if (isUnconnected) {
            rowStyle = 'background: rgba(245, 158, 11, 0.10); border-left: 3px solid #f59e0b;';
        } else if (item.status === 'BUSY') {
            rowStyle = 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444;';
        }

        const hasAudio = (item.status === 'ANSWERED' && (item.duration || 0) > 0) || Boolean(item.recording);
        const safeRec = (item.recording || '').replace(/'/g, "\\'");
        const safeCaller = (item.callerId || '').replace(/'/g, "\\'");
        const durSec = item.duration || 0;
        const waitSecVal = item.waitSec || 0;
        const waitCellHtml = isOut
            ? '<td style="font-size: 11px; color: var(--text-dim); text-align: center;" title="Chiquvchi qo\'ng\'iroqda navbat yo\'q">—</td>'
            : `<td style="font-family: monospace; font-weight: 600; color: #f59e0b;" title="Navbatda kutish: ${formatSeconds(waitSecVal)}">${formatSeconds(waitSecVal)}</td>`;

        const callKey = `${item.callerId || ''}_${durSec}`;
        const isThisPlaying = currentlyPlayingCallKey === callKey;
        const isThisPaused = pausedCallKey === callKey;
        const isThisSearching = activeSearchingCallerId === item.callerId;

        const playBtnText = isThisSearching 
            ? '⏳ Qidirilmoqda...' 
            : (isThisPlaying ? '⏸ To\'xtatish' : (isThisPaused ? '▶ Davom ettirish' : '▶ Tinglash'));

        const audioCell = hasAudio 
            ? `<div style="display: inline-flex; align-items: center; gap: 6px;">
                   <button class="btn-action btn-play-audio-inline ${isThisPlaying ? 'btn-audio-playing' : ''}" 
                           ${isThisSearching ? 'disabled' : ''} 
                           onclick="playDashboardRecording('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                           style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; padding: 4px 10px; font-size: 11px;" 
                           title="${isThisPlaying ? 'To\'xtatish (pauza)' : (isThisPaused ? 'Qolgan joyidan davom ettirish' : 'Audioni tinglash')}">
                       <span>${playBtnText}</span>
                   </button>
                   <button class="btn-action" 
                           onclick="openInExplorerStudio('${safeRec}', '${safeCaller}', ${durSec}, this)" 
                           style="padding: 4px 8px; font-size: 11px; background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #c7d2fe; display: inline-flex; align-items: center; gap: 4px;" 
                           title="Audio Explorer studiyasida to'liq pleyer bilan ochish">
                       <span>🔍 Detal</span>
                   </button>
               </div>`
            : `<span class="badge" style="background: rgba(100, 116, 139, 0.12); color: var(--text-dim); font-size: 11px; padding: 4px 8px; border: 1px dashed rgba(148, 163, 184, 0.2);" title="Suhbat bo'lmagan (ovoz yozuvi mavjud emas)">
                   🚫 Audio yo'q
               </span>`;

        const hangupDisplay = isXfer
            ? '<span style="color: #38bdf8; font-weight: 600;">🔀 Transfer (Operatorga)</span>'
            : (item.hangupParty || 'Noma\'lum');

        return `
            <tr style="${rowStyle}">
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td>${new Date(item.time).toLocaleTimeString()}</td>
                <td>
                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                        <span class="phone-icon">${isXfer ? '🔀' : `<img src="/img/${isOut ? 'icon-chiquvchi' : 'icon-kiruvchi'}.png" alt="${isOut ? 'chiquvchi' : 'kiruvchi'}" style="width:14px;height:14px;object-fit:contain;">`}</span>
                        <span>${formatCallerNumberOrOperator(item.callerId)}</span>
                    </div>
                </td>
                <td>${dirBadge}</td>
                <td>${opCellHtml}</td>
                <td>${formatSeconds(item.duration || 0)}</td>
                ${waitCellHtml}
                <td>${statusBadge}</td>
                <td style="font-weight: 500; font-size: 12px; color: ${isXfer ? '#38bdf8' : (item.hangupParty?.includes('Operator') ? 'var(--warning)' : (item.hangupParty?.includes('Mijoz') ? 'var(--secondary)' : 'var(--text-dim)'))};">
                    ${hangupDisplay}
                </td>
                <td>
                    ${audioCell}
                </td>
            </tr>
        `;
    }).join('');
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
        const displayName = `📞 ${callerId} (${formatSeconds(duration || 0)})`;
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
            const displayName = `📞 ${callerId} (${formatSeconds(matchedDuration || duration || 0)})`;
            playAudioFile(displayName, matchedRecording, (matchedDuration || duration || 0) * 16000, false);
        } else {
            alert(`⚠️ "${callerId}" raqamiga tegishli audio yozuv topilmadi yoki suhbat amalga oshmagan (0 soniya).`);
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        alert('Audio yozuvni yuklashda xatolik yuz berdi: ' + e.message);
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
        const [statsRes, opRes, queueRes, statusRes] = await Promise.all([
            fetch('/api/stats').then(r => r.json()).catch(() => null),
            fetch('/api/operators').then(r => r.json()).catch(() => []),
            fetch('/api/queues').then(r => r.json()).catch(() => []),
            fetch('/api/status').then(r => r.json()).catch(() => null)
        ]);

        if (statsRes) updateStatsUI(statsRes);
        if (opRes) renderOperators(opRes);
        if (queueRes) renderQueues(queueRes);
        if (statusRes) {
            updateAmiStatus(statusRes.amiConnected);
            updateSftpStatus(statusRes.sftpConnected);
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
    limit: 100,
    search: '',
    totalPages: 1,
    total: 0
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

async function fetchAndRenderDetailCalls() {
    const bodyEl = document.getElementById('detailModalBody');
    const countBadge = document.getElementById('detailCountBadge');
    const pageInd = document.getElementById('detailPageIndicator');
    const prevBtn = document.getElementById('detailPrevPage');
    const nextBtn = document.getElementById('detailNextPage');

    bodyEl.innerHTML = `
        <div class="modal-loading-box">
            <div class="modal-spinner-ring"></div>
            <div class="modal-loading-text">Ma'lumotlar yuklanmoqda...</div>
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

        if (countBadge) countBadge.innerText = `Jami: ${detailState.total} ta qo'ng'iroq (Ko'rsatilmoqda: ${calls.length} ta)`;
        if (pageInd) pageInd.innerText = `${json.page || detailState.page} / ${detailState.totalPages}`;
        if (prevBtn) prevBtn.disabled = detailState.page <= 1;
        if (nextBtn) nextBtn.disabled = detailState.page >= detailState.totalPages;

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
                        <th>Vaqt</th>
                        <th>Mijoz Raqami</th>
                        <th>Yo'nalish</th>
                        <th>Operator</th>
                        <th>Suhbat / Kutish Vaqti</th>
                        <th>Holati</th>
                        <th>Kim tugatdi?</th>
                        <th>Audio</th>
                    </tr>
                </thead>
                <tbody>
                    ${calls.map((c, index) => {
                        const rowNum = (detailState.page - 1) * detailState.limit + index + 1;
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

                        return `
                            <tr style="${rowStyle}">
                                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                                <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${new Date(c.time).toLocaleTimeString()}</td>
                                <td style="white-space: nowrap;">
                                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                                        <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                                        <span>${formatCallerNumberOrOperator(c.callerId)}</span>
                                    </div>
                                </td>
                                <td style="white-space: nowrap;">${directionBadge}</td>
                                <td style="white-space: nowrap;">
                                    ${(c.operator || '').includes('IVR') || (c.operator || '').includes('Avtojavob') 
                                        ? `<span style="color: #94a3b8; font-style: italic; display: inline-flex; align-items: center; gap: 4px;">🤖 ${c.operator}</span>`
                                        : `<span style="font-weight: 600; color: var(--text-main);">${c.operator}</span>`
                                    }
                                </td>
                                <td style="white-space: nowrap;">${durText}</td>
                                <td style="white-space: nowrap;">${statusBadge}</td>
                                <td style="white-space: nowrap; font-size: 12px; font-weight: 500; color: ${c.hangupParty === 'Operator' ? 'var(--warning)' : (c.hangupParty === 'Mijoz' ? '#38bdf8' : 'var(--text-dim)')}">${c.hangupParty || '-'}</td>
                                <td style="white-space: nowrap;">
                                    ${c.recording ? `
                                        <button class="btn-action" style="padding: 3px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="playCallAudio('${c.recording}', this)">
                                            ▶ Tinglash
                                        </button>
                                    ` : `<span style="color: var(--text-dim); font-size: 11px;">Mavjud emas</span>`}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        bodyEl.innerHTML = `<div style="color: var(--danger); padding: 20px;">Yuklashda xatolik yuz berdi: ${err.message}</div>`;
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

    if (searchInput) searchInput.value = '';

    const isToday = !currentSelectedDate || currentSelectedDate === getTodayDateString();
    titleEl.innerHTML = `📊 ${title}`;
    subTitleEl.innerText = isToday ? `Bugungi kun bo'yicha saralangan qo'ng'iroqlar tafsiloti` : `${currentSelectedDate} sanasi bo'yicha saralangan qo'ng'iroqlar tafsiloti`;
    summaryEl.style.display = 'none';
    summaryEl.innerHTML = '';

    modal.style.display = 'flex';
    fetchAndRenderDetailCalls();
}

async function openOperatorDetail(operatorId) {
    const modal = document.getElementById('detailModal');
    const titleEl = document.getElementById('detailModalTitle');
    const subTitleEl = document.getElementById('detailModalSubtitle');
    const summaryEl = document.getElementById('detailOperatorSummary');
    const searchInput = document.getElementById('detailSearchInput');

    detailState.type = 'operator';
    detailState.operatorExt = operatorId;
    detailState.page = 1;
    detailState.search = '';

    if (searchInput) searchInput.value = '';

    const op = currentOperators.find(o => String(o.id) === String(operatorId)) || { id: operatorId, name: `Operator ${operatorId}` };
    const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

    titleEl.innerHTML = `👤 ${cleanName} — Tafsilotlar & Bugungi Suhbatlar`;
    subTitleEl.innerText = `Operatorning kunlik faolligi, intizomi va audio yozuvlari`;

    // Operator Summary Header
    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-right: 20px;">
            <div class="operator-avatar" style="width: 48px; height: 48px; font-size: 15px; background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
                ${op.id}
            </div>
            <div>
                <h4 style="font-size: 16px; font-weight: 700; color: #fff;">${cleanName}</h4>
                <span style="font-size: 12px; color: var(--text-dim);">Ichki raqam: ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
            </div>
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
            <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Qabul qilingan:</span>
                <b style="font-size: 14px; color: var(--success);">${op.answered || 0} ta</b>
            </div>
            <div style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Chiquvchi:</span>
                <b style="font-size: 14px; color: #38bdf8;">${op.outbound || 0} ta</b>
            </div>
            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Rad etilgan:</span>
                <b style="font-size: 14px; color: var(--danger);">${op.denied || 0} ta</b>
            </div>
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

    titleEl.innerHTML = `👥 Navbatda Kutayotganlar (Real-time)`;
    subTitleEl.innerText = `Ayni daqiqada navbatda turgan mijozlar ro'yxati`;
    summaryEl.style.display = 'none';
    summaryEl.innerHTML = '';

    const waiters = currentQueues.flatMap(q => (q.callersWaiting || []).map(c => ({ ...c, queueName: q.name })));
    countBadge.innerText = `Jami: ${waiters.length} ta mijoz kutmoqda`;
    if (pageInd) pageInd.innerText = '1 / 1';

    if (waiters.length === 0) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                Hozircha navbatda kutayotgan mijozlar yo'q. Barcha qo'ng'iroqlar operatorlarga ulangan yoki navbat bo'sh.
            </div>
        `;
    } else {
        bodyEl.innerHTML = `
            <table class="detail-table">
                <thead>
                    <tr>
                        <th>O'rni</th>
                        <th>Mijoz Raqami</th>
                        <th>Navbat Nomi</th>
                        <th>Kutish Vaqti</th>
                        <th>Kanal</th>
                    </tr>
                </thead>
                <tbody>
                    ${waiters.map(w => `
                        <tr>
                            <td style="font-weight: 700; color: #fbbf24;">#${w.position || 1}</td>
                            <td style="white-space: nowrap;">
                                <div class="phone-cell">
                                    <span class="phone-icon">📞</span>
                                    <span>${w.callerId}</span>
                                </div>
                            </td>
                            <td><span class="badge badge-info">${w.queueName || 'Asosiy Navbat'}</span></td>
                            <td style="font-weight: 600; color: var(--warning);">${w.waitSec ? formatSeconds(w.waitSec) : 'Kutmoqda...'}</td>
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
        alert('Ushbu qo\'ng\'iroqda audio yozuv mavjud emas (suhbat bo\'lmagan)');
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
                Yuklanmoqda...
            </div>
        `;
    }

    try {
        const res = await fetch(url);
        const json = await res.json();

        agentLogsTotalPages = json.totalPages || 1;
        if (pageEl) pageEl.innerText = `${json.page || 1} / ${agentLogsTotalPages}`;
        if (totalEl) totalEl.innerText = `Jami: ${json.total || 0} ta hodisa`;
        if (prevBtn) prevBtn.disabled = (json.page <= 1);
        if (nextBtn) nextBtn.disabled = (json.page >= agentLogsTotalPages);

        if (!json.data || json.data.length === 0) {
            bodyEl.innerHTML = `
                <div style="text-align: center; padding: 50px; color: var(--text-muted); font-size: 13px;">
                    3CX Desktop Agent tomonidan hozircha qo'ng'iroq qayd etilmadi.<br>
                    <span style="font-size: 11px; opacity: 0.7;">Qo'ng'iroqlar amalga oshirilganda bu yerda real-time paydo bo'ladi.</span>
                </div>
            `;
            return;
        }

        const opNames = {
            '101': 'Oybek',
            '103': 'Feruza',
            '106': 'Gulchehra',
            '111': 'Nozima',
            '114': 'Maxmudbek',
            '116': 'Ibrohim',
            '119': 'Muattar',
            '120': 'Navruzoy'
        };

        const rowsHtml = json.data.map((r, index) => {
            const rowNum = (json.page - 1) * 50 + index + 1;
            const opName = opNames[String(r.operator_id)] || `Operator ${r.operator_id}`;
            const opDisplay = `${opName} (${r.operator_id})`;
            
            let typeBadge = '';
            const t = (r.event_type || '').toUpperCase();
            const dur = parseInt(r.duration_sec || 0, 10);

            const isDialled = t === 'DIALLED' || t === 'OUTBOUND';
            if (t === 'REJECT') {
                typeBadge = `<span class="status-badge failed">🚫 Rad etildi</span>`;
            } else if (isDialled) {
                if (dur > 0) {
                    typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-weight: 700;"><i class="badge-dir-icon outbound"></i> Chiquvchi</span>`;
                } else {
                    typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);"><i class="badge-dir-icon outbound"></i> Chiquvchi (Ulanmagan)</span>`;
                }
            } else if (t === 'MISSED' || dur === 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⚠️ O'tkazib yuborildi</span>`;
            } else if (t === 'ANSWERED' || dur > 0) {
                typeBadge = `<span class="status-badge answered">🟢 Javob berildi</span>`;
            } else if (t === 'RINGING' || t === 'INCOMING') {
                typeBadge = `<span class="status-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);"><i class="badge-dir-icon inbound"></i> Kiruvchi</span>`;
            } else {
                typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3);">📴 Tugadi</span>`;
            }

            const durFormatted = formatSeconds(dur);

            return `
                <tr>
                    <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                    <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${r.event_time || ''}</td>
                    <td style="font-weight: 600; color: var(--text-main); white-space: nowrap;">${opDisplay}</td>
                    <td style="white-space: nowrap;">
                        <div class="phone-cell">
                            <span class="phone-icon">📞</span>
                            <span>${r.caller_id || 'Yashirin'}</span>
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
                            <th>Qayd Vaqti</th>
                            <th>Operator</th>
                            <th>Mijoz Raqami</th>
                            <th>Hodisa Turi</th>
                            <th>Suhbat Vaqti</th>
                            <th>Kompyuter (PC)</th>
                            <th>3CX Tarixi</th>
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
                Ma'lumotlarni yuklab bo'lmadi: ${err.message}
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
            textEl.innerText = data.lastSyncTime || 'Kecha 21:00';
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
            btn.innerHTML = '⏳ Sinxronlanmoqda...';
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
            alert(`✅ Sinxronizatsiya muvaffaqiyatli yakunlandi!\n\nAsterisk CDR dan ${data.addedCount} ta yetishmayotgan qo'ng'iroq tiklandi.`);
            await loadTabAgentOperators(activeDate);
            if (typeof loadTabAgentLogs === 'function') loadTabAgentLogs();
        } else {
            alert(`⚠️ Sinxronizatsiya: ${data.message || data.error || 'Noma\'lum xatolik'}`);
        }
    } catch (err) {
        console.error('triggerCdrSync xatolik:', err);
        alert('❌ Sinxronizatsiya vaqtida xatolik yuz berdi: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// --- EXPORT MODAL & SANA ORALIG'I (RANGE) EXPORT LOGIKASI ---

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
    } else if (preset === 'last7') {
        const dt = new Date();
        dt.setDate(dt.getDate() - 6);
        const y7 = dt.getFullYear();
        const m7 = String(dt.getMonth() + 1).padStart(2, '0');
        const d7 = String(dt.getDate()).padStart(2, '0');
        startInput.value = `${y7}-${m7}-${d7}`;
        endInput.value = todayStr;
    } else if (preset === 'thisMonth') {
        startInput.value = `${todayStr.slice(0, 7)}-01`;
        endInput.value = todayStr;
    } else if (preset === 'prevMonth') {
        const prevMonthDate = new Date(y, m - 2, 1);
        const py = prevMonthDate.getFullYear();
        const pm = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(py, prevMonthDate.getMonth() + 1, 0).getDate();
        startInput.value = `${py}-${pm}-01`;
        endInput.value = `${py}-${pm}-${String(lastDay).padStart(2, '0')}`;
    }
    updateExportRangeBadge();
}

function onExportDateChange() {
    updateExportRangeBadge();
}

function updateExportRangeBadge() {
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    const textEl = document.getElementById('exportRangeText');
    if (!startInput || !endInput || !textEl) return;

    const s = startInput.value;
    const e = endInput.value;
    if (!s || !e) {
        textEl.innerText = 'Iltimos, ikkala sanani ham tanlang';
        return;
    }

    const d1 = new Date(s);
    const d2 = new Date(e);
    if (d1 > d2) {
        textEl.innerHTML = `<span style="color: #f87171; font-weight: 600;">⚠️ Boshlanish sanasi tugash sanasidan katta bo'lishi mumkin emas!</span>`;
        return;
    }

    const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    const [sy, sm, sd] = s.split('-');
    const [ey, em, ed] = e.split('-');
    textEl.innerHTML = `Tanlangan oraliq: <b>${diffDays} kun</b> (${sd}.${sm}.${sy} — ${ed}.${em}.${ey})`;
}

function submitRangeExport() {
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');
    if (!startInput || !endInput) return;

    let s = startInput.value;
    let e = endInput.value;

    if (!s || !e) {
        alert("Iltimos, boshlanish va tugash sanasini tanlang!");
        return;
    }

    if (s > e) {
        const tmp = s;
        s = e;
        e = tmp;
        startInput.value = s;
        endInput.value = e;
    }

    const btn = document.getElementById('btnSubmitExport');
    const btnIcon = document.getElementById('exportBtnIcon');
    const btnText = document.getElementById('exportBtnText');
    const mainBtn = document.getElementById('btnExportExcel');
    const mainBtnText = document.getElementById('txtExportExcel');

    if (btn) btn.disabled = true;
    if (btnIcon) btnIcon.innerText = '⏳';
    if (btnText) btnText.innerText = 'Yuklanmoqda...';
    if (mainBtn) mainBtn.disabled = true;
    if (mainBtnText) mainBtnText.innerText = 'Yuklanmoqda...';

    const downloadUrl = `/api/export/excel?startDate=${encodeURIComponent(s)}&endDate=${encodeURIComponent(e)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `Call_Center_Export_${s}_${e}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
        if (btn) btn.disabled = false;
        if (btnIcon) btnIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>`;
        if (btnText) btnText.innerText = 'Excel hisobotni yuklash';
        if (mainBtn) mainBtn.disabled = false;
        if (mainBtnText) mainBtnText.innerText = 'Export';
        closeExportModal();
    }, 2500);
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
            titleEl.innerText = "Agent ma'lumotlari";
        } else {
            const op = tabAgentOperatorsData.find(o => String(o.id) === selectedTabAgentOpId);
            titleEl.innerText = op ? `${op.name} — Agent ma'lumotlari` : `Operator ${selectedTabAgentOpId} — Agent ma'lumotlari`;
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
        grid.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; padding: 16px;">Hozircha 3CX Desktop Agent ma'lumotlari mavjud emas.</div>`;
        lastTabOpsFingerprint = '';
        return;
    }

    const currentFingerprint = JSON.stringify(operators) + '_' + selectedTabAgentOpId;
    if (currentFingerprint === lastTabOpsFingerprint && grid.children.length > 0) {
        return; // Ma'lumotlar o'zgarmagan bo'lsa DOM qayta chizilmaydi, kartochkalar mutlaqo statik turadi
    }
    lastTabOpsFingerprint = currentFingerprint;

    // Top 1 operatorni aniqlash (MVP reyting) agent answered soni bo'yicha
    const sortedByScore = [...operators]
        .filter(op => (op.answered || 0) > 0 || (op.totalDurationSec || 0) > 0)
        .sort((a, b) => (b.answered || 0) - (a.answered || 0) || (b.totalDurationSec || 0) - (a.totalDurationSec || 0));

    const top1Id = sortedByScore[0] ? sortedByScore[0].id : null;

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

        let stars = '';
        if (answered > 35) {
            stars = '⭐⭐⭐⭐⭐';
        } else if (answered >= 25) {
            stars = '⭐⭐⭐⭐';
        } else if (answered >= 16) {
            stars = '⭐⭐⭐';
        } else if (answered >= 11) {
            stars = '⭐⭐';
        } else if (answered >= 1) {
            stars = '⭐';
        }

        const isMvp = op.id === top1Id && answered > 0;
        let mvpBadge = '';
        let avatarBg = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
        if (isMvp) {
            mvpBadge = `<span class="mvp-badge gold" title="3CX Agent bo'yicha yetakchi operator">👑 MVP</span>`;
            avatarBg = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else if (stars === '⭐') {
            mvpBadge = `<span class="mvp-badge npc" title="1 ta yulduzli operator">🤖 NPC</span>`;
        }

        const isSelected = selectedTabAgentOpId === String(op.id);
        const cleanName = getCleanOperatorName(op.realName || op.name, op.id);

        return `
            <div class="operator-card clickable-card static-operator-card ${isSelected ? 'is-selected' : ''}" 
                 onclick="filterTabAgentLogsByOperator('${op.id}')" 
                 title="${cleanName} tafsilotlarini va 3CX jurnallarini ko'rish uchun bosing">
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
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                            <span style="font-size: 11px; color: var(--text-dim);">Exten: ${op.id}</span>
                            ${generateStarRatingHtml(answered, cleanName)}
                        </div>
                    </div>
                </div>

                <div class="op-stat-row">
                    <span>Desktop Agent:</span>
                    <span class="op-stat-val" style="font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'}; ${op.agentConnected ? 'box-shadow: 0 0 6px #10b981;' : ''}"></span>
                        <span style="color: ${op.agentConnected ? 'var(--success)' : 'var(--text-dim)'};">${op.agentConnected ? 'Faol' : 'O\'chiq'}</span>
                        ${op.agentConnected ? `<span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : ''}
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
                    <span class="op-stat-val" style="color: var(--success); font-weight: 700;">${answered} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>Chiquvchi:</span>
                    <span class="op-stat-val" style="color: ${outbound > 0 ? '#38bdf8' : 'var(--text-dim)'}; font-weight: 700;">${outbound} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>O'tkazib yuborilgan:</span>
                    <span class="op-stat-val" style="color: ${missed > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-weight: 700;">${missed} ta</span>
                </div>
                <div class="op-stat-row">
                    <span>Umumiy suhbat:</span>
                    <span class="op-stat-val" style="font-weight: 700; color: ${op.totalDurationSec > 7200 ? '#fcd34d' : 'var(--text-main)'};">
                        ${formatSeconds(op.totalDurationSec || 0)} ${op.totalDurationSec > 7200 ? '🔥' : ''}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>O'rtacha suhbat:</span>
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

    if (elReady) elReady.innerText = `${operators.length} ta`;
    if (elAgent) elAgent.innerText = `${countAgentOnline} ta`;
    if (elAns) elAns.innerText = `${totalAns} ta`;
    if (elOut) elOut.innerText = `${totalOutbound} ta`;
    if (elMiss) elMiss.innerText = `${totalMissed} ta`;

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
            3CX Desktop Agent jurnali yuklanmoqda...
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

        if (totalEl) totalEl.innerText = `Jami qaydlar: ${json.total || 0} ta`;

        if (!json.data || json.data.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-dim); background: rgba(0,0,0,0.2); border-radius: var(--radius-sm);">
                    <div style="font-size: 32px; margin-bottom: 8px;">📭</div>
                    3CX Desktop Agent tomonidan ushbu operator bo'yicha hali yangi qo'ng'iroq qayd etilmagan.
                </div>
                <div style="padding: 12px 16px; border-top: 1px solid var(--border-color); font-size: 13px; color: var(--text-muted); font-weight: 600;">
                    Jami qaydlar: 0 ta
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
                typeBadge = `<span class="status-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: 700;">🚫 Rad etildi (Deny)</span>`;
            } else if (isDialled) {
                if (dur > 0) {
                    typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-weight: 700;"><i class="badge-dir-icon outbound"></i> Chiquvchi (Dialled)</span>`;
                } else {
                    typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);"><i class="badge-dir-icon outbound"></i> Chiquvchi (Ulanmagan)</span>`;
                }
            } else if (statusKey === 'MISSED' || dur === 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⚠️ O'tkazib yuborildi</span>`;
            } else if (statusKey === 'ANSWERED' || dur > 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700;">📞 Javob berildi</span>`;
            } else {
                typeBadge = `<span class="status-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);"><i class="badge-dir-icon inbound"></i> Kiruvchi</span>`;
            }

            const durFormatted = formatSeconds(dur);

            return `
                <tr>
                    <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                    <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${r.event_time || ''}</td>
                    <td style="font-weight: 600; color: var(--text-main); white-space: nowrap;">${opDisplay}</td>
                    <td style="white-space: nowrap;">
                        <div class="phone-cell">
                            <span class="phone-icon">📞</span>
                            <span>${r.caller_id || 'Yashirin'}</span>
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
                        ⬅ Oldingi
                    </button>
                    <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Sahifa ${page} / ${json.totalPages}</span>
                    <button class="btn-action" ${page >= json.totalPages ? 'disabled style="opacity: 0.4;"' : ''} onclick="loadTabOperatorLogs('${opId || ''}', ${page + 1})">
                        Keyingi ➡
                    </button>
                </div>
            `;
        }

        const bottomBarHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid var(--border-color); background: rgba(15, 23, 42, 0.4); margin-top: 4px;">
                <div id="tabOperatorLogsTotal" style="font-size: 13px; color: var(--text-muted); font-weight: 600;">
                    Jami qaydlar: ${totalCount} ta
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
                            <th>Qayd Vaqti</th>
                            <th>Operator</th>
                            <th>Mijoz Raqami</th>
                            <th>Hodisa Turi</th>
                            <th>Suhbat Vaqti</th>
                            <th>Kompyuter (PC)</th>
                            <th>3CX Tarixi</th>
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
                Xatolik: ${err.message}
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
    tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">Yuklanmoqda...</td></tr>`;

    try {
        const res = await fetch('/api/agent/status-all');
        const data = await res.json();

        if (data.releaseConfig) {
            if (curVerEl) curVerEl.innerText = `v${data.releaseConfig.latestVersion}`;
            if (urlEl) urlEl.innerText = data.releaseConfig.updateUrl || '/downloads/agent.exe';
        }

        if (!data.operators || data.operators.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">Operatorlar topilmadi</td></tr>`;
            return;
        }

        const rows = data.operators.map(op => {
            let statusBadge = '';
            let verBadge = '';

            if (op.agentConnected) {
                if (op.isLatest) {
                    statusBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">✅ Eng so'nggi</span>`;
                } else {
                    statusBadge = `<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 3px 8px; border-radius: 12px; font-weight: 600; font-size: 11px; animation: pulse 2s infinite;">⚠️ Yangilanmoqda...</span>`;
                }
                verBadge = `<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 8px; border-radius: 12px; font-weight: 700; font-size: 11px;">v${op.agentVersion || '1.0.0'}</span>`;
            } else {
                statusBadge = `<span style="color: var(--text-dim); font-size: 11px;">⚪ O'chiq (Offline)</span>`;
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
                            ? `<span style="color: #10b981; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981;"></span>🟢 Faol</span>` 
                            : `<span style="color: var(--text-dim);">⚪ O'chiq</span>`}
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
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--danger);">Xatolik: ${err.message}</td></tr>`;
    }
}

async function submitNewRelease() {
    const input = document.getElementById('newReleaseVersionInput');
    const ver = input ? input.value.trim() : '';

    if (!ver) {
        alert('Iltimos, yangi versiya raqamini kiriting! (Masalan: 1.0.1)');
        return;
    }

    if (!confirm(`Haqiqatan ham yangi v${ver} versiyasini e'lon qilmoqchimisiz?\n\nBarcha ulangan operatorlarning kompyuteridagi agentlar fon rejimida avtomatik ravishda ushbu versiyaga yangilanadi.`)) {
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
            alert(`Xatolik: ${result.error || 'Noma\'lum xatolik'}`);
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
    const monthName = UZ_MONTHS[m - 1] || '';
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
                ? `Bugun (${formatDateDisplay(todayStr)})`
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
        labelEl.innerText = `Bugun (${formatDateDisplay(todayStr)})`;
    }

    // Render initial calendar matrix
    renderCalendarMatrix();

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

    titleEl.innerText = `${UZ_MONTHS[calViewMonth]} ${calViewYear}`;
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
    const formattedText = isToday ? `Bugun (${formatDateDisplay(dateStr)})` : formatDateDisplay(dateStr);

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
            if (hintEl) hintEl.innerText = '⚡ Real-time jonli monitoring faol';
        } else {
            badgeEl.className = 'cal-mode-badge archive';
            modeText.innerText = `Arxiv: ${dateStr}`;
            if (backTodayBtn) backTodayBtn.style.display = 'inline-block';
            if (hintEl) hintEl.innerText = `⚡ ${dateStr} sanasi hisoboti ko'rsatilmoqda`;
        }
    }

    // Sync view year/month
    const [y, m] = dateStr.split('-').map(Number);
    calViewYear = y;
    calViewMonth = m - 1;
    renderCalendarMatrix();

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
        if (refreshText) refreshText.innerText = 'Yuklanmoqda...';
        if (statusHint) {
            statusHint.innerHTML = `<span class="cal-loading-badge"><span class="fluent-spinner"></span> Serverdan ma'lumot yuklanmoqda...</span>`;
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
        if (refreshText) refreshText.innerText = 'Yangilash';
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
            statusHint.innerHTML = `<span style="color: #34d399; font-size: 12px; font-weight: 500;">✅ Ma'lumotlar yuklandi (${isToday ? 'Bugun' : targetDate})</span>`;
            setTimeout(() => {
                if (statusHint && statusHint.innerText.includes('yuklandi')) {
                    statusHint.innerHTML = isToday ? '⚡ Real-time jonli monitoring faol' : `⚡ ${targetDate} sanasi hisoboti`;
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
            if (diskDetailEl) diskDetailEl.textContent = `(${data.disk.usedFormatted} band / ${data.disk.freeFormatted} bo'sh - Jami ${data.disk.totalFormatted})`;
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
                    ? `<button onclick="triggerVmAction(${vm.id}, 'stop')" class="btn-action" style="padding: 4px 10px; font-size: 11px; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;">⏹ To'xtatish</button>`
                    : `<button onclick="triggerVmAction(${vm.id}, 'start')" class="btn-action" style="padding: 4px 10px; font-size: 11px; background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4); color: #86efac;">▶ Yoqish</button>`;

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
        if (headerSub) headerSub.textContent = `Xatolik: ${err.message}`;
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
        btn.innerHTML = `<span>⏳</span> Bajarilmoqda...`;
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
                showNotification('✅ Kerio va Issabel VMlari muvaffaqiyatli ishga tushirildi!', 'success');
            } else {
                alert('✅ Kerio va Issabel VMlari muvaffaqiyatli ishga tushirildi!');
            }
        } else {
            alert('Xatolik: ' + (data.error || 'Noma\'lum xatolik'));
        }
        await fetchServerStatus(true);
    } catch (err) {
        if (logBox) logBox.textContent += `\n❌ So'rov yuborishda xatolik: ${err.message}`;
        alert('Serverga ulanishda xatolik: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>⚡</span> Svet o'chib yonganda: 1-Bosishda LVM Fix + VMlarni Yoqish`;
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
            alert('Xatolik: ' + (data.error || 'Noma\'lum xatolik'));
        }
    } catch (err) {
        alert('Xatolik: ' + err.message);
    }
}

// Initialize Application after all components and functions are loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit);
} else {
    runInit();
}

