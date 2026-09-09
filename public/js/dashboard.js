/**
 * Call Center Dashboard & Audio Explorer Frontend Logic
 * Includes: WaveSurfer.js Waveform, Real-time AMI monitoring, SQLite CDR Pagination, and IVR Robot detection
 */

// Global State
let socket = null;
let currentPath = '';
let explorerFilesData = [];
let currentConversations = [];
let currentQueues = [];
let currentOperators = [];
let currentAudioCategory = 'all'; // 'all' | 'talk' | 'robot'

// Call History Pagination State
let historyCurrentPage = 1;
let historyTotalPages = 1;
let historySearchQuery = '';

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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit);
} else {
    runInit();
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

function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-tab');
            switchRoute(target, true);
        });
    });

    window.addEventListener('popstate', () => {
        const path = window.location.pathname.toLowerCase().replace(/\/$/, '') || '/';
        const target = ROUTE_MAP[path] || 'dashboard';
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
                    allowPointSelect: true,
                    cursor: 'pointer',
                    depth: 35,
                    size: '80%',
                    slicedOffset: 20,
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
                    { name: 'Muvaffaqiyatli', y: 1, color: '#10b981', sliced: true },
                    { name: 'Navbatdan chiqdi', y: 0, color: '#f59e0b', sliced: true },
                    { name: 'Chiquvchi', y: 0, color: '#a855f7', sliced: true }
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
        if (msg.data.callHistory) renderDashboardRecentTable(msg.data.callHistory.slice(0, 12));
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
        const total = answeredCalls + abandonedCalls + outboundCalls;
        if (total === 0) {
            callDistributionChart.series[0].setData([
                { name: 'Kutilmoqda', y: 1, color: '#334155' }
            ]);
        } else {
            callDistributionChart.series[0].setData([
                { name: 'Muvaffaqiyatli', y: answeredCalls, color: '#10b981', sliced: true },
                { name: 'Navbatdan chiqdi', y: abandonedCalls, color: '#f59e0b', sliced: true },
                { name: 'Chiquvchi', y: outboundCalls, color: '#a855f7', sliced: true }
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
function initWaveSurfer() {
    if (typeof WaveSurfer === 'undefined') return;

    try {
        wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#6366f1',
            progressColor: '#a855f7',
            cursorColor: '#38bdf8',
            barWidth: 3,
            barGap: 2,
            barRadius: 3,
            height: 60,
            normalize: true
        });

        wavesurfer.on('ready', () => {
            if (waveLoadingText) waveLoadingText.style.display = 'none';
            playerDuration.innerText = formatDuration(wavesurfer.getDuration());
            btnPlayPause.innerText = '⏸';
            wavesurfer.play();
        });

        wavesurfer.on('timeupdate', (time) => {
            playerCurrentTime.innerText = formatDuration(time);
        });

        wavesurfer.on('finish', () => {
            btnPlayPause.innerText = '▶';
        });

        btnPlayPause.addEventListener('click', () => {
            if (!wavesurfer) return;
            if (wavesurfer.isPlaying()) {
                wavesurfer.pause();
                btnPlayPause.innerText = '▶';
            } else {
                wavesurfer.play();
                btnPlayPause.innerText = '⏸';
            }
        });

        document.getElementById('btnRewind10').addEventListener('click', () => {
            if (wavesurfer) wavesurfer.skip(-10);
        });

        document.getElementById('btnForward10').addEventListener('click', () => {
            if (wavesurfer) wavesurfer.skip(10);
        });

        playbackRateSelect.addEventListener('change', (e) => {
            if (wavesurfer) wavesurfer.setPlaybackRate(parseFloat(e.target.value));
        });
    } catch (e) {
        console.warn('WaveSurfer init xatolik:', e);
    }
}

function initExplorer() {
    document.getElementById('btnRefreshExplorer').addEventListener('click', () => {
        loadExplorerPath(currentPath);
    });

    const searchInput = document.getElementById('explorerSearchInput');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        filterExplorerFiles(query);
    });

    // Audio Category Filters
    const btnAll = document.getElementById('filterAudioAll');
    const btnTalk = document.getElementById('filterAudioTalk');
    const btnRobot = document.getElementById('filterAudioRobot');

    const updateFilterActive = (activeBtn, category) => {
        [btnAll, btnTalk, btnRobot].forEach(b => b.classList.remove('active-filter'));
        activeBtn.classList.add('active-filter');
        currentAudioCategory = category;
        filterExplorerFiles(searchInput.value.toLowerCase().trim());
    };

    if (btnAll) btnAll.addEventListener('click', () => updateFilterActive(btnAll, 'all'));
    if (btnTalk) btnTalk.addEventListener('click', () => updateFilterActive(btnTalk, 'talk'));
    if (btnRobot) btnRobot.addEventListener('click', () => updateFilterActive(btnRobot, 'robot'));
}

async function loadExplorerPath(subPath) {
    currentPath = subPath;
    updateBreadcrumbs(subPath);

    const foldersGrid = document.getElementById('explorerFoldersGrid');
    const filesTbody = document.getElementById('explorerFilesTable');

    foldersGrid.innerHTML = '';
    filesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 20px;">Yuklanmoqda...</td></tr>`;

    try {
        const res = await fetch(`/api/recordings/tree?path=${encodeURIComponent(subPath)}`);
        const data = await res.json();

        // Render Directories
        if (data.directories && data.directories.length > 0) {
            foldersGrid.innerHTML = data.directories.map(d => `
                <div class="folder-card" onclick="loadExplorerPath('${d.path.replace(/\\/g, '/')}')">
                    <div class="folder-icon">📁</div>
                    <div class="folder-name">${d.name}</div>
                </div>
            `).join('');
        } else {
            foldersGrid.innerHTML = '';
        }

        // Render Files
        explorerFilesData = data.files || [];
        renderExplorerFilesTable(explorerFilesData);
    } catch (err) {
        filesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 20px;">Xatolik: ${err.message}</td></tr>`;
    }
}

function updateBreadcrumbs(subPath) {
    const container = document.getElementById('explorerBreadcrumbs');
    const parts = subPath ? subPath.split('/').filter(Boolean) : [];

    let html = `<span class="breadcrumb-item ${parts.length === 0 ? 'active' : ''}" onclick="loadExplorerPath('')">📁 monitor</span>`;
    
    let accumulated = '';
    parts.forEach((p, idx) => {
        accumulated = accumulated ? `${accumulated}/${p}` : p;
        const isLast = idx === parts.length - 1;
        html += ` <span>/</span> <span class="breadcrumb-item ${isLast ? 'active' : ''}" onclick="loadExplorerPath('${accumulated}')">${p}</span>`;
    });

    container.innerHTML = html;
}

/**
 * Audio faylni tahlil qilish: Operator gaplashganmi yoki faqat Navbat roboti (IVR)?
 */
function classifyAudioFile(fileName, sizeBytes) {
    const name = fileName.toLowerCase();
    // 1. Agar hajmi juda kichik bo'lsa (< 250 KB ~ 15 soniya) yoki nomida q- va abandon bo'lsa
    const isSmall = sizeBytes && sizeBytes < 280000;
    const isQueuePrefix = name.startsWith('q-') || name.includes('-queue-') || name.includes('ext-queues');
    const hasNoOp = !name.match(/(?:10[1-9]|11[0-9]|12[0-9]|16[0-9]|20[1-9]|40[1-9])/);

    if (name.includes('abandon') || (isQueuePrefix && (isSmall || hasNoOp))) {
        return {
            isRobot: true,
            label: '🤖 Faqat Navbat (Robot)',
            badgeClass: 'badge-warning',
            desc: 'Mijoz faqat navbat robotini eshitgan, operator bilan suhbat bo\'lmagan'
        };
    }

    return {
        isRobot: false,
        label: '🎧 Suhbat (Human Talk)',
        badgeClass: 'badge-success',
        desc: 'Mijoz va operator o\'rtasidagi haqiqiy suhbat'
    };
}

function renderExplorerFilesTable(files) {
    const filesTbody = document.getElementById('explorerFilesTable');
    if (!files || files.length === 0) {
        filesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">Ushbu papkada audio yozuvlar yo'q</td></tr>`;
        return;
    }

    filesTbody.innerHTML = files.map(file => {
        const fileDate = file.modifyTime ? new Date(file.modifyTime).toLocaleString() : 'Bugun';
        const analysis = classifyAudioFile(file.name, file.size);

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
                <td style="color: var(--text-muted); font-size: 12px;">${fileDate}</td>
                <td>
                    <button class="btn-action" onclick="playAudioFile('${file.name}', '${file.path.replace(/\\/g, '/')}', ${file.size || 0})">
                        ▶ Eshitish
                    </button>
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

    if (currentAudioCategory === 'talk') {
        filtered = filtered.filter(f => !classifyAudioFile(f.name, f.size).isRobot);
    } else if (currentAudioCategory === 'robot') {
        filtered = filtered.filter(f => classifyAudioFile(f.name, f.size).isRobot);
    }

    if (query) {
        filtered = filtered.filter(f => f.name.toLowerCase().includes(query));
    }

    renderExplorerFilesTable(filtered);
}

function playAudioFile(fileName, filePath, sizeBytes = 0) {
    playerFileName.innerText = fileName;
    const streamUrl = `/api/recordings/stream?file=${encodeURIComponent(filePath)}`;
    
    const analysis = classifyAudioFile(fileName, sizeBytes);
    if (audioTagBadge) {
        audioTagBadge.style.display = 'inline-block';
        audioTagBadge.className = `badge ${analysis.badgeClass}`;
        audioTagBadge.innerText = analysis.label;
        audioTagBadge.title = analysis.desc;
    }

    if (waveLoadingText) waveLoadingText.style.display = 'flex';

    if (wavesurfer) {
        wavesurfer.load(streamUrl);
        wavesurfer.setPlaybackRate(parseFloat(playbackRateSelect.value || '1'));
    }
}

/* ==========================================================================
   5. Compact Conversations, Queues & Call Transfer (Sidebar)
   ========================================================================== */
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
                    <div class="chan-number">📞 ${c.callerId}</div>
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
    if (kpiQueue) kpiQueue.innerText = `${totalWaiters} ta`;

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
            <span style="color: #fbbf24; font-size: 10px;">Navbatda #${w.position || 1}</span>
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

const EXCLUDED_OPERATOR_IDS = new Set(['1111', '1324', '1001', '1000', '402', '401', '207', '202', '201', '170', '161', '118', '115', '160', '66']);

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

        let statusBadge = '';
        let avatarBg = '';

        if (ringingNow) {
            statusBadge = `<span class="badge badge-warning" style="font-size: 11px; background: rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.4); color: #fbbf24; animation: pulse 1.5s infinite;">📞 Jiringlanmoqda</span>`;
            avatarBg = 'linear-gradient(135deg, #f59e0b, #ea580c)';
        } else if (pres === 'talking') {
            statusBadge = `<span class="badge badge-info" style="font-size: 11px; background: rgba(14, 165, 233, 0.2); border-color: rgba(14, 165, 233, 0.4); color: #38bdf8;">🔵 Suhbatda</span>`;
            avatarBg = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
        } else if (pres === 'offline') {
            statusBadge = `<span class="badge badge-danger" style="font-size: 11px;">🔴 Offline</span>`;
            avatarBg = 'linear-gradient(135deg, #ef4444, #991b1b)';
        } else {
            statusBadge = `<span class="badge badge-success" style="font-size: 11px;">🟢 Tayyor</span>`;
            avatarBg = 'linear-gradient(135deg, #10b981, #059669)';
        }

        // Yulduzlar va MVP reytingi
        let mvpBadge = '';
        let cardClass = 'operator-card clickable-card';
        if (pres === 'offline') {
            cardClass += ' status-offline';
        } else if (ringingNow) {
            cardClass += ' status-ringing status-active call-ringing';
        } else if (pres === 'talking') {
            cardClass += ' status-talking status-active call-talking';
        } else {
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
                            ${stars ? `<span class="star-rating-box" title="${answered} ta qabul qilingan">${stars}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="op-stat-row">
                    <span>Desktop Agent:</span>
                    <span class="op-stat-val" style="font-weight: 600; font-size: 11px; color: ${op.agentConnected ? 'var(--success)' : 'var(--text-dim)'}; display: inline-flex; align-items: center; gap: 5px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'}; ${op.agentConnected ? 'box-shadow: 0 0 6px #10b981;' : ''}"></span>
                        ${op.agentConnected ? `🟢 Faol ${op.agentHostname ? `(${op.agentHostname})` : ''} <span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : `⚪ O'chiq`}
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
            thLast.innerText = 'Tugatish sababi';
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

async function loadHistoryPage(page = 1, search = '') {
    const tbody = document.getElementById('historyTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;"><div class="spinner" style="margin: 0 auto 8px;"></div> Qo'ng'iroqlar tarixi yuklanmoqda...</td></tr>`;
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

            if (pageDisp) pageDisp.innerText = `Sahifa ${historyCurrentPage} / ${historyTotalPages}`;
            if (countInfo) countInfo.innerText = `Jami: ${result.total || 0} ta yozuv`;
            if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
            if (nextBtn) nextBtn.disabled = historyCurrentPage >= historyTotalPages;

            renderAgentHistoryTable(result.data || []);
        } else {
            // 2. Issabel Asterisk CDR Server bazasidan
            const res = await fetch(`/api/history?page=${page}&limit=20&search=${encodeURIComponent(search)}&date=${encodeURIComponent(dateParam)}`);
            const result = await res.json();

            historyCurrentPage = result.page || 1;
            historyTotalPages = result.totalPages || 1;

            const pageDisp = document.getElementById('pageNumberDisplay');
            const countInfo = document.getElementById('historyCountInfo');
            const prevBtn = document.getElementById('btnPrevPage');
            const nextBtn = document.getElementById('btnNextPage');

            if (pageDisp) pageDisp.innerText = `Sahifa ${historyCurrentPage} / ${historyTotalPages}`;
            if (countInfo) countInfo.innerText = `Jami: ${result.total || 0} ta yozuv`;
            if (prevBtn) prevBtn.disabled = historyCurrentPage <= 1;
            if (nextBtn) nextBtn.disabled = historyCurrentPage >= historyTotalPages;

            renderServerHistoryTable(result.data || []);
        }
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger); padding: 20px;">Xatolik yuz berdi: ${e.message}</td></tr>`;
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

function formatOperatorDisplayName(opStr) {
    if (!opStr || opStr === 'Navbat' || opStr === '-') return 'Navbat';
    const match = String(opStr).match(/\b(10[1-9]|11[0-9]|120)\b/);
    if (match) {
        const ext = match[1];
        const name = OPERATOR_NAMES_MAP[ext];
        if (name) return `${name} (${ext})`;
    }
    return opStr;
}

function renderAgentHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    if (!data || data.length === 0) {
        if (historySearchQuery && historyDateScope === 'today') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
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
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">3CX Desktop Agent bo'yicha qo'ng'iroqlar jurnali bo'sh</td></tr>`;
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
            ? '<span class="badge badge-purple">📤 Chiquvchi</span>' 
            : '<span class="badge badge-info">📥 Kiruvchi</span>';

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

        return `
            <tr>
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td style="text-align: left;">${timeHtml}</td>
                <td>
                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                        <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                        <span style="font-weight: 600;">${item.caller_id || '-'}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator_id)}</td>
                <td>${dirBadge}</td>
                <td style="font-family: monospace; font-weight: 600; color: ${isAns ? 'var(--text-main)' : 'var(--text-dim)'};">${formatSeconds(item.duration_sec || 0)}</td>
                <td>${statusBadge}</td>
                <td style="color: var(--text-muted); font-size: 12px;">
                    <span style="display: inline-flex; align-items: center; gap: 4px;">
                        <span>💻</span> ${item.hostname || 'Desktop'}
                    </span>
                </td>
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
                    <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 32px 20px;">
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
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">Issabel serverida qo'ng'iroqlar jurnali bo'sh</td></tr>`;
        }
        return;
    }

    const isAll = (historyDateScope === 'all');

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = (historyCurrentPage - 1) * 20 + index + 1;
        const isOut = item.direction === 'outbound';
        const isAns = item.status === 'ANSWERED';
        const statusBadge = isAns 
            ? '<span class="badge badge-success">✅ Javob berilgan</span>' 
            : (item.status === 'BUSY' ? '<span class="badge badge-danger">🚫 Band</span>' : (isOut ? '<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 Javobsiz</span>' : '<span class="badge badge-warning">⏳ Navbatdan chiqdi</span>'));
        const dirBadge = isOut 
            ? '<span class="badge badge-purple">📤 chiquvchi</span>' 
            : '<span class="badge badge-info">📥 kiruvchi</span>';

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

        return `
            <tr>
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td style="text-align: left;">${timeHtml}</td>
                <td>
                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                        <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                        <span>${item.callerId}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator)}</td>
                <td>${dirBadge}</td>
                <td>${formatSeconds(item.duration || 0)}</td>
                <td>${statusBadge}</td>
                <td style="color: var(--text-muted); font-size: 12px;">${item.hangupParty || item.cause || 'Normal'}</td>
            </tr>
        `;
    }).join('');
}

