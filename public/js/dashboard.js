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
let operatorChart = null;

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
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initCharts();
    initWebSocket();
    initWaveSurfer();
    initExplorer();
    initHistoryPagination();
    initTransferModal();
    loadInitialData();

    // Avtomatik har 5 soniyada yangilash (foydalanuvchi bosishi shart emas)
    setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'refresh_channels' }));
        }
    }, 5000);
});

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
    operators: "Operatorlar Nazorati | Call Center AI",
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
        if (typeof callDistributionChart !== 'undefined' && callDistributionChart) callDistributionChart.resize();
    } else if (target === 'operators') {
        if (typeof operatorChart !== 'undefined' && operatorChart) operatorChart.resize();
        loadTabAgentOperators();
        loadTabOperatorLogs(selectedTabAgentOpId, 1);
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
                    tension: 0.3
                },
                {
                    label: 'Javob berilgan (Answered)',
                    data: new Array(14).fill(0),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    fill: true,
                    tension: 0.3
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

    // 2. Inbound Answered vs Abandoned vs Outbound Donut Chart
    const ctxDist = document.getElementById('callDistributionChart').getContext('2d');
    callDistributionChart = new Chart(ctxDist, {
        type: 'doughnut',
        data: {
            labels: ['Muvaffaqiyatli', 'Navbatdan chiqdi', 'Chiquvchi'],
            datasets: [{
                data: [1, 0, 0],
                backgroundColor: ['#10b981', '#f59e0b', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed || 0;
                            return ` ${context.label}: ${value} ta`;
                        }
                    }
                }
            },
            cutout: '70%'
        }
    });

    // 3. Operator Performance Chart
    const ctxOp = document.getElementById('operatorChart').getContext('2d');
    operatorChart = new Chart(ctxOp, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Qabul qilingan',
                    data: [],
                    backgroundColor: '#10b981',
                    borderRadius: 6
                },
                {
                    label: 'Mijoz qo\'ydi (Client)',
                    data: [],
                    backgroundColor: '#06b6d4',
                    borderRadius: 6
                },
                {
                    label: 'Operator qo\'ydi (Op Hangup)',
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
}

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

    document.getElementById('btnSync').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'sync' }));
        }
    });
}

