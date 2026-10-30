const issabel = require('../services/issabelDbService');
const sftpService = require('../services/sftpService');
const telegramService = require('../services/telegramService');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const CALLS_DIR = path.join(__dirname, '..', 'scratch', 'calls');
if (!fs.existsSync(CALLS_DIR)) fs.mkdirSync(CALLS_DIR, { recursive: true });

const VOICE_ID_FILE = path.join(__dirname, '..', 'data', 'voice_identifications.json');
const STATUS_FILE = path.join(__dirname, '..', 'data', 'voice_scan_status.json');

const START_DATE = '2026-08-17 00:00:00';
const END_DATE = '2026-09-19 23:59:59';

let lastNotifiedPercent = 0;

function isInRange(d) {
    if (!d) return false;
    return d >= START_DATE && d <= END_DATE;
}

const LOCAL_PORT = process.env.PORT || 3535;
const LOCAL_API_BASE = `http://127.0.0.1:${LOCAL_PORT}`;

async function checkRemoteRestartFlag() {
    try {
        const res = await fetch(`${LOCAL_API_BASE}/api/voice-scan/restart-status`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
            const data = await res.json();
            if (data.restartRequested) {
                await fetch(`${LOCAL_API_BASE}/api/voice-scan/restart-ack`, { method: 'POST', signal: AbortSignal.timeout(1500) }).catch(() => {});
                return true;
            }
        }
    } catch (e) {}
    return false;
}