const renderHistoryTable = renderServerHistoryTable;

function renderDashboardRecentTable(data) {
    const tbody = document.getElementById('dashboardCallsTable');
    if (!data || data.length === 0) return;

    tbody.innerHTML = data.map((item, index) => {
        const rowNum = index + 1;
        const isOut = item.direction === 'outbound';
        const isAns = item.status === 'ANSWERED';
        const statusBadge = isAns 
            ? '<span class="badge badge-success">✅ Javob berilgan</span>' 
            : (item.status === 'BUSY' ? '<span class="badge badge-danger">🚫 Band</span>' : (isOut ? '<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 Javobsiz</span>' : '<span class="badge badge-warning">⏳ Navbatdan chiqdi</span>'));
        const dirBadge = isOut 
            ? '<span class="badge badge-purple">📤 chiquvchi</span>' 
            : '<span class="badge badge-info">📥 kiruvchi</span>';

        return `
            <tr>
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td>${new Date(item.time).toLocaleTimeString()}</td>
                <td>
                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                        <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                        <span>${item.callerId}</span>
                    </div>
                </td>
                <td>${dirBadge}</td>
                <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(item.operator)}</td>
                <td>${formatSeconds(item.duration || 0)}</td>
                <td>${statusBadge}</td>
                <td style="font-weight: 500; font-size: 12px; color: ${item.hangupParty?.includes('Operator') ? 'var(--warning)' : (item.hangupParty?.includes('Mijoz') ? 'var(--secondary)' : 'var(--text-dim)')};">
                    ${item.hangupParty || 'Noma\'lum'}
                </td>
                <td>
                    <button class="btn-action" onclick="document.querySelector('[data-tab=explorer]').click()">📂 Audio</button>
                </td>
            </tr>
        `;
    }).join('');
}

