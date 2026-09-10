/**
 * Audio Fast-Index Service
 * Periodically scans and indexes Asterisk audio recordings from SFTP in RAM / Local Map.
 * Provides sub-millisecond lookups by caller ID, uniqueid, or filename.
 */

const sftpService = require('./sftpService');

class AudioIndexService {
    constructor() {
        // Map<callerId, Array<AudioFileEntry>> (newest first)
        this.callerIndex = new Map();
        // Map<uniqueid, AudioFileEntry>
        this.uniqueidIndex = new Map();
        // Map<filename, AudioFileEntry>
        this.filenameIndex = new Map();
        // Cache metadata
        this.lastSyncTime = 0;
        this.isSyncing = false;
        this.indexedCount = 0;
        this.todayDateStr = '';

        // Har 10 soniyada foniy indekslash
        this.startAutoSync();
    }

    getTodayPath() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}/${mm}/${dd}`;
    }

    startAutoSync() {
        const runSync = async () => {
            if (this.isSyncing) return;
            try {
                await this.syncTodayRecordings();
            } catch (e) {
                // Background quiet
            }
        };

        // Server yoqilgandan 2 soniya o'tib birinchi yuklash
        setTimeout(runSync, 2000);
        // Har 10 soniyada yangilab turish
        setInterval(runSync, 10000);
    }

    /**
     * Bugungi kun audio fayllarini SFTP dan bir marta o'qib indeksga kiritish
     */
    async syncTodayRecordings() {
        if (!sftpService.isConnected) {
            // SFTP ulanmagan bo'lsa ulanishga harakat qilamiz
            const ok = await sftpService.connect();
            if (!ok) return;
        }

        this.isSyncing = true;
        try {
            const todayPath = this.getTodayPath();
            const res = await sftpService.listDirectory(todayPath);
            if (!res || !res.files || !Array.isArray(res.files)) return;

            // Yangi indekslar tuzish
            const newCallerIndex = new Map();
            const newUniqueidIndex = new Map();
            const newFilenameIndex = new Map();

            for (const file of res.files) {
                if (file.type !== 'file' && !file.name.match(/\.(wav|mp3|gsm|WAV)$/i)) continue;

                const entry = this.parseAudioFilename(file.name, file.path, file.size, file.modifyTime);
                if (!entry) continue;

                // 1. Filename index
                newFilenameIndex.set(entry.filename.toLowerCase(), entry);

                // 2. Uniqueid index
                if (entry.uniqueid) {
                    newUniqueidIndex.set(entry.uniqueid, entry);
                }

                // 3. Caller ID index (9 ta raqamli yoki har qanday telefon raqami)
                if (entry.callerId) {
                    const cleanPhone = entry.callerId.replace(/[^0-9]/g, '');
                    if (!newCallerIndex.has(cleanPhone)) {
                        newCallerIndex.set(cleanPhone, []);
                    }
                    newCallerIndex.get(cleanPhone).push(entry);

                    // 998 bilan yoki 998 siz variantlarini ham kiritish
                    if (cleanPhone.length === 9) {
                        const full998 = `998${cleanPhone}`;
                        if (!newCallerIndex.has(full998)) newCallerIndex.set(full998, []);
                        newCallerIndex.get(full998).push(entry);
                    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('998')) {
                        const short9 = cleanPhone.slice(3);
                        if (!newCallerIndex.has(short9)) newCallerIndex.set(short9, []);
                        newCallerIndex.get(short9).push(entry);
                    }
                }
            }

            // Har bir caller bo'yicha fayllarni vaqtiga ko'ra saralash (eng oxirgisi 1-o'rinda)
            for (const list of newCallerIndex.values()) {
                list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }

            this.callerIndex = newCallerIndex;
            this.uniqueidIndex = newUniqueidIndex;
            this.filenameIndex = newFilenameIndex;
            this.lastSyncTime = Date.now();
            this.indexedCount = res.files.length;
            this.todayDateStr = todayPath;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Fayl nomini analiz qilish (Regex Parser)
     * Masalan: q-2020159-935361695-20260910-151650-1789035402.1487198.wav
     * yoki: external-101-998853802-20260910-145021-1789033821.wav
     * yoki: g101-20260910-133740-1789031860.1486300.wav
     */
    parseAudioFilename(filename, filePath, sizeBytes, modifyTime) {
        if (!filename) return null;

        let callerId = null;
        let dateStr = null;
        let timeStr = null;
        let uniqueid = null;
        let timestamp = modifyTime ? modifyTime * 1000 : 0;

        // 1. Standart Queue formati: q-2020159-935361695-20260910-151650-1789035402.1487198.wav
        const queueMatch = filename.match(/^q-[0-9]+-([0-9]{7,15})-(\d{4}\d{2}\d{2})-(\d{6})-([0-9.]+)\.wav$/i);
        if (queueMatch) {
            callerId = queueMatch[1];
            dateStr = queueMatch[2];
            timeStr = queueMatch[3];
            uniqueid = queueMatch[4];
        } else {
            // 2. External formati: external-101-998853802-20260910-...
            const extMatch = filename.match(/^(?:external|out|in)-[0-9]+-([0-9]{7,15})-(\d{8})-(\d{6})/i);
            if (extMatch) {
                callerId = extMatch[1];
                dateStr = extMatch[2];
                timeStr = extMatch[3];
            } else {
                // 3. Umumiy raqam ajratish (7-12 ta raqam)
                const phoneMatch = filename.match(/[-_]([0-9]{9,12})[-_]/);
                if (phoneMatch) {
                    callerId = phoneMatch[1];
                }
            }

            // Uniqueid ajratish (agar bor bo'lsa)
            const uidMatch = filename.match(/([0-9]{10}\.[0-9]+)/);
            if (uidMatch) {
                uniqueid = uidMatch[1];
            }
        }

        // Davomiyligini hisoblash (WAV 8000Hz, 16bit mono = 16000 bytes/sec)
        const durationSec = Math.max(0, Math.round(((sizeBytes || 0) - 44) / 16000));

        return {
            filename,
            path: filePath || filename,
            size: sizeBytes || 0,
            duration: durationSec,
            callerId,
            dateStr,
            timeStr,
            uniqueid,
            timestamp: timestamp || Date.now()
        };
    }

    /**
     * Telefon raqami bo'yicha audio faylni 0.1ms da topish!
     */
    findAudioForCaller(callerId, targetDuration = 0) {
        if (!callerId) return null;
        const clean = String(callerId).replace(/[^0-9]/g, '');
        if (!clean) return null;

        // 1. To'g'ridan-to'g'ri raqam bo'yicha tekshirish
        const list = this.callerIndex.get(clean);
        if (list && list.length > 0) {
            // Agar davomiylik berilgan bo'lsa, davomiyligi eng yaqinini tanlaymiz
            if (targetDuration > 0) {
                const sortedByDiff = [...list].sort((a, b) => {
                    const diffA = Math.abs((a.duration || 0) - targetDuration);
                    const diffB = Math.abs((b.duration || 0) - targetDuration);
                    return diffA - diffB;
                });
                return sortedByDiff[0];
            }
            // Aks holda eng oxirgi (eng yangi) faylni olamiz
            return list[0];
        }

        // 2. Qisman moslik (masalan 9 ta raqam bilan 998 li raqam)
        if (clean.length >= 9) {
            const shortPhone = clean.slice(-9);
            for (const [phone, files] of this.callerIndex.entries()) {
                if (phone.endsWith(shortPhone) && files.length > 0) {
                    return files[0];
                }
            }
        }

        return null;
    }

    /**
     * Uniqueid bo'yicha audio faylni topish
     */
    findAudioByUniqueId(uniqueid) {
        if (!uniqueid) return null;
        return this.uniqueidIndex.get(String(uniqueid).trim()) || null;
    }

    /**
     * Fayl nomi bo'yicha qidirish
     */
    findAudioByFilename(filename) {
        if (!filename) return null;
        const clean = filename.split('/').pop().toLowerCase();
        return this.filenameIndex.get(clean) || null;
    }

    getStatus() {
        return {
            indexedCount: this.indexedCount,
            uniqueCallersCount: this.callerIndex.size,
            lastSyncTime: this.lastSyncTime ? new Date(this.lastSyncTime).toISOString() : null,
            todayDate: this.todayDateStr
        };
    }
}

module.exports = new AudioIndexService();
