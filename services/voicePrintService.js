/**
 * Voice Print Identification Service
 * Saqlangan audio tahlillari (ECAPA-TDNN) natijalarini boshqarish va CDR yozuvlariga biriktirish xizmati
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'voice_identifications.json');

class VoicePrintService {
    constructor() {
        this.cache = new Map(); // key: recording / uniqueid / caller_time -> info
        this.lastMtime = 0;
        this.load();
    }

    checkReload() {
        try {
            if (fs.existsSync(DB_FILE)) {
                const stat = fs.statSync(DB_FILE);
                if (stat.mtimeMs > this.lastMtime) {
                    this.load();
                }
            }
        } catch (e) {}
    }

    load() {
        try {
            if (fs.existsSync(DB_FILE)) {
                this.lastMtime = fs.statSync(DB_FILE).mtimeMs;
                const raw = fs.readFileSync(DB_FILE, 'utf8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this.cache.clear();
                    for (const item of data) {
                        this.indexItem(item);
                    }
                }
            } else {
                this.importFromBatchReport();
            }
        } catch (e) {
            console.error('⚠️ VoicePrintService load xatolik:', e.message);
        }
    }

    importFromBatchReport() {
        const scratchFile = path.join(__dirname, '..', 'scratch', 'batch_scan_report.json');
        if (!fs.existsSync(scratchFile)) return;

        try {
            const raw = fs.readFileSync(scratchFile, 'utf8');
            const list = JSON.parse(raw);
            const items = [];

            for (const item of list) {
                const isZuhra = item.is_zuhra_detected || item.zuhra_match_count >= 2 || item.max_zuhra_score >= 0.53;
                const recName = item.file || '';
                const uidMatch = recName.match(/(\d+\.\d+)/);
                const uniqueid = uidMatch ? uidMatch[1] : '';

                const entry = {
                    file: recName,
                    uniqueid: uniqueid,
                    caller_id: item.src || '',
                    calldate: item.calldate || '',
                    duration: item.billsec || 0,
                    speaker: isZuhra ? 'zuhra' : 'muattar',
                    speaker_name: isZuhra ? 'Zuhra opa' : 'Muattar',
                    score: item.max_zuhra_score || 0,
                    zuhra_segments: item.zuhra_match_count || 0,
                    confidence: Math.round((item.max_zuhra_score || 0) * 100),
                    top_segments: item.top_segments ? item.top_segments.slice(0, 3) : []
                };
                items.push(entry);
                this.indexItem(entry);
            }

            fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2), 'utf8');
            console.log(`✅ VoicePrintService: ${items.length} ta tahlil saqlandi -> data/voice_identifications.json`);
        } catch (e) {
            console.error('⚠️ VoicePrintService import xatolik:', e.message);
        }
    }

    indexItem(entry) {
        if (!entry) return;
        if (entry.file) {
            this.cache.set(entry.file.toLowerCase(), entry);
            const base = entry.file.replace(/\.wav$/i, '').toLowerCase();
            this.cache.set(base, entry);
        }
        if (entry.uniqueid) {
            this.cache.set(entry.uniqueid, entry);
        }
        if (entry.caller_id && entry.calldate) {
            const cleanDate = String(entry.calldate).split('.')[0].trim();
            this.cache.set(`${entry.caller_id}_${cleanDate}`, entry);
        }
    }

    findAnalysis(call) {
        if (!call) return null;
        this.checkReload();

        if (call.recording) {
            const recLower = String(call.recording).toLowerCase().trim();
            const recBase = recLower.replace(/\.wav$/i, '');
            if (this.cache.has(recLower)) return this.cache.get(recLower);
            if (this.cache.has(recBase)) return this.cache.get(recBase);

            for (const [key, val] of this.cache.entries()) {
                if (key.includes(recBase) || recLower.includes(key)) {
                    return val;
                }
            }
        }

        if (call.id && this.cache.has(String(call.id))) {
            return this.cache.get(String(call.id));
        }

        if (call.callerId && call.time) {
            const cleanDate = String(call.time).split('.')[0].trim();
            const key = `${call.callerId}_${cleanDate}`;
            if (this.cache.has(key)) return this.cache.get(key);
        }

        return null;
    }

    getAll() {
        this.checkReload();
        const uniqueEntries = new Set();
        for (const val of this.cache.values()) {
            uniqueEntries.add(val);
        }
        return Array.from(uniqueEntries);
    }

    /**
     * Speaker (zuhra / muattar) bo'yicha tezkor sahifalangan ro'yxat (Asteriskni og'ir so'rov bilan yuklamaydi)
     */
    getCallsBySpeaker(speaker, page = 1, limit = 20, search = '') {
        const all = this.getAll();
        let filtered = all.filter(item => {
            if (speaker && speaker !== 'all' && item.speaker !== speaker) return false;
            if (search) {
                const s = search.toLowerCase();
                const mCaller = String(item.caller_id || '').toLowerCase().includes(s);
                const mFile = String(item.file || '').toLowerCase().includes(s);
                if (!mCaller && !mFile) return false;
            }
            return true;
        });

        // Sanasi bo'yicha eng yangilari tepada
        filtered.sort((a, b) => new Date(b.calldate || 0) - new Date(a.calldate || 0));

        const total = filtered.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const offset = (Math.max(1, page) - 1) * limit;
        const pageItems = filtered.slice(offset, offset + limit);

        const data = pageItems.map(item => ({
            id: item.uniqueid || item.file,
            time: item.calldate,
            callerId: item.caller_id,
            operator: `${item.speaker_name || (item.speaker === 'zuhra' ? 'Zuhra opa' : 'Muattar')} (119)`,
            operatorExten: '119',
            direction: 'inbound',
            duration: item.duration || 1800,
            waitSec: 0,
            status: 'ANSWERED',
            hangupParty: 'Mijoz',
            recording: item.file,
            voiceAnalysis: {
                speaker: item.speaker,
                speaker_name: item.speaker_name,
                score: item.score,
                zuhra_segments: item.zuhra_segments,
                confidence: item.confidence
            }
        }));

        return {
            total,
            page: Math.min(page, totalPages),
            totalPages,
            limit,
            data
        };
    }

    addOrUpdate(entry) {
        this.indexItem(entry);
        const all = this.getAll();
        fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2), 'utf8');
    }

    /**
     * AI xato aniqlagan qo'ng'iroqni qo'lda boshqa operatorga (zuhra <-> muattar) o'tkazish
     */
    updateSpeaker(file, newSpeaker) {
        if (!file || !newSpeaker) return null;
        this.checkReload();
        const cleanFile = path.basename(file).toLowerCase();
        let target = null;

        for (const val of this.cache.values()) {
            if (val && val.file && path.basename(val.file).toLowerCase() === cleanFile) {
                target = val;
                break;
            }
        }

        if (!target) return null;

        target.speaker = newSpeaker === 'zuhra' ? 'zuhra' : 'muattar';
        target.speaker_name = target.speaker === 'zuhra' ? 'Zuhra opa' : 'Muattar';
        target.is_manual_override = true;
        target.updated_at = new Date().toISOString();

        // Indeksni va faylni yangilash
        this.indexItem(target);
        const all = this.getAll();
        fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2), 'utf8');
        return target;
    }

    /**
     * Qo'ng'iroqni eshitib tekshirilgan (galochka) deb belgilash yoki bekor qilish
     */
    toggleVerified(file, isVerified = null) {
        if (!file) return null;
        this.checkReload();
        const cleanFile = path.basename(file).toLowerCase();
        let target = null;

        for (const val of this.cache.values()) {
            if (val && val.file && path.basename(val.file).toLowerCase() === cleanFile) {
                target = val;
                break;
            }
        }

        if (!target) return null;

        if (typeof isVerified === 'boolean') {
            target.is_verified = isVerified;
        } else {
            target.is_verified = !target.is_verified;
        }
        target.verified_at = target.is_verified ? new Date().toISOString() : null;

        this.indexItem(target);
        const all = this.getAll();
        fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2), 'utf8');
        return target;
    }
}

module.exports = new VoicePrintService();
