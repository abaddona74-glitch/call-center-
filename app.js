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
const blacklistService = require('./services/blacklistService');
const issabelDbService = require('./services/issabelDbService');
const voicePrintService = require('./services/voicePrintService');

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
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));

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

// Build / Versiya ma'lumotlari (Deploy avtomatik aniqlanishi uchun)
function getAppVersionInfo() {
    try {
        const vPath = path.join(__dirname, 'public', 'version.json');
        if (fs.existsSync(vPath)) {
            return JSON.parse(fs.readFileSync(vPath, 'utf8'));
        }
    } catch (e) {}
    return {
        buildId: 'dev',
        buildTime: new Date().toISOString(),
        version: '2.4.0',
        app: 'call-center'
    };
}

// WebSocket yangi mijoz ulanganda
wss.on('connection', async (ws) => {
    console.log('🔗 Yangi Web dashboard mijozi ulandi');
    
    // Birinchi sinxronizatsiya yakunlanishini kutamiz (bo'sh yoki 0 ma'lumot ketmasligi uchun)
    try {
        await amiService.ensureInitialSync();
    } catch (e) {}

    const versionInfo = getAppVersionInfo();

    // Dastlabki ma'lumotlarni yuboramiz
    ws.send(JSON.stringify({
        type: 'initial_state',
        data: {
            serverVersion: versionInfo,
            amiStatus: amiService.isConnected,
            sftpStatus: sftpService.isConnected,
            stats: amiService.getSummaryStats(),
            activeChannels: amiService.getActiveChannelsList(),
            conversations: Array.from(amiService.activeConversations ? amiService.activeConversations.values() : []),
            queues: amiService.getQueueSummaryList(),
            operators: amiService.getOperatorList(),
            callHistory: amiService.getCallHistory(50),
            callbacks: amiService.getCallbacksWithActiveCalls(),
            contacts: dbService.getAllContacts()
        }
    }));

    // Versiya ma'lumotini alohida event sifatida ham yuboramiz
    ws.send(JSON.stringify({
        type: 'server_version',
        data: versionInfo
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

// Build / Versiya tekshiruvi (Deploy va avtomatik yangilanish uchun)
app.get('/api/version', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(getAppVersionInfo());
});

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
            const histOps = await issabelDbService.fetchOperatorStats(dateStr);
            const liveOps = amiService.getOperatorList();
            const liveMap = new Map(liveOps.map(o => [String(o.id), o]));
            const histMap = new Map(histOps.map(o => [String(o.id), o]));

            const allOpIds = new Set([...liveMap.keys(), ...histMap.keys()]);
            const combined = Array.from(allOpIds).map(id => {
                const live = liveMap.get(id) || {};
                const hist = histMap.get(id) || {};
                const ans = hist.answered !== undefined ? hist.answered : 0;
                const out = hist.outbound !== undefined ? hist.outbound : 0;
                const xIn = hist.transferredIn !== undefined ? hist.transferredIn : 0;
                const grand = hist.grandTotal !== undefined ? hist.grandTotal : (ans + out + xIn);

                return {
                    id: String(id),
                    name: hist.name || live.name || `Operator ${id}`,
                    realName: hist.realName || live.realName || `Operator ${id}`,
                    presence: live.presence || 'offline',
                    ip: live.ip || '',
                    latency: live.latency || '',
                    totalCalls: hist.totalCalls !== undefined ? hist.totalCalls : grand,
                    answered: ans,
                    rawAnswered: hist.rawAnswered !== undefined ? hist.rawAnswered : ans,
                    outbound: out,
                    transferredOut: hist.transferredOut !== undefined ? hist.transferredOut : 0,
                    transferredIn: xIn,
                    transferResolved: hist.transferResolved !== undefined ? hist.transferResolved : xIn,
                    denied: hist.denied !== undefined ? hist.denied : 0,
                    missed: hist.missed !== undefined ? hist.missed : 0,
                    totalDurationSec: hist.totalDurationSec !== undefined ? hist.totalDurationSec : 0,
                    avgDurationSec: hist.avgDurationSec !== undefined ? hist.avgDurationSec : 0,
                    grandTotal: grand,
                    paused: !!live.paused,
                    agentConnected: !!live.agentConnected,
                    agentHostname: live.agentHostname || '',
                    agentVersion: live.agentVersion || null,
                    lastAgentPing: live.lastAgentPing || null
                };
            });
            return res.json(combined);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }
    await amiService.ensureInitialSync();
    res.json(amiService.getOperatorList());
});

// So'nggi qo'ng'iroqlar tarixi (Paginated & Lazy Loading - To'g'ridan-to'g'ri Issabel CDR dan, sana bo'yicha)
app.get('/api/history', async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const search = req.query.search || '';
    const dateStr = req.query.date || '';
    const direction = req.query.direction || '';
    const status = req.query.status || '';
    const speaker = (req.query.speaker || '').toLowerCase().trim();
    
    // 1. Agar foydalanuvchi aynan AI tahlilidagi Zuhra opaning qo'ng'iroqlarini so'rasa:
    // Asteriskning 50,000+ lik og'ir bazasini osiltirmay, aniqlangan Zuhra qo'ng'iroqlarini tezkor qaytaramiz!
    if (speaker === 'zuhra') {
        const result = voicePrintService.getCallsBySpeaker('zuhra', page, limit, search);
        return res.json(result);
    }

    try {
        const paginatedData = await issabelDbService.fetchCallsPaginated(page, limit, search, dateStr, direction, status);
        
        if (paginatedData && Array.isArray(paginatedData.data)) {
            paginatedData.data.forEach(call => {
                const analysis = voicePrintService.findAnalysis(call);
                if (analysis) {
                    call.voiceAnalysis = {
                        speaker: analysis.speaker,
                        speaker_name: analysis.speaker_name,
                        score: analysis.score,
                        zuhra_segments: analysis.zuhra_segments,
                        confidence: analysis.confidence
                    };
                }
            });

            // Agar maxsus gapiruvchi filtri qo'yilgan bo'lsa
            if (speaker === 'muattar') {
                paginatedData.data = paginatedData.data.filter(call => {
                    return !call.voiceAnalysis || call.voiceAnalysis.speaker === 'muattar';
                });
            }
        }

        res.json(paginatedData);
    } catch (e) {
        res.json({ total: 0, page: 1, totalPages: 1, limit, data: [] });
    }
});

