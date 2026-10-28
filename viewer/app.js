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
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ticketService = require('./services/ticketService');

const PORT = parseInt(process.env.PORT || '3005', 10);
// Upstream host (3535) - agar alohida berilmagan bo'lsa 127.0.0.1
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_HTTP = process.env.UPSTREAM_HTTP || `http://${UPSTREAM_HOST}:3535`;
const UPSTREAM_WS = process.env.UPSTREAM_WS || `ws://${UPSTREAM_HOST}:3535`;

// --- AUTHENTICATION & SECURITY GATEWAY (PORT 3005) ---
const sessionCache = new Map(); // token -> { user, expiresAt }

function extractToken(req) {
    if (!req) return null;
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7).trim();
    }
    const cookieHeader = req.headers?.cookie;
    if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)cc_session=([^;]+)/);
        if (match) return decodeURIComponent(match[1]);
    }
    if (req.query && req.query.token) {
        return req.query.token;
    }
    if (req.url && req.url.includes('token=')) {
        try {
            const parsedUrl = new URL(req.url, 'http://localhost');
            const t = parsedUrl.searchParams.get('token');
            if (t) return t;
        } catch (e) {}
    }
    return null;
}

function validateSessionWithUpstream(token) {
    return new Promise((resolve) => {
        if (!token) return resolve(null);
        const cached = sessionCache.get(token);
        if (cached && cached.expiresAt > Date.now()) {
            return resolve(cached.user);
        }

        const clientReq = http.request({
            hostname: UPSTREAM_HOST,
            port: 3535,
            path: '/api/auth/me',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 2500
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.authenticated && parsed.user) {
                            sessionCache.set(token, {
                                user: parsed.user,
                                expiresAt: Date.now() + 60000 // 60s kesh
                            });
                            return resolve(parsed.user);
                        }
                    } catch (e) {}
                }
                resolve(null);
            });
        });
        clientReq.on('error', () => resolve(null));
        clientReq.on('timeout', () => { clientReq.destroy(); resolve(null); });
        clientReq.end();
    });
}

function logoutUpstream(token) {
    return new Promise((resolve) => {
        if (!token) return resolve(false);
        const clientReq = http.request({
            hostname: UPSTREAM_HOST,
            port: 3535,
            path: '/api/auth/logout',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 2500
        }, () => resolve(true));
        clientReq.on('error', () => resolve(false));
        clientReq.on('timeout', () => { clientReq.destroy(); resolve(false); });
        clientReq.end();
    });
}

const app = express();
app.set('json spaces', 2);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// HTTP -> HTTPS Redirect Gateway
app.use((req, res, next) => {
    const isHttps = req.secure || req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    if (!isHttps) {
        const host = req.headers.host || req.hostname;
        return res.redirect(301, `https://${host}${req.originalUrl || req.url}`);
    }
    next();
});

// Tizimdan chiqish (Logout)
app.all(['/logout', '/api/auth/logout'], async (req, res) => {
    const token = extractToken(req);
    if (token) {
        sessionCache.delete(token);
        await logoutUpstream(token);
    }
    res.clearCookie('cc_session', { path: '/' });
    const host = req.hostname || 'uniconsoft.ddns.net';
    const isPublic = host === 'uniconsoft.ddns.net';
    const loginUrl = isPublic ? 'https://uniconsoft.ddns.net/login' : `https://${host}:3535/login`;

    if (req.path === '/logout') {
        return res.redirect(loginUrl);
    }
    return res.json({ success: true, redirect: loginUrl });
});

// Ichki so'rov: 3535 (Admin) dan kelgan foydalanuvchi sessiyasini darhol bekor qilish (kick qilish)
app.post('/api/internal/invalidate-sessions', express.json(), (req, res) => {
    const { username } = req.body || {};
    if (username) {
        for (const [t, entry] of sessionCache.entries()) {
            if (entry.user && entry.user.username === username) {
                sessionCache.delete(t);
            }
        }
    } else {
        sessionCache.clear();
    }
    if (typeof wss !== 'undefined' && wss && wss.clients) {
        wss.clients.forEach(client => {
            if (client.user && (!username || client.user.username === username)) {
                try {
                    client.send(JSON.stringify({ type: 'session_terminated', message: 'Parolingiz o\'zgartirildi. Iltimos, qayta kiring.' }));
                    client.close(4001, 'Session invalidated');
                } catch (e) {}
            }
        });
    }
    res.json({ success: true });
});

// 1. Sessiya / Token tekshiruv middleware
app.use(async (req, res, next) => {
    const p = req.path;

    // Statik ochiq fayllar (Favicon, rasmlar, ikonlar, css, version, tools, downloads)
    if (
        p === '/favicon.ico' ||
        p === '/favicon.png' ||
        p === '/api/version' ||
        p === '/version.json' ||
        p.startsWith('/icons/') ||
        p.startsWith('/images/') ||
        p.startsWith('/img/') ||
        p.startsWith('/css/') ||
        p.startsWith('/js/') ||
        p.startsWith('/uploads/') ||
        p.startsWith('/downloads/') ||
        p.startsWith('/tools/')
    ) {
        return next();
    }

    const token = extractToken(req);
    const user = await validateSessionWithUpstream(token);

    if (user) {
        req.user = user;
        // Agar token URL parametri orqali kelgan bo'lsa, cookie ga o'rnatish
        if (req.query && req.query.token) {
            res.cookie('cc_session', req.query.token, {
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });
        }
        return next();
    }

    // Tizimga kirmagan bo'lsa:
    const host = req.hostname || 'uniconsoft.ddns.net';
    const isPublic = host === 'uniconsoft.ddns.net';
    const loginUrl = isPublic ? 'https://uniconsoft.ddns.net/login' : `https://${host}:3535/login`;

    const isApi = p.startsWith('/api/') || 
                  req.xhr || 
                  (req.headers.accept && req.headers.accept.includes('application/json'));

    if (isApi) {
        return res.status(401).json({
            error: 'unauthorized',
            message: 'Tizimga kirish talab qilinadi',
            redirect: loginUrl
        });
    }

    return res.redirect(loginUrl);
});

