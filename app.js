process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
});

const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const amiService = require('./services/amiService');
const sftpService = require('./services/sftpService');
const dbService = require('./services/dbService');
const syncService = require('./services/syncService');
const exportService = require('./services/exportService');

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerSpec');

const app = express();
app.set('json spaces', 2);

// SSL Sertifikatlari (Self-Signed yoki Custom SSL)
const sslKeyPath = path.join(__dirname, 'ssl', 'server.key');
const sslCertPath = path.join(__dirname, 'ssl', 'server.crt');
const hasSsl = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

let server;
let isMultiplexed = false;
const wss = new WebSocket.Server({ noServer: true });

const handleUpgrade = (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
};

if (hasSsl) {
    try {
        const httpsOptions = {
            key: fs.readFileSync(sslKeyPath),
            cert: fs.readFileSync(sslCertPath)
        };
        const httpServer = http.createServer(app);
        const httpsServer = https.createServer(httpsOptions, app);

        httpServer.on('upgrade', handleUpgrade);
        httpsServer.on('upgrade', handleUpgrade);

        // HTTP va HTTPS ni bitta portda birgalikda qabul qiluvchi multiplexer:
        // Agar birinchi bayt 22 (0x16 TLS Handshake) bo'lsa -> HTTPS
        // Aks holda (GET, POST va h.k.) -> HTTP
        server = net.createServer((socket) => {
            socket.once('data', (buffer) => {
                socket.pause();
                socket.unshift(buffer);
                if (buffer[0] === 22) {
                    httpsServer.emit('connection', socket);
                } else {
                    httpServer.emit('connection', socket);
                }
                process.nextTick(() => socket.resume());
            });
        });
        server.on('error', (err) => console.error('Server multiplexer xatosi:', err));
        isMultiplexed = true;
    } catch (sslErr) {
        console.error('⚠️ SSL yuklashda xatolik yuz berdi, oddiy HTTP ga qaytilmoqda:', sslErr.message);
        server = http.createServer(app);
        server.on('upgrade', handleUpgrade);
    }
} else {
    server = http.createServer(app);
    server.on('upgrade', handleUpgrade);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Swagger API Hujjatlari (UI & JSON)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/swagger', (req, res) => res.redirect('/api-docs'));
app.get('/api/docs-json', (req, res) => res.json(swaggerSpec));

// WebSocket orqali barcha ulangan mijozlarga xabar yuborish
function broadcastWs(payload) {
    const msg = JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// 1. AMI xizmatini ishga tushirish
amiService.init(broadcastWs);

// 2. SFTP ulanishini tekshirish va holat o'zgarishini WebSocket ga ulash
sftpService.onStatusChange = (connected) => {
    broadcastWs({
        type: 'sftp_status',
        data: { connected }
    });
};

sftpService.connect().then(connected => {
    if (connected) {
        console.log('📁 SFTP Monitor papkasi faol!');
    }
});

// WebSocket yangi mijoz ulanganda
wss.on('connection', async (ws) => {
    console.log('🔗 Yangi Web dashboard mijozi ulandi');
    
    // Birinchi sinxronizatsiya yakunlanishini kutamiz (bo'sh yoki 0 ma'lumot ketmasligi uchun)
    try {
        await amiService.ensureInitialSync();
    } catch (e) {}

    // Dastlabki ma'lumotlarni yuboramiz
    ws.send(JSON.stringify({
        type: 'initial_state',
        data: {
            amiStatus: amiService.isConnected,
            sftpStatus: sftpService.isConnected,
            stats: amiService.getSummaryStats(),
            activeChannels: amiService.getActiveChannelsList(),
            conversations: Array.from(amiService.activeConversations ? amiService.activeConversations.values() : []),
            queues: amiService.getQueueSummaryList(),
            operators: amiService.getOperatorList(),
            callHistory: amiService.getCallHistory(50)
        }
    }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.action === 'refresh_channels') {
                amiService.pollQueueAndChannels();
            }
        } catch (e) {}
    });
});

// --- REST API ENDPOINTLARI ---

// Server holati
app.get('/api/status', (req, res) => {
    res.json({
        amiConnected: amiService.isConnected,
        sftpConnected: sftpService.isConnected,
        host: config.AMI.host
    });
});