function handleWsMessage(msg) {
    if (msg.type === 'initial_state') {
        updateAmiStatus(msg.data.amiStatus);
        updateSftpStatus(msg.data.sftpStatus);
        updateStatsUI(msg.data.stats);
        if (msg.data.conversations) renderActiveConversations(msg.data.conversations);
        if (msg.data.queues) renderQueues(msg.data.queues);
        if (msg.data.operators) renderOperators(msg.data.operators);
        if (msg.data.callHistory) renderDashboardRecentTable(msg.data.callHistory.slice(0, 10));
    } else if (msg.type === 'ami_status') {
        updateAmiStatus(msg.data.connected);
    } else if (msg.type === 'sftp_status') {
        updateSftpStatus(msg.data.connected);
    } else if (msg.type === 'stats_update') {
        updateStatsUI(msg.data);
    } else if (msg.type === 'active_conversations_update') {
        renderActiveConversations(msg.data);
    } else if (msg.type === 'queue_update') {
        renderQueues(msg.data);
    } else if (msg.type === 'operators_update') {
        renderOperators(msg.data);
    } else if (msg.type === 'agent_operators_update') {
        tabAgentOperatorsData = msg.data;
        renderTabAgentOperators(tabAgentOperatorsData);
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
    
    const opTotalAnswered = (currentOperators && currentOperators.length > 0) ? currentOperators.reduce((sum, o) => sum + (o.answered || 0), 0) : 0;
    const answeredCalls = (stats.answeredCalls && stats.answeredCalls > 0) ? stats.answeredCalls : opTotalAnswered;
    const inboundCalls = stats.inboundCalls || stats.totalCalls || 0;
    const outboundCalls = stats.outboundCalls || 0;
    const totalCalls = stats.totalCalls || (inboundCalls + outboundCalls);
    const abandonedCalls = stats.abandonedCalls || 0;
    const deniedCalls = stats.deniedCalls || 0;
    const missedCalls = stats.missedCalls !== undefined ? stats.missedCalls : currentOperators.reduce((sum, o) => sum + (o.missed || 0), 0);
    
    const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
    const abandonedRate = inboundCalls > 0 ? Math.round((abandonedCalls / inboundCalls) * 100) : 0;
    const denyRate = totalCalls > 0 ? Math.round((deniedCalls / totalCalls) * 100) : 0;
    const missedRate = totalCalls > 0 ? Math.round((missedCalls / totalCalls) * 100) : 0;

    const elTotal = document.getElementById('kpiTotalCalls');
    const elInbound = document.getElementById('kpiInbound');
    const elOutbound = document.getElementById('kpiOutbound');
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
    if (elAnswered) elAnswered.innerText = answeredCalls;
    if (elAnswerRate) elAnswerRate.innerText = `${answerRate}%`;
    if (elAbandoned) elAbandoned.innerText = abandonedCalls;
    if (elAbandonedRate) elAbandonedRate.innerText = `${abandonedRate}%`;
    if (elDenied) elDenied.innerText = deniedCalls;
    if (elDenyRate) elDenyRate.innerText = `${denyRate}%`;
    if (elMissed) elMissed.innerText = missedCalls;
    
    const queueWaiting = stats.queueWaitingTotal || 0;
    const kpiQueue = document.getElementById('kpiQueueWaiting');
    if (kpiQueue) kpiQueue.innerText = `${queueWaiting} ta`;

    // Real-time Hourly Chart yangilash (08:00 - 21:00)
    if (stats.hourlyChart && callVolumeChart) {
        callVolumeChart.data.labels = stats.hourlyChart.labels;
        callVolumeChart.data.datasets[0].data = stats.hourlyChart.inbound;
        callVolumeChart.data.datasets[1].data = stats.hourlyChart.answered;
        callVolumeChart.update();
    }

    // Update Donut Chart (Inbound, Outbound, Abandoned)
    if (callDistributionChart) {
        callDistributionChart.data.datasets[0].data = [
            answeredCalls,
            abandonedCalls,
            outboundCalls
        ];
        callDistributionChart.update();
    }
}

// Background Auto-Refresh Polling (Har 5 soniyada yangilab turadi)
setInterval(async () => {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        if (stats && !stats.error) {
            updateStatsUI(stats);
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
function renderActiveConversations(conversations) {
    currentConversations = conversations || [];
    const container = document.getElementById('activeChannelsContainer');
    const countEl = document.getElementById('activeLineCount');
    
    // Faol liniyalar soni
    countEl.innerText = currentConversations.length;

    if (!currentConversations || currentConversations.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 12px; font-size: 11px;">
                Hozircha faol suhbatlar yo'q
            </div>
        `;
        return;
    }

    container.innerHTML = currentConversations.map(c => {
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

        return `
            <div class="compact-channel-card ${isTalking ? 'talking' : 'ringing'}">
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
            </div>
        `;
    }).join('');
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
function renderOperators(operators) {
    const weight = { 'ready': 1, 'talking': 2, 'paused': 3, 'offline': 4 };
    currentOperators = (operators || [])
        .filter(op => !EXCLUDED_OPERATOR_IDS.has(String(op.id)))
        .slice().sort((a, b) => {
            const wA = weight[a.presence] || 5;
            const wB = weight[b.presence] || 5;
            if (wA !== wB) return wA - wB;
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
        let statusBadge = '';
        let avatarBg = '';

        if (pres === 'talking') {
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
        } else if (pres === 'talking') {
            cardClass += ' status-talking status-active';
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

        return `
            <div class="${cardClass}" onclick="openOperatorDetail('${op.id}')" title="${op.name} tafsilotlarini va suhbatlarini ko'rish uchun bosing">
                <div class="operator-head">
                    <div class="operator-avatar" style="background: ${avatarBg};">${op.id.slice(-2)}</div>
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <h4 style="font-size: 15px; font-weight: 700;">${op.name}</h4>
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
                    <span>Liniya holati:</span>
                    <span class="op-stat-val" style="font-weight: 700; color: ${pres === 'ready' ? 'var(--success)' : (pres === 'talking' ? '#38bdf8' : 'var(--danger)')};">
                        ${pres === 'ready' ? '✅ Qabul qilishga tayyor' : (pres === 'talking' ? '🔵 Hozir gaplashmoqda' : '❌ 3CX ulanmagan')}
                    </span>
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
                    <span class="op-stat-val" style="color: var(--success); font-weight: 700;">${op.answered} ta</span>
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

    // Update Operator Chart
    if (operatorChart && currentOperators.length > 0) {
        operatorChart.data.labels = currentOperators.map(o => o.name);
        operatorChart.data.datasets[0].data = currentOperators.map(o => o.answered || 0);
        operatorChart.data.datasets[1].data = currentOperators.map(o => o.clientHangup || 0);
        operatorChart.data.datasets[2].data = currentOperators.map(o => o.operatorHangup || 0);
        operatorChart.update();
    }

    if (typeof renderOperatorChips === 'function') {
        renderOperatorChips();
        if (typeof selectedCompareOpId !== 'undefined' && selectedCompareOpId) {
            const op = currentOperators.find(o => String(o.id) === String(selectedCompareOpId));
            if (op && typeof renderCompareStats === 'function') renderCompareStats(op);
        }
    }
}

/* ==========================================================================
   7. Call History & SQLite Pagination
   ========================================================================== */
function initHistoryPagination() {
    const input = document.getElementById('historySearchInput');
    let searchTimeout = null;

    input.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            historySearchQuery = e.target.value.trim();
            loadHistoryPage(1, historySearchQuery);
        }, 300);
    });

    document.getElementById('btnPrevPage').addEventListener('click', () => {
        if (historyCurrentPage > 1) {
            loadHistoryPage(historyCurrentPage - 1, historySearchQuery);
        }
    });

    document.getElementById('btnNextPage').addEventListener('click', () => {
        if (historyCurrentPage < historyTotalPages) {
            loadHistoryPage(historyCurrentPage + 1, historySearchQuery);
        }
    });
}

async function loadHistoryPage(page = 1, search = '') {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Yuklanmoqda...</td></tr>`;

    try {
        const res = await fetch(`/api/history?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
        const result = await res.json();

        historyCurrentPage = result.page || 1;
        historyTotalPages = result.totalPages || 1;

        document.getElementById('pageNumberDisplay').innerText = `Sahifa ${historyCurrentPage} / ${historyTotalPages}`;
        document.getElementById('historyCountInfo').innerText = `Jami: ${result.total || 0} ta yozuv (SQLite)`;
        document.getElementById('btnPrevPage').disabled = historyCurrentPage <= 1;
        document.getElementById('btnNextPage').disabled = historyCurrentPage >= historyTotalPages;

        renderHistoryTable(result.data || []);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 20px;">Xatolik: ${e.message}</td></tr>`;
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

function renderHistoryTable(data) {
    const tbody = document.getElementById('historyTableBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">Qo'ng'iroqlar jurnali bo'sh</td></tr>`;
        return;
    }

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

        return `
            <tr>
                <td style="color: var(--text-dim); font-size: 12px; font-weight: 600; text-align: center; width: 45px;">${rowNum}</td>
                <td style="font-family: monospace; color: var(--text-muted);">${new Date(item.time).toLocaleTimeString()}</td>
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
    if (tbody.children.length > 10) tbody.removeChild(tbody.lastChild);
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
    } catch (e) {
        console.warn('Dastlabki yuklash xatosi:', e);
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
        <div style="text-align: center; padding: 40px; color: var(--text-dim);">
            <div class="spinner" style="margin: 0 auto 12px; width: 28px; height: 28px; border: 3px solid rgba(59, 130, 246, 0.2); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            Ma'lumotlar yuklanmoqda...
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
                                <td style="font-weight: 600; color: var(--text-main); white-space: nowrap;">${c.operator}</td>
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

    titleEl.innerHTML = `📊 ${title}`;
    subTitleEl.innerText = `Bugungi kun bo'yicha saralangan qo'ng'iroqlar tafsiloti`;
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

    titleEl.innerHTML = `👤 ${op.name} — Tafsilotlar & Bugungi Suhbatlar`;
    subTitleEl.innerText = `Operatorning kunlik faolligi, intizomi va audio yozuvlari`;

    // Operator Summary Header
    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-right: 20px;">
            <div class="operator-avatar" style="width: 48px; height: 48px; font-size: 18px; background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
                ${String(op.id).slice(-2)}
            </div>
            <div>
                <h4 style="font-size: 16px; font-weight: 700; color: #fff;">${op.name}</h4>
                <span style="font-size: 12px; color: var(--text-dim);">Ichki raqam: ${op.id} ${op.ip ? `• IP: ${op.ip}` : ''}</span>
            </div>
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center;">
            <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 6px 12px; border-radius: var(--radius-sm);">
                <span style="font-size: 11px; color: var(--text-muted); display: block;">Qabul qilingan:</span>
                <b style="font-size: 14px; color: var(--success);">${op.answered || 0} ta</b>
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

            if (t === 'REJECT') {
                typeBadge = `<span class="status-badge failed">🚫 Rad etildi</span>`;
            } else if (t === 'MISSED' || (dur === 0 && t !== 'DIALLED' && t !== 'OUTBOUND')) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⚠️ O'tkazib yuborildi</span>`;
            } else if ((t === 'ANSWERED' || dur > 0) && dur > 0) {
                typeBadge = `<span class="status-badge answered">🟢 Javob berildi</span>`;
            } else if (t === 'DIALLED' || t === 'OUTBOUND') {
                typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4);">📤 Chiquvchi</span>`;
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
let selectedTabAgentDate = 'today';
let tabOperatorLogsPage = 1;
const tabOperatorLogsLimit = 50;

function filterTabAgentLogsByDate(val) {
    selectedTabAgentDate = val || 'today';
    loadTabOperatorLogs(selectedTabAgentOpId, 1);
}
window.filterTabAgentLogsByDate = filterTabAgentLogsByDate;

async function loadTabAgentOperators(force = false) {
    try {
        const res = await fetch('/api/agent/operator-stats');
        tabAgentOperatorsData = await res.json();
        renderTabAgentOperators(tabAgentOperatorsData);
    } catch (e) {
        console.error('loadTabAgentOperators error:', e.message);
    }
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
            titleEl.innerText = 'Barcha Operatorlar';
        } else {
            const op = tabAgentOperatorsData.find(o => String(o.id) === selectedTabAgentOpId);
            titleEl.innerText = op ? `${op.name}` : `Operator ${selectedTabAgentOpId}`;
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

    let countReady = 0;
    let countAgentOnline = 0;
    let totalAns = 0;
    let totalMissed = 0;

    // Operator select dropdown
    const selectEl = document.getElementById('tabAgentLogOpSelect');
    if (selectEl && selectEl.options.length <= 1) {
        operators.forEach(op => {
            const opt = document.createElement('option');
            opt.value = op.id;
            opt.innerText = `${op.name || op.realName || op.id}`;
            selectEl.appendChild(opt);
        });
    }

    grid.innerHTML = operators.map(op => {
        const pres = op.presence || 'ready';
        if (pres === 'ready') countReady++;
        if (op.agentConnected) countAgentOnline++;
        const answered = op.answered || 0;
        const missed = op.missed || 0;
        totalAns += answered;
        totalMissed += missed;

        let statusBadge = '';
        let avatarBg = '';
        if (pres === 'talking') {
            statusBadge = `<span class="badge badge-info" style="font-size: 11px; background: rgba(14, 165, 233, 0.2); border-color: rgba(14, 165, 233, 0.4); color: #38bdf8;">🔵 Suhbatda</span>`;
            avatarBg = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
        } else if (pres === 'offline') {
            statusBadge = `<span class="badge badge-danger" style="font-size: 11px;">🔴 Offline</span>`;
            avatarBg = 'linear-gradient(135deg, #ef4444, #991b1b)';
        } else {
            statusBadge = `<span class="badge badge-success" style="font-size: 11px;">🟢 Tayyor</span>`;
            avatarBg = 'linear-gradient(135deg, #10b981, #059669)';
        }

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
        let cardClass = 'operator-card clickable-card';
        if (pres === 'offline') cardClass += ' status-offline';
        else if (pres === 'talking') cardClass += ' status-talking status-active';
        else cardClass += ' status-ready status-active';

        if (op.id === top1Id && answered > 0) {
            mvpBadge = `<span class="mvp-badge gold" title="3CX Agent bo'yicha yetakchi operator">👑 MVP</span>`;
            cardClass += ' mvp-gold';
            avatarBg = 'linear-gradient(135deg, #f59e0b, #d97706)';
        } else if (stars === '⭐') {
            mvpBadge = `<span class="mvp-badge npc" title="1 ta yulduzli operator">🤖 NPC</span>`;
        }

        const isSelected = selectedTabAgentOpId === String(op.id);
        const selectedBorder = isSelected ? 'border: 2px solid var(--primary); box-shadow: 0 0 16px rgba(59, 130, 246, 0.4);' : '';

        return `
            <div class="${cardClass}" style="${selectedBorder}" onclick="filterTabAgentLogsByOperator('${op.id}')" title="${op.name} tafsilotlarini va 3CX jurnallarini ko'rish uchun bosing">
                <div class="operator-head">
                    <div class="operator-avatar" style="background: ${avatarBg};">${op.id.slice(-2)}</div>
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <h4 style="font-size: 15px; font-weight: 700;">${op.name}</h4>
                                ${mvpBadge}
                            </div>
                            ${statusBadge}
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
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${op.agentConnected ? '#10b981' : '#64748b'}; ${op.agentConnected ? 'box-shadow: 0 0 6px #10b981;' : ''}"></span>
                        ${op.agentConnected ? `🟢 Faol ${op.agentHostname ? `(${op.agentHostname})` : ''} <span class="agent-ver-badge">v${op.agentVersion || '1.0.0'}</span>` : `⚪ O'chiq`}
                    </span>
                </div>
                <div class="op-stat-row">
                    <span>Qabul qilingan:</span>
                    <span class="op-stat-val" style="color: var(--success); font-weight: 700;">${answered} ta</span>
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
    const elMiss = document.getElementById('tabOpTotalMissed');

    if (elReady) elReady.innerText = countReady;
    if (elAgent) elAgent.innerText = `${countAgentOnline} ta`;
    if (elAns) elAns.innerText = `${totalAns} ta`;
    if (elMiss) elMiss.innerText = `${totalMissed} ta`;

    // Operatorlar bo'yicha grafikni ham 3CX agent ma'lumotlari bilan yangilash
    if (operatorChart && operators.length > 0) {
        operatorChart.data.labels = operators.map(o => o.realName || o.name || o.id);
        operatorChart.data.datasets[0].data = operators.map(o => o.answered || 0);
        operatorChart.update();
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
        let url = `/api/agent/logs?page=${page}&limit=${tabOperatorLogsLimit}&date=${encodeURIComponent(selectedTabAgentDate || 'today')}`;
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

            if (statusKey === 'REJECT') {
                typeBadge = `<span class="status-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: 700;">🚫 Rad etildi (Deny)</span>`;
            } else if (statusKey === 'MISSED' || (dur === 0 && statusKey !== 'OUTBOUND' && statusKey !== 'DIALLED')) {
                typeBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⚠️ O'tkazib yuborildi (Missed)</span>`;
            } else if ((statusKey === 'ANSWERED' || dur > 0) && dur > 0) {
                typeBadge = `<span class="status-badge" style="background: rgba(160, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700;">📞 Javob berildi</span>`;
            } else if (statusKey === 'OUTBOUND' || statusKey === 'DIALLED') {
                typeBadge = `<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4);">📤 Chiquvchi (Dialled)</span>`;
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

        let paginationHtml = '';
        if (json.totalPages > 1) {
            paginationHtml = `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid var(--border-color);">
                    <button class="btn-action" ${page <= 1 ? 'disabled style="opacity: 0.4;"' : ''} onclick="loadTabOperatorLogs('${opId || ''}', ${page - 1})">
                        ⬅ Oldingi
                    </button>
                    <span style="font-size: 13px; color: var(--text-muted);">Sahifa ${page} / ${json.totalPages}</span>
                    <button class="btn-action" ${page >= json.totalPages ? 'disabled style="opacity: 0.4;"' : ''} onclick="loadTabOperatorLogs('${opId || ''}', ${page + 1})">
                        Keyingi ➡
                    </button>
                </div>
            `;
        }

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
            ${paginationHtml}
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