app.use(express.static(path.join(__dirname, 'public')));

// SSL sertifikatlari mavjud bo'lsa, to'g'ridan-to'g'ri 3005-portda HTTPS ishga tushadi
const wss = new WebSocket.Server({ noServer: true, maxPayload: 15 * 1024 * 1024 });

const handleUpgrade = async (request, socket, head) => {
    const token = extractToken(request);
    const user = await validateSessionWithUpstream(token);

    if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = user;
        wss.emit('connection', ws, request);
    });
};

// SSL sertifikatlari mavjud bo'lsa, bitta 3005-portda HTTP va HTTPS ni parallel qabul qiluvchi multiplexer
let server;
let isHttps = false;
try {
    const sslDir = path.join(__dirname, 'ssl');
    const keyFile = path.join(sslDir, 'server.key');
    const certFile = path.join(sslDir, 'server.crt');
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
        const httpsOptions = {
            key: fs.readFileSync(keyFile),
            cert: fs.readFileSync(certFile)
        };
        const httpServer = http.createServer(app);
        const httpsServer = https.createServer(httpsOptions, app);

        httpServer.on('upgrade', handleUpgrade);
        httpsServer.on('upgrade', handleUpgrade);

        // HTTP va HTTPS ni bitta 3005-portda birgalikda qabul qiluvchi multiplexer:
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
        server.on('error', (err) => console.error('Viewer multiplexer xatosi:', err));
        isHttps = true;
    } else {
        server = http.createServer(app);
        server.on('upgrade', handleUpgrade);
    }
} catch (sslErr) {
    console.warn('⚠️ SSL yuklashda xatolik, oddiy HTTP ga o\'tildi:', sslErr.message);
    server = http.createServer(app);
    server.on('upgrade', handleUpgrade);
}

// Helper: Sanitize call history / details to completely remove audio paths
function sanitizeCalls(calls) {
    if (!Array.isArray(calls)) return calls;
    return calls.map(c => {
        const clean = { ...c };
        delete clean.recording;
        delete clean.recordingfile;
        delete clean.uniqueid_clean;
        return clean;
    });
}

// Client IP extractor (IPv6 to IPv4 clean)
function extractClientIp(req) {
    if (!req) return '127.0.0.1';
    let ip = req.headers['x-forwarded-for'] || 
             req.socket?.remoteAddress || 
             req.connection?.remoteAddress || '';
    if (typeof ip === 'string' && ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }
    ip = String(ip).replace(/^.*:/, '');
    if (ip === '1' || ip === '') ip = '127.0.0.1';
    return ip;
}

// Baza yoki Asterisk orqali olingan operatorlar IP manzillari xaritasi
const operatorIpMap = new Map([
    ['192.168.0.17', { id: '101', exten: '101', name: 'Oybek' }],
    ['192.168.0.100', { id: '103', exten: '103', name: 'Feruza' }],
    ['192.168.0.19', { id: '111', exten: '111', name: 'Nozima' }],
    ['192.168.0.18', { id: '120', exten: '120', name: 'Navruzoy' }],
    ['192.168.0.15', { id: '119', exten: '119', name: 'Muattar' }],
    ['192.168.0.114', { id: '114', exten: '114', name: 'Maxmudbek' }],
    ['192.168.0.106', { id: '106', exten: '106', name: 'Ubaydullayeva Gulchehra' }]
]);

// Operatorlar ro'yxatidan IP larni dinamik yangilash
function updateCachedOperators(opsList) {
    if (!Array.isArray(opsList)) return;
    for (const op of opsList) {
        if (!op) continue;
        const opId = String(op.id || op.exten || '');
        const ip = op.ip;
        const rawName = op.realName || op.name || `Operator ${opId}`;
        const cleanName = String(rawName).replace(/\s*\(\d+\)\s*/g, '').trim();
        if (ip && ip !== '-none-' && ip !== '(null)' && ip !== '') {
            operatorIpMap.set(ip, {
                id: opId,
                exten: opId,
                name: cleanName,
                hostname: op.agentHostname || ''
            });
        }
    }
}