// Asosiy statistika (Sana bo'yicha yoki Jonli bugungi)
app.get('/api/stats', async (req, res) => {
    const dateStr = req.query.date;
    const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr !== todayStr) {
        try {
            const stats = await issabelDbService.fetchFullStatsByDate(dateStr);
            return res.json(stats);
        } catch (e) {
            console.error('Stats by date error:', e.message);
            return res.status(500).json({ error: e.message });
        }
    }
    await amiService.ensureInitialSync();
    res.json(amiService.getSummaryStats());
});

// Navbatlar (Queues)
app.get('/api/queues', (req, res) => {
    res.json(amiService.getQueueSummaryList());
});

// Faol kanallar (Real-time)
app.get('/api/channels', (req, res) => {
    res.json(amiService.getActiveChannelsList());
});

// Operatorlar ro'yxati va ularning unumdorligi (Sana bo'yicha yoki bugungi)
app.get('/api/operators', async (req, res) => {
    const dateStr = req.query.date;
    const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr !== todayStr) {
        try {
            const ops = await issabelDbService.fetchOperatorStats(dateStr);
            return res.json(ops);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }
    await amiService.ensureInitialSync();
    res.json(amiService.getOperatorList());
});

const issabelDbService = require('./services/issabelDbService');

// So'nggi qo'ng'iroqlar tarixi (Paginated & Lazy Loading - To'g'ridan-to'g'ri Issabel CDR dan, sana bo'yicha)
app.get('/api/history', async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const search = req.query.search || '';
    const dateStr = req.query.date || '';
    
    try {
        const paginatedData = await issabelDbService.fetchCallsPaginated(page, limit, search, dateStr);
        res.json(paginatedData);
    } catch (e) {
        res.json({ total: 0, page: 1, totalPages: 1, limit, data: [] });
    }
});

// Kartochkalar yoki Operator bosilganda uning tanlangan sana bo'yicha barcha qo'ng'iroqlari tafsiloti
app.get('/api/calls/details', async (req, res) => {
    const type = req.query.type || 'all';
    const operatorExt = req.query.operator || '';
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const search = req.query.search || '';
    const dateStr = req.query.date || '';

    try {
        const paginatedData = await issabelDbService.fetchCallsDetail({ type, operatorExt, page, limit, search, dateStr });
        res.json({ success: true, ...paginatedData });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, total: 0, page: 1, totalPages: 1, limit, data: [] });
    }
});

// --- MA'LUMOTLAR BAZASI (DATABASE) API ENDPOINTLARI ---

