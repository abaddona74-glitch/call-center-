/**
 * 3CX Desktop Reject Monitor Agent
 * Portable EXE (pkg) va Node.js da ishlaydi
 * Tashqi kutubxonalarsiz — Pure Node.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const os   = require('os');

// --- pkg EXE uchun: config.json EXE yonida turadi ---
// EXE sifatida ishlayotganda process.execPath to'g'ri papkani beradi
const exeDir  = path.dirname(process.execPath);
const devDir  = __dirname;
const configDir = fs.existsSync(path.join(exeDir, 'config.json')) ? exeDir : devDir;
const configPath = path.join(configDir, 'config.json');

let config = {
    serverUrl:           'http://192.168.0.16:3000',
    operatorId:          '101',
    heartbeatIntervalSec: 30,
    customLogPath:       ''
};

try {
    if (fs.existsSync(configPath)) {
        // PowerShell UTF-8 BOM ni tozalash
        const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '').trim();
        config = { ...config, ...JSON.parse(raw) };
    }
} catch (e) {
    console.error("config.json o'qishda xatolik:", e.message);
}

const serverUrl  = new URL(config.serverUrl || 'http://192.168.0.16:3000');
const operatorId = String(config.operatorId || '101');

console.log('======================================================');
console.log('3CX Desktop Agent ishga tushdi!');
console.log('Operator ID : ' + operatorId);
console.log('Server      : ' + serverUrl.origin);
console.log('Config      : ' + configPath);
console.log('======================================================');

// --- HTTP POST yordamchi ---
function postJson(pathname, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request({
            hostname: serverUrl.hostname,
            port:     parseInt(serverUrl.port) || 3000,
            path:     pathname,
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 8000
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(body));
        });
        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(payload);
        req.end();
    });
}

// --- Versiya va Auto-Update ---
const CURRENT_VERSION = '1.0.0';
let isUpdating = false;

function compareVersions(v1, v2) {
    const p1 = String(v1 || '0').split('.').map(Number);
    const p2 = String(v2 || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}

function performAutoUpdate(updateUrlPath, newVer) {
    if (isUpdating) return;
    isUpdating = true;
    console.log(`🚀 [Auto-Update] Yangi versiya e'lon qilindi: v${newVer} (Hozirgi: v${CURRENT_VERSION})`);
    
    // Faqat compiled .exe rejimida faylni almashtiramiz
    const isPkg = typeof process.pkg !== 'undefined';
    if (!isPkg) {
        console.log('ℹ️ [Auto-Update] Node.js skript rejimida ishlamoqda, fayl almashtirilmaydi.');
        isUpdating = false;
        return;
    }

    const downloadUrl = updateUrlPath.startsWith('http') 
        ? updateUrlPath 
        : `${config.serverUrl.replace(/\/+$/, '')}${updateUrlPath.startsWith('/') ? '' : '/'}${updateUrlPath}`;

    console.log(`📥 Yuklab olinmoqda: ${downloadUrl}`);
    const targetDir = path.dirname(process.execPath);
    const tempExe = path.join(targetDir, 'agent_update.exe');
    const finalExe = path.join(targetDir, 'agent.exe');
    const updaterBat = path.join(targetDir, 'updater.bat');
    const launcherPs1 = path.join(targetDir, 'tray_launcher.ps1');

    const fileStream = fs.createWriteStream(tempExe);
    const client = downloadUrl.startsWith('https') ? https : http;

    client.get(downloadUrl, (res) => {
        if (res.statusCode !== 200) {
            console.error(`❌ Yuklab olishda xatolik: HTTP ${res.statusCode}`);
            fileStream.close();
            try { fs.unlinkSync(tempExe); } catch (e) {}
            isUpdating = false;
            return;
        }

        res.pipe(fileStream);

        fileStream.on('finish', () => {
            fileStream.close(() => {
                console.log('✅ Yangi versiya muvaffaqiyatli yuklab olindi!');
                
                // Updater bat faylini yaratish
                const batScript = `@echo off
timeout /t 2 /nobreak >nul
move /y "${tempExe}" "${finalExe}" >nul
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${launcherPs1}"
del "%~f0"
`;
                try {
                    fs.writeFileSync(updaterBat, batScript);
                    console.log('🔄 Yangi versiya ishga tushirilmoqda...');
                    const { spawn } = require('child_process');
                    const child = spawn('cmd.exe', ['/c', updaterBat], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true
                    });
                    child.unref();
                    process.exit(0);
                } catch (err) {
                    console.error('❌ Updater ishga tushirishda xatolik:', err.message);
                    isUpdating = false;
                }
            });
        });
    }).on('error', (err) => {
        console.error('❌ Yuklab olish xatoligi:', err.message);
        fileStream.close();
        try { fs.unlinkSync(tempExe); } catch (e) {}
        isUpdating = false;
    });
}

// --- Heartbeat ---
function sendHeartbeat() {
    postJson('/api/agent/heartbeat', {
        operatorId,
        hostname:   os.hostname(),
        version:    CURRENT_VERSION,
        appVersion: CURRENT_VERSION
    }).then(resStr => {
        try {
            const data = typeof resStr === 'string' ? JSON.parse(resStr) : resStr;
            if (data && data.latestVersion && compareVersions(data.latestVersion, CURRENT_VERSION) > 0) {
                performAutoUpdate(data.updateUrl || '/downloads/agent.exe', data.latestVersion);
            }
        } catch (e) {}
    }).catch(() => {});
}

// --- Qo'ng'iroq hodisalarini yuborish (Issabel bilan solishtirish uchun) ---
function sendCallEvent(eventType, callerId, durationSec = 0, details = '') {
    const caller = callerId || 'Yashirin raqam';
    postJson('/api/agent/call-event', {
        operatorId,
        eventType,
        callerId: caller,
        durationSec: parseInt(durationSec || 0, 10),
        hostname: os.hostname(),
        details,
        timestamp: new Date().toISOString()
    }).catch(() => {});
}

// --- Reject yuborish ---
function sendReject(callerId, reason) {
    const caller = callerId || 'Yashirin raqam';
    console.log('[REJECT] Operator ' + operatorId + ' rad etdi! Raqam: ' + caller);
    postJson('/api/agent/reject', {
        operatorId,
        callerId:  caller,
        reason:    reason || 'Operator Reject',
        timestamp: new Date().toISOString()
    }).then(() => {
        console.log('Server ga yuborildi');
    }).catch(err => {
        console.error('Serverga yuborishda xatolik:', err.message);
    });
}

// --- Dastlabki heartbeat ---
sendHeartbeat();
setInterval(sendHeartbeat, (config.heartbeatIntervalSec || 30) * 1000);

// --- 3CX Log va Tarix fayllarini qidirish ---
const appData      = process.env.APPDATA      || '';
const localAppData = process.env.LOCALAPPDATA || '';

function findPossibleLogPaths() {
    const list = [
        config.customLogPath,
        path.join(appData,      '3CXPhone for Windows', 'Logs', '3CXWin8Phone.log'),
        path.join(appData,      '3CX Desktop App',      'logs', 'app.log'),
        path.join(localAppData, '3CX Desktop App',      'logs', 'app.log'),
        path.join(localAppData, '3CXPhone for Windows', 'Logs', '3CXWin8Phone.log'),
    ].filter(Boolean);

    // 3CX VoIP Phone (v6 / v12) History fayllari (callHistory*.txt)
    const voipHistoryDir = path.join(localAppData, '3CX VoIP Phone', 'History');
    try {
        if (fs.existsSync(voipHistoryDir)) {
            const files = fs.readdirSync(voipHistoryDir).filter(f => f.startsWith('callHistory') && f.endsWith('.txt'));
            files.forEach(f => list.push(path.join(voipHistoryDir, f)));
        }
    } catch (e) {}

    return list;
}

const possibleLogPaths = findPossibleLogPaths();
let targetLogPath = possibleLogPaths.find(p => {
    try { return fs.existsSync(p); } catch (e) { return false; }
});
// Boshlanishda fayldan boshlab o'qish (mavjud bugungi yozuvlarni ham o'qib olish)
let fileOffset    = 0;
let ringingCaller = null;
let currentCall   = null;
const processedHistoryKeys = new Set();

if (targetLogPath) {
    console.log('3CX Jurnali topildi: ' + targetLogPath);
} else {
    console.log('3CX log fayli topilmadi. Har 5 soniyada qayta qidiriladi...');
}

// --- Log monitoring (har 500ms) ---
setInterval(() => {
    if (!targetLogPath) {
        const list = findPossibleLogPaths();
        const found = list.find(p => {
            try { return fs.existsSync(p); } catch (e) { return false; }
        });
        if (found) {
            targetLogPath = found;
            // callHistory.txt bo'lsa - 0 dan boshlab bugungi yozuvlarni oladi
            fileOffset = found.toLowerCase().endsWith('.txt') ? 0 : fs.statSync(found).size;
            console.log('3CX Jurnali topildi: ' + found);
        }
        return;
    }

    try {
        const stat = fs.statSync(targetLogPath);
        if (stat.size < fileOffset) fileOffset = 0;

        if (stat.size > fileOffset) {
            const bufLen = stat.size - fileOffset;
            const buffer = Buffer.alloc(bufLen);
            const fd     = fs.openSync(targetLogPath, 'r');
            fs.readSync(fd, buffer, 0, bufLen, fileOffset);
            fs.closeSync(fd);
            fileOffset = stat.size;

            // UTF-16LE (3CX VoIP Phone .txt) yoki UTF-8 (.log) ni to'g'ri o'qish
            const isUtf16 = (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) || 
                            targetLogPath.toLowerCase().endsWith('.txt');
            const encoding = isUtf16 ? 'utf16le' : 'utf8';
            const rawText = buffer.toString(encoding).replace(/^\uFEFF/, '').replace(/\0/g, '');

            const lines = rawText.split(/\r?\n/);
            for (const line of lines) {
                if (!line.trim()) continue;

                // Maxsus: 3CX VoIP Phone (v6) History fayllari (tab-separated: 0\t950460242\t2026/09/03 12:16:37\t...)
                if (line.includes('\t')) {
                    const parts = line.split('\t');
                    if (parts.length >= 3) {
                        const statusCode = parts[0].trim();
                        const caller = parts[1].trim() || 'Yashirin raqam';
                        const timeStr = parts[2].trim();
                        const dur = parseInt(parts[3] || 0, 10);
                        
                        const key = `${caller}_${timeStr}`;
                        if (processedHistoryKeys.has(key)) {
                            continue; // Allaqachon jo'natilgan, qayta sanalmaydi!
                        }
                        processedHistoryKeys.add(key);

                        if (dur > 0) {
                            sendCallEvent('ANSWERED', caller, dur, `3CX Qabul qilindi: ${timeStr}`);
                        } else if (statusCode === '0') {
                            // 3CX Call History: Missed (O'tkazib yuborilgan)!
                            sendCallEvent('MISSED', caller, 0, `3CX O'tkazib yuborildi: ${timeStr}`);
                        } else {
                            sendCallEvent('DIALLED', caller, dur, `3CX Chiquvchi: ${timeStr}`);
                        }
                        continue;
                    }
                }

                // 1. Kiruvchi qo'ng'iroq / Jiringlash
                const incMatch = line.match(
                    /(?:Incoming call|Ringing|Call from\s+([0-9+]+)|caller[: ]+([0-9+]+))/i
                );
                if (incMatch) {
                    const caller = incMatch[1] || incMatch[2] || ringingCaller || 'Yashirin raqam';
                    ringingCaller = caller;
                    currentCall = {
                        callerId: caller,
                        ringTime: new Date(),
                        answerTime: null
                    };
                    sendCallEvent('RINGING', caller, 0, 'Jiringlayapti');
                }

                // 2. Rad etish / Qizil tugma
                if (/(?:Reject|Declined|UserBusy|CallRejected|BusyHere|486 Busy)/i.test(line)) {
                    sendReject(ringingCaller, '3CX User Reject');
                    sendCallEvent('REJECT', ringingCaller, 0, 'Operator qizil tugma bilan rad etdi');
                    ringingCaller = null;
                    currentCall = null;
                }

                // 3. Suhbat boshlandi (Javob berildi)
                if (/(?:Connected|Answered|Established)/i.test(line)) {
                    if (currentCall) {
                        currentCall.answerTime = new Date();
                    }
                    sendCallEvent('ANSWERED', ringingCaller, 0, 'Suhbat boshlandi');
                }

                // 4. Qo'ng'iroq yakunlandi
                if (/(?:Call ended|Hangup|Terminated)/i.test(line)) {
                    let dur = 0;
                    if (currentCall && currentCall.answerTime) {
                        dur = Math.max(1, Math.round((Date.now() - currentCall.answerTime.getTime()) / 1000));
                    }
                    if (ringingCaller || (currentCall && currentCall.callerId)) {
                        const caller = ringingCaller || currentCall.callerId;
                        sendCallEvent('ENDED', caller, dur, `Suhbat tugadi (${dur}s)`);
                    }
                    ringingCaller = null;
                    currentCall = null;
                }
            }
        }
    } catch (e) {
        // fayl o'qishda xatolik — jimgina o'tkazib yuboramiz
    }
}, 500);

// --- Kutilmagan xatolar da dastur o'lmasin ---
process.on('uncaughtException',  err => console.error('uncaughtException:', err.message));
process.on('unhandledRejection', err => console.error('unhandledRejection:', String(err)));

console.log('Agent faol — Ctrl+C bilan toxtating\n');