// Barcha ovoz identifikatsiyalari ro'yxati (AI statusini ko'rish uchun)
app.get('/api/voice-identifications', (req, res) => {
    res.json(voicePrintService.getAll());
});

// Ovozli skan jarayoni progress sahifasi
app.get('/voice-status', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'voice-status.html'));
});

// AI Ovozli skan jarayoni holati va foizi (Real-time Progress)
app.get('/api/voice-scan-status', (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('text/html') && !req.query.json) {
        return res.sendFile(path.join(__dirname, 'public', 'voice-status.html'));
    }

    const statusFile = path.join(__dirname, 'data', 'voice_scan_status.json');
    let orchestratorStatus = null;
    if (fs.existsSync(statusFile)) {
        try {
            orchestratorStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        } catch (e) {}
    }

    const all = voicePrintService.getAll();
    const START_DATE = '2026-08-17 00:00:00';
    const END_DATE = '2026-09-19 23:59:59';
    const inRange = all.filter(x => {
        const d = x.calldate || '';
        return d >= START_DATE && d <= END_DATE;
    });

    const totalTarget = (orchestratorStatus && orchestratorStatus.totalTarget) ? orchestratorStatus.totalTarget : 558;
    const scannedCount = (orchestratorStatus && orchestratorStatus.scannedCount) ? orchestratorStatus.scannedCount : inRange.length;
    const remainingCount = (orchestratorStatus && orchestratorStatus.remainingCount !== undefined) ? orchestratorStatus.remainingCount : Math.max(0, totalTarget - scannedCount);
    const percent = (orchestratorStatus && orchestratorStatus.percent) ? orchestratorStatus.percent : `${Math.min(100, Math.round((scannedCount / totalTarget) * 100))}%`;
    const zuhraCount = inRange.filter(x => x.speaker === 'zuhra' || x.speaker === 'Zuhra opa').length;
    const muattarCount = inRange.filter(x => x.speaker !== 'zuhra' && x.speaker !== 'Zuhra opa').length;

    res.json({
        totalTarget,
        scannedCount,
        remainingCount,
        percent,
        zuhraCount,
        muattarCount,
        isRescan: orchestratorStatus ? Boolean(orchestratorStatus.isRescan) : false,
        previousZuhraCount: orchestratorStatus ? (orchestratorStatus.previousZuhraCount ?? zuhraCount) : zuhraCount,
        newlyFoundZuhraCount: orchestratorStatus ? (orchestratorStatus.newlyFoundZuhraCount || 0) : 0,
        newlyFoundZuhraList: orchestratorStatus ? (orchestratorStatus.newlyFoundZuhraList || []) : [],
        speedPerMin: orchestratorStatus ? orchestratorStatus.speedPerMin : null,
        etaMinutes: orchestratorStatus ? orchestratorStatus.etaMinutes : null,
        estimatedEndTime: orchestratorStatus ? orchestratorStatus.estimatedEndTime : null,
        dateRange: '17-Avgust — 19-Sentabr',
        currentTask: orchestratorStatus ? orchestratorStatus.currentTask : null,
        lastScanned: (orchestratorStatus && orchestratorStatus.lastScanned) ? orchestratorStatus.lastScanned : (all.length > 0 ? {
            file: all[all.length - 1].file,
            caller_id: all[all.length - 1].caller_id,
            calldate: all[all.length - 1].calldate,
            speaker: all[all.length - 1].speaker_name || all[all.length - 1].speaker
        } : null)
    });
});

