const SftpClient = require('ssh2-sftp-client');
const config = require('../config');
const path = require('path');
const fs = require('fs');

class SftpService {
    constructor() {
        this.sftp = new SftpClient();
        this.isConnected = false;
        this.isConnecting = false;
        this.onStatusChange = null;
        this.healthCheckTimer = null;

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
                            url: `/api/recordings/stream?file=${encodeURIComponent(path.posix.join(subPath, item.name))}`
                        });
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
                    const range = req.headers.range;
                    const contentType = fullPath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';

                    if (range) {
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                        const chunksize = (end - start) + 1;

                        res.writeHead(206, {
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': chunksize,
                            'Content-Type': contentType,
                        });

                        const stream = this.sftp.createReadStream(fullPath, { start, end });
                        stream.pipe(res);
                    } else {
                        res.writeHead(200, {
                            'Content-Length': fileSize,
                            'Content-Type': contentType,
                        });
                        const stream = this.sftp.createReadStream(fullPath);
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

    formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
                    { name: `${yyyy}`, path: `${yyyy}`, type: 'directory', modifyTime: Date.now() },
                    { name: `${yyyy - 1}`, path: `${yyyy - 1}`, type: 'directory', modifyTime: Date.now() - 86400000 * 30 }
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
                    { name: `${mm}`, path: `${yyyy}/${mm}`, type: 'directory', modifyTime: Date.now() },
                    { name: '08', path: `${yyyy}/08`, type: 'directory', modifyTime: Date.now() - 86400000 * 5 }
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
                    { name: `${dd}`, path: `${yyyy}/${mm}/${dd}`, type: 'directory', modifyTime: Date.now() },
                    { name: String(Number(dd) - 1).padStart(2, '0'), path: `${yyyy}/${mm}/${String(Number(dd) - 1).padStart(2, '0')}`, type: 'directory', modifyTime: Date.now() - 86400000 }
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