function addRecentDashboardRow(record) {
    const tbody = document.getElementById('dashboardCallsTable');
    const row = document.createElement('tr');
    const isOut = record.direction === 'outbound';
    const isAns = record.status === 'ANSWERED';
    const statusBadge = isAns 
        ? '<span class="badge badge-success">✅ Javob berilgan</span>' 
        : (record.status === 'BUSY' ? '<span class="badge badge-danger">🚫 Band</span>' : (isOut ? '<span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">📵 Javobsiz</span>' : '<span class="badge badge-warning">⏳ Navbatdan chiqdi</span>'));
    const dirBadge = isOut 
        ? '<span class="badge badge-purple">📤 chiquvchi</span>' 
        : '<span class="badge badge-info">📥 kiruvchi</span>';

    row.innerHTML = `
        <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">1</td>
        <td>${new Date(record.time).toLocaleTimeString()}</td>
        <td>
            <div class="phone-cell ${isOut ? 'outbound' : ''}">
                <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                <span>${record.callerId}</span>
            </div>
        </td>
        <td>${dirBadge}</td>
        <td style="font-weight: 600; color: var(--text-main);">${formatOperatorDisplayName(record.operator)}</td>
        <td>${formatSeconds(record.duration || 0)}</td>
        <td>${statusBadge}</td>
        <td style="font-weight: 500; font-size: 12px; color: ${record.hangupParty?.includes('Operator') ? 'var(--warning)' : (record.hangupParty?.includes('Mijoz') ? 'var(--secondary)' : 'var(--text-dim)')};">
            ${record.hangupParty || 'Noma\'lum'}
        </td>
        <td>
            <button class="btn-action" onclick="document.querySelector('[data-tab=explorer]').click()">📂 Audio</button>
        </td>
    `;
    if (tbody.children.length > 0 && tbody.children[0].children.length === 1) {
        tbody.innerHTML = '';
    }
    tbody.insertBefore(row, tbody.firstChild);
    if (tbody.children.length > 12) tbody.removeChild(tbody.lastChild);

    // Qatorlar tartib raqamini (1, 2, 3...) har safar to'g'ri yangilash
    Array.from(tbody.children).forEach((r, idx) => {
        if (r.children && r.children[0]) {
            r.children[0].innerText = idx + 1;
        }
    });
}