async function main() {
    telegramService.startPolling();

    let isRescanMode = process.argv.includes('--rescan') || process.argv.includes('-r');
    if (!isRescanMode) {
        const remoteRequested = await checkRemoteRestartFlag();
        if (remoteRequested) {
            isRescanMode = true;
            console.log("⚡ Serverdan qayta skan (restart) so'rovi aniqlandi! Re-scan rejimida ish boshlanmoqda.");
        }
    }

    console.log("======================================================");
    console.log(`🎙️  CALL CENTER — BARCHA 119 QO'NG'IROQLARINI OVOZLI ${isRescanMode ? 'QAYTA SKAN (MODEL TUNING TEKSHIRUVI)' : 'SKAN QILISH'}`);
    console.log(`📅 Sana oralig'i: ${START_DATE.slice(0, 10)} dan ${END_DATE.slice(0, 10)} gacha`);
    if (isRescanMode) {
        console.log("🎯 RE-SCAN REJIMI: Faqat yangi topilgan Zuhra opa qo'ng'iroqlari Telegram botga yuboriladi!");
    }
    console.log("======================================================");

    // 1. Load existing results
    let voiceIds = [];
    if (fs.existsSync(VOICE_ID_FILE)) {
        try {
            voiceIds = JSON.parse(fs.readFileSync(VOICE_ID_FILE, 'utf8'));
        } catch (e) {
            voiceIds = [];
        }
    }

    const prevMap = new Map();
    for (const v of voiceIds) {
        const b = path.basename(v.file || '');
        if (b) prevMap.set(b, v);
    }

    const alreadyInRange = voiceIds.filter(v => isInRange(v.calldate));
    const initialZuhraCount = alreadyInRange.filter(v => v.speaker === 'zuhra' || v.speaker === 'Zuhra opa').length;
    console.log(`Bazada mavjud natijalar (oraliqda): ${alreadyInRange.length} ta (Zuhra: ${initialZuhraCount} ta)`);

    // 2. Query Asterisk CDR strictly for 17-Aug to 19-Sep
    console.log("Asterisk CDR bazasidan 17-avgust — 19-sentabr qo'ng'iroqlari olinmoqda...");
    const sql = `
        USE asteriskcdrdb;
        SELECT calldate, clid, src, dst, billsec, recordingfile, uniqueid
        FROM cdr
        WHERE (dst = '119' OR dstchannel LIKE 'SIP/119-%')
          AND disposition = 'ANSWERED'
          AND billsec >= 30
          AND calldate >= '${START_DATE}'
          AND calldate <= '${END_DATE}'
        ORDER BY billsec DESC;
    `;

    const res = await issabel.execQuery(sql);
    const lines = res.trim().split('\n').filter(Boolean);

    const candidates = [];
    const seenRecs = new Set();
    let totalTarget = 0;

    for (const l of lines) {
        const parts = l.split('\t');
        if (parts.length >= 6) {
            const [calldate, clid, src, dst, billsec, rec, uniqueid] = parts;
            const recFile = rec ? rec.trim() : '';
            const recBase = path.basename(recFile);
            if (!recBase || recBase === '.' || seenRecs.has(recBase)) continue;
            seenRecs.add(recBase);
            totalTarget++;

            const prevEntry = prevMap.get(recBase);

            if (isRescanMode) {
                // Qayta skanda: agar qo'lda o'zgartirilgan bo'lsa, unga tegilmaydi!
                if (prevEntry && prevEntry.is_manual_override === true) {
                    continue;
                }
            } else {
                // Oddiy skanda: allaqachon skan qilingan bo'lsa o'tkazib yuboriladi
                if (prevEntry) {
                    continue;
                }
            }

            candidates.push({
                calldate: calldate.trim(),
                src: src ? src.trim() : '',
                dst: dst ? dst.trim() : '',
                billsec: parseInt(billsec, 10) || 0,
                recordingfile: recFile,
                recBase,
                uniqueid: uniqueid ? uniqueid.trim() : ''
            });
        }
    }

    console.log(`Oraliqdagi jami qo'ng'iroqlar: ${totalTarget} ta`);
    console.log(`${isRescanMode ? 'Qayta tekshiriladigan' : 'Hali skan qilinmagan'} qo'ng'iroqlar: ${candidates.length} ta`);

    if (candidates.length === 0) {
        console.log("✅ Tekshirilishi kerak bo'lgan qo'ng'iroqlar topilmadi.");
        process.exit(0);
    }

    // 3. Connect to SFTP
    console.log("SFTP serveriga ulanmoqda...");
    const sftpOk = await sftpService.connect();
    if (!sftpOk) {
        console.error("❌ SFTP ga ulanib bo'lmadi!");
        process.exit(1);
    }
    console.log("✅ SFTP serveriga ulandi.");

    // 4. Start Persistent Python Worker (Optimized Batch Matcher)
    console.log("SpeechBrain AI modeli ishga tushirilmoqda (Vektorlashtirilgan Batch Python)...");
    const pyPath = path.join(__dirname, 'persistent_matcher_worker.py');
    const pyProcess = spawn('python', [pyPath], {
        cwd: path.join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'inherit']
    });

    const pyReader = readline.createInterface({
        input: pyProcess.stdout,
        crlfDelay: Infinity
    });

    let pendingResolve = null;

    pyReader.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (trimmed === 'READY') {
            if (pendingResolve) {
                const r = pendingResolve;
                pendingResolve = null;
                r();
            }
            return;
        }

        if (trimmed.startsWith('{')) {
            if (pendingResolve) {
                const r = pendingResolve;
                pendingResolve = null;
                try {
                    r(JSON.parse(trimmed));
                } catch (err) {
                    r({ error: 'JSON parse error: ' + trimmed });
                }
            }
        }
    });

    pyProcess.on('error', (err) => {
        console.error("❌ Python jarayonini ishga tushirib bo'lmadi:", err);
        if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = null;
            r({ error: err.message });
        }
    });

    pyProcess.on('exit', (code) => {
        if (code !== 0) {
            console.error(`❌ Python jarayoni to'xtadi (kod: ${code})`);
            if (pendingResolve) {
                const r = pendingResolve;
                pendingResolve = null;
                r({ error: `Python worker exited with code ${code}` });
            }
        }
    });

    const initResult = await new Promise((resolve) => {
        pendingResolve = resolve;
    });

    if (initResult && initResult.error) {
        console.error("❌ Python AI modeli ishga tushmadi:", initResult.error);
        process.exit(1);
    }
    console.log("✅ Tezlashtirilgan AI modeli xotiraga yuklandi va tayyor!\n");

    function askWorker(payload) {
        return new Promise((resolve) => {
            pendingResolve = resolve;
            pyProcess.stdin.write(JSON.stringify(payload) + '\n');
        });
    }

    if (isRescanMode) {
        telegramService.broadcast(
            `🔄 <b>OVOZLI QAYTA SKAN (MODEL TUNING) BOSHLANDI!</b>\n\n` +
            `📅 <b>Oraliq:</b> 17-avgust — 19-sentabr\n` +
            `📊 <b>Qayta tekshiriladigan suhbatlar:</b> ${candidates.length} ta\n` +
            `🌸 <b>Hozirgi Zuhra opa soni:</b> ${initialZuhraCount} ta\n\n` +
            `ℹ️ <i>Faqat tuning natijasida YANGI aniqlangan Zuhra opa qo'ng'iroqlari botga yuboriladi.</i>\n\n` +
            `🌐 <a href="http://192.168.0.2:3535/voice-status">Jonli kuzatish</a>`
        );
    }

    let newlyScanned = 0;
    const newlyFoundZuhraList = [];
    const startTime = Date.now();

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const progressStr = `[${i + 1}/${candidates.length}]`;
        const mins = Math.floor(c.billsec / 60);
        const secs = c.billsec % 60;
        const durStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

        function syncRemote(statusData, newVoiceId = null) {
            try {
                if (statusData) fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2), 'utf8');
                if (newVoiceId) fs.writeFileSync(VOICE_ID_FILE, JSON.stringify(voiceIds, null, 2), 'utf8');
            } catch (e) {}

            fetch(`${LOCAL_API_BASE}/api/internal/voice-scan-sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: statusData, newVoiceId }),
                signal: AbortSignal.timeout(2000)
            }).catch(() => {});
        }

        function saveLiveProgress(stage, stagePercent, isNewlyFound = false) {
            const elapsedSec = (Date.now() - startTime) / 1000;
            const speedPerMin = elapsedSec > 0 ? Math.round((newlyScanned / elapsedSec) * 60) : 15;
            const remainingCount = candidates.length - i;
            const remainingSec = speedPerMin > 0 ? (remainingCount / speedPerMin) * 60 : 0;
            const etaMinutes = Math.max(1, Math.ceil(remainingSec / 60));
            const estimatedEndTime = new Date(Date.now() + remainingSec * 1000).toLocaleTimeString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 5);

            const currentInRange = voiceIds.filter(v => isInRange(v.calldate));
            const currentScannedCount = isRescanMode ? (i + 1) : currentInRange.length;
            const percentNum = Math.min(100, Math.round((currentScannedCount / totalTarget) * 100));

            const curZuhraCount = currentInRange.filter(v => v.speaker === 'zuhra').length;
            const curMuattarCount = currentInRange.filter(v => v.speaker !== 'zuhra').length;

            const statusData = {
                totalTarget,
                scannedCount: currentScannedCount,
                remainingCount: candidates.length - (i + 1),
                percent: `${percentNum}%`,
                zuhraCount: curZuhraCount,
                muattarCount: curMuattarCount,
                isRescan: isRescanMode,
                previousZuhraCount: initialZuhraCount,
                newlyFoundZuhraCount: newlyFoundZuhraList.length,
                newlyFoundZuhraList: newlyFoundZuhraList.slice(-20),
                speedPerMin,
                etaMinutes,
                estimatedEndTime,
                dateRange: '17-Avgust — 19-Sentabr',
                currentTask: {
                    file: c.recBase,
                    caller_id: c.src,
                    calldate: c.calldate,
                    duration: durStr,
                    stage,
                    stagePercent,
                    currentIndex: i + 1,
                    totalCandidates: candidates.length
                },
                lastScanned: {
                    file: c.recBase,
                    caller_id: c.src,
                    calldate: c.calldate,
                    speaker: isNewlyFound ? 'Zuhra opa' : (pyResTemp && pyResTemp.speaker === 'zuhra' ? 'Zuhra opa' : 'Muattar'),
                    isNewlyFound: isNewlyFound
                }
            };

            syncRemote(statusData);
            return statusData;
        }

        let pyResTemp = null;
        const localPath = path.join(CALLS_DIR, c.recBase);

        // Download audio if needed
        if (!fs.existsSync(localPath) || fs.statSync(localPath).size < 100) {
            saveLiveProgress('SFTP serveridan audio yuklanmoqda...', 30);
            try {
                if (!sftpService.isConnected) {
                    await sftpService.connect();
                }
                let resolved = await sftpService.resolveRemoteAudioPath(c.recBase);
                if (!resolved && c.recordingfile && c.recordingfile.startsWith('/')) {
                    resolved = { fullPath: c.recordingfile };
                }

                if (!resolved || !resolved.fullPath) {
                    console.log(`${progressStr} ⚠️ Fayl topilmadi: ${c.recBase}`);
                    continue;
                }

                const buf = await sftpService.sftp.get(resolved.fullPath);
                fs.writeFileSync(localPath, buf);
            } catch (err) {
                console.log(`${progressStr} ❌ Yuklab olishda xatolik (${c.recBase}): ${err.message}`);
                continue;
            }
        }

        // Send to AI Worker
        saveLiveProgress('SpeechBrain AI biometrik tahlil...', 75);
        const pyRes = await askWorker({
            localPath,
            recBase: c.recBase,
            uniqueid: c.uniqueid,
            src: c.src,
            calldate: c.calldate,
            billsec: c.billsec
        });

        if (pyRes.error) {
            console.log(`${progressStr} ⚠️ AI xatosi (${c.recBase}): ${pyRes.error}`);
            continue;
        }

        pyResTemp = pyRes;
        newlyScanned++;

        const prev = prevMap.get(c.recBase);
        const wasZuhra = prev && (prev.speaker === 'zuhra' || prev.speaker === 'Zuhra opa');
        const isNowZuhra = pyRes.speaker === 'zuhra';
        let isNewlyFoundZuhra = false;

        if (isNowZuhra) {
            if (!wasZuhra) {
                // 🎉 FAQAT YANGI TOPILGANI!
                isNewlyFoundZuhra = true;
                newlyFoundZuhraList.push({
                    file: c.recBase,
                    caller_id: c.src,
                    calldate: c.calldate,
                    duration: c.billsec,
                    confidence: pyRes.confidence,
                    score: pyRes.score,
                    previousSpeaker: prev ? (prev.speaker === 'zuhra' ? 'Zuhra opa' : 'Muattar') : 'Mavjud emas'
                });

                console.log(`${progressStr} 🎯 YANGI ZUHRA TOPILDI (TUNING)! ${c.calldate} | ${c.src} (${durStr}) -> Zuhra: ${pyRes.confidence}% (ball: ${pyRes.score})`);

                telegramService.broadcast(
                    `🎯 <b>TUNING NATIJASI: YANGI ZUHRA OPA TOPILDI!</b>\n\n` +
                    `📞 <b>Mijoz:</b> <code>${c.src}</code>\n` +
                    `📅 <b>Vaqt:</b> ${c.calldate}\n` +
                    `⏱️ <b>Davomiyligi:</b> ${durStr}\n` +
                    `🎯 <b>Yangi AI Ishonch:</b> ${pyRes.confidence}% (ball: ${pyRes.score})\n` +
                    `ℹ️ <i>Oldingi holati: ${prev ? (prev.speaker === 'zuhra' ? 'Zuhra' : 'Muattar') : 'Aniqlanmagan'}</i>\n\n` +
                    `🌐 <a href="http://192.168.0.2:3535/voice-status">Eshitish va tekshirish</a>`
                );
            } else {
                // Oldin ham Zuhra bo'lgan — BOTGA SPAM QILMAYMIZ!
                console.log(`${progressStr} 🌸 Oldingi Zuhra tasdiqlandi: ${c.calldate} | ${c.src} (${durStr}) -> Zuhra: ${pyRes.confidence}% (ball: ${pyRes.score})`);
            }
        } else {
            console.log(`${progressStr} 👤 Muattar: ${c.calldate} | ${c.src} (${durStr}) -> Zuhra ball: ${pyRes.score}`);
            try {
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            } catch (e) {}
        }

        // Update database array
        const existingIdx = voiceIds.findIndex(v => path.basename(v.file || '') === c.recBase);
        if (existingIdx !== -1) {
            if (!voiceIds[existingIdx].is_manual_override) {
                voiceIds[existingIdx] = {
                    ...voiceIds[existingIdx],
                    ...pyRes,
                    file: c.recBase
                };
            }
        } else {
            voiceIds.push(pyRes);
        }

        const statusData = saveLiveProgress(`Tahlil yakunlandi (${isNowZuhra ? 'Zuhra opa' : 'Muattar'})`, 100, isNewlyFoundZuhra);
        syncRemote(statusData, pyRes);

        const curPct = parseInt(statusData.percent, 10) || 0;
        if (curPct >= lastNotifiedPercent + 25) {
            lastNotifiedPercent = curPct;
            telegramService.broadcast(
                `📊 <b>OVOZLI SKAN PROGRESSI: ${curPct}%</b>\n\n` +
                `✅ Ko'rib chiqildi: ${statusData.scannedCount} / ${statusData.totalTarget} ta\n` +
                `🌸 Zuhra opa: ${statusData.zuhraCount} ta${isRescanMode ? ` (Yangi topilgan: +${newlyFoundZuhraList.length} ta)` : ''}\n` +
                `👤 Muattar: ${statusData.muattarCount} ta\n` +
                `⏳ Qolgan vaqt: ~${statusData.etaMinutes} daqiqa\n\n` +
                `🌐 <a href="http://192.168.0.2:3535/voice-status">Jonli Status Sahifasi</a>`
            );
        }

        if (newlyScanned % 5 === 0) {
            console.log(`📊 Holat: ${statusData.scannedCount}/${statusData.totalTarget} (${statusData.percent}) | Zuhra: ${statusData.zuhraCount} ta (Yangi: +${newlyFoundZuhraList.length}) | Tezlik: ~${statusData.speedPerMin} ta/daq | Qolgan: ~${statusData.etaMinutes} daq (${statusData.estimatedEndTime})`);
        }
    }

    const finalZuhraTotal = voiceIds.filter(v => isInRange(v.calldate) && v.speaker === 'zuhra').length;
    const finalMuattarTotal = voiceIds.filter(v => isInRange(v.calldate) && v.speaker !== 'zuhra').length;

    if (isRescanMode) {
        telegramService.broadcast(
            `🏁 <b>QAYTA SKAN (MODEL TUNING) 100% YAKUNLANDI!</b>\n\n` +
            `📅 <b>Oraliq:</b> 17-avgust — 19-sentabr\n` +
            `📊 <b>Jami tekshirilgan suhbatlar:</b> ${candidates.length} ta\n` +
            `🎯 <b>Yangi aniqlangan Zuhra opa: +${newlyFoundZuhraList.length} ta!</b>\n` +
            `🌸 <b>Jami joriy Zuhra opa suhbatlari:</b> ${finalZuhraTotal} ta (avval: ${initialZuhraCount} ta)\n` +
            `👤 <b>Muattar suhbatlari:</b> ${finalMuattarTotal} ta\n\n` +
            `Barcha qo'ng'iroqlarni quyidagi havola orqali tinglashingiz mumkin:\n` +
            `👉 <a href="http://192.168.0.2:3535/voice-status">http://192.168.0.2:3535/voice-status</a>`
        );
    } else {
        telegramService.broadcast(
            `🏁 <b>OVOZLI SKAN 100% YAKUNLANDI!</b>\n\n` +
            `📅 <b>Oraliq:</b> 17-avgust — 19-sentabr\n` +
            `📊 <b>Jami tekshirilgan suhbatlar:</b> ${totalTarget} ta\n` +
            `🌸 <b>Zuhra opa suhbatlari:</b> ${finalZuhraTotal} ta\n` +
            `👤 <b>Muattar suhbatlari:</b> ${finalMuattarTotal} ta\n\n` +
            `Barcha qo'ng'iroqlarni quyidagi havola orqali tinglashingiz mumkin:\n` +
            `👉 <a href="http://192.168.0.2:3535/voice-status">http://192.168.0.2:3535/voice-status</a>`
        );
    }

    pyProcess.stdin.write("EXIT\n");

    // Final Sync
    try {
        fs.writeFileSync(VOICE_ID_FILE, JSON.stringify(voiceIds, null, 2), 'utf8');
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
            totalTarget,
            scannedCount: totalTarget,
            remainingCount: 0,
            percent: '100%',
            zuhraCount: finalZuhraTotal,
            muattarCount: finalMuattarTotal,
            isRescan: isRescanMode,
            previousZuhraCount: initialZuhraCount,
            newlyFoundZuhraCount: newlyFoundZuhraList.length,
            newlyFoundZuhraList: newlyFoundZuhraList,
            speedPerMin: 0,
            etaMinutes: 0,
            estimatedEndTime: 'Tugallandi',
            dateRange: '17-Avgust — 19-Sentabr',
            currentTask: null
        }, null, 2), 'utf8');
        syncRemote(null, null);
        console.log(`📡 Yakuniy natijalar to'liq saqlandi!`);
    } catch (e) {}

    console.log("\n======================================================");
    console.log(`🏁 17-AVGUST — 19-SENTABR ${isRescanMode ? 'QAYTA SKANI' : 'SKANI'} YAKUNLANDI!`);
    console.log(`Jami tekshirilgan: ${newlyScanned} ta`);
    if (isRescanMode) {
        console.log(`Yangi aniqlangan Zuhra opa qo'ng'iroqlari: +${newlyFoundZuhraList.length} ta`);
    }
    console.log(`Jami Zuhra opa: ${finalZuhraTotal} ta`);
    console.log("======================================================");
    process.exit(0);
}

main().catch(err => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
});
