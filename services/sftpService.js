const SftpClient = require('ssh2-sftp-client');
const config = require('../config');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const issabelDbService = require('./issabelDbService');

class SftpService {
    constructor() {
        this.sftp = new SftpClient();
        this.isConnected = false;
        this.isConnecting = false;
        this.onStatusChange = null;
        this.healthCheckTimer = null;

        // Papkalar hajmi uchun xotira keshi
        this.dirSizeCache = new Map();
        // Root darajadagi 2025 va 2026 hajmlarini oldindan keshga kiritib qo'yish (bosh sahifa qotmasligi uchun)
        this.dirSizeCache.set('/var/spool/asterisk/monitor/2025', { size: 198846406624, time: Date.now() });
        this.dirSizeCache.set('/var/spool/asterisk/monitor/2026', { size: 208667712168, time: Date.now() });

        // Har 20 soniyada aloqani tekshirib, tirik ushlab turish
        this.startHealthCheck();
    }

    notifyStatus(status) {
        if (this.isConnected !== status) {
            this.isConnected = status;
            if (typeof this.onStatusChange === 'function') {
                try {
                    this.onStatusChange(status);
                } catch (e) {}
            }
        }
    }

    async connect() {
        if (this.isConnected) {
            // Soket chindan ham tirikligini tekshiramiz
            try {
                const alive = await this.sftp.cwd();
                if (alive) return true;
            } catch (e) {
                this.isConnected = false;
            }
        }

        if (this.isConnecting) return false;

        if (!config.SFTP.password && !config.SFTP.privateKey) {
            return false;
        }

        this.isConnecting = true;
        try {
            try {
                await this.sftp.end();
            } catch (e) {}

            this.sftp = new SftpClient();

            // Uzilish hodisalarini ushlash
            this.sftp.on('close', () => {
                this.notifyStatus(false);
            });
            this.sftp.on('end', () => {
                this.notifyStatus(false);
            });
            this.sftp.on('error', (err) => {
                console.warn('⚠️ SFTP xatoligi:', err.message);
                this.notifyStatus(false);
            });

            await this.sftp.connect({
                host: config.SFTP.host,
                port: config.SFTP.port,
                username: config.SFTP.username,
                password: config.SFTP.password,
                readyTimeout: 15000,
                retries: 2,
                retry_factor: 2,
                retry_minTimeout: 2000,
                keepaliveInterval: 10000, // 10 soniyada SSH keepalive yuborish
                keepaliveCountMax: 3
            });

            this.isConnecting = false;
            this.notifyStatus(true);
            console.log(`✅ SFTP ga muvaffaqiyatli ulandi! (${config.SFTP.host}:${config.SFTP.monitorPath})`);
            return true;
        } catch (err) {
            this.isConnecting = false;
            this.notifyStatus(false);
            return false;
        }
    }

    startHealthCheck() {
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = setInterval(async () => {
            if (!this.isConnected) {
                // Uzilgan bo'lsa fonda qayta ulanishga harakat qilamiz
                await this.connect();
            } else {
                // Aloqani tekshiramiz
                try {
                    await this.sftp.cwd();
                } catch (err) {
                    console.warn('⚠️ SFTP aloqasi uzildi, qayta ulanmoqda...');
                    this.notifyStatus(false);
                    await this.connect();
                }
            }
        }, 15000);
    }

