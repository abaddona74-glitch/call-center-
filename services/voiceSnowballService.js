const fs = require('fs');
const path = require('path');
const sftpService = require('./sftpService');

const CANDIDATES_JSON = path.join(__dirname, '..', 'data', 'voice_candidate_samples.json');
const IDENTIFICATIONS_JSON = path.join(__dirname, '..', 'data', 'voice_identifications.json');
const CALLS_DIR = path.join(__dirname, '..', 'scratch', 'calls');
const SAMPLES_DIR = path.join(__dirname, '..', 'public', 'samples', 'candidates');

if (!fs.existsSync(CALLS_DIR)) fs.mkdirSync(CALLS_DIR, { recursive: true });
if (!fs.existsSync(SAMPLES_DIR)) fs.mkdirSync(SAMPLES_DIR, { recursive: true });

function sliceWavBuffer(buf, startSec, durSec) {
    const dataIdx = buf.indexOf('data');
    if (dataIdx === -1) throw new Error('WAV data chunk topilmadi');

    const sampleRate = buf.readUInt32LE(24);
    const numChannels = buf.readUInt16LE(22);
    const bitsPerSample = buf.readUInt16LE(34);
    const bytesPerSec = sampleRate * numChannels * (bitsPerSample / 8);

    const startByte = dataIdx + 8 + Math.floor(startSec * bytesPerSec);
    const byteLen = Math.floor(durSec * bytesPerSec);
    const endByte = Math.min(buf.length, startByte + byteLen);
    const slicedRaw = buf.subarray(startByte, endByte);

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + slicedRaw.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(bytesPerSec, 28);
    header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(slicedRaw.length, 40);

    return Buffer.concat([header, slicedRaw]);
}

class VoiceSnowballService {
    /**
     * Yangi Zuhra opa qo'ng'iroqlari asosida yangi audio parchalar to'plamini (Snowball batch) tayyorlash
     * @param {number} batchSize - Nechta yangi namuna kesish (default: 6 ta)
     */
    async generateNextBatch(batchSize = 6) {
        if (!fs.existsSync(IDENTIFICATIONS_JSON)) {
            throw new Error('voice_identifications.json bazasi topilmadi');
        }

        let existingSamples = [];
        if (fs.existsSync(CANDIDATES_JSON)) {
            try {
                existingSamples = JSON.parse(fs.readFileSync(CANDIDATES_JSON, 'utf8'));
            } catch (e) {
                existingSamples = [];
            }
        }

        const existingFileSet = new Set(
            existingSamples.map(s => s.source_call || s.file).filter(Boolean)
        );

        // Barcha mavjud sample_ id lardan eng kattasini topish
        let maxIdNum = 0;
        let maxBatchNum = 1;
        for (const s of existingSamples) {
            if (s.id && s.id.startsWith('sample_')) {
                const n = parseInt(s.id.replace('sample_', ''), 10);
                if (!isNaN(n) && n > maxIdNum) maxIdNum = n;
            }
            if (s.batch && typeof s.batch === 'number' && s.batch > maxBatchNum) {
                maxBatchNum = s.batch;
            }
        }

        const nextBatchNum = maxBatchNum + 1;

        // voice_identifications bazasidan manual Zuhra opa qo'ng'iroqlarini olish
        const allCalls = JSON.parse(fs.readFileSync(IDENTIFICATIONS_JSON, 'utf8'));
        const manualZuhra = allCalls.filter(c => 
            c.is_manual_override && 
            (c.speaker === 'zuhra' || c.speaker === 'Zuhra opa') &&
            !existingFileSet.has(c.file)
        );

        // Agar manual kam bo'lsa, AI eng yuqori ishonch bilan topgan lekin hali sample olinmagan Zuhra qo'ng'iroqlarini qo'shish
        let candidates = [...manualZuhra];
        if (candidates.length < batchSize) {
            const aiDetections = allCalls.filter(c =>
                !c.is_manual_override &&
                (c.speaker === 'zuhra' || c.speaker === 'Zuhra opa') &&
                !existingFileSet.has(c.file) &&
                (c.confidence || c.score)
            ).sort((a, b) => (b.confidence || b.score || 0) - (a.confidence || a.score || 0));

            for (const ai of aiDetections) {
                if (candidates.length >= batchSize) break;
                candidates.push(ai);
            }
        }

        if (candidates.length === 0) {
            return {
                success: false,
                message: 'Hozircha yangi qo\'lda o\'tkazilgan yoki saralanmagan Zuhra opa qo\'ng\'iroqlari qolmadi.',
                totalExisting: existingSamples.length
            };
        }

        const selectedCandidates = candidates.slice(0, batchSize);
        console.log(`❄️ [Snowball] Yangi Batch #${nextBatchNum} uchun ${selectedCandidates.length} ta qo'ng'iroq tanlandi.`);

        const createdSamples = [];
        let connectedSftp = false;

        for (let i = 0; i < selectedCandidates.length; i++) {
            const c = selectedCandidates[i];
            const localCallPath = path.join(CALLS_DIR, c.file);

            // Agar audio lokal kompyuterda bo'lmasa, SFTP dan yuklab olish
            if (!fs.existsSync(localCallPath)) {
                if (!connectedSftp) {
                    await sftpService.connect();
                    connectedSftp = true;
                }
                const resObj = await sftpService.resolveRemoteAudioPath(c.file);
                const remoteFilePath = (typeof resObj === 'string') ? resObj : (resObj?.fullPath || resObj?.path);
                if (remoteFilePath) {
                    try {
                        await sftpService.sftp.fastGet(remoteFilePath, localCallPath);
                    } catch (err) {
                        console.warn(`SFTP dan yuklab bo'lmadi: ${c.file}`, err.message);
                        continue;
                    }
                } else {
                    console.warn(`Remote yo'l topilmadi: ${c.file}`);
                    continue;
                }
            }

            if (!fs.existsSync(localCallPath)) continue;

            try {
                const callBuf = fs.readFileSync(localCallPath);
                
                // Segment vaqtini aniqlash: agar top_segments bo'lsa undan, aks holda 14s-20s dan
                let startSec = 14.0;
                if (c.top_segments && c.top_segments[0] && c.top_segments[0].start > 0) {
                    startSec = Math.max(2.0, c.top_segments[0].start);
                } else if (c.billsec && c.billsec > 40) {
                    startSec = 18.0;
                }
                const durSec = 3.0;

                const slicedBuf = sliceWavBuffer(callBuf, startSec, durSec);

                maxIdNum++;
                const newSampleId = `sample_${maxIdNum}`;
                const outWavName = `${newSampleId}.wav`;
                const outWavPath = path.join(SAMPLES_DIR, outWavName);

                fs.writeFileSync(outWavPath, slicedBuf);

                const tEnd = startSec + durSec;
                const startStr = `${String(Math.floor(startSec / 60)).padStart(2, '0')}:${String(Math.floor(startSec % 60)).padStart(2, '0')}`;
                const endStr = `${String(Math.floor(tEnd / 60)).padStart(2, '0')}:${String(Math.floor(tEnd % 60)).padStart(2, '0')}`;

                const sampleObj = {
                    id: newSampleId,
                    filename: outWavName,
                    audio_url: `/samples/candidates/${outWavName}`,
                    caller_id: c.caller_id || (c.src || 'Noma\'lum'),
                    calldate: c.calldate,
                    source_call: c.file,
                    start_sec: startSec,
                    end_sec: tEnd,
                    time_range: `${startStr} — ${endStr}`,
                    duration_sec: durSec,
                    similarity_score: c.score || c.confidence ? (c.score || (c.confidence / 100)) : 0.50,
                    source_type: c.is_manual_override ? 'manual_override' : 'ai_detected',
                    batch: nextBatchNum,
                    description: c.is_manual_override ? `Qo'lda tasdiqlangan (To'plam #${nextBatchNum})` : `AI deteksiya (To'plam #${nextBatchNum})`,
                    status: 'pending',
                    reviewed_at: null
                };

                createdSamples.push(sampleObj);
                existingSamples.push(sampleObj);
                console.log(`  + [Batch #${nextBatchNum}] ${newSampleId} yaratildi: ${c.caller_id} (${startStr} - ${endStr})`);
            } catch (err) {
                console.error(`Namuna kesishda xatolik (${c.file}):`, err.message);
            }
        }

        // Saqlash
        fs.writeFileSync(CANDIDATES_JSON, JSON.stringify(existingSamples, null, 2), 'utf8');

        const approvedCount = existingSamples.filter(s => s.status === 'approved').length;
        const deniedCount = existingSamples.filter(s => s.status === 'denied').length;
        const pendingCount = existingSamples.filter(s => s.status === 'pending').length;

        return {
            success: true,
            batch: nextBatchNum,
            addedCount: createdSamples.length,
            createdSamples,
            allSamples: existingSamples,
            stats: {
                total: existingSamples.length,
                approved: approvedCount,
                denied: deniedCount,
                pending: pendingCount
            }
        };
    }
}

module.exports = new VoiceSnowballService();
