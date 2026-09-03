process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const amiService = require('./services/amiService');
const sftpService = require('./services/sftpService');
const dbService = require('./services/dbService');

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerSpec');

const app = express();
app.set('json spaces', 2);
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
wss.on('connection', (ws) => {
    console.log('🔗 Yangi Web dashboard mijozi ulandi');
    
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

// Asosiy statistika
app.get('/api/stats', (req, res) => {
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

// Operatorlar ro'yxati va ularning unumdorligi
app.get('/api/operators', (req, res) => {
    res.json(amiService.getOperatorList());
});

const issabelDbService = require('./services/issabelDbService');

// So'nggi qo'ng'iroqlar tarixi (Paginated & Lazy Loading - To'g'ridan-to'g'ri Issabel CDR dan)
app.get('/api/history', async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const search = req.query.search || '';
    
    try {
        const paginatedData = await issabelDbService.fetchCallsPaginated(page, limit, search);
        res.json(paginatedData);
    } catch (e) {
        res.json({ total: 0, page: 1, totalPages: 1, limit, data: [] });
    }
});

// Kartochkalar yoki Operator bosilganda uning bugungi barcha qo'ng'iroqlari tafsiloti
app.get('/api/calls/details', async (req, res) => {
    const type = req.query.type || 'all';
    const operatorExt = req.query.operator || '';
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const search = req.query.search || '';

    try {
        const paginatedData = await issabelDbService.fetchCallsDetail({ type, operatorExt, page, limit, search });
        res.json({ success: true, ...paginatedData });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, total: 0, page: 1, totalPages: 1, limit, data: [] });
    }
});

// --- MA'LUMOTLAR BAZASI (DATABASE) API ENDPOINTLARI ---

// Bugungi kunlik CDR umumiy hisoboti (MariaDB)
app.get('/api/db/summary', async (req, res) => {
    try {
        const summary = await issabelDbService.fetchTodaySummary();
        res.json({ success: true, data: summary });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Operatorlar kunlik bazaviy ko'rsatkichlari (MariaDB)
app.get('/api/db/operators', async (req, res) => {
    try {
        const ops = await issabelDbService.fetchTodayOperatorStats();
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

// 3CX Desktop Agentdan rad etish (Reject) hodisasini qabul qilish
app.post('/api/agent/reject', (req, res) => {
    const { operatorId, callerId, duration, reason } = req.body;
    if (!operatorId) {
        return res.status(400).json({ error: 'operatorId parametri talab qilinadi' });
    }
    const opId = String(operatorId);
    amiService.ensureOperatorExists(opId);
    const op = amiService.operators.get(opId);

    const isWorkTime = dbService.isWorkingHours();

    if (isWorkTime) {
        if (op) {
            op.denied = (op.denied || 0) + 1;
            op.totalCalls = (op.totalCalls || 0) + 1;
        }
        dbService.recordOperatorReject(opId, callerId || '3CX Desktop Reject', '3CX-Agent', true);
        amiService.stats.deniedCalls = (amiService.stats.deniedCalls || 0) + 1;
        amiService.broadcast('operators_update', amiService.getOperatorList());
        amiService.broadcast('stats_update', amiService.getSummaryStats());
        console.log(`🚫 [3CX Agent] Operator ${opId} rad etdi! Raqam: ${callerId || 'Yashirin'}`);
    } else {
        // Ish vaqtidan tashqari (08:00 dan oldin yoki 21:00 dan keyin)
        dbService.recordOperatorReject(opId, callerId || '3CX Desktop Reject', '3CX-Agent (Ish vaqtidan tashqari)', false);
        console.log(`ℹ️ [3CX Agent] Operator ${opId} ish vaqtidan tashqari (08:00-21:00) rad etdi. KPI ga qo'shilmadi.`);
    }

    res.json({ success: true, operatorId: opId, inWorkingHours: isWorkTime, deniedCount: op ? op.denied : 0 });
});

// 3CX Desktop Agent Markaziy Versiya Boshqaruvi (OTA Update)
let agentReleaseConfig = {
    latestVersion: '1.0.0',
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

            if (wasOffline) {
                console.log(`🟢 [3CX Desktop Agent] Operator ${opId} (${op.realName || 'Noma\'lum'}) ulandi! PC: ${hostname || 'Noma\'lum'} [v${currentVer}]`);
                amiService.broadcast('operators_update', amiService.getOperatorList());
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

// 3CX Agent to'liq qo'ng'iroq hodisalari (RINGING, ANSWERED, ENDED, REJECT)
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

    // 2. Agar rad etilgan bo'lsa - hisoblagichlarni yangilash
    if (eventType === 'REJECT') {
        const isWorkTime = dbService.isWorkingHours();
        if (isWorkTime) {
            if (op) {
                op.denied = (op.denied || 0) + 1;
                op.totalCalls = (op.totalCalls || 0) + 1;
            }
            dbService.recordOperatorReject(opId, callerId || '3CX Desktop Reject', '3CX-Agent', true);
            amiService.stats.deniedCalls = (amiService.stats.deniedCalls || 0) + 1;
            amiService.broadcast('operators_update', amiService.getOperatorList());
            amiService.broadcast('stats_update', amiService.getSummaryStats());
            console.log(`🚫 [3CX Agent REJECT] Operator ${opId} rad etdi! Raqam: ${callerId}`);
        } else {
            dbService.recordOperatorReject(opId, callerId || '3CX Desktop Reject', '3CX-Agent (Ish vaqtidan tashqari)', false);
            console.log(`ℹ️ [3CX Agent REJECT] Operator ${opId} ish vaqtidan tashqari (08:00-21:00) rad etdi. KPI ga qo'shilmadi.`);
        }
    } else if (eventType === 'MISSED') {
        const isWorkTime = dbService.isWorkingHours();
        if (isWorkTime) {
            if (op) {
                op.missed = (op.missed || 0) + 1;
            }
            dbService.recordOperatorMissed(opId, callerId || '3CX Missed', '3CX-Agent', true);
            amiService.broadcast('operators_update', amiService.getOperatorList());
            amiService.broadcast('stats_update', amiService.getSummaryStats());
            console.log(`⚠️ [3CX Agent MISSED] Operator ${opId} ko'tarmadi (Missed): ${callerId}`);
        } else {
            dbService.recordOperatorMissed(opId, callerId || '3CX Missed', '3CX-Agent (Ish vaqtidan tashqari)', false);
        }
    } else if (eventType === 'ANSWERED') {
        console.log(`📞 [3CX Agent ANSWER] Operator ${opId} javob berdi! Raqam: ${callerId}`);
    } else if (eventType === 'ENDED') {
        console.log(`📴 [3CX Agent END] Operator ${opId} suhbat yakunlandi! Raqam: ${callerId}, Vaqt: ${durationSec || 0}s`);
    }

    res.json({ success: true });
});

// 3CX Agent jurnali API (Issabel bilan solishtirish uchun - doim Pretty Print)
app.get('/api/agent/logs', (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const operatorId = req.query.operatorId || null;
    const result = dbService.getAgentCallLogsPaginated(page, limit, operatorId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(result, null, 2));
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
    console.log(`🌐 Manzil: http://localhost:${config.PORT}`);
    console.log(`📖 Swagger API Docs: http://localhost:${config.PORT}/api-docs`);
    console.log(`📊 AMI Server: ${config.AMI.host}:${config.AMI.port}`);
    console.log(`📁 SFTP Monitor Path: ${config.SFTP.monitorPath}`);
    console.log(`======================================================\n`);
});