// Operator ID bo'yicha operator ismini avtomatik aniqlash
const OPERATOR_NAMES_MAP = {
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

function resolveOperatorName(opId) {
    if (!opId) return null;
    const cleanId = String(opId).trim();
    if (OPERATOR_NAMES_MAP[cleanId]) return OPERATOR_NAMES_MAP[cleanId];
    for (const item of operatorIpMap.values()) {
        if (String(item.id) === cleanId && item.name) {
            return String(item.name).replace(/\s*\(\d+\)\s*/g, '').replace('Ubaydullayeva ', '').trim();
        }
    }
    return `Operator ${cleanId}`;
}


// ==========================================================================
// Viewer Kirish Tarixi (Viewer Access & Connection History) — Faqat Superuser uchun
// ==========================================================================
const VIEWER_HISTORY_FILE = path.join(__dirname, 'data', 'viewer_history.json');
let viewerHistory = [];

function loadViewerHistory() {
    try {
        if (fs.existsSync(VIEWER_HISTORY_FILE)) {
            const data = fs.readFileSync(VIEWER_HISTORY_FILE, 'utf8');
            viewerHistory = JSON.parse(data);
            if (!Array.isArray(viewerHistory)) viewerHistory = [];
        }
    } catch (e) {
        console.warn('⚠️ viewer_history.json yuklashda xatolik:', e.message);
        viewerHistory = [];
    }

    // Server qayta ishga tushganda eski 'online' qolgan yozuvlarni offline ga o'tkazamiz
    const now = Date.now();
    let updated = false;
    for (const item of viewerHistory) {
        if (item.status === 'online') {
            item.status = 'offline';
            if (!item.disconnectedAt) {
                item.disconnectedAt = now;
                item.durationSeconds = Math.max(0, Math.round((item.disconnectedAt - item.connectedAt) / 1000));
            }
            updated = true;
        }
    }
    if (updated) saveViewerHistory();
}

function saveViewerHistory() {
    try {
        if (viewerHistory.length > 500) {
            viewerHistory = viewerHistory.slice(-500);
        }
        const dataDir = path.dirname(VIEWER_HISTORY_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(VIEWER_HISTORY_FILE, JSON.stringify(viewerHistory, null, 2), 'utf8');
    } catch (e) {
        console.warn('⚠️ viewer_history.json saqlashda xatolik:', e.message);
    }
}

loadViewerHistory();

// Hozirda viewer sahifasini ochib turgan barcha faol ulanishlar
const connectedViewers = new Map(); // ws -> { ip, operatorId, operatorName, username, role, connectedAt }

function getActiveViewersList() {
    const userGroups = new Map();

    for (const [ws, info] of connectedViewers.entries()) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        // Group key:
        // DDNS (uniconsoft.ddns.net) yoki bitta Wi-Fi orqali bir nechta operator kirsa, IP lari bir xil bo'ladi.
        // Shuning uchun operatorId yoki username bo'yicha guruhlaymiz:
        let groupKey;
        if (info.operatorId) {
            groupKey = `op_${info.operatorId}`;
        } else if (info.username && info.username !== 'anon' && info.username !== 'Mehmon') {
            groupKey = `user_${info.username}_${info.ip}`;
        } else {
            groupKey = `guest_${info.ip}`;
        }

        if (!userGroups.has(groupKey)) {
            userGroups.set(groupKey, {
                groupKey,
                ip: info.ip,
                operatorId: info.operatorId,
                operatorName: info.operatorName,
                username: info.username,
                role: info.role,
                tabsCount: 0,
                connectedAt: info.connectedAt
            });
        }

        const group = userGroups.get(groupKey);
        group.tabsCount++;
        if (info.operatorId && !group.operatorId) {
            group.operatorId = info.operatorId;
            group.operatorName = info.operatorName;
        }
        if (info.connectedAt < group.connectedAt) {
            group.connectedAt = info.connectedAt;
        }
    }

    const viewers = [];
    for (const [key, group] of userGroups.entries()) {
        let op = null;
        if (group.operatorId) {
            op = Array.from(operatorIpMap.values()).find(o => String(o.id) === String(group.operatorId)) || {
                id: group.operatorId,
                exten: group.operatorId,
                name: group.operatorName || `Operator ${group.operatorId}`
            };
        } else {
            op = operatorIpMap.get(group.ip);
        }

        if (op) {
            viewers.push({
                ip: group.ip,
                isOperator: true,
                id: op.id,
                exten: op.exten,
                name: op.name,
                tabsCount: group.tabsCount,
                connectedAt: group.connectedAt
            });
        } else if (group.role === 'superuser' || group.username === 'superuser' || group.ip === '127.0.0.1' || group.ip === '192.168.0.2') {
            viewers.push({
                ip: group.ip,
                isOperator: false,
                name: 'Admin',
                tabsCount: group.tabsCount,
                connectedAt: group.connectedAt
            });
        } else if (group.username && group.username !== 'anon') {
            viewers.push({
                ip: group.ip,
                isOperator: false,
                name: `${group.username} (${group.ip})`,
                tabsCount: group.tabsCount,
                connectedAt: group.connectedAt
            });
        } else {
            viewers.push({
                ip: group.ip,
                isOperator: false,
                name: `Mehmon (${group.ip})`,
                tabsCount: group.tabsCount,
                connectedAt: group.connectedAt
            });
        }
    }

    viewers.sort((a, b) => {
        if (a.isOperator && !b.isOperator) return -1;
        if (!a.isOperator && b.isOperator) return 1;
        return (a.id || a.name || '').localeCompare(b.id || b.name || '');
    });

    return {
        count: viewers.length,
        totalTabs: connectedViewers.size,
        viewers
    };
}

function broadcastActiveViewers() {
    const payload = JSON.stringify({
        type: 'active_viewers_update',
        data: getActiveViewersList()
    });
    for (const [ws] of connectedViewers.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(payload);
            } catch (e) {}
        }
    }
}

function getViewerVersionInfo() {
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
        app: 'call-center-viewer'
    };
}

function findSocketsForOperator(targetOpId) {
    const sockets = [];
    const targetStr = String(targetOpId || '').trim();
    if (!targetStr) return sockets;
    for (const [ws, info] of connectedViewers.entries()) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const mappedOp = operatorIpMap.get(info.ip);
        const currentOpId = String(info.operatorId || mappedOp?.id || mappedOp?.exten || '').trim();
        if (currentOpId === targetStr) {
            sockets.push(ws);
        }
    }
    return sockets;
}

