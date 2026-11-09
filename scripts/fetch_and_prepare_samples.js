const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sftpService = require('../services/sftpService');

const CALLS_DIR = path.join(__dirname, '..', 'scratch', 'calls');
if (!fs.existsSync(CALLS_DIR)) fs.mkdirSync(CALLS_DIR, { recursive: true });

const MANUAL_CALLS = [
    {
        file: 'q-2020159-909127798-20260918-123844-1789717116.147858.wav',
        caller_id: '909127798',
        calldate: '2026-09-18 12:38:50',
        source_type: 'manual_override'
    },
    {
        file: 'q-2020159-948509897-20260918-111244-1789711957.145423.wav',
        caller_id: '948509897',
        calldate: '2026-09-18 11:12:51',
        source_type: 'manual_override'
    },
    {
        file: 'q-2020159-555170055-20260918-154845-1789728518.172751.wav',
        caller_id: '555170055',
        calldate: '2026-09-18 15:48:51',
        source_type: 'manual_override'
    },
    {
        file: 'q-2020159-944138877-20260918-101826-1789708699.142165.wav',
        caller_id: '944138877',
        calldate: '2026-09-18 10:19:29',
        source_type: 'manual_override'
    },
    {
        file: 'q-2020159-935230458-20260918-105651-1789711004.144461.wav',
        caller_id: '935230458',
        calldate: '2026-09-18 10:56:57',
        source_type: 'manual_override'
    }
];

const TOP_AI_CALLS = [
    {
        file: 'q-2020159-938939833-20260824-162845-1787570918.143837.wav',
        caller_id: '938939833',
        calldate: '2026-08-24 16:28:45',
        source_type: 'ai_detected'
    },
    {
        file: 'q-2020159-951677131-20260817-150325-1786960998.3664.wav',
        caller_id: '951677131',
        calldate: '2026-08-17 15:03:25',
        source_type: 'ai_detected'
    },
    {
        file: 'q-2020159-712077377-20260918-113053-1789713045.146274.wav',
        caller_id: '712077377',
        calldate: '2026-09-18 11:30:53',
        source_type: 'ai_detected'
    },
    {
        file: 'q-2020159-978850526-20260827-095854-1787806726.642856.wav',
        caller_id: '978850526',
        calldate: '2026-08-27 09:58:54',
        source_type: 'ai_detected'
    },
    {
        file: 'q-2020159-903295367-20260824-154047-1787568040.139167.wav',
        caller_id: '903295367',
        calldate: '2026-08-24 15:40:47',
        source_type: 'ai_detected'
    }
];

async function main() {
    console.log("🚀 Namuna ovoz parchalarini tayyorlash boshlandi...");

    // Connect SFTP to download any missing manual calls
    console.log("SFTP ga ulanmoqda...");
    const ok = await sftpService.connect();
    if (!ok) {
        console.error("❌ SFTP ga ulanib bo'lmadi!");
    } else {
        console.log("✅ SFTP ulandi.");
        for (const item of MANUAL_CALLS) {
            const localPath = path.join(CALLS_DIR, item.file);
            if (!fs.existsSync(localPath) || fs.statSync(localPath).size < 100) {
                console.log(`Yuklab olinmoqda: ${item.file}...`);
                const resolved = await sftpService.resolveRemoteAudioPath(item.file);
                if (resolved && resolved.fullPath) {
                    const buf = await sftpService.sftp.get(resolved.fullPath);
                    fs.writeFileSync(localPath, buf);
                    console.log(`✅ Yuklandi: ${item.file} (${buf.length} bayt)`);
                } else {
                    console.warn(`⚠️ Remote fayl topilmadi: ${item.file}`);
                }
            } else {
                console.log(`Mavjud: ${item.file}`);
            }
        }
    }

    // Build task manifest for python
    const allCandidates = [...MANUAL_CALLS, ...TOP_AI_CALLS].map(c => ({
        localPath: path.join(CALLS_DIR, c.file),
        caller_id: c.caller_id,
        calldate: c.calldate,
        source_type: c.source_type
    })).filter(c => fs.existsSync(c.localPath));

    console.log(`Jami tayyor audio fayllar: ${allCandidates.length} ta`);

    const manifestPath = path.join(CALLS_DIR, 'snippet_tasks.json');
    fs.writeFileSync(manifestPath, JSON.stringify(allCandidates, null, 2), 'utf8');

    console.log("SpeechBrain orqali eng sof 3 soniyalik ovoz parchalari kesib olinmoqda...");
    const pyScript = path.join(__dirname, 'extract_snippets.py');

    const py = spawn('python', [pyScript, manifestPath], {
        cwd: path.join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'inherit']
    });

    let stdout = '';
    py.stdout.on('data', chunk => {
        stdout += chunk.toString();
    });

    py.on('close', code => {
        if (code !== 0) {
            console.error(`❌ Python script xato bilan tugadi (kod: ${code})`);
            process.exit(code);
        }

        try {
            const samples = JSON.parse(stdout);
            console.log(`🎉 Muvaffaqiyatli ${samples.length} ta ovoz namunasi kesib olindi!`);
            const outDb = path.join(__dirname, '..', 'data', 'voice_candidate_samples.json');
            fs.writeFileSync(outDb, JSON.stringify(samples, null, 2), 'utf8');
            console.log(`Saqlandi -> ${outDb}`);
            process.exit(0);
        } catch (e) {
            console.error("JSON parse error:", e.message, "\nRaw output:", stdout);
            process.exit(1);
        }
    });
}

main().catch(err => {
    console.error("Xatolik:", err);
    process.exit(1);
});
