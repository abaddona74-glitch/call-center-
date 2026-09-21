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

const PORT = parseInt(process.env.PORT || '3005', 10);
// Agar serverda bo'lsa localhost:3535, lokal kompyuterda bo'lsa 192.168.0.2:3535 ga ulanadi
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || (process.platform === 'win32' ? '192.168.0.2' : '127.0.0.1');
const UPSTREAM_HTTP = process.env.UPSTREAM_HTTP || `http://${UPSTREAM_HOST}:3535`;
const UPSTREAM_WS = process.env.UPSTREAM_WS || `ws://${UPSTREAM_HOST}:3535`;

const app = express();
app.set('json spaces', 2);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

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
    ['192.168.0.116', { id: '116', exten: '116', name: 'Ibrohim' }],
    ['192.168.0.106', { id: '106', exten: '106', name: 'Gulchehra' }]
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

// Hozirda viewer sahifasini ochib turgan barcha faol ulanishlar
const connectedViewers = new Map(); // ws -> { ip, connectedAt }

function getActiveViewersList() {
    const ipGroups = new Map();
    for (const [ws, info] of connectedViewers.entries()) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const ip = info.ip;
        if (!ipGroups.has(ip)) {
            ipGroups.set(ip, {
                ip,
                tabsCount: 0,
                connectedAt: info.connectedAt
            });
        }
        const group = ipGroups.get(ip);
        group.tabsCount++;
        if (info.connectedAt < group.connectedAt) {
            group.connectedAt = info.connectedAt;
        }
    }

    const viewers = [];
    for (const [ip, group] of ipGroups.entries()) {
        const op = operatorIpMap.get(ip);
        if (op) {
            viewers.push({
                ip,
                isOperator: true,
                id: op.id,
                exten: op.exten,
                name: op.name,
                tabsCount: group.tabsCount,
                connectedAt: group.connectedAt
            });
        } else if (ip === '127.0.0.1' || ip === '192.168.0.2') {
            viewers.push({
                ip,
                isOperator: false,
                name: 'Admin',
                tabsCount: group.tabsCount,
                connectedAt: group.connectedAt
            });
        } else {
            viewers.push({
                ip,
                isOperator: false,
                name: `Mehmon (${ip})`,
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

// 1. WebSocket Proxy to 3535 + Active Viewers Management
wss.on('connection', (clientWs, req) => {
    let upstreamWs = null;
    const clientIp = extractClientIp(req);

    clientWs.isAlive = true;
    clientWs.on('pong', () => { clientWs.isAlive = true; });

    connectedViewers.set(clientWs, {
        ip: clientIp,
        connectedAt: Date.now()
    });

    console.log(`👁️ [Viewer Connection] Yangi foydalanuvchi ulandi: IP ${clientIp} (Jami oyna: ${connectedViewers.size})`);

    // Yangi ulangan mijozga o'z IP si va hozirgi onlayn kuzatuvchilarni yuborish
    try {
        clientWs.send(JSON.stringify({
            type: 'client_identity',
            data: { ip: clientIp }
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
                    if (parsed.type === 'initial_state' && parsed.data) {
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
            if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.send(msg);
            }
        });

        clientWs.on('close', () => {
            connectedViewers.delete(clientWs);
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


// SPA fallback: hamma URL bitta index.html ga boradi
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Call Center Viewer (Faqat Operatorlar) ishga tushdi!`);
    console.log(`🌐 Manzil:        http://localhost:${PORT}`);
    console.log(`📡 Ma'lumot oqimi: ${UPSTREAM_HTTP} (Real-time Proxy)`);
    console.log(`🛡️ Xavfsizlik:    Faqat Operatorlar paneli, Audio butunlay yo'q`);
    console.log(`======================================================\n`);
});