    /**
     * Papkalar hajmini (MB/GB) aniqlash va keshda saqlash
     */
    async getDirectorySizes(remoteParentDir, dirNames) {
        if (!dirNames || dirNames.length === 0) return {};
        const result = {};
        const missing = [];
        const now = Date.now();

        for (const name of dirNames) {
            const fullDir = path.posix.join(remoteParentDir, name);
            const cached = this.dirSizeCache.get(fullDir);
            const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
            const isToday = fullDir.includes(todayStr);
            // Bugungi sana papkasi 2 daqiqa, eski sanalar 24 soat keshda turadi
            const ttl = isToday ? 2 * 60 * 1000 : 24 * 60 * 60 * 1000;

            if (cached && (now - cached.time < ttl)) {
                result[name] = cached.size;
            } else {
                missing.push(name);
            }
        }

        if (missing.length > 0) {
            try {
                // Tezkor du -sb orqali barcha sub-papkalarning hajmini bir so'rovda olish (~200ms)
                const cmd = `du -sb "${remoteParentDir}"/* 2>/dev/null`;
                const stdout = await issabelDbService.execCommand(cmd, 6000);
                if (stdout) {
                    const lines = stdout.trim().split('\n');
                    for (const line of lines) {
                        const parts = line.split('\t');
                        if (parts.length >= 2) {
                            const sizeBytes = parseInt(parts[0], 10);
                            const itemPath = parts[1].trim();
                            const itemName = path.posix.basename(itemPath);
                            if (!isNaN(sizeBytes) && itemName) {
                                result[itemName] = sizeBytes;
                                this.dirSizeCache.set(path.posix.join(remoteParentDir, itemName), {
                                    size: sizeBytes,
                                    time: Date.now()
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('⚠️ du -sb papka hajmlarini olishda xatolik:', err.message);
            }
        }

        return result;
    }

    /**
     * Berilgan papkadagi audio fayllar va ichki papkalarni ro'yxatini oladi
     * @param {string} subPath - Masalan: '' yoki '2026/09/02'
     */
    async listDirectory(subPath = '') {
        const fullRemotePath = path.posix.join(config.SFTP.monitorPath, subPath.replace(/\\/g, '/'));
        
        try {
            const connected = await this.connect();
            if (connected) {
                const list = await this.sftp.list(fullRemotePath);
                
                const directories = [];
                const files = [];

                for (const item of list) {
                    if (item.type === 'd') {
                        directories.push({
                            name: item.name,
                            path: path.posix.join(subPath, item.name),
                            type: 'directory',
                            modifyTime: item.modifyTime
                        });
                    } else if (item.type === '-' || item.name.match(/\.(wav|mp3|gsm|ogg|flac|m4a)$/i)) {
                        files.push({
                            name: item.name,
                            path: path.posix.join(subPath, item.name),
                            type: 'file',
                            size: item.size,
                            sizeFormatted: this.formatBytes(item.size),
                            modifyTime: item.modifyTime,
                            isEmpty: (item.size || 0) <= 44,
                            url: `/api/recordings/stream?file=${encodeURIComponent(path.posix.join(subPath, item.name))}`
                        });
                    }
                }

                // Papkalar hajmini (MB / GB) hisoblash va to'ldirish
                if (directories.length > 0) {
                    try {
                        const dirNames = directories.map(d => d.name);
                        const sizeMap = await this.getDirectorySizes(fullRemotePath, dirNames);
                        for (const d of directories) {
                            const sz = sizeMap[d.name] || 0;
                            d.size = sz;
                            d.sizeFormatted = sz > 0 ? this.formatBytes(sz) : '';
                        }
                    } catch (e) {
                        console.warn('Papka hajmlarini hisoblashda ogohlantirish:', e.message);
                    }
                }

                // Sanaga ko'ra yangilarini yuqoriga saralash
                directories.sort((a, b) => b.name.localeCompare(a.name));
                files.sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0));

                return {
                    success: true,
                    currentPath: subPath,
                    fullRemotePath,
                    directories,
                    files,
                    isRealSftp: true
                };
            }
        } catch (err) {
            if (err && err.message && err.message.includes('No such file')) {
                // Bugungi kun papkasi hali PBX da yaratilmagan bo'lsa (birinchi qo'ng'iroq bo'lmaguncha) - bu xato emas
                return {
                    success: true,
                    currentPath: subPath,
                    fullRemotePath,
                    directories: [],
                    files: [],
                    isRealSftp: true
                };
            }
            console.warn(`SFTP listDirectory xatosi (${fullRemotePath}):`, err.message);
        }

        // Agar SFTP ulanmagan bo'lsa, namunaviy (Explorer) daraxt qaytaramiz
        return this.getMockDirectoryList(subPath);
    }

    /**
     * Audio faylning to'liq remote yo'lini topish
     */
    async resolveRemoteAudioPath(filePath) {
        if (!filePath) return null;
        let clean = filePath.trim().replace(/\\/g, '/');
        
        const candidates = [];
        if (clean.startsWith('/var/spool/asterisk/monitor')) {
            candidates.push(clean);
        } else if (clean.match(/^[0-9]{4}\/[0-9]{2}\/[0-9]{2}\//)) {
            candidates.push(`/var/spool/asterisk/monitor/${clean}`);
        } else {
            // Fayl nomidan YYYY/MM/DD ni ajratib olish (masalan: q-2020159-935289878-20260902-143113...)
            const match = clean.match(/(202[0-9])(0[1-9]|1[0-2])([0-3][0-9])/);
            if (match) {
                candidates.push(`/var/spool/asterisk/monitor/${match[1]}/${match[2]}/${match[3]}/${clean}`);
            }
            candidates.push(`/var/spool/asterisk/monitor/${clean}`);
            
            // Bugungi sana papkasi
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            candidates.push(`/var/spool/asterisk/monitor/${yyyy}/${mm}/${dd}/${clean}`);
        }

        const finalCandidates = [];
        for (const cand of candidates) {
            finalCandidates.push(cand);
            if (!cand.match(/\.(wav|mp3|gsm|ogg|flac|m4a|WAV)$/i)) {
                finalCandidates.push(cand + '.wav');
                finalCandidates.push(cand + '.WAV');
                finalCandidates.push(cand + '.gsm');
            }
        }

        for (const fullPath of finalCandidates) {
            try {
                const stat = await this.sftp.stat(fullPath);
                if (stat && stat.size > 0) {
                    return { fullPath, size: stat.size };
                }
            } catch (e) {
                // Not found, check next
            }
        }

        return null;
    }

    /**
     * Audio faylni brauzerga stream qilish
     */
    async streamFile(filePath, req, res) {
        try {
            const connected = await this.connect();
            if (connected) {
                const resolved = await this.resolveRemoteAudioPath(filePath);
                if (resolved) {
                    const { fullPath, size: fileSize } = resolved;

                    // 44 bayt - bu faqat bo'sh WAV sarlavhasi (suhbat bo'lmagan, 0 soniya)
                    if (fileSize <= 44) {
                        return res.status(400).json({
                            error: 'Ushbu qo\'ng\'iroqda suhbat bo\'lmagan (ovoz yozuvi bo\'sh: 0 soniya)',
                            emptyAudio: true,
                            fileSize
                        });
                    }

                    const range = req.headers.range;
                    const contentType = fullPath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';

                    if (range) {
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                        const chunksize = (end - start) + 1;

                        const isDownload = req.query && (req.query.download === '1' || req.query.dl === '1');
                        const headers206 = {
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': chunksize,
                            'Content-Type': contentType,
                        };
                        if (isDownload) {
                            headers206['Content-Disposition'] = `attachment; filename="${path.basename(fullPath)}"`;
                        }
                        res.writeHead(206, headers206);

                        const stream = this.sftp.createReadStream(fullPath, { start, end });
                        stream.on('error', (err) => {
                            console.warn('SFTP stream xatosi:', err.message);
                            if (!res.headersSent) res.status(500).end();
                        });
                        req.on('close', () => {
                            try { stream.destroy(); } catch (e) {}
                        });
                        stream.pipe(res);
                    } else {
                        const isDownload = req.query && (req.query.download === '1' || req.query.dl === '1');
                        const headers200 = {
                            'Content-Length': fileSize,
                            'Content-Type': contentType,
                        };
                        if (isDownload) {
                            headers200['Content-Disposition'] = `attachment; filename="${path.basename(fullPath)}"`;
                        }
                        res.writeHead(200, headers200);
                        const stream = this.sftp.createReadStream(fullPath);
                        stream.on('error', (err) => {
                            console.warn('SFTP stream xatosi:', err.message);
                            if (!res.headersSent) res.status(500).end();
                        });
                        req.on('close', () => {
                            try { stream.destroy(); } catch (e) {}
                        });
                        stream.pipe(res);
                    }
                    return;
                }
            }
        } catch (err) {
            console.error('Audio stream xatosi:', err.message);
        }

        // Agar fayl topilmasa yoki SFTP ulanmasa
        res.status(404).json({
            error: 'Audio fayl topilmadi yoki SFTP server bilan aloqa yo\'q',
            hint: 'Fayl /var/spool/asterisk/monitor ichida mavjudligini tekshiring'
        });
    }

    /**
     * Bir nechta audio fayllarni ZIP arxiv shaklida stream qilish
     */
    async downloadFilesAsZip(fileList, req, res, customZipName) {
        let audioIndexService = null;
        try {
            audioIndexService = require('./audioIndexService');
        } catch (e) {}

        try {
            const connected = await this.connect();
            if (!connected) {
                return res.status(503).json({ error: 'SFTP serverga ulanib bo\'lmadi' });
            }

            const archive = archiver('zip', {
                zlib: { level: 4 }
            });

            const now = new Date();
            const dateTag = now.toISOString().slice(0, 10);
            const safeZipName = (customZipName || `call_recordings_${dateTag}.zip`).replace(/[/\\?%*:|"<>]/g, '_');

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${safeZipName}"`);
            res.setHeader('Cache-Control', 'no-cache');

            let isAborted = false;
            req.on('close', () => {
                isAborted = true;
                try { archive.abort(); } catch (e) {}
            });

            archive.on('error', (err) => {
                console.error('ZIP archiver xatosi:', err.message);
                if (!res.headersSent) res.status(500).end();
            });

            archive.pipe(res);

            let addedCount = 0;
            const usedNames = new Set();

            for (const fileItem of fileList) {
                if (isAborted) break;

                let rawPath = typeof fileItem === 'string' ? fileItem : (fileItem.path || fileItem.recording);
                const customName = (typeof fileItem === 'object' && fileItem.filename) ? fileItem.filename : null;

                // Agar recording nomi bo'sh bo'lsa, tezkor indeksdan qidirib ko'ramiz
                if (!rawPath && typeof fileItem === 'object' && fileItem.callerId && audioIndexService) {
                    const match = audioIndexService.findAudioForCaller(fileItem.callerId, fileItem.duration || 0);
                    if (match && match.path) {
                        rawPath = match.path;
                    }
                }

                if (!rawPath) continue;

                try {
                    const resolved = await this.resolveRemoteAudioPath(rawPath);
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

                        const readStream = this.sftp.createReadStream(resolved.fullPath);
                        await new Promise((resolve) => {
                            readStream.on('error', (err) => {
                                console.warn(`SFTP stream xatosi (${resolved.fullPath}):`, err.message);
                                resolve();
                            });
                            readStream.on('end', () => resolve());
                            archive.append(readStream, { name: entryName });
                        });
                        addedCount++;
                    }
                } catch (itemErr) {
                    console.warn(`Arxivga audio qo'shishda xatolik:`, itemErr.message);
                }
            }

            if (addedCount === 0) {
                archive.append('Tanlangan qo\'ng\'iroqlarda audio yozuvlar topilmadi (suhbat bo\'lmagan yoki 0 soniyali).', { name: 'info.txt' });
            }

            if (!isAborted) {
                await archive.finalize();
            }
        } catch (err) {
            console.error('downloadFilesAsZip umumiy xatolik:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        }
    }

    formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        if (i < 0 || i >= sizes.length) return '0 B';
        const val = bytes / Math.pow(k, i);
        // GB va TB uchun 2 xona (1.24 GB), MB uchun 1 xona (230.1 MB), KB uchun 0 xona
        const dec = i >= 3 ? 2 : (i === 2 ? 1 : 0);
        return `${parseFloat(val.toFixed(dec))} ${sizes[i]}`;
    }

    getMockDirectoryList(subPath) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        if (!subPath || subPath === '') {
            return {
                success: true,
                currentPath: '',
                fullRemotePath: config.SFTP.monitorPath,
                isRealSftp: false,
                notice: 'SFTP ulanmagan. Demo ma\'lumotlar ko\'rsatilmoqda. (.env da SFTP_PASSWORD ni kiriting)',
                directories: [
                    { name: `${yyyy}`, path: `${yyyy}`, type: 'directory', modifyTime: Date.now(), size: 208667712168, sizeFormatted: '194.34 GB' },
                    { name: `${yyyy - 1}`, path: `${yyyy - 1}`, type: 'directory', modifyTime: Date.now() - 86400000 * 30, size: 198846406624, sizeFormatted: '185.19 GB' }
                ],
                files: []
            };
        }

        if (subPath === `${yyyy}`) {
            return {
                success: true,
                currentPath: subPath,
                fullRemotePath: path.posix.join(config.SFTP.monitorPath, subPath),
                isRealSftp: false,
                directories: [
                    { name: `${mm}`, path: `${yyyy}/${mm}`, type: 'directory', modifyTime: Date.now(), size: 16884767044, sizeFormatted: '15.72 GB' },
                    { name: '08', path: `${yyyy}/08`, type: 'directory', modifyTime: Date.now() - 86400000 * 5, size: 17471160260, sizeFormatted: '16.27 GB' }
                ],
                files: []
            };
        }

        if (subPath === `${yyyy}/${mm}`) {
            return {
                success: true,
                currentPath: subPath,
                fullRemotePath: path.posix.join(config.SFTP.monitorPath, subPath),
                isRealSftp: false,
                directories: [
                    { name: `${dd}`, path: `${yyyy}/${mm}/${dd}`, type: 'directory', modifyTime: Date.now(), size: 241240584, sizeFormatted: '230.1 MB' },
                    { name: String(Number(dd) - 1).padStart(2, '0'), path: `${yyyy}/${mm}/${String(Number(dd) - 1).padStart(2, '0')}`, type: 'directory', modifyTime: Date.now() - 86400000, size: 843607324, sizeFormatted: '804.5 MB' }
                ],
                files: []
            };
        }

        // Kunlik fayllar namunasi
        return {
            success: true,
            currentPath: subPath,
            fullRemotePath: path.posix.join(config.SFTP.monitorPath, subPath),
            isRealSftp: false,
            directories: [],
            files: [
                {
                    name: `q-101-998901234567-${yyyy}${mm}${dd}-103015-172525.wav`,
                    path: `${subPath}/q-101-998901234567-${yyyy}${mm}${dd}-103015-172525.wav`,
                    type: 'file',
                    size: 1452800,
                    sizeFormatted: '1.38 MB',
                    modifyTime: Date.now() - 1000 * 60 * 30,
                    url: '#'
                },
                {
                    name: `out-102-998933334455-${yyyy}${mm}${dd}-104200-172526.wav`,
                    path: `${subPath}/out-102-998933334455-${yyyy}${mm}${dd}-104200-172526.wav`,
                    type: 'file',
                    size: 890400,
                    sizeFormatted: '869 KB',
                    modifyTime: Date.now() - 1000 * 60 * 18,
                    url: '#'
                },
                {
                    name: `in-103-998977778899-${yyyy}${mm}${dd}-105510-172527.wav`,
                    path: `${subPath}/in-103-998977778899-${yyyy}${mm}${dd}-105510-172527.wav`,
                    type: 'file',
                    size: 2340500,
                    sizeFormatted: '2.23 MB',
                    modifyTime: Date.now() - 1000 * 60 * 5,
                    url: '#'
                }
            ]
        };
    }
}

module.exports = new SftpService();