/* ==========================================================================
   Helper Functions
   ========================================================================== */
function formatSeconds(sec) {
    sec = Math.round(sec);
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return `${hrs > 0 ? String(hrs).padStart(2, '0') + ':' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDuration(sec) {
    if (isNaN(sec) || !isFinite(sec)) return '00:00';
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

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

document.addEventListener('DOMContentLoaded', () => {
    const btnClose = document.getElementById('btnCloseDetailModal');
    const btnCloseBtn = document.getElementById('btnCloseDetailModalBtn');
    const modal = document.getElementById('detailModal');
    const limitSelect = document.getElementById('detailLimitSelect');
    const searchInput = document.getElementById('detailSearchInput');
    const prevBtn = document.getElementById('detailPrevPage');
    const nextBtn = document.getElementById('detailNextPage');

    if (btnClose) btnClose.addEventListener('click', closeDetailModal);
    if (btnCloseBtn) btnCloseBtn.addEventListener('click', closeDetailModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeDetailModal();
        });
    }

    if (limitSelect) {
        limitSelect.addEventListener('change', (e) => {
            detailState.limit = parseInt(e.target.value, 10) || 100;
            detailState.page = 1;
            fetchAndRenderDetailCalls();
        });
    }

    let searchTimeout = null;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                detailState.search = e.target.value.trim();
                detailState.page = 1;
                fetchAndRenderDetailCalls();
            }, 300);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (detailState.page > 1) {
                detailState.page--;
                fetchAndRenderDetailCalls();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (detailState.page < detailState.totalPages) {
                detailState.page++;
                fetchAndRenderDetailCalls();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDetailModal();
    });
});

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
        const queryParams = new URLSearchParams({
            type: detailState.type,
            operator: detailState.operatorExt,
            page: detailState.page,
            limit: detailState.limit,
            search: detailState.search
        });
        if (currentSelectedDate) {
            queryParams.set('date', currentSelectedDate);
        }

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
                            ? `<span class="badge badge-purple" style="font-size: 10px;">📤 chiquvchi</span>`
                            : `<span class="badge badge-info" style="font-size: 10px;">📥 kiruvchi</span>`;

                        return `
                            <tr>
                                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                                <td style="color: var(--text-dim); font-size: 12px; white-space: nowrap;">${new Date(c.time).toLocaleTimeString()}</td>
                                <td style="white-space: nowrap;">
                                    <div class="phone-cell ${isOut ? 'outbound' : ''}">
                                        <span class="phone-icon">${isOut ? '📤' : '📞'}</span>
                                        <span>${c.callerId}</span>
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
    if (!recordingFile) return;

    // Agar ayni shu tugma bosilgan bo'lsa va audio yangrayotgan bo'lsa -> To'xtatish (Toggle Pause)
    if (currentDetailAudio && currentDetailBtn === btn) {
        currentDetailAudio.pause();
        currentDetailAudio = null;
        currentDetailBtn = null;
        btn.classList.remove('btn-playing-audio');
        btn.innerHTML = '▶ Tinglash';
        return;
    }

    // Boshqa audio yangrayotgan bo'lsa to'xtatish
    if (currentDetailAudio) {
        try {
            currentDetailAudio.pause();
        } catch (e) {}
        currentDetailAudio = null;
    }
    document.querySelectorAll('.btn-playing-audio').forEach(b => {
        b.classList.remove('btn-playing-audio');
        b.innerHTML = '▶ Tinglash';
    });

    const audioUrl = `/api/recordings/stream?file=${encodeURIComponent(recordingFile)}`;
    const audio = new Audio(audioUrl);
    currentDetailAudio = audio;
    currentDetailBtn = btn;

    btn.classList.add('btn-playing-audio');
    btn.innerHTML = '⏹ To\'xtatish';

    audio.play().catch(e => {
        // Agar foydalanuvchi to'xtatgan bo'lsa yoki abort bo'lsa, alert chiqarmaslik
        if (e.name === 'AbortError' || (e.message && e.message.includes('interrupted'))) {
            return;
        }
        alert('Audio faylni ochib bo\'lmadi: ' + e.message);
        btn.innerHTML = '▶ Tinglash';
        btn.classList.remove('btn-playing-audio');
        if (currentDetailAudio === audio) currentDetailAudio = null;
        if (currentDetailBtn === btn) currentDetailBtn = null;
    });

    audio.onended = () => {
        btn.innerHTML = '▶ Tinglash';
        btn.classList.remove('btn-playing-audio');
        if (currentDetailAudio === audio) currentDetailAudio = null;
        if (currentDetailBtn === btn) currentDetailBtn = null;
    };
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
                    typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-weight: 700;">📤 Chiquvchi</span>`;
                } else {
                    typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">📤 Chiquvchi (Ulanmagan)</span>`;
                }
            } else if (t === 'MISSED' || dur === 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⚠️ O'tkazib yuborildi</span>`;
            } else if (t === 'ANSWERED' || dur > 0) {
                typeBadge = `<span class="status-badge answered">🟢 Javob berildi</span>`;
            } else if (t === 'RINGING' || t === 'INCOMING') {
                typeBadge = `<span class="status-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);">📥 Kiruvchi</span>`;
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
        if (grid) grid.classList.add('is-loading');

        const res = await fetch(`/api/agent/operator-stats${urlDateParam}`);
        tabAgentOperatorsData = await res.json();
        renderTabAgentOperators(tabAgentOperatorsData);
    } catch (e) {
        console.error('loadTabAgentOperators error:', e.message);
    } finally {
        if (grid) grid.classList.remove('is-loading');
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

function renderTabAgentOperators(operators) {
    const grid = document.getElementById('tabOperatorsGrid');
    if (!grid) return;

    if (!operators || operators.length === 0) {
        grid.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; padding: 16px;">Hozircha 3CX Desktop Agent ma'lumotlari mavjud emas.</div>`;
        return;
    }

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
    if (selectEl && selectEl.options.length <= 1) {
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
                            ${stars ? `<span class="star-rating-box" title="${answered} ta qabul qilingan">${stars}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="op-stat-row">
                    <span>Desktop Agent:</span>
                    <span class="op-stat-val" style="font-weight: 600; font-size: 11px; color: ${op.agentConnected ? 'var(--success)' : 'var(--text-dim)'}; display: inline-flex; align-items: center; gap: 5px;">
                        <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'};"></span>
                        ${op.agentConnected ? `Faol ${op.agentHostname ? `(${op.agentHostname})` : ''} <span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : `O'chiq`}
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
                    typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-weight: 700;">📤 Chiquvchi (Dialled)</span>`;
                } else {
                    typeBadge = `<span class="status-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">📤 Chiquvchi (Ulanmagan)</span>`;
                }
            } else if (statusKey === 'MISSED' || dur === 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⚠️ O'tkazib yuborildi</span>`;
            } else if (statusKey === 'ANSWERED' || dur > 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700;">📞 Javob berildi</span>`;
            } else {
                typeBadge = `<span class="status-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);">📥 Kiruvchi</span>`;
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
        if (tabOpGrid) tabOpGrid.classList.add('is-loading');

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
            tabOpGrid.querySelectorAll('.op-stat-val, h4, .operator-avatar').forEach(el => {
                el.classList.remove('number-pop');
                void el.offsetWidth; // trigger reflow
                el.classList.add('number-pop');
            });
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