// Kunlik CDR umumiy hisoboti (MariaDB)
app.get('/api/db/summary', async (req, res) => {
    const dateStr = req.query.date || '';
    try {
        const summary = await issabelDbService.fetchSummaryByDate(dateStr);
        res.json({ success: true, data: summary });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Operatorlar kunlik bazaviy ko'rsatkichlari (MariaDB)
app.get('/api/db/operators', async (req, res) => {
    const dateStr = req.query.date || '';
    try {
        const ops = await issabelDbService.fetchOperatorStats(dateStr);
        res.json({ success: true, data: ops });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Asterisk MariaDB ga to'g'ridan-to'g'ri xavfsiz (faqat SELECT) SQL so'rov yuborish
app.post('/api/db/query', async (req, res) => {
    const { sql } = req.body || {};
    if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ success: false, error: 'sql parametri kiritilishi shart' });
    }

    const trimmed = sql.trim();
    if (!/^(select|show|describe|desc)\s/i.test(trimmed)) {
        return res.status(403).json({ success: false, error: 'Xavfsizlik cheklovi: Faqat SELECT, SHOW yoki DESCRIBE so\'rovlariga ruxsat berilgan' });
    }

    if (/;\s*(drop|delete|truncate|update|insert|alter|grant|revoke|create)/i.test(trimmed)) {
        return res.status(403).json({ success: false, error: 'Xavfli buyruqlar aniqlandi' });
    }

    try {
        const raw = await issabelDbService.execQuery(trimmed);
        res.json({ success: true, query: trimmed, rawOutput: raw });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// /var/spool/asterisk/monitor/ papkasidagi fayllar ro'yxati (Explorer)
app.get('/api/recordings/tree', async (req, res) => {
    const subPath = req.query.path || '';
    const data = await sftpService.listDirectory(subPath);
    res.json(data);
});

// Audio faylni stream qilish (Brauzer pleyeri uchun)
app.get('/api/recordings/stream', async (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'file parametri berilmadi' });
    }
    await sftpService.streamFile(filePath, req, res);
});

const audioIndexService = require('./services/audioIndexService');

// Tezkor Audio Indeks API (RAM dagi xaritadan 0.2ms da topadi)
app.get('/api/recordings/fast-find', (req, res) => {
    const callerId = req.query.callerId || req.query.search || '';
    const uniqueid = req.query.uniqueid || '';
    const duration = parseInt(req.query.duration || '0', 10);

    let match = null;
    if (uniqueid) {
        match = audioIndexService.findAudioByUniqueId(uniqueid);
    }
    if (!match && callerId) {
        match = audioIndexService.findAudioForCaller(callerId, duration);
    }

    if (match) {
        return res.json({
            success: true,
            found: true,
            recording: match.path,
            filename: match.filename,
            duration: match.duration,
            callerId: match.callerId
        });
    }

    res.json({
        success: true,
        found: false,
        message: 'Bugungi tezkor indeksdan topilmadi'
    });
});

// Audio Indeks holati (Status)
app.get('/api/recordings/index-status', (req, res) => {
    res.json({
        success: true,
        ...audioIndexService.getStatus()
    });
});

const systemService = require('./services/systemService');

// Server va Tizim holati (CPU, RAM, Disk, PM2, Services)
app.get('/api/system/status', async (req, res) => {
    try {
        const metrics = await systemService.getSystemMetrics();
        res.json({ success: true, ...metrics });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Qo'ng'iroqni boshqa operatorga yo'naltirish (Transfer / Redirect)
app.post('/api/action/transfer', (req, res) => {
    const { channel, targetExten } = req.body;
    if (!channel || !targetExten) {
        return res.status(400).json({ error: 'channel va targetExten parametrlari zarur' });
    }

    amiService.transferCall(channel, targetExten, (err, response) => {
        if (err) {
            console.error('Transfer xatosi:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: `Qo'ng'iroq Operator ${targetExten} ga yo'naltirildi`, response });
    });
});

// Kanalni majburan uzish (Hangup)
app.post('/api/action/hangup', (req, res) => {
    const { channel } = req.body;
    if (!channel || !amiService.ami) {
        return res.status(400).json({ error: 'Kanal yoki AMI topilmadi' });
    }

    amiService.ami.action({
        action: 'Hangup',
        channel: channel
    }, (err, response) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, response });
    });
});

// Click to Call (Originate)
app.post('/api/action/originate', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to || !amiService.ami) {
        return res.status(400).json({ error: 'from va to parametrlari kerak' });
    }

    amiService.ami.action({
        action: 'Originate',
        channel: `SIP/${from}`,
        exten: to,
        context: 'from-internal',
        priority: 1,
        callerid: from
    }, (err, response) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, response });
    });
});

// --- 3CX DESKTOP AGENT API ENDPOINTLARI ---

// 3CX Desktop Agentdan rad etish (Reject) - bekor qilingan
app.post('/api/agent/reject', (req, res) => {
    res.json({ success: true, message: 'Reject monitoring disabled' });
});

// 3CX Desktop Agent Markaziy Versiya Boshqaruvi (OTA Update)
let initialVer = '1.0.4';
try {
    const vPath = path.join(__dirname, '3cx-desktop-agent', 'dist', 'version.txt');
    if (fs.existsSync(vPath)) {
        initialVer = fs.readFileSync(vPath, 'utf8').trim() || '1.0.4';
    }
} catch (e) {}

let agentReleaseConfig = {
    latestVersion: initialVer,
    updateUrl: '/downloads/agent.exe',
    releaseNotes: 'Boshlang\'ich barqaror versiya',
    minVersion: '1.0.0',
    lastReleaseTime: new Date().toISOString()
};

// 3CX Agent Heartbeat (Operator kompyuteri onlaynligini tasdiqlash va versiya sinxronizatsiyasi)
app.post('/api/agent/heartbeat', (req, res) => {
    const { operatorId, hostname, appVersion, version } = req.body;
    const currentVer = version || appVersion || '1.0.0';

    if (operatorId) {
        const opId = String(operatorId);
        amiService.ensureOperatorExists(opId);
        const op = amiService.operators.get(opId);
        if (op) {
            const wasOffline = !op.agentConnected;
            op.agentConnected = true;
            op.lastAgentPing = Date.now();
            op.agentHostname = hostname || '';
            op.agentVersion = currentVer;
            if (opId === '101') {
                console.log(`💓 [Heartbeat 101] ver: ${currentVer}, latest: ${agentReleaseConfig.latestVersion}, host: ${hostname}`);
            }

            if (wasOffline) {
                console.log(`🟢 [3CX Desktop Agent] Operator ${opId} (${op.realName || 'Noma\'lum'}) ulandi! PC: ${hostname || 'Noma\'lum'} [v${currentVer}]`);
                amiService.broadcast('operators_update', amiService.getOperatorList());
                amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
            }
        }
    }

    res.json({ 
        success: true, 
        timestamp: new Date().toISOString(),
        latestVersion: agentReleaseConfig.latestVersion,
        updateUrl: agentReleaseConfig.updateUrl
    });
});

// Agent Versiya ma'lumotlarini olish
app.get('/api/agent/version', (req, res) => {
    res.json({
        success: true,
        ...agentReleaseConfig
    });
});

// Yangi agent versiyasini chiqarish (Admin paneldan)
app.post('/api/agent/release', (req, res) => {
    const { version, releaseNotes } = req.body;
    if (!version) {
        return res.status(400).json({ error: 'Versiya raqami talab qilinadi (masalan, 1.0.1)' });
    }

    agentReleaseConfig.latestVersion = String(version).trim();
    if (releaseNotes) agentReleaseConfig.releaseNotes = String(releaseNotes);
    agentReleaseConfig.lastReleaseTime = new Date().toISOString();

    console.log(`🚀 [OTA Update] Yangi versiya e'lon qilindi: v${agentReleaseConfig.latestVersion}!`);
    amiService.broadcast('agent_version_released', agentReleaseConfig);
    amiService.broadcast('operators_update', amiService.getOperatorList());

    res.json({ success: true, message: `v${agentReleaseConfig.latestVersion} muvaffaqiyatli e'lon qilindi`, config: agentReleaseConfig });
});

// Agent OTA Update Loglari tarixi (xotirada oxirgi 100 ta logni saqlash)
const agentUpdateLogsHistory = [];

app.post('/api/agent/update-log', (req, res) => {
    const { operatorId, hostname, version, targetVersion, step, message } = req.body;
    const opId = String(operatorId || '???');
    const op = amiService.operators.get(opId);
    const opName = op ? (op.realName || op.name || opId) : `Operator ${opId}`;
    const timeStr = new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Tashkent' });

    let icon = 'ℹ️';
    if (step === 'DOWNLOADING') icon = '📥';
    else if (step === 'DOWNLOADED') icon = '📦';
    else if (step === 'INSTALLING') icon = '🔄';
    else if (step === 'SUCCESS') icon = '🎉';
    else if (step === 'ERROR') icon = '❌';

    const logEntry = {
        id: Date.now() + Math.random().toString(36).slice(2, 6),
        time: timeStr,
        operatorId: opId,
        operatorName: opName,
        hostname: hostname || '',
        version: version || '',
        targetVersion: targetVersion || '',
        step: step || 'INFO',
        message: message || '',
        icon
    };

    agentUpdateLogsHistory.unshift(logEntry);
    if (agentUpdateLogsHistory.length > 100) agentUpdateLogsHistory.pop();

    console.log(`${icon} [OTA Log] ${timeStr} | ${opName} (${opId}) [PC: ${hostname || '?'}] | ${message || step}`);

    amiService.broadcast('agent_ota_log', logEntry);

    res.json({ success: true });
});

app.get('/api/agent/update-logs', (req, res) => {
    res.json({ success: true, logs: agentUpdateLogsHistory });
});

// Barcha operatorlar agent holatlari va versiyalari (Settings paneli uchun)
app.get('/api/agent/status-all', (req, res) => {
    const list = amiService.getOperatorList().map(op => {
        const lastPing = op.lastAgentPing ? Math.round((Date.now() - op.lastAgentPing) / 1000) : null;
        const ver = op.agentVersion || '1.0.0';
        const isLatest = ver === agentReleaseConfig.latestVersion;
        return {
            id: op.id,
            name: op.realName || `Operator ${op.id}`,
            exten: op.exten || op.id,
            ip: op.ip || '-none-',
            agentConnected: !!op.agentConnected,
            agentHostname: op.agentHostname || '',
            agentVersion: op.agentConnected ? ver : null,
            lastPingSec: lastPing,
            isLatest: op.agentConnected ? isLatest : false,
            latestVersion: agentReleaseConfig.latestVersion
        };
    });

    res.json({
        success: true,
        releaseConfig: agentReleaseConfig,
        operators: list
    });
});

// 3CX Desktop Agent ma'lumotlari asosidagi operatorlar statistikasi (/operators sahifasi uchun)
function getAgentOperatorStatsList(targetDate = null) {
    const agentStatsMap = dbService.getTodayAgentOperatorStats(targetDate);
    const allOps = amiService.getOperatorList();
    
    return allOps.map(op => {
        const stats = agentStatsMap[op.id] || { answered: 0, outbound: 0, missed: 0, totalDurationSec: 0, avgDurationSec: 0 };
        return {
            id: op.id,
            name: op.name,
            realName: op.realName,
            presence: op.presence,
            ringingCaller: op.ringingCaller || null,
            agentConnected: !!op.agentConnected,
            agentHostname: op.agentHostname || '',
            agentVersion: op.agentVersion || null,
            lastAgentPing: op.lastAgentPing || null,
            answered: stats.answered || 0,
            outbound: stats.outbound || 0,
            missed: stats.missed || 0,
            totalDurationSec: stats.totalDurationSec || 0,
            avgDurationSec: stats.avgDurationSec || 0,
            totalCalls: (stats.answered || 0) + (stats.outbound || 0) + (stats.missed || 0)
        };
    });
}

// Agent online/offline o'zgarganda /operators sahifasiga real-vaqtda broadcast qilish
amiService.onAgentStateChange = () => {
    amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
};

// 21:00 yoki qo'lda CDR sinxronizatsiyasi yakunlanganda barcha brauzerlarga yangi statistikani yuborish
syncService.onSyncComplete = (res) => {
    console.log('🔄 [syncService] Sinxronizatsiya yakunlandi, veb sahifalarga tarqatilmoqda...');
    amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
    amiService.broadcast('stats_update', amiService.getSummaryStats());
    amiService.broadcast('operators_update', amiService.getOperatorList());
};

// /operators sahifasi uchun faqat 3CX Desktop Agent to'plagan operatorlar statistikasi
app.get('/api/agent/operator-stats', (req, res) => {
    const dateStr = req.query.date || null;
    res.json(getAgentOperatorStatsList(dateStr));
});

// 3CX Agent to'liq qo'ng'iroq hodisalari (RINGING, ANSWERED, ENDED, MISSED)
app.post('/api/agent/call-event', (req, res) => {
    const { operatorId, eventType, callerId, durationSec, startTime, endTime, hostname, details } = req.body;
    if (!operatorId) {
        return res.status(400).json({ error: 'operatorId talab qilinadi' });
    }

    const opId = String(operatorId);
    amiService.ensureOperatorExists(opId);
    const op = amiService.operators.get(opId);

    // 1. Bazaga (agent_3cx_call_logs) to'liq yozish
    dbService.recordAgentCallLog({
        operatorId: opId,
        callerId: callerId || 'Yashirin raqam',
        eventType: eventType || 'INFO',
        durationSec: parseInt(durationSec || 0, 10),
        startTime,
        endTime,
        hostname,
        details
    });

    // 3CX Desktop Agent ma'lumotlari faqat agent_3cx_call_logs jadvalida va /operators sahifasida aks etadi.
    // Asosiy dashboarddagi Issabel PBX ma'lumotlariga (op.missed yoki recordOperatorMissed) aralashmaydi!
    if (eventType === 'MISSED') {
        console.log(`⚠️ [3CX Agent MISSED] Operator ${opId} (3CX History): ${callerId}`);
    } else if (eventType === 'ANSWERED') {
        console.log(`📞 [3CX Agent ANSWER] Operator ${opId} javob berdi! Raqam: ${callerId}`);
    } else if (eventType === 'ENDED') {
        console.log(`📴 [3CX Agent END] Operator ${opId} suhbat yakunlandi! Raqam: ${callerId}, Vaqt: ${durationSec || 0}s`);
    }

    // /operators va asosiy Dashboard uchun yangilangan statistikalarni real-vaqtda broadcast qilish
    amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
    amiService.broadcast('stats_update', amiService.getSummaryStats());

    res.json({ success: true });
});

// 3CX Agent to'plamli tarixni sinxronizatsiya qilish (1 oy, 1 yil yoki butun tarix)
app.post('/api/agent/sync-batch', (req, res) => {
    const { operatorId, hostname, calls } = req.body;
    if (!operatorId || !Array.isArray(calls)) {
        return res.status(400).json({ error: 'operatorId va calls massivi talab qilinadi' });
    }

    const opId = String(operatorId);
    amiService.ensureOperatorExists(opId);

    const inserted = dbService.recordAgentCallLogsBatch(opId, hostname, calls);
    console.log(`📥 [3CX Sync Batch] Operator ${opId} (${hostname}): ${calls.length} ta yozuv yuborildi, ${inserted} ta yangi saqlandi.`);

    if (inserted > 0) {
        amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
        amiService.broadcast('stats_update', amiService.getSummaryStats());
    }

    res.json({ success: true, count: inserted });
});

// 3CX Agent jurnali API (Issabel bilan solishtirish uchun - doim Pretty Print)
app.get('/api/agent/logs', (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const operatorId = req.query.operatorId || null;
    const date = req.query.date || 'today';
    const search = req.query.search || '';
    const result = dbService.getAgentCallLogsPaginated(page, limit, operatorId, date, search);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(result, null, 2));
});

// Asterisk CDR dan 3CX Agent jurnali (agent_3cx_call_logs) ga tushmay qolgan qo'ng'iroqlarni sinxron qilish
app.post('/api/agent/sync-from-cdr', async (req, res) => {
    const { date } = req.body || {};
    try {
        const result = await syncService.syncDailyCdrToAgentLogs(date);
        if (result.success && result.addedCount > 0) {
            amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
            amiService.broadcast('stats_update', amiService.getSummaryStats());
            amiService.broadcast('operators_update', amiService.getOperatorList());
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/agent/sync-status', (req, res) => {
    res.json(syncService.getLastSyncInfo());
});

// Excel hisoboti eksporti ("cal stat" andozasi bo'yicha - Oylik yoki Sana oralig'i)
app.get('/api/export/excel', async (req, res) => {
    const month = req.query.month || null;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    try {
        const { buffer, fileName } = await exportService.generateReportBuffer({
            targetMonth: month,
            startDate,
            endDate
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        console.error('❌ Excel export xatosi:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// SPA Navigation Routes
['/', '/dashboard', '/explorer', '/audio', '/operators', '/history'].forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
});

// Asosiy sahifa (Catch-all)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(config.PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Call Center Dashboard ishga tushdi!`);
    if (isMultiplexed) {
        console.log(`🔒 Xavfsiz HTTPS Manzil: https://localhost:${config.PORT}`);
        console.log(`🌐 Oddiy HTTP Manzil:   http://localhost:${config.PORT}`);
        console.log(`📖 Swagger API Docs:    https://localhost:${config.PORT}/api-docs`);
    } else {
        console.log(`🌐 Manzil: http://localhost:${config.PORT}`);
        console.log(`📖 Swagger API Docs: http://localhost:${config.PORT}/api-docs`);
    }
    console.log(`📊 AMI Server: ${config.AMI.host}:${config.AMI.port}`);
    console.log(`📁 SFTP Monitor Path: ${config.SFTP.monitorPath}`);
    console.log(`======================================================\n`);
}); 