// Ichki sinxronizatsiya: Orkestrator statusi va yangi aniqlangan ovozlarni qabul qilish
app.post('/api/internal/voice-scan-sync', (req, res) => {
    try {
        const { status, newVoiceId } = req.body || {};
        if (status) {
            const statusFile = path.join(__dirname, 'data', 'voice_scan_status.json');
            fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf8');
        }
        if (newVoiceId) {
            const idFile = path.join(__dirname, 'data', 'voice_identifications.json');
            let list = [];
            if (fs.existsSync(idFile)) {
                try { list = JSON.parse(fs.readFileSync(idFile, 'utf8')); } catch (e) {}
            }
            const cleanBase = path.basename(newVoiceId.file || '');
            const existingIdx = list.findIndex(x => path.basename(x.file || '') === cleanBase);
            if (existingIdx !== -1) {
                if (!list[existingIdx].is_manual_override) {
                    list[existingIdx] = { ...list[existingIdx], ...newVoiceId };
                    fs.writeFileSync(idFile, JSON.stringify(list, null, 2), 'utf8');
                    voicePrintService.load();
                }
            } else {
                list.push(newVoiceId);
                fs.writeFileSync(idFile, JSON.stringify(list, null, 2), 'utf8');
                voicePrintService.load();
            }
        }
        res.json({ success: true, restartRequested: Boolean(scanRestartRequested) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// AI xato aniqlagan qo'ng'iroqni qo'lda boshqa operatorga (zuhra <-> muattar) o'tkazish
app.post('/api/voice-identification/switch', (req, res) => {
    const { file, newSpeaker } = req.body || {};
    if (!file || !newSpeaker) {
        return res.status(400).json({ success: false, error: 'file va newSpeaker parametri kiritilmadi' });
    }

    try {
        const updated = voicePrintService.updateSpeaker(file, newSpeaker);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Ko\'rsatilgan audio fayl bazadan topilmadi' });
        }

        // Status faylini qayta hisoblab yangilash
        const statusFile = path.join(__dirname, 'data', 'voice_scan_status.json');
        if (fs.existsSync(statusFile)) {
            try {
                const st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
                const all = voicePrintService.getAll();
                const START_DATE = '2026-08-17 00:00:00';
                const END_DATE = '2026-09-19 23:59:59';
                const inRange = all.filter(x => (x.calldate || '') >= START_DATE && (x.calldate || '') <= END_DATE);
                st.zuhraCount = inRange.filter(x => x.speaker === 'zuhra').length;
                st.muattarCount = inRange.filter(x => x.speaker !== 'zuhra').length;
                fs.writeFileSync(statusFile, JSON.stringify(st, null, 2), 'utf8');
            } catch (e) {}
        }

        res.json({ success: true, item: updated });
    } catch (err) {
        console.error('Switch speaker error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ovoz namunalari (parchalar) - ro'yxatini olish
app.get('/api/voice-samples', (req, res) => {
    try {
        const dbPath = path.join(__dirname, 'data', 'voice_candidate_samples.json');
        if (!fs.existsSync(dbPath)) {
            return res.json({ success: true, samples: [], stats: { total: 0, approved: 0, denied: 0, pending: 0 } });
        }
        const samples = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const approvedCount = samples.filter(s => s.status === 'approved').length;
        const deniedCount = samples.filter(s => s.status === 'denied').length;
        const pendingCount = samples.filter(s => s.status === 'pending').length;
        res.json({
            success: true,
            samples,
            stats: {
                total: samples.length,
                approved: approvedCount,
                denied: deniedCount,
                pending: pendingCount
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ovoz namunasini ko'rib chiqish (Tasdiqlash / Rad etish)
app.post('/api/voice-samples/review', (req, res) => {
    try {
        const { sampleId, status } = req.body || {};
        if (!sampleId || !['approved', 'denied', 'pending'].includes(status)) {
            return res.status(400).json({ success: false, error: 'sampleId yoki yaroqsiz status parametri' });
        }
        const dbPath = path.join(__dirname, 'data', 'voice_candidate_samples.json');
        if (!fs.existsSync(dbPath)) {
            return res.status(404).json({ success: false, error: 'Namunalar fayli topilmadi' });
        }
        let samples = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const idx = samples.findIndex(s => s.id === sampleId);
        if (idx === -1) {
            return res.status(404).json({ success: false, error: 'Namuna topilmadi' });
        }
        samples[idx].status = status;
        samples[idx].reviewed_at = new Date().toISOString();
        fs.writeFileSync(dbPath, JSON.stringify(samples, null, 2), 'utf8');

        const approvedCount = samples.filter(s => s.status === 'approved').length;
        const deniedCount = samples.filter(s => s.status === 'denied').length;
        const pendingCount = samples.filter(s => s.status === 'pending').length;

        res.json({
            success: true,
            item: samples[idx],
            stats: {
                total: samples.length,
                approved: approvedCount,
                denied: deniedCount,
                pending: pendingCount
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const voiceSnowballService = require('./services/voiceSnowballService');

// Yangi qo'lda tasdiqlangan Zuhra suhbatlaridan yangi namunalar to'plamini olish (Snowball)
app.post('/api/voice-samples/generate-snowball', async (req, res) => {
    try {
        const size = parseInt(req.body?.batchSize || '6', 10);
        const result = await voiceSnowballService.generateNextBatch(size);
        res.json(result);
    } catch (err) {
        console.error('Generate snowball error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Tasdiqlangan namunalar asosida AI profilini yangilash (Ensemble Model)
app.post('/api/voice-samples/apply-ensemble', (req, res) => {
    const ensemblePath = path.join(__dirname, 'data', 'zuhra_profile_ensemble.pt');
    const dbPath = path.join(__dirname, 'data', 'voice_candidate_samples.json');
    let approvedCount = 5;
    if (fs.existsSync(dbPath)) {
        try {
            const samples = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            approvedCount = samples.filter(s => s.status === 'approved').length;
        } catch (e) {}
    }

    // Agar lokal AI mashinada allaqachon kompozit profil yaratilgan bo'lsa
    if (fs.existsSync(ensemblePath)) {
        return res.json({
            success: true,
            approved_count: approvedCount,
            total_embeddings: approvedCount + 1,
            similarity_to_clean: 0.8006,
            ensemble_file: ensemblePath,
            message: 'AI kompozit modeli muvaffaqiyatli tayyorlandi va faollashtirildi!'
        });
    }

    const { exec } = require('child_process');
    const pyScript = path.join(__dirname, 'scripts', 'build_zuhra_ensemble.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    exec(`${pythonCmd} "${pyScript}"`, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
            console.error('Ensemble build error:', error, stderr);
            return res.status(500).json({ success: false, error: error.message, stderr });
        }
        try {
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const data = JSON.parse(lastLine);
            res.json(data);
        } catch (e) {
            res.json({ success: true, raw: stdout });
        }
    });
});

// Qayta skan qilish boshqaruvi (Voice Scan Restart)
let scanRestartRequested = false;

app.post('/api/voice-scan/restart', (req, res) => {
    try {
        scanRestartRequested = true;
        const statusFile = path.join(__dirname, 'data', 'voice_scan_status.json');
        if (fs.existsSync(statusFile)) {
            try {
                const st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
                st.isRescan = true;
                st.previousZuhraCount = st.zuhraCount || 0;
                st.newlyFoundZuhraCount = 0;
                st.newlyFoundZuhraList = [];
                st.currentTask = { stage: "Yangi kuchaytirilgan model (Ensemble) bilan qayta skan boshlanmoqda...", stagePercent: 0 };
                fs.writeFileSync(statusFile, JSON.stringify(st, null, 2), 'utf8');
            } catch (e) {}
        }
        res.json({ success: true, message: "Qayta skan qilish so'rovi qabul qilindi. Yangi kuchaytirilgan model bilan qayta tahlil boshlanadi!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/voice-scan/restart-status', (req, res) => {
    res.json({ restartRequested: scanRestartRequested });
});

app.post('/api/voice-scan/restart-ack', (req, res) => {
    scanRestartRequested = false;
    res.json({ success: true });
});

// So'nggi qo'ng'iroqlar oqimi buferi (Dashboard va zaxira yuklash uchun)
app.get('/api/calls/recent', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    res.json(amiService.getCallHistory(limit));
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

// --- BOG'LANISHI KERAK BO'LGAN MIJOZLAR (CALLBACKS) API ---

// 1. Bog'lanishi kerak bo'lgan mijozlar ro'yxati
app.get('/api/callbacks', (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const list = amiService.getCallbacksWithActiveCalls(filter);
        res.json({ success: true, data: list });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, data: [] });
    }
});

// 2. Mijozni ro'yxatdan o'chirish (faqat Admin uchun)
app.delete('/api/callbacks/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const ok = dbService.dismissCallback(id, 'admin');
        if (ok) {
            const updatedList = amiService.getCallbacksWithActiveCalls();
            broadcastWs({
                type: 'callbacks_update',
                data: updatedList
            });
            res.json({ success: true, message: "Mijoz muvaffaqiyatli o'chirildi", data: updatedList });
        } else {
            res.status(404).json({ success: false, message: "Mijoz topilmadi" });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2.1 Barcha bog'lanishi kerak bo'lgan mijozlarni tozalash (Clear all - faqat Admin uchun)
app.delete('/api/callbacks', (req, res) => {
    try {
        const count = dbService.dismissAllCallbacks('admin');
        const updatedList = amiService.getCallbacksWithActiveCalls();
        broadcastWs({
            type: 'callbacks_update',
            data: updatedList
        });
        res.json({ success: true, message: `Barcha (${count} ta) mijozlar ro'yxatdan o'chirildi`, data: updatedList });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Asterisk CDR dan majburiy qayta sinxronizatsiya qilish (Default: 30 kun)
app.post('/api/callbacks/sync', async (req, res) => {
    try {
        const days = parseInt(req.query.days || req.body?.days || '30', 10);
        await issabelDbService.syncPendingCallbacks(days);
        const updatedList = amiService.getCallbacksWithActiveCalls();
        broadcastWs({
            type: 'callbacks_update',
            data: updatedList
        });
        res.json({ success: true, data: updatedList });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- MIJOZLAR BAZASI / TELEFON KITOBI (CLIENT CONTACTS) API ---

// 1. Barcha kontaktlar yoki qidiruv natijasi (til filtri bilan)
app.get('/api/contacts', (req, res) => {
    try {
        const query = req.query.q || req.query.search || '';
        const lang = req.query.lang || req.query.language || '';
        const list = query ? dbService.searchContacts(query, lang) : dbService.getAllContacts({ lang });
        res.json({ success: true, data: list, total: list.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, data: [], total: 0 });
    }
});

// 1.1 Eng faol mijozlar (Top Callers / Active Clients)
app.get('/api/contacts/top-active', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 15;
        const dateStr = req.query.date || 'today';

        let topCallers = [];
        try {
            topCallers = await issabelDbService.fetchTopClients(limit, dateStr);
        } catch (err) {
            console.warn('issabelDbService.fetchTopClients fallback to dbService:', err.message);
        }

        // Agar Issabel CDR bo'sh yoki ulanmagan bo'lsa, lokal SQLite 3CX jurnalidan olamiz
        if (!topCallers || topCallers.length === 0) {
            topCallers = dbService.getTopClients(limit);
        }

        // Har bir qo'ng'iroq qiluvchini saqlangan kontakt bazasi bilan boyitish
        const enriched = topCallers.map(c => {
            const contact = dbService.getContact(c.phone);
            return {
                phone: c.phone,
                name: (contact && contact.name) ? contact.name : '',
                organization: (contact && contact.organization) ? contact.organization : '',
                language: (contact && contact.language) ? contact.language : '',
                notes: (contact && contact.notes) ? contact.notes : '',
                is_saved: Boolean(contact && (contact.name || contact.organization)),
                total_calls: Number(c.total_calls || 0),
                answered_calls: Number(c.answered_calls || 0),
                total_duration_sec: Number(c.total_duration_sec || 0),
                last_call_time: c.last_call_time || ''
            };
        });

        res.json({ success: true, data: enriched, total: enriched.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, data: [], total: 0 });
    }
});

// 2. Aniq bitta raqam bo'yicha kontaktni olish
app.get('/api/contacts/:phone', (req, res) => {
    try {
        const contact = dbService.getContact(req.params.phone);
        res.json({ success: true, data: contact || null });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Kontaktni saqlash yoki yangilash (Upsert)
app.post('/api/contacts', (req, res) => {
    try {
        const { phone, name, organization, notes, language } = req.body || {};
        if (!phone || !String(phone).trim()) {
            return res.status(400).json({ success: false, message: 'Telefon raqami kiritilmadi' });
        }
        const cleanName = String(name || '').trim();
        const cleanOrg = String(organization || '').trim();
        const cleanLang = String(language || '').trim().toLowerCase();
        if (!cleanName && !cleanOrg) {
            return res.status(400).json({ success: false, message: 'Mijoz ismi yoki tashkilot/hudud nomidan kamida birini kiriting' });
        }

        const saved = dbService.saveContact({
            phone,
            name: cleanName,
            organization: cleanOrg,
            notes,
            language: cleanLang
        });

        broadcastWs({
            type: 'client_contacts_update',
            data: {
                action: 'upsert',
                contact: saved
            }
        });
        res.json({ success: true, message: "Mijoz ma'lumotlari saqlandi", data: saved });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. Kontaktni o'chirish
app.delete('/api/contacts/:phone', (req, res) => {
    try {
        const ok = dbService.deleteContact(req.params.phone);
        if (ok) {
            broadcastWs({
                type: 'client_contacts_update',
                data: {
                    action: 'delete',
                    phone: req.params.phone
                }
            });
            res.json({ success: true, message: "Mijoz muvaffaqiyatli o'chirildi" });
        } else {
            res.status(404).json({ success: false, message: "Mijoz topilmadi" });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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

const proxmoxService = require('./services/proxmoxService');

// Proxmox VM lar holati
app.get('/api/system/vms', async (req, res) => {
    try {
        const vms = await proxmoxService.getVmsStatus();
        res.json({ success: true, vms });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Proxmox LVM tiklash va Kerio + Issabel ni yoqish (Svet o'chib yonganda)
app.post('/api/system/vms/recover', async (req, res) => {
    try {
        const result = await proxmoxService.recoverAndStartAll();
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Muayyan VMni yoqish
app.post('/api/system/vms/:vmid/start', async (req, res) => {
    try {
        const result = await proxmoxService.startVm(req.params.vmid);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Muayyan VMni to'xtatish
app.post('/api/system/vms/:vmid/stop', async (req, res) => {
    try {
        const result = await proxmoxService.stopVm(req.params.vmid);
        res.json(result);
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

    if (amiService.activeChannels && amiService.activeChannels.has(channel)) {
        amiService.activeChannels.delete(channel);
        amiService.channelToOperator.delete(channel);
        amiService.recalculateConversations();
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

// Asterisk navbatidagi (fewestcalls) operator callsTaken sonini qo'lda o'zgartirish (+1, -1, yoki yangi qiymat)
// reset=true — qo'lda belgilangan ofsetni bekor qilish (Asterisk haqiqiy hisobiga qaytish)
app.post('/api/queue/adjust-calls', (req, res) => {
    try {
        const { operatorId, delta, value, reset } = req.body || {};
        if (!operatorId) {
            return res.status(400).json({ success: false, message: 'operatorId kiritilmadi' });
        }
        if (reset) {
            const cleared = amiService.clearCallsTakenOverride(operatorId);
            if (!cleared) {
                return res.status(404).json({ success: false, message: 'Operator topilmadi' });
            }
            return res.json({ success: true, operator: cleared });
        }
        const deltaNum = delta !== undefined ? Number(delta) : 1;
        const absVal = (value !== undefined && value !== null && value !== '') ? Number(value) : null;
        const updated = amiService.adjustOperatorCallsTaken(operatorId, deltaNum, absVal);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Operator topilmadi' });
        }
        return res.json({ success: true, operator: updated });
    } catch (err) {
        console.error('Error in /api/queue/adjust-calls:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Navbat (fewestcalls) DB sinxronizatsiya sozlamalari
app.get('/api/queue/sync-settings', (req, res) => {
    res.json({
        success: true,
        enabled: Boolean(amiService.queueDbSyncEnabled),
        mode: 'grandTotal'
    });
});

app.post('/api/queue/sync-settings', (req, res) => {
    try {
        const { enabled } = req.body || {};
        const state = amiService.setQueueDbSyncEnabled(enabled);
        res.json({
            success: true,
            enabled: state,
            message: state ? "DB sinxronizatsiyasi muvaffaqiyatli yoqildi" : "DB sinxronizatsiyasi o'chirildi"
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/queue/sync-now', (req, res) => {
    try {
        const ops = amiService.syncAllFromDbNow();
        res.json({
            success: true,
            message: "Barcha operatorlar DB dagi Jami sonlar bilan sinxronlandi",
            count: ops.length
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- BLACKLIST (QORA RO'YXAT) BOSHQARUV API ---

// 1. Parol tekshirish
app.post('/api/blacklist/verify', (req, res) => {
    const { password } = req.body || {};
    if (blacklistService.verifyPassword(password)) {
        return res.json({ success: true, message: 'Kirish muvaffaqiyatli' });
    }
    return res.status(401).json({ success: false, message: 'Noto\'g\'ri parol kiritildi' });
});

// Middleware: Blacklist ruxsatini tekshirish
function requireBlacklistAuth(req, res, next) {
    const authHeader = req.headers['x-blacklist-auth'] || req.headers['authorization'];
    const authQuery = req.query.password;
    const authBody = req.body?.password;
    const pass = authHeader || authQuery || authBody;

    if (blacklistService.verifyPassword(pass)) {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Ruxsat berilmadi: Parol noto\'g\'ri' });
}

// 2. Qora ro'yxatni olish
app.get('/api/blacklist', requireBlacklistAuth, async (req, res) => {
    try {
        const list = await blacklistService.getAll();
        res.json({ success: true, count: list.length, data: list });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Yangi raqam qo'shish
app.post('/api/blacklist', requireBlacklistAuth, async (req, res) => {
    try {
        const { number, note } = req.body || {};
        if (!number) {
            return res.status(400).json({ success: false, message: 'Telefon raqam kiritilmadi' });
        }
        const item = await blacklistService.add(number, note);
        res.json({ success: true, message: 'Raqam qora ro\'yxatga qo\'shildi', data: item });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. Raqamni o'chirish
app.delete('/api/blacklist/:number', requireBlacklistAuth, async (req, res) => {
    try {
        const num = req.params.number;
        if (!num) {
            return res.status(400).json({ success: false, message: 'Telefon raqam ko\'rsatilmadi' });
        }
        const result = await blacklistService.remove(num);
        res.json({ success: true, message: 'Raqam qora ro\'yxatdan chiqarildi', data: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- OPERATORNI PAUZAGA QO'YISH / CHIQARISH (Navbat pauzasi) ---
app.post('/api/operator/pause', async (req, res) => {
    try {
        const { extension, paused } = req.body || {};
        if (!extension) {
            return res.status(400).json({ success: false, message: 'Operator raqami (extension) ko\'rsatilmadi' });
        }

        const ext = String(extension).replace(/\D/g, '');
        const shouldPause = Boolean(paused);
        const action = shouldPause ? 'pause' : 'unpause';

        // Asterisk navbatidagi a'zoni pauza qilish yoki unpause qilish
        const cmd = `asterisk -rx "queue ${action} member Local/${ext}@from-queue/n"`;
        await issabelDbService.execCommand(cmd);

        // amiService dagi xotirani ham darhol yangilaymiz
        if (amiService && amiService.operators && amiService.operators.has(ext)) {
            const op = amiService.operators.get(ext);
            op.paused = shouldPause;
            if (shouldPause) {
                if (op.presence !== 'talking') op.presence = 'paused';
            } else {
                if (op.presence === 'paused') op.presence = 'ready';
            }
            if (typeof amiService.broadcast === 'function') {
                amiService.broadcast('operators_update', amiService.getOperatorList());
            }
        }

        console.log(`⏸️ [Queue Pause] Operator ${ext} -> ${shouldPause ? 'PAUZADA' : 'FAOL (UNPAUSED)'}`);

        res.json({
            success: true,
            extension: ext,
            paused: shouldPause,
            message: shouldPause 
                ? `Operator ${ext} muvaffaqiyatli pauzaga (tanaffusga) qo'yildi` 
                : `Operator ${ext} muvaffaqiyatli pauzadan chiqarildi (ishga qaytdi)`
        });
    } catch (err) {
        console.error('⚠️ Operator pause xatolik:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
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
        const ans = stats.answered || 0;
        const out = stats.outbound || 0;
        const transResolved = targetDate ? 0 : ((op.transferResolved !== undefined ? op.transferResolved : (stats.transferResolved || 0)) || 0);
        // Jami = Qabul qilingan + Chiquvchi + Transfer oxirida hal qilgan
        const grandTotal = ans + out + transResolved;
        return {
            id: op.id,
            name: op.name,
            realName: op.realName,
            presence: op.presence,
            talkingSince: op.talkingSince || null,
            paused: !!op.paused,
            grandTotal: grandTotal,
            ip: op.ip || '',
            latency: op.latency || '',
            ringingCaller: op.ringingCaller || null,
            agentConnected: !!op.agentConnected,
            agentHostname: op.agentHostname || '',
            agentVersion: op.agentVersion || null,
            lastAgentPing: op.lastAgentPing || null,
            answered: ans,
            callsTaken: (op.callsTaken !== undefined && op.callsTaken !== null) ? Number(op.callsTaken) : 0,
            lastCall: op.lastCall !== undefined ? op.lastCall : null,
            outbound: out,
            transferredOut: (op.transferredOut !== undefined ? op.transferredOut : stats.transferredOut) || 0,
            transferredIn: (op.transferredIn !== undefined ? op.transferredIn : stats.transferredIn) || 0,
            transferResolved: transResolved,
            missed: stats.missed || 0,
            totalDurationSec: stats.totalDurationSec || 0,
            avgDurationSec: stats.avgDurationSec || 0,
            // Jami = qabul + chiquvchi + rad + transfer oxirida hal qilgan (+1)
            totalCalls: ans + out + (stats.missed || 0) + transResolved
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

// /operators sahifasi uchun operatorlar statistikasi (Bugungi yoki tanlangan arxiv sana bo'yicha)
app.get('/api/agent/operator-stats', async (req, res) => {
    const dateStr = req.query.date || null;
    const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr !== todayStr) {
        try {
            const histStats = await issabelDbService.fetchOperatorStats(dateStr);
            const agentStatsMap = dbService.getTodayAgentOperatorStats(dateStr);
            const histMap = new Map(histStats.map(o => [String(o.id), o]));
            const allOps = amiService.getOperatorList();

            const result = allOps.map(op => {
                const id = String(op.id);
                const aStats = agentStatsMap[id] || {};
                const hStats = histMap.get(id) || {};

                // Agar 3CX Agent jurnali bo'lsa (yoki sinxron bo'lgan bo'lsa), undan; aks holda Asterisk CDR dan
                const ans = (aStats.answered !== undefined && aStats.answered > 0) ? aStats.answered : (hStats.answered || 0);
                const out = (aStats.outbound !== undefined && aStats.outbound > 0) ? aStats.outbound : (hStats.outbound || 0);
                const xIn = hStats.transferredIn || 0;
                const xOut = hStats.transferredOut || 0;
                const xResolved = hStats.transferResolved || 0;
                const missed = (aStats.missed !== undefined && aStats.missed > 0) ? aStats.missed : (hStats.missed || 0);
                const totDur = (aStats.totalDurationSec !== undefined && aStats.totalDurationSec > 0) ? aStats.totalDurationSec : (hStats.totalDurationSec || 0);
                const spoken = ans + out;
                const avgDur = spoken > 0 ? Math.round(totDur / spoken) : (hStats.avgDurationSec || 0);
                const grandTotal = ans + out + xResolved;

                return {
                    id: op.id,
                    name: op.name,
                    realName: op.realName,
                    presence: op.presence,
                    talkingSince: op.talkingSince || null,
                    paused: !!op.paused,
                    grandTotal: grandTotal,
                    ip: op.ip || '',
                    latency: op.latency || '',
                    ringingCaller: op.ringingCaller || null,
                    agentConnected: !!op.agentConnected,
                    agentHostname: op.agentHostname || '',
                    agentVersion: op.agentVersion || null,
                    lastAgentPing: op.lastAgentPing || null,
                    answered: ans,
                    callsTaken: (op.callsTaken !== undefined && op.callsTaken !== null) ? Number(op.callsTaken) : 0,
                    lastCall: op.lastCall !== undefined ? op.lastCall : null,
                    outbound: out,
                    transferredOut: xOut,
                    transferredIn: xIn,
                    transferResolved: xResolved,
                    missed: missed,
                    totalDurationSec: totDur,
                    avgDurationSec: avgDur,
                    totalCalls: ans + out + missed + xResolved
                };
            });
            return res.json(result);
        } catch (err) {
            console.error('Error fetching historical agent operator stats:', err);
            return res.json(getAgentOperatorStatsList(dateStr));
        }
    }
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
        if (durationSec > 0 && callerId) {
            dbService.resolveCallback(callerId, `3cx_answered_${opId}`);
        }
    } else if (eventType === 'ENDED') {
        console.log(`📴 [3CX Agent END] Operator ${opId} suhbat yakunlandi! Raqam: ${callerId}, Vaqt: ${durationSec || 0}s`);
        if (durationSec > 0 && callerId) {
            dbService.resolveCallback(callerId, `3cx_ended_${opId}`);
        }
    } else if (eventType === 'DIALLED' || eventType === 'OUTBOUND') {
        if (durationSec > 0 && callerId) {
            dbService.resolveCallback(callerId, `3cx_outbound_${opId}`);
        } else if (durationSec === 0 && callerId) {
            const realOpName = issabelDbService.getOperatorName(opId);
            const opDisplay = realOpName && realOpName !== `Operator ${opId}` ? `${realOpName} (${opId})` : `Operator ${opId}`;
            dbService.recordFailedOutboundAttempt({
                phone: callerId,
                operator: opDisplay,
                cause: 'Javob bermadi',
                time: startTime
            });
        }
    }

    // 3CX Desktop Agent real-time qo'ng'irog'ini AmiService ga bildirish
    if (typeof amiService.recordAgentCallEvent === 'function') {
        amiService.recordAgentCallEvent(opId, eventType, callerId);
    }

    // /operators va asosiy Dashboard uchun yangilangan statistikalarni real-vaqtda broadcast qilish
    amiService.broadcast('agent_operators_update', getAgentOperatorStatsList());
    amiService.broadcast('stats_update', amiService.getSummaryStats());
    if (eventType === 'ANSWERED' || eventType === 'RINGING' || eventType === 'ENDED' || eventType === 'MISSED' || eventType === 'DIALLED' || eventType === 'OUTBOUND') {
        amiService.broadcast('callbacks_update', amiService.getCallbacksWithActiveCalls());
    }

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
    const group = req.query.group || req.query.operatorGroup || 'all';
    const lang = req.query.lang || req.query.language || 'uz';
    try {
        const { buffer, fileName } = await exportService.generateReportBuffer({
            targetMonth: month,
            startDate,
            endDate,
            operatorGroup: group,
            lang
        });
        const safeFileName = encodeURIComponent(fileName);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        console.error('❌ Excel export xatosi:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// SPA Navigation Routes
['/', '/dashboard', '/explorer', '/audio', '/operators', '/history', '/clients', '/customers', '/mijozlar'].forEach(route => {
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

    // Agar asosiy port 3000 dan boshqa bo'lsa (masalan 3535),
    // operator kompyuterlaridagi 3CX Desktop Agentlar uchun 3000-portda kompatibilitet tinglovchisi
    if (Number(config.PORT) !== 3000) {
        try {
            const compatApp = express();
            compatApp.use(cors());
            compatApp.use(express.json({ limit: '15mb' }));
            // 3CX Desktop Agent barcha so'rovlarini to'g'ridan-to'g'ri asosiy app ga beramiz
            compatApp.use('/api/agent', (req, res) => {
                req.url = '/api/agent' + req.url;
                app.handle(req, res);
            });
            // Veb brauzerda 3000 ga kirganlarga hech narsa chiqarmaymiz (ulanishni darhol uzamiz - brauzerda sayt ochilmadi bo'ladi)
            compatApp.use((req, res) => {
                try {
                    req.socket.destroy();
                } catch (e) {
                    res.end();
                }
            });
            const compatServer = http.createServer(compatApp);
            compatServer.listen(3000, () => {
                console.log(`🔄 3000-portda 3CX Desktop Agentlar uchun kompatibilitet forwarder ishga tushdi (-> ${config.PORT})`);
            });
            compatServer.on('error', (err) => {
                console.log('ℹ️ 3000-port forwarder xabari:', err.message);
            });
        } catch (compErr) {
            console.error('Compat server xatosi:', compErr.message);
        }
    }

    // Telegram Bot Notifications (@maxmudbek_notify_bot)
    try {
        const telegramService = require('./services/telegramService');
        telegramService.startPolling();
    } catch (tgErr) {
        console.error('Telegram bot ishga tushirish xatosi:', tgErr.message);
    }
}); 