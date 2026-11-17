const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const sftpService = require('./sftpService');
const audioIndexService = require('./audioIndexService');

const TEMP_ZIPS_DIR = path.join(__dirname, '..', 'data', 'temp_zips');

// Ensure directory exists
if (!fs.existsSync(TEMP_ZIPS_DIR)) {
    try {
        fs.mkdirSync(TEMP_ZIPS_DIR, { recursive: true });
    } catch (e) {
        console.warn('⚠️ temp_zips papkasini yaratishda xato:', e.message);
    }
}

// In-memory jobs map: jobId -> jobData
const jobs = new Map();

// Helper: safe filename
function sanitizeFileName(name) {
    return (name || 'recordings.zip').replace(/[/\\?%*:|"<>]/g, '_');
}

/**
 * 2 soatdan eski vaqtinchalik zip fayllarni tozalash
 */
function cleanupOldZips() {
    try {
        const now = Date.now();
        const maxAge = 2 * 60 * 60 * 1000; // 2 soat

        if (fs.existsSync(TEMP_ZIPS_DIR)) {
            const files = fs.readdirSync(TEMP_ZIPS_DIR);
            for (const f of files) {
                const fp = path.join(TEMP_ZIPS_DIR, f);
                try {
                    const stat = fs.statSync(fp);
                    if (now - stat.mtimeMs > maxAge) {
                        fs.unlinkSync(fp);
                        console.log(`🧹 [ZipJob] Eski ZIP tozalandi: ${f}`);
                    }
                } catch (_) {}
            }
        }

        // Job Map ni ham tozalash
        for (const [id, job] of jobs.entries()) {
            if (now - job.createdAt > maxAge) {
                jobs.delete(id);
            }
        }
    } catch (err) {
        console.warn('⚠️ cleanupOldZips xatolik:', err.message);
    }
}

// Har 30 daqiqada eski fayllarni tozalab turish
setInterval(cleanupOldZips, 30 * 60 * 1000);
setTimeout(cleanupOldZips, 10000);

// ==========================================
// PARALLELLIK VA NAVBAT (Queue) BOSHQARUVI
// ==========================================
const MAX_CONCURRENT_JOBS = 3;
let activeRunningJobs = 0;
const waitingQueue = [];

class ZipJobService {
    /**
     * Yangi fon arxivlash vazifasini boshlash
     */
    async startZipJob({ fileList, zipName = 'recordings.zip', metadata = {} }) {
        if (!Array.isArray(fileList) || fileList.length === 0) {
            throw new Error('Arxivlash uchun fayllar ro\'yxati berilmadi');
        }

        const jobId = `zip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const safeZipName = sanitizeFileName(zipName);
        const targetFilePath = path.join(TEMP_ZIPS_DIR, `${jobId}.zip`);

        const isQueued = activeRunningJobs >= MAX_CONCURRENT_JOBS;

        const job = {
            id: jobId,
            status: isQueued ? 'queued' : 'processing', // 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled'
            queuePosition: isQueued ? waitingQueue.length + 1 : 0,
            progress: 0,
            total: fileList.length,
            processed: 0,
            added: 0,
            currentFile: '',
            zipName: safeZipName,
            filePath: targetFilePath,
            fileSize: 0,
            fileSizeFormatted: '0 MB',
            createdAt: Date.now(),
            completedAt: null,
            error: null,
            metadata
        };

        jobs.set(jobId, job);

        if (!isQueued) {
            activeRunningJobs++;
            console.log(`🚀 [ZipJob ${job.id}] Parallel boshlandi (Faol: ${activeRunningJobs}/${MAX_CONCURRENT_JOBS})`);
            setImmediate(() => {
                this._runJob(job, fileList);
            });
        } else {
            waitingQueue.push({ job, fileList });
            console.log(`⏳ [ZipJob ${job.id}] Navbatga qo'yildi (Navbatdagi o'rni: #${job.queuePosition})`);
        }

        return job;
    }

    /**
     * Ichki fon jarayoni: SFTP dan o'qib, diskdagi ZIP faylga yozish
     */
    async _runJob(job, fileList) {
        let outputStream = null;
        let archive = null;

        let audioIndexService = null;
        try {
            audioIndexService = require('./audioIndexService');
        } catch (e) {}

        try {
            const connected = await sftpService.connect();
            if (!connected) {
                throw new Error('SFTP serverga ulanib bo\'lmadi');
            }

            outputStream = fs.createWriteStream(job.filePath);
            archive = archiver('zip', {
                zlib: { level: 4 }
            });

            archive.pipe(outputStream);

            archive.on('error', (err) => {
                console.error(`❌ [ZipJob ${job.id}] Archiver xatosi:`, err.message);
                job.status = 'failed';
                job.error = err.message;
            });

            outputStream.on('error', (err) => {
                console.error(`❌ [ZipJob ${job.id}] Output stream xatosi:`, err.message);
                job.status = 'failed';
                job.error = err.message;
            });

            const finishPromise = new Promise((resolve, reject) => {
                outputStream.on('close', resolve);
                outputStream.on('error', reject);
            });

            let addedCount = 0;
            const usedNames = new Set();

            for (let i = 0; i < fileList.length; i++) {
                if (job.isCancelled || job.status === 'cancelled') {
                    console.log(`🛑 [ZipJob ${job.id}] Bekor qilindi, sikl to'xtatildi.`);
                    try {
                        if (archive) archive.abort();
                        if (outputStream) outputStream.destroy();
                        if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
                    } catch (_) {}
                    return;
                }

                const fileItem = fileList[i];
                job.processed = i + 1;
                job.progress = Math.min(99, Math.round((job.processed / job.total) * 100));

                let rawPath = typeof fileItem === 'string' ? fileItem : (fileItem.path || fileItem.recording);
                const customName = (typeof fileItem === 'object' && fileItem.filename) ? fileItem.filename : null;

                // Tezkor indeksdan qidirish (agar yo'l to'liq audio fayl bo'lmasa yoki callerId_duration shaklida bo'lsa)
                const isAudioExt = rawPath && typeof rawPath === 'string' && /\.(wav|mp3|ogg|m4a)$/i.test(rawPath);
                if (!isAudioExt && audioIndexService) {
                    let targetCaller = typeof fileItem === 'object' ? fileItem.callerId : '';
                    let targetDur = typeof fileItem === 'object' ? (fileItem.duration || 0) : 0;

                    if (!targetCaller && typeof rawPath === 'string') {
                        const m = rawPath.match(/^(\+?[0-9]{7,15})_([0-9]+)/);
                        if (m) {
                            targetCaller = m[1];
                            targetDur = parseInt(m[2], 10);
                        } else if (/^\+?[0-9]{7,15}$/.test(rawPath.trim())) {
                            targetCaller = rawPath.trim();
                        }
                    }

                    if (targetCaller) {
                        const match = audioIndexService.findAudioForCaller(targetCaller, targetDur);
                        if (match && match.path) {
                            rawPath = match.path;
                        }
                    }
                }

                if (!rawPath) continue;

                job.currentFile = path.basename(rawPath);

                try {
                    const resolved = await sftpService.resolveRemoteAudioPath(rawPath);
                    if (resolved && resolved.size > 44) {
                        let baseName = customName || path.basename(resolved.fullPath);
                        baseName = baseName.replace(/[/\\?%*:|"<>]/g, '_');
                        if (!baseName.toLowerCase().endsWith('.wav') && !baseName.toLowerCase().endsWith('.mp3')) {
                            baseName += '.wav';
                        }

                        let entryName = baseName;
                        let counter = 1;
                        while (usedNames.has(entryName)) {
                            const ext = path.extname(baseName);
                            const root = path.basename(baseName, ext);
                            entryName = `${root}_${counter}${ext}`;
                            counter++;
                        }
                        usedNames.add(entryName);

                        const readStream = sftpService.sftp.createReadStream(resolved.fullPath);
                        await new Promise((resStream) => {
                            readStream.on('error', (streamErr) => {
                                console.warn(`⚠️ [ZipJob ${job.id}] SFTP o'qishda xato (${resolved.fullPath}):`, streamErr.message);
                                resStream();
                            });
                            readStream.on('end', () => resStream());
                            archive.append(readStream, { name: entryName });
                        });
                        addedCount++;
                        job.added = addedCount;
                    }
                } catch (fileErr) {
                    console.warn(`⚠️ [ZipJob ${job.id}] Faylni kiritishda xato:`, fileErr.message);
                }
            }

            if (job.isCancelled || job.status === 'cancelled') {
                try {
                    if (archive) archive.abort();
                    if (outputStream) outputStream.destroy();
                    if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
                } catch (_) {}
                return;
            }

            // Arxivni yakunlash
            await archive.finalize();
            await finishPromise;

            // Natija hajmini o'lchash
            if (fs.existsSync(job.filePath)) {
                const stat = fs.statSync(job.filePath);
                job.fileSize = stat.size;
                job.fileSizeFormatted = (stat.size / (1024 * 1024)).toFixed(1) + ' MB';
            }

            job.status = 'ready';
            job.progress = 100;
            job.completedAt = Date.now();
            console.log(`✅ [ZipJob ${job.id}] Arxiv tayyor! ${job.added} ta fayl, Hajmi: ${job.fileSizeFormatted}`);
        } catch (err) {
            if (job.isCancelled || job.status === 'cancelled') {
                console.log(`ℹ️ [ZipJob ${job.id}] Bekor qilingan vazifa to'xtatildi.`);
                return;
            }
            console.error(`❌ [ZipJob ${job.id}] Umumiy xatolik:`, err.message);
            job.status = 'failed';
            job.error = err.message;
            try {
                if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
            } catch (_) {}
        } finally {
            this._onJobFinished(job);
        }
    }

    /**
     * Bitta vazifa tugaganda (muvaffaqiyatli, xato yoki bekor bo'lganda)
     */
    _onJobFinished(job) {
        activeRunningJobs = Math.max(0, activeRunningJobs - 1);
        console.log(`🏁 [ZipJob ${job.id}] Yakunlandi (status: ${job.status}). Faol qoldi: ${activeRunningJobs}/${MAX_CONCURRENT_JOBS}`);
        this._checkQueue();
    }

    /**
     * Navbatda turgan keyingi vazifalarni ishga tushirish
     */
    _checkQueue() {
        while (activeRunningJobs < MAX_CONCURRENT_JOBS && waitingQueue.length > 0) {
            const next = waitingQueue.shift();
            if (next && next.job && !next.job.isCancelled && next.job.status === 'queued') {
                activeRunningJobs++;
                next.job.status = 'processing';
                next.job.queuePosition = 0;
                console.log(`🚀 [ZipJob ${next.job.id}] Navbatdan chiqdi va ishga tushdi! (Faol: ${activeRunningJobs}/${MAX_CONCURRENT_JOBS})`);
                setImmediate(() => {
                    this._runJob(next.job, next.fileList);
                });
            }
        }

        // Navbatda qolganlarning o'rnini (position) yangilash
        waitingQueue.forEach((item, index) => {
            if (item && item.job) {
                item.job.queuePosition = index + 1;
            }
        });
    }

    /**
     * Job ma'lumotlarini olish
     */
    getJob(jobId) {
        const job = jobs.get(jobId);
        if (!job) return null;
        if (job.status === 'queued') {
            const qIdx = waitingQueue.findIndex(item => item && item.job && item.job.id === jobId);
            job.queuePosition = qIdx !== -1 ? qIdx + 1 : 1;
        }
        return job;
    }

    /**
     * Jarayonni bekor qilish va resurslarni tozalash
     */
    cancelJob(jobId) {
        const job = jobs.get(jobId);
        if (!job) return false;
        
        console.log(`🛑 [ZipJob ${jobId}] Foydalanuvchi bekor qildi`);
        job.status = 'cancelled';
        job.isCancelled = true;
        job.error = 'Bekor qilindi';

        // 1. Agar navbatda kutayotgan bo'lsa, navbatdan olib tashlaymiz
        const qIdx = waitingQueue.findIndex(item => item && item.job && item.job.id === jobId);
        if (qIdx !== -1) {
            waitingQueue.splice(qIdx, 1);
            console.log(`🛑 [ZipJob ${jobId}] Navbatdan olib tashlandi.`);
            this._checkQueue();
            return true;
        }
        
        // 2. Agar ishlab turgan bo'lsa, faylini tozalaymiz
        try {
            if (fs.existsSync(job.filePath)) {
                fs.unlinkSync(job.filePath);
            }
        } catch (_) {}
        
        return true;
    }

    /**
     * Fayl tayyor bo'lsa uning haqiqiy diskdagi yo'lini olish
     */
    getReadyFilePath(jobId) {
        const job = jobs.get(jobId);
        if (!job || job.status !== 'ready') return null;
        if (fs.existsSync(job.filePath)) {
            return {
                filePath: job.filePath,
                fileName: job.zipName,
                fileSize: job.fileSize
            };
        }
        return null;
    }
}

module.exports = new ZipJobService();
