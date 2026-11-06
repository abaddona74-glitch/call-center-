const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const issabelDbService = require('./issabelDbService');

const ADMIN_PASSWORD = process.env.BLACKLIST_ADMIN_PASSWORD || '@Abaddon2004';

class BlacklistService {
    constructor() {
        const dbDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const dbPath = path.join(dbDir, 'callcenter.db');
        this.db = new DatabaseSync(dbPath);
        this.initSchema();
    }

    initSchema() {
        try {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS blacklist (
                    number TEXT PRIMARY KEY,
                    variants TEXT,
                    note TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
        } catch (e) {
            console.error('⚠️ Blacklist jadvalini yaratishda xatolik:', e.message);
        }
    }

    verifyPassword(password) {
        return Boolean(password && String(password).trim() === ADMIN_PASSWORD);
    }

    formatPhone(num) {
        const c = String(num || '').replace(/\D/g, '');
        if (c.length === 12 && c.startsWith('998')) {
            return `+998 (${c.slice(3, 5)}) ${c.slice(5, 8)}-${c.slice(8, 10)}-${c.slice(10, 12)}`;
        }
        if (c.length === 9) {
            return `+998 (${c.slice(0, 2)}) ${c.slice(2, 5)}-${c.slice(5, 7)}-${c.slice(7, 9)}`;
        }
        return String(num || '');
    }

    normalizeNumber(input) {
        if (!input) return null;
        let clean = String(input).trim().replace(/\D/g, '');
        if (!clean || clean.length < 3) return null;

        if (clean.length === 10 && clean.startsWith('8')) {
            clean = clean.slice(1);
        }

        let primary = clean;
        let variants = [clean];

        if (clean.length === 9) {
            primary = '998' + clean;
            variants = [clean, primary];
        } else if (clean.length === 12 && clean.startsWith('998')) {
            primary = clean;
            const short9 = clean.slice(3);
            variants = [short9, primary];
        }

        return {
            primary,
            clean,
            variants: Array.from(new Set(variants)),
            formatted: this.formatPhone(primary)
        };
    }

    async syncFromAsterisk() {
        try {
            const out = await issabelDbService.execCommand('asterisk -rx "database show blacklist_114"');
            if (!out) return;

            const lines = out.split('\n');
            const insertStmt = this.db.prepare(`
                INSERT OR IGNORE INTO blacklist (number, variants, note, created_at, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `);

            for (const line of lines) {
                const match = line.match(/^\/blacklist_114\/([^\s:]+)\s*:\s*(.*)$/);
                if (match) {
                    const rawNum = match[1].trim();
                    const note = match[2].trim();
                    const norm = this.normalizeNumber(rawNum);
                    if (norm) {
                        insertStmt.run(norm.primary, JSON.stringify(norm.variants), note || 'Asterisk 114');
                    }
                }
            }
        } catch (err) {
            console.warn('⚠️ Asterisk blacklist_114 sync ogohlantirish:', err.message);
        }
    }

    async getAll() {
        try {
            await this.syncFromAsterisk().catch(() => {});

            const rows = this.db.prepare(`
                SELECT number, variants, note, created_at, updated_at 
                FROM blacklist 
                ORDER BY created_at DESC
            `).all();

            return rows.map(r => {
                let parsedVariants = [];
                try {
                    parsedVariants = JSON.parse(r.variants || '[]');
                } catch (e) {
                    parsedVariants = [r.number];
                }
                return {
                    number: r.number,
                    formattedNumber: this.formatPhone(r.number),
                    variants: parsedVariants,
                    note: r.note || '',
                    createdAt: r.created_at,
                    updatedAt: r.updated_at
                };
            });
        } catch (err) {
            console.error('⚠️ Blacklist getAll xatolik:', err.message);
            return [];
        }
    }

    async add(rawNumber, note = '') {
        const norm = this.normalizeNumber(rawNumber);
        if (!norm) {
            throw new Error('Noto\'g\'ri telefon raqami kiritildi');
        }

        const cleanNote = String(note || '').trim().replace(/["'\\]/g, '');
        const noteForAstdb = cleanNote || '1';

        const upsertStmt = this.db.prepare(`
            INSERT INTO blacklist (number, variants, note, created_at, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(number) DO UPDATE SET
                variants = excluded.variants,
                note = excluded.note,
                updated_at = CURRENT_TIMESTAMP
        `);

        upsertStmt.run(norm.primary, JSON.stringify(norm.variants), cleanNote);

        try {
            // Faqat Maxmudbek 114 uchun blacklist_114 ga yozish, global blacklist dan o'chirish
            const cmds = norm.variants.map(v => 
                `asterisk -rx "database put blacklist_114 ${v} \\"${noteForAstdb}\\""; asterisk -rx "database del blacklist ${v}"`
            ).join('; ');
            await issabelDbService.execCommand(cmds);
            console.log(`🚫 [Blacklist-114] Qo'shildi: ${norm.formatted} (${norm.variants.join(', ')}) - Maxmudbek 114 uchun bloklandi.`);
        } catch (astErr) {
            console.error('⚠️ Asterisk AstDB ga yozishda xatolik:', astErr.message);
        }

        return {
            number: norm.primary,
            formattedNumber: norm.formatted,
            variants: norm.variants,
            note: cleanNote,
            createdAt: new Date().toISOString()
        };
    }

    async remove(rawNumber) {
        const norm = this.normalizeNumber(rawNumber);
        const searchNum = norm ? norm.primary : String(rawNumber).replace(/\D/g, '');

        let variants = norm ? norm.variants : [searchNum];
        try {
            const row = this.db.prepare(`SELECT variants FROM blacklist WHERE number = ?`).get(searchNum);
            if (row && row.variants) {
                const parsed = JSON.parse(row.variants);
                if (Array.isArray(parsed)) variants = Array.from(new Set([...variants, ...parsed]));
            }
        } catch (e) {}

        try {
            this.db.prepare(`DELETE FROM blacklist WHERE number = ?`).run(searchNum);
        } catch (e) {
            console.error('⚠️ SQLite blacklist DELETE xatolik:', e.message);
        }

        try {
            const cmds = variants.map(v => 
                `asterisk -rx "database del blacklist_114 ${v}"; asterisk -rx "database del blacklist ${v}"`
            ).join('; ');
            await issabelDbService.execCommand(cmds);
            console.log(`✅ [Blacklist-114] O'chirildi: ${searchNum} (variantlar: ${variants.join(', ')})`);
        } catch (astErr) {
            console.error('⚠️ Asterisk AstDB dan o\'chirishda xatolik:', astErr.message);
        }

        return { success: true, removedNumber: searchNum };
    }
}

module.exports = new BlacklistService();