function handleHelpRequest(callerWs, data) {
    const { requestId, fromId, fromName, toId, toName, audioBase64, durationSec, hasVoice, textMessage } = data || {};
    if (!requestId || !toId) return;

    console.log(`🔔 [Help Request] ${fromName} (${fromId}) -> ${toName} (${toId}) [Voice: ${!!audioBase64}, Text: ${!!textMessage}, Dur: ${durationSec || 0}s]`);

    const targetSockets = findSocketsForOperator(toId);
    if (targetSockets.length === 0) {
        // Target operator not active on viewer
        try {
            callerWs.send(JSON.stringify({
                type: 'help_request_status',
                data: {
                    requestId,
                    status: 'offline',
                    toId,
                    toName,
                    message: "Operator viewer tizimida hozir faol emas (sahifa ochiq emas)"
                }
            }));
        } catch (e) {}
        return;
    }

    // Notify caller that call is ringing
    try {
        callerWs.send(JSON.stringify({
            type: 'help_request_status',
            data: {
                requestId,
                status: 'ringing',
                toId,
                toName,
                hasVoice: Boolean(audioBase64),
                hasText: Boolean(textMessage)
            }
        }));
    } catch (e) {}

    // Send incoming request to all open tabs of target operator
    const payload = JSON.stringify({
        type: 'incoming_help_request',
        data: {
            requestId,
            fromId,
            fromName,
            toId,
            toName,
            audioBase64: audioBase64 || null,
            durationSec: durationSec || 0,
            hasVoice: Boolean(audioBase64),
            textMessage: textMessage ? String(textMessage).trim() : null,
            timestamp: Date.now()
        }
    });

    for (const ws of targetSockets) {
        try {
            ws.send(payload);
        } catch (e) {}
    }
}

function handleHelpResponse(responderWs, data) {
    const { requestId, fromId, toId, toName, accepted } = data || {};
    if (!requestId || !fromId) return;

    console.log(`📞 [Help Response] ${toName} (${toId}) -> ${fromId}: ${accepted ? 'QABUL QILINDI (ACCEPTED)' : 'RAD ETILDI / BAND (REJECTED)'}`);

    const callerSockets = findSocketsForOperator(fromId);
    const payload = JSON.stringify({
        type: 'help_response_received',
        data: {
            requestId,
            fromId,
            toId,
            toName,
            accepted: !!accepted,
            timestamp: Date.now()
        }
    });

    for (const ws of callerSockets) {
        try {
            ws.send(payload);
        } catch (e) {}
    }
}

function handleHelpCancel(callerWs, data) {
    const { requestId, fromId, toId } = data || {};
    if (!requestId || !toId) return;

    console.log(`🚫 [Help Cancelled] ${fromId} bekor qildi -> ${toId}`);

    const targetSockets = findSocketsForOperator(toId);
    const payload = JSON.stringify({
        type: 'help_cancelled',
        data: {
            requestId,
            fromId,
            toId
        }
    });

    for (const ws of targetSockets) {
        try {
            ws.send(payload);
        } catch (e) {}
    }
}

