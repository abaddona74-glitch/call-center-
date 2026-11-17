/**
 * Speech-to-Text (STT) Service for Call Center
 * Translates call recordings into Uzbek text on-demand using Uzbek Wav2Vec2 AI model.
 * Caches transcriptions in SQLite database (callcenter.db) for instant retrieval.
 * Employs Gemini AI for contextual auto-fix and continuously trains local dictionary.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const sftpService = require('./sftpService');
const sttCleanerService = require('./sttCleanerService');
const geminiService = require('./geminiService');

class SttService {
    constructor() {
        const dbDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const dbPath = path.join(dbDir, 'callcenter.db');
        this.db = new DatabaseSync(dbPath);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 10000;
        `);

        this.initSchema();

        this.callsDir = path.join(__dirname, '..', 'scratch', 'calls');
        if (!fs.existsSync(this.callsDir)) {
            fs.mkdirSync(this.callsDir, { recursive: true });
        }

        // Active transcription locks to prevent parallel duplicate runs on the same call
        this.activeJobs = new Map();
    }

    initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS call_transcriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                call_key TEXT UNIQUE,
                recording_file TEXT,
                caller_id TEXT,
                duration_sec REAL,
                transcription TEXT,
                formatted_transcription TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_transcribe_key ON call_transcriptions(call_key);
            CREATE INDEX IF NOT EXISTS idx_transcribe_rec ON call_transcriptions(recording_file);
        `);

        try {
            this.db.exec(`ALTER TABLE call_transcriptions ADD COLUMN formatted_transcription TEXT;`);
        } catch (e) {
            // Column already exists
        }
    }

    getPythonPath() {
        if (process.platform === 'win32') {
            const winDefault = 'C:\\Users\\User\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
            if (fs.existsSync(winDefault)) return winDefault;
            return 'python';
        }
        return 'python3';
    }

    /**
     * Get cached transcription by callKey or recording file
     */
    getCached(callKey, recFile, callerId, duration) {
        try {
            let row = null;
            if (callKey) {
                const stmt = this.db.prepare('SELECT transcription, formatted_transcription, duration_sec, created_at FROM call_transcriptions WHERE call_key = ? OR call_key LIKE ? LIMIT 1');
                row = stmt.get(callKey, `${callKey}%`);
            }
            if (!row && recFile) {
                const baseRec = path.basename(recFile);
                if (baseRec && baseRec.length > 3) {
                    const stmt = this.db.prepare('SELECT transcription, formatted_transcription, duration_sec, created_at FROM call_transcriptions WHERE recording_file LIKE ? LIMIT 1');
                    row = stmt.get(`%${baseRec}%`);
                }
            }
            if (!row && callerId) {
                const cleanCaller = String(callerId).replace(/[^0-9]/g, '');
                const dur = Number(duration) || 0;
                if (dur > 0 && cleanCaller) {
                    const stmt = this.db.prepare('SELECT transcription, formatted_transcription, duration_sec, created_at FROM call_transcriptions WHERE (caller_id = ? OR caller_id LIKE ?) AND ABS(duration_sec - ?) <= 4 LIMIT 1');
                    row = stmt.get(cleanCaller, `%${cleanCaller}%`, dur);
                }
                if (!row && cleanCaller) {
                    const stmt = this.db.prepare('SELECT transcription, formatted_transcription, duration_sec, created_at FROM call_transcriptions WHERE caller_id = ? OR caller_id LIKE ? ORDER BY id DESC LIMIT 1');
                    row = stmt.get(cleanCaller, `%${cleanCaller}%`);
                }
            }

            if (row && row.transcription) {
                const raw = row.transcription;
                const text = row.formatted_transcription || sttCleanerService.clean(raw);
                return {
                    success: true,
                    text: text,
                    rawText: raw,
                    duration: row.duration_sec,
                    cached: true
                };
            }
        } catch (e) {
            console.error('STT getCached xatosi:', e.message);
        }
        return null;
    }

    /**
     * Get all cached transcriptions for instant client-side lookup & badges
     */
    getAllTranscribed(limit = 5000) {
        try {
            const stmt = this.db.prepare(`
                SELECT call_key, recording_file, caller_id, duration_sec,
                       SUBSTR(COALESCE(NULLIF(formatted_transcription, ''), transcription), 1, 140) AS snippet,
                       created_at
                FROM call_transcriptions
                ORDER BY id DESC
                LIMIT ?
            `);
            return stmt.all(limit) || [];
        } catch (e) {
            console.error('STT getAllTranscribed xatosi:', e.message);
            return [];
        }
    }

    /**
     * Save transcription to SQLite cache
     */
    saveToCache(callKey, recFile, callerId, durationSec, rawText, formattedText) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO call_transcriptions (call_key, recording_file, caller_id, duration_sec, transcription, formatted_transcription, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(call_key) DO UPDATE SET
                    transcription = excluded.transcription,
                    formatted_transcription = excluded.formatted_transcription,
                    duration_sec = excluded.duration_sec,
                    created_at = excluded.created_at
            `);
            stmt.run(callKey, recFile || '', callerId || '', durationSec || 0, rawText, formattedText || '');
        } catch (e) {
            console.error('STT saveToCache xatosi:', e.message);
        }
    }

    /**
     * Save manual edit from user into SQLite cache
     */
    saveManualTranscription(callKey, recFile, formattedText) {
        try {
            let row = null;
            if (callKey) {
                const stmt = this.db.prepare('SELECT id FROM call_transcriptions WHERE call_key = ? LIMIT 1');
                row = stmt.get(callKey);
            }
            if (!row && recFile) {
                const baseRec = path.basename(recFile);
                const stmt = this.db.prepare('SELECT id FROM call_transcriptions WHERE recording_file LIKE ? LIMIT 1');
                row = stmt.get(`%${baseRec}%`);
            }
            if (row) {
                const updateStmt = this.db.prepare('UPDATE call_transcriptions SET formatted_transcription = ?, created_at = datetime(\'now\') WHERE id = ?');
                updateStmt.run(formattedText, row.id);
                return { success: true };
            }
            return { success: false, error: 'Qo\'ng\'iroq transkripsiyasi topilmadi' };
        } catch (e) {
            console.error('STT saveManualTranscription xatosi:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Download audio file from PBX via SFTP if not already available locally
     */
    async ensureLocalAudio(recFile, callerId, duration) {
        let targetRec = recFile;
        if (!targetRec && callerId) {
            try {
                const audioIndexService = require('./audioIndexService');
                const fast = audioIndexService.fastFindAudio(callerId, duration || 0);
                if (fast && fast.found && fast.recording) {
                    targetRec = fast.recording;
                }
            } catch (e) {}
            if (!targetRec) {
                try {
                    const issabelDbService = require('./issabelDbService');
                    const rows = await issabelDbService.getCalls({ search: callerId, limit: 10 });
                    const match = rows && rows.find(r => r.recording && r.recording.length > 0);
                    if (match && match.recording) {
                        targetRec = match.recording;
                    }
                } catch (e) {}
            }
        }
        if (!targetRec) return null;

        const baseName = path.basename(targetRec);
        const localCandidate = path.join(this.callsDir, baseName.endsWith('.wav') ? baseName : baseName + '.wav');

        if (fs.existsSync(localCandidate) && fs.statSync(localCandidate).size > 44) {
            return localCandidate;
        }

        // SFTP orqali yuklab olish
        try {
            const connected = await sftpService.connect();
            if (!connected) return null;

            const resolved = await sftpService.resolveRemoteAudioPath(targetRec);
            if (!resolved || !resolved.fullPath) return null;

            console.log(`[STT] Audio yuklab olinmoqda: ${resolved.fullPath} -> ${localCandidate}`);
            await sftpService.sftp.fastGet(resolved.fullPath, localCandidate);

            if (fs.existsSync(localCandidate) && fs.statSync(localCandidate).size > 44) {
                return localCandidate;
            }
        } catch (e) {
            console.error('[STT] ensureLocalAudio xatosi:', e.message);
        }
        return null;
    }

    /**
     * Process raw text through AI & Self-learning vocabulary dictionary
     */
    async cleanAndLearn(rawText) {
        if (!rawText || typeof rawText !== 'string') return '';

        if (geminiService.isAvailable()) {
            try {
                console.log('[STT] Gemini AI orqali tozalash va lug\'atni o\'qitish boshlandi...');
                const aiRes = await geminiService.cleanAndLearn(rawText);
                if (aiRes.success && aiRes.formattedText) {
                    if (Array.isArray(aiRes.vocabularyPairs) && aiRes.vocabularyPairs.length > 0) {
                        sttCleanerService.learnPairs(aiRes.vocabularyPairs);
                    }
                    return aiRes.formattedText;
                }
                console.warn('[STT] Gemini javob bermadi, lokal lug\'at ishlatiladi:', aiRes.error);
            } catch (aiErr) {
                console.error('[STT] Gemini xatosi:', aiErr.message);
            }
        }

        // Fallback to internal self-learning dictionary
        return sttCleanerService.clean(rawText);
    }

    /**
     * Main on-demand transcribe method
     */
    async transcribe(params) {
        let { recFile, callerId, duration, callKey: clientKey } = params || {};

        // Agar recFile bo'sh bo'lsa, audioIndexService yoki issabelDbService dan topish
        if (!recFile && callerId) {
            try {
                const audioIndexService = require('./audioIndexService');
                const fast = audioIndexService.fastFindAudio(callerId, duration || 0);
                if (fast && fast.found && fast.recording) {
                    recFile = fast.recording;
                }
            } catch (e) {}
            if (!recFile) {
                try {
                    const issabelDbService = require('./issabelDbService');
                    const rows = await issabelDbService.getCalls({ search: callerId, limit: 10 });
                    const match = rows && rows.find(r => r.recording && r.recording.length > 0);
                    if (match && match.recording) {
                        recFile = match.recording;
                    }
                } catch (e) {}
            }
        }

        const callKey = clientKey || `${callerId || 'unknown'}_${duration || 0}_${path.basename(recFile || '')}`;

        // 1. Check SQLite Cache first
        const cached = this.getCached(callKey, recFile, callerId, duration);
        if (cached) {
            return { ...cached, recFile };
        }

        // 2. Prevent duplicate concurrent runs for the same call
        if (this.activeJobs.has(callKey)) {
            return await this.activeJobs.get(callKey);
        }

        const jobPromise = (async () => {
            try {
                // Ensure audio is on disk
                const localPath = await this.ensureLocalAudio(recFile, callerId, duration);
                if (!localPath) {
                    return {
                        success: false,
                        error: "Audio fayl topilmadi yoki yuklab olinmadi (suhbat bo'lmagan bo'lishi mumkin)."
                    };
                }

                // Run python transcription
                const pyExe = this.getPythonPath();
                const scriptPath = path.join(__dirname, '..', 'scripts', 'transcribe_single.py');

                const result = await new Promise((resolve) => {
                    const proc = spawn(pyExe, [scriptPath, localPath], {
                        cwd: path.join(__dirname, '..'),
                        stdio: ['ignore', 'pipe', 'pipe']
                    });

                    let stdout = '';
                    let stderr = '';

                    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
                    proc.stderr.on('data', d => { stderr += d.toString('utf8'); });

                    const maxWaitMs = Math.max(300000, Math.min(1800000, Math.round((duration || 60) * 1500)));
                    const timer = setTimeout(() => {
                        try { proc.kill('SIGTERM'); } catch (e) {}
                        resolve({ success: false, error: `Transkripsiya vaqti tugadi (timeout ${Math.round(maxWaitMs/1000)}s)` });
                    }, maxWaitMs);

                    proc.on('close', code => {
                        clearTimeout(timer);
                        if (code !== 0 && !stdout.trim()) {
                            resolve({ success: false, error: stderr.trim() || `Python xatosi (code ${code})` });
                            return;
                        }
                        try {
                            const parsed = JSON.parse(stdout.trim());
                            resolve(parsed);
                        } catch (parseErr) {
                            resolve({ success: false, error: `Natijani o'qib bo'lmadi: ${stdout.slice(0, 200)}` });
                        }
                    });

                    proc.on('error', err => {
                        clearTimeout(timer);
                        resolve({ success: false, error: `Jarayonni boshlashda xatolik: ${err.message}` });
                    });
                });

                if (result.success && result.text) {
                    const raw = result.text;
                    result.rawText = raw;

                    // AI cleaning + auto-learning vocabulary
                    const formatted = await this.cleanAndLearn(raw);
                    result.text = formatted;

                    this.saveToCache(callKey, recFile, callerId, result.duration_sec || duration, raw, formatted);
                    result.cached = false;
                }

                if (result) {
                    result.recFile = recFile || '';
                }
                return result;
            } finally {
                this.activeJobs.delete(callKey);
            }
        })();

        this.activeJobs.set(callKey, jobPromise);
        return await jobPromise;
    }
}

module.exports = new SttService();