// 1. WebSocket Proxy to 3535 + Active Viewers Management
wss.on('connection', (clientWs, req) => {
    let upstreamWs = null;
    const clientIp = extractClientIp(req);
    const wsUser = clientWs.user || {};

    clientWs.isAlive = true;
    clientWs.on('pong', () => { clientWs.isAlive = true; });

    // Agar foydalanuvchi hisobida operatorId bo'lsa, uni qat'iy olamiz va qotiramiz!
    const autoMappedOp = operatorIpMap.get(clientIp);
    const resolvedOpId = wsUser.operatorId ? String(wsUser.operatorId).trim() : (autoMappedOp ? autoMappedOp.id : null);
    const resolvedOpName = resolvedOpId 
        ? resolveOperatorName(resolvedOpId)
        : (autoMappedOp ? autoMappedOp.name : null);
    const isOpLocked = Boolean(wsUser.operatorId);

    connectedViewers.set(clientWs, {
        ip: clientIp,
        operatorId: resolvedOpId,
        operatorName: resolvedOpName,
        operatorLocked: isOpLocked,
        username: wsUser.username || null,
        role: wsUser.role || null,
        connectedAt: Date.now()
    });

    // Kirish tarixiga yozish
    const historyEntry = {
        id: `vh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        ip: clientIp,
        username: wsUser.username || (clientIp === '127.0.0.1' || clientIp === '192.168.0.2' ? 'Admin' : 'Mehmon'),
        role: wsUser.role || 'guest',
        operatorId: resolvedOpId,
        operatorName: resolvedOpName,
        connectedAt: Date.now(),
        disconnectedAt: null,
        durationSeconds: null,
        status: 'online',
        userAgent: req.headers['user-agent'] || ''
    };
    clientWs._historyId = historyEntry.id;
    viewerHistory.push(historyEntry);
    saveViewerHistory();

    console.log(`👁️ [Viewer Connection] Yangi foydalanuvchi ulandi: IP ${clientIp} ${resolvedOpName ? `(${resolvedOpName})` : ''} | User: ${wsUser.username || 'anon'} (${wsUser.role || 'guest'})${isOpLocked ? ' [LOCKED]' : ''} (Jami oyna: ${connectedViewers.size})`);

    // Yangi ulangan mijozga o'z IP si, versiya va hozirgi onlayn kuzatuvchilarni yuborish
    try {
        clientWs.send(JSON.stringify({
            type: 'client_identity',
            data: { 
                ip: clientIp,
                operatorId: resolvedOpId,
                operatorName: resolvedOpName,
                operatorLocked: isOpLocked,
                username: wsUser.username || null,
                role: wsUser.role || null
            }
        }));
        clientWs.send(JSON.stringify({
            type: 'server_version',
            data: getViewerVersionInfo()
        }));
        clientWs.send(JSON.stringify({
            type: 'active_viewers_update',
            data: getActiveViewersList()
        }));
    } catch (e) {}

    // Barcha boshqa mijozlarga ham yangilangan onlaynlar sonini yuborish
    broadcastActiveViewers();

    try {
        upstreamWs = new WebSocket(UPSTREAM_WS);

        upstreamWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                try {
                    const parsed = JSON.parse(data.toString());

                    // 3535 (Admin) server_version hodisasini Viewer ga o'tkazmaymiz (Viewer o'z buildId siga ega)
                    if (parsed.type === 'server_version') {
                        return;
                    }

                    if (parsed.type === 'initial_state' && parsed.data) {
                        delete parsed.data.serverVersion; // 3535 ning versiyasini uzatmaymiz
                        parsed.data.sftpStatus = false;
                        if (parsed.data.callHistory) {
                            parsed.data.callHistory = sanitizeCalls(parsed.data.callHistory);
                        }
                        if (Array.isArray(parsed.data.operators)) {
                            updateCachedOperators(parsed.data.operators);
                        }
                    } else if (parsed.type === 'operators_update' && Array.isArray(parsed.data)) {
                        updateCachedOperators(parsed.data);
                    } else if (parsed.type === 'agent_operators_update' && Array.isArray(parsed.data)) {
                        updateCachedOperators(parsed.data);
                    }
                    clientWs.send(JSON.stringify(parsed));
                } catch (e) {
                    clientWs.send(data);
                }
            }
        });

        upstreamWs.on('error', (err) => {
            console.warn(`Upstream WS error (${UPSTREAM_WS}):`, err.message);
        });

        upstreamWs.on('close', () => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
            }
        });

        clientWs.on('message', (msg) => {
            try {
                const parsed = JSON.parse(msg.toString());
                if (parsed && parsed.type) {
                    if (parsed.type === 'register_operator' && parsed.data) {
                        const info = connectedViewers.get(clientWs);
                        if (info) {
                            if (info.operatorLocked) {
                                console.log(`🔒 [Operator Register Blocked] IP ${clientIp} allaqachon ${info.operatorName} (${info.operatorId}) profiliga qotirilgan`);
                                return;
                            }
                            info.operatorId = String(parsed.data.operatorId || '').trim();
                            info.operatorName = String(parsed.data.operatorName || '').trim();
                            console.log(`👤 [Operator Registered] IP ${clientIp} -> Operator ${info.operatorName} (${info.operatorId})`);
                            if (clientWs._historyId) {
                                const hItem = viewerHistory.find(h => h.id === clientWs._historyId);
                                if (hItem) {
                                    hItem.operatorId = info.operatorId;
                                    hItem.operatorName = info.operatorName;
                                    saveViewerHistory();
                                }
                            }
                            broadcastActiveViewers();
                        }
                        return;
                    }
                    if (parsed.type === 'help_request' && parsed.data) {
                        handleHelpRequest(clientWs, parsed.data);
                        return;
                    }
                    if (parsed.type === 'help_response' && parsed.data) {
                        handleHelpResponse(clientWs, parsed.data);
                        return;
                    }
                    if (parsed.type === 'help_cancel' && parsed.data) {
                        handleHelpCancel(clientWs, parsed.data);
                        return;
                    }
                }
            } catch (e) {}

            if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.send(msg);
            }
        });

        clientWs.on('close', () => {
            connectedViewers.delete(clientWs);
            if (clientWs._historyId) {
                const hItem = viewerHistory.find(h => h.id === clientWs._historyId);
                if (hItem) {
                    hItem.disconnectedAt = Date.now();
                    hItem.status = 'offline';
                    hItem.durationSeconds = Math.max(0, Math.round((hItem.disconnectedAt - hItem.connectedAt) / 1000));
                    saveViewerHistory();
                }
            }
            console.log(`👋 [Viewer Disconnect] Foydalanuvchi chiqdi: IP ${clientIp} (Qoldi: ${connectedViewers.size})`);
            broadcastActiveViewers();
            if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.close();
            }
        });
    } catch (wsErr) {
        console.error('WS proxy initialization error:', wsErr.message);
        connectedViewers.delete(clientWs);
        broadcastActiveViewers();
    }
});

// O'lik ulanishlarni har 30 soniyada tozalash (Heartbeat Watchdog)
setInterval(() => {
    let changed = false;
    for (const [ws, info] of connectedViewers.entries()) {
        if (ws.isAlive === false) {
            connectedViewers.delete(ws);
            if (ws._historyId) {
                const hItem = viewerHistory.find(h => h.id === ws._historyId);
                if (hItem) {
                    hItem.disconnectedAt = Date.now();
                    hItem.status = 'offline';
                    hItem.durationSeconds = Math.max(0, Math.round((hItem.disconnectedAt - hItem.connectedAt) / 1000));
                    saveViewerHistory();
                }
            }
            try { ws.terminate(); } catch (e) {}
            changed = true;
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch (e) {
            connectedViewers.delete(ws);
            changed = true;
        }
    }
    if (changed) {
        broadcastActiveViewers();
    }
}, 30000);

// Build / Versiya tekshiruvi (Deploy va avtomatik yangilanish uchun)
app.get('/api/version', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(getViewerVersionInfo());
});

// Joriy autentifikatsiya qilingan foydalanuvchi va biriktirilgan operator ma'lumotlari
app.get('/api/auth/me', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ authenticated: false });
    }
    const clientIp = extractClientIp(req);
    const autoMappedOp = operatorIpMap.get(clientIp);
    const resolvedOpId = req.user.operatorId ? String(req.user.operatorId).trim() : (autoMappedOp ? autoMappedOp.id : null);
    const resolvedOpName = resolvedOpId 
        ? resolveOperatorName(resolvedOpId)
        : (autoMappedOp ? autoMappedOp.name : null);

    res.json({
        authenticated: true,
        user: {
            username: req.user.username,
            role: req.user.role,
            operatorId: resolvedOpId,
            operatorName: resolvedOpName,
            email: req.user.email || null
        }
    });
});

// Profil Gmail manzilini saqlash / yangilash (Upstream 3535 ga uzatish)
app.put('/api/auth/profile/email', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Avtorizatsiyadan o\'tilmagan' });
    }
    const token = extractToken(req);
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/auth/profile/email`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(req.body || {})
        });
        const json = await resp.json();
        if (resp.ok && json.success) {
            // Sessiya keshini yangilash
            if (token && sessionCache.has(token)) {
                const entry = sessionCache.get(token);
                if (entry && entry.user) {
                    entry.user.email = json.email;
                }
            }
            if (req.user) {
                req.user.email = json.email;
            }
        }
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server xatosi: ' + e.message });
    }
});

// Profil Gmail tasdiqlash kodi jo'natish (Upstream 3535 ga uzatish)
app.post('/api/auth/profile/email/send-code', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Avtorizatsiyadan o\'tilmagan' });
    }
    const token = extractToken(req);
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/auth/profile/email/send-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(req.body || {})
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server xatosi: ' + e.message });
    }
});

// Profil Gmail kodini tekshirish va tasdiqlash (Upstream 3535 ga uzatish)
app.post('/api/auth/profile/email/verify', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Avtorizatsiyadan o\'tilmagan' });
    }
    const token = extractToken(req);
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/auth/profile/email/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(req.body || {})
        });
        const json = await resp.json();
        if (resp.ok && json.success) {
            // Sessiya keshini yangilash
            if (token && sessionCache.has(token)) {
                const entry = sessionCache.get(token);
                if (entry && entry.user) {
                    entry.user.email = json.email;
                }
            }
            if (req.user) {
                req.user.email = json.email;
            }
        }
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server xatosi: ' + e.message });
    }
});

// 2. REST API Proxies to 3535
app.get('/api/status', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/status`);
        const json = await resp.json();
        json.sftpConnected = false;
        json.mode = 'viewer_operators_only';
        res.json(json);
    } catch (e) {
        res.json({ amiConnected: true, host: '192.168.0.124', sftpConnected: false });
    }
});

// Operatorlar ro'yxati
app.get('/api/operators', async (req, res) => {
    try {
        const queryStr = new URLSearchParams(req.query).toString();
        const url = queryStr ? `${UPSTREAM_HTTP}/api/operators?${queryStr}` : `${UPSTREAM_HTTP}/api/operators`;
        const resp = await fetch(url);
        const json = await resp.json();
        res.json(json);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// So'nggi qo'ng'iroqlar buferi (Dashboard va zaxira yuklash uchun)
app.get('/api/calls/recent', async (req, res) => {
    try {
        const queryStr = new URLSearchParams(req.query).toString();
        const resp = await fetch(`${UPSTREAM_HTTP}/api/calls/recent?${queryStr}`);
        const json = await resp.json();
        res.json(Array.isArray(json) ? sanitizeCalls(json) : json);
    } catch (e) {
        res.status(500).json([]);
    }
});

// Calls details (Operator bosilganda ochiladigan modal) — Audio butunlay tozalangan
app.get('/api/calls/details', async (req, res) => {
    try {
        const queryStr = new URLSearchParams(req.query).toString();
        const resp = await fetch(`${UPSTREAM_HTTP}/api/calls/details?${queryStr}`);
        const json = await resp.json();
        if (json && Array.isArray(json.data)) {
            json.data = sanitizeCalls(json.data);
        }
        res.json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, data: [], total: 0 });
    }
});

// Hozirda onlayn ochib turgan barcha foydalanuvchilar (REST API)
app.get('/api/viewers/active', (req, res) => {
    res.json(getActiveViewersList());
});

// Bog'lanishi kerak bo'lgan mijozlar ro'yxati (Faqat ko'rish - Read-Only)
app.get('/api/callbacks', async (req, res) => {
    try {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const resp = await fetch(`${UPSTREAM_HTTP}/api/callbacks${query}`);
        const json = await resp.json();
        res.json(json);
    } catch (e) {
        res.status(500).json({ success: false, data: [], error: e.message });
    }
});

// Mijozni o'chirish (Admin server 3535 ga uzatiladi)
app.delete('/api/callbacks/:id', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/callbacks/${req.params.id}`, { method: 'DELETE' });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Barcha mijozlarni tozalash (Admin server 3535 ga uzatiladi)
app.delete('/api/callbacks', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/callbacks`, { method: 'DELETE' });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Mijozlar bazasi / Telefon kitobi (Client Contacts) API Proxies
app.get('/api/contacts', async (req, res) => {
    try {
        const queryStr = new URLSearchParams(req.query).toString();
        const url = queryStr ? `${UPSTREAM_HTTP}/api/contacts?${queryStr}` : `${UPSTREAM_HTTP}/api/contacts`;
        const resp = await fetch(url);
        const json = await resp.json();
        res.json(json);
    } catch (e) {
        res.status(500).json({ success: false, data: [], error: e.message });
    }
});

app.get('/api/contacts/top-active', async (req, res) => {
    try {
        const queryStr = new URLSearchParams(req.query).toString();
        const url = queryStr ? `${UPSTREAM_HTTP}/api/contacts/top-active?${queryStr}` : `${UPSTREAM_HTTP}/api/contacts/top-active`;
        const resp = await fetch(url);
        const json = await resp.json();
        res.json(json);
    } catch (e) {
        res.status(500).json({ success: false, data: [], error: e.message });
    }
});

app.get('/api/contacts/:phone', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/contacts/${encodeURIComponent(req.params.phone)}`);
        const json = await resp.json();
        res.json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/contacts', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/contacts/:phone', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/contacts/${encodeURIComponent(req.params.phone)}`, {
            method: 'DELETE'
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Universal Fayl Konvertori (3535 orqali Zero-storage konvertatsiya)
app.post('/api/converter/convert', async (req, res) => {
    try {
        const token = extractToken(req);
        const resp = await fetch(`${UPSTREAM_HTTP}/api/converter/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify(req.body)
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        console.error('Viewer converter xatosi:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Blacklist (Qora ro'yxat) API Proxies to 3535
app.post('/api/blacklist/verify', async (req, res) => {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/blacklist/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/blacklist', async (req, res) => {
    try {
        const authHeader = req.headers['x-blacklist-auth'] || '';
        const resp = await fetch(`${UPSTREAM_HTTP}/api/blacklist`, {
            headers: { 'x-blacklist-auth': authHeader }
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/blacklist', async (req, res) => {
    try {
        const authHeader = req.headers['x-blacklist-auth'] || '';
        const resp = await fetch(`${UPSTREAM_HTTP}/api/blacklist`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-blacklist-auth': authHeader
            },
            body: JSON.stringify(req.body)
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/blacklist/:number', async (req, res) => {
    try {
        const authHeader = req.headers['x-blacklist-auth'] || '';
        const resp = await fetch(`${UPSTREAM_HTTP}/api/blacklist/${encodeURIComponent(req.params.number)}`, {
            method: 'DELETE',
            headers: { 'x-blacklist-auth': authHeader }
        });
        const json = await resp.json();
        res.status(resp.status).json(json);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Operatorni pauzaga qo'yish / chiqarish viewerda man etilgan (faqat admin uchun)
app.post('/api/operator/pause', (req, res) => {
    res.status(403).json({ success: false, error: "Pauza qilish faqat admin paneli orqali amalga oshiriladi. Operatorlar panelida bu imkoniyat cheklangan." });
});

// Operatorlar keshini boshlang'ich yuklash
async function refreshOperatorsCache() {
    try {
        const resp = await fetch(`${UPSTREAM_HTTP}/api/operators`);
        const json = await resp.json();
        const list = Array.isArray(json) ? json : (json.data || json.operators || []);
        if (list.length > 0) {
            updateCachedOperators(list);
        }
    } catch (e) {}
}
refreshOperatorsCache();
setInterval(refreshOperatorsCache, 30000);


// Viewer kirish tarixi (FAQAT Superuser uchun)
app.get('/api/viewers/history', (req, res) => {
    if (!req.user || req.user.role !== 'superuser') {
        return res.status(403).json({
            success: false,
            error: 'forbidden',
            message: 'Ushbu ma\'lumotni ko\'rish huquqi faqat Superuserga berilgan'
        });
    }

    const list = [...viewerHistory].reverse().slice(0, 300);
    return res.json({
        success: true,
        count: list.length,
        totalTracked: viewerHistory.length,
        data: list
    });
});

// ==========================================================================
// OPERATORLAR UCHUN TICKETLAR / ZAKAZLAR MONITORI (KDS TICKETS API)
// ==========================================================================
function broadcastTicketEvent(eventType, ticketData) {
    const payload = JSON.stringify({
        type: eventType,
        data: ticketData,
        timestamp: Date.now()
    });
    for (const [ws] of connectedViewers.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(payload); } catch (e) {}
        }
    }
}

// 1. Ticketlar ro'yxatini olish (filter: all | mine | pending | in_progress | completed | rejected)
app.get('/api/tickets', (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const operatorId = req.query.operatorId || (req.user && req.user.operatorId) || null;
        const list = ticketService.getTickets(filter, operatorId);
        const allList = ticketService.getTickets('all');
        const cleanOp = String(operatorId || '').trim();
        const mineCount = cleanOp 
            ? allList.filter(t => String(t.targetOperatorId).trim() === cleanOp || String(t.creatorId).trim() === cleanOp).length 
            : 0;

        const stats = {
            total: allList.length,
            mine: mineCount,
            pending: allList.filter(t => t.status === 'pending').length,
            in_progress: allList.filter(t => t.status === 'in_progress').length,
            completed: allList.filter(t => t.status === 'completed').length,
            rejected: allList.filter(t => t.status === 'rejected').length
        };
        res.json({ success: true, total: list.length, stats, data: list });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. Bitta ticket ma'lumotini olish
app.get('/api/tickets/:id', (req, res) => {
    try {
        const t = ticketService.getTicketById(req.params.id);
        if (!t) return res.status(404).json({ success: false, error: "Ticket topilmadi" });
        res.json({ success: true, data: t });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Yangi ticket yaratish
app.post('/api/tickets', (req, res) => {
    try {
        const clientIp = extractClientIp(req);
        const { creatorId, creatorName, customerPhone, title, comment, files, isUrgent, targetOperatorId, targetOperatorName } = req.body || {};
        
        const newTicket = ticketService.createTicket({
            creatorId,
            creatorName,
            creatorIp: clientIp,
            customerPhone,
            title,
            comment,
            files,
            isUrgent,
            targetOperatorId,
            targetOperatorName
        });

        // Barcha ulangan operatorlarga real-time xabar
        broadcastTicketEvent('ticket_created', newTicket);

        res.status(201).json({ success: true, data: newTicket });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 3b. Ticketni tahrirlash (Edit ticket)
const handleTicketEdit = (req, res) => {
    try {
        const { editorId, editorName, customerPhone, comment, isUrgent, targetOperatorId, targetOperatorName } = req.body || {};
        const updated = ticketService.updateTicket(req.params.id, {
            editorId,
            editorName,
            customerPhone,
            comment,
            isUrgent,
            targetOperatorId,
            targetOperatorName
        });
        broadcastTicketEvent('ticket_updated', updated);
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
};
app.put('/api/tickets/:id', handleTicketEdit);
app.post('/api/tickets/:id/edit', handleTicketEdit);

// 4. Operator ticketni qabul qilishi (in_progress)
app.post('/api/tickets/:id/accept', (req, res) => {
    try {
        const { operatorId, operatorName } = req.body || {};
        const updated = ticketService.acceptTicket(req.params.id, { operatorId, operatorName });
        broadcastTicketEvent('ticket_accepted', updated);
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 5. Operator ticketni bajarildi deb belgilashi (completed)
app.post('/api/tickets/:id/complete', (req, res) => {
    try {
        const { operatorId, operatorName } = req.body || {};
        const updated = ticketService.completeTicket(req.params.id, { operatorId, operatorName });
        broadcastTicketEvent('ticket_completed', updated);
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 5b. Operator ticketni rad etishi (rejected)
app.post('/api/tickets/:id/reject', (req, res) => {
    try {
        const { operatorId, operatorName, reason } = req.body || {};
        const updated = ticketService.rejectTicket(req.params.id, { operatorId, operatorName, reason });
        broadcastTicketEvent('ticket_rejected', updated);
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 6. Ticketga javob / izoh yoki qo'shimcha screenshot qo'shish
app.post('/api/tickets/:id/comments', (req, res) => {
    try {
        const { operatorId, operatorName, text, files } = req.body || {};
        const result = ticketService.addTicketComment(req.params.id, { operatorId, operatorName, text, files });
        broadcastTicketEvent('ticket_comment_added', result);
        res.json({ success: true, data: result.ticket, comment: result.comment });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 7. Ticketni o'chirish
app.delete('/api/tickets/:id', (req, res) => {
    try {
        const ok = ticketService.deleteTicket(req.params.id);
        if (ok) {
            broadcastTicketEvent('ticket_deleted', { id: req.params.id });
            return res.json({ success: true });
        }
        res.status(404).json({ success: false, error: "Ticket topilmadi" });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 8. Bajarilgan ticketlarni tozalash (Dushanba yoki manual)
app.post('/api/tickets/cleanup', (req, res) => {
    try {
        const result = ticketService.manualCleanupCompleted();
        broadcastTicketEvent('tickets_cleaned', result);
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 8b. DOC / DOCX hujjatlarni HTML ga aylantirib in-place ko'rsatish
app.get('/api/tickets/preview-doc', async (req, res) => {
    try {
        const fileParam = req.query.file || req.query.url || req.query.fileName;
        if (!fileParam) {
            return res.status(400).json({ success: false, error: 'Fayl nomi yoki URL ko\'rsatilmadi' });
        }
        const data = await ticketService.renderDocxToHtml(fileParam);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

app.post('/api/tickets/preview-doc', async (req, res) => {
    try {
        const { base64, filename, file, url } = req.body || {};
        if (base64) {
            const data = await ticketService.renderDocxBase64ToHtml(base64, filename);
            return res.json({ success: true, ...data });
        }
        const target = file || url || filename;
        if (!target) {
            return res.status(400).json({ success: false, error: 'Hujjat ma\'lumoti berilmadi' });
        }
        const data = await ticketService.renderDocxToHtml(target);
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 9. Faol sessiyalar va tokenlarni olish (Upstream 3535 orqali)
app.get('/api/viewer/sessions', async (req, res) => {
    try {
        const token = extractToken(req);
        const clientReq = http.request({
            hostname: UPSTREAM_HOST,
            port: 3535,
            path: '/api/settings/sessions',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 3000
        }, (upstreamRes) => {
            let data = '';
            upstreamRes.on('data', chunk => data += chunk);
            upstreamRes.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    res.status(upstreamRes.statusCode).json(parsed);
                } catch (err) {
                    res.status(500).json({ success: false, error: 'JSON parse error' });
                }
            });
        });
        clientReq.on('error', (err) => res.status(500).json({ success: false, error: err.message }));
        clientReq.end();
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Maxsus Ticketlar sahifasi yo'naltmasi
app.get(['/tickets', '/tickets.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tickets.html'));
});

// SPA fallback: hamma URL bitta index.html ga boradi
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Call Center Viewer (${isHttps ? 'HTTPS' : 'HTTP'}) ishga tushdi:  ${isHttps ? 'https' : 'http'}://0.0.0.0:${PORT}`);
    console.log(`📡 Ma'lumot oqimi: ${UPSTREAM_HTTP} (Real-time Proxy)`);
    console.log(`🎙️ Mikrofon/PTT:  ${isHttps ? 'FAOL (HTTPS 3005)' : 'Nofaol'}`);
    console.log(`======================================================\n`);
});
