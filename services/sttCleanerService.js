/**
 * STT Text Cleaner and Normalizer for Call Center
 * Translates phonetic/acoustic errors of Uzbek Wav2Vec2 into normalized,
 * domain-accurate call center text (Unicon-Soft, EDO, AnyDesk, E-IMZO, etc.).
 *
 * Self-learning engine:
 * Stores and applies automatically learned vocabulary pairs from AI model
 * so the local dictionary continuously improves without external dependencies.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class SttCleanerService {
    constructor() {
        const dbDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        const dbPath = path.join(dbDir, 'callcenter.db');
        this.db = new DatabaseSync(dbPath);
        this.initDb();

        this.customRulesFile = path.join(__dirname, '..', 'data', 'stt_custom_rules.json');
        this.customRules = [];
        this.learnedRules = [];
        this.loadCustomRules();
        this.loadLearnedRules();

        // Built-in high-precision dictionary & phonetics normalization
        this.builtinRules = [
            // 1. Greetings & Etiquette
            { pattern: /\b(alo\s+|alaa\s+)?(sovaliko|somilikom|samsisaovaliko|assalomaleykum|assalomu\s*aleykum|salomaleykum|salomale[k|y]um)\b/gi, replace: 'Alo, assalomu alaykum' },
            { pattern: /\b(yaxshimis[a|i]la|yaxshimisizlar)\b/gi, replace: 'yaxshimisizlar' },
            { pattern: /\b(salomat\s*bo[‘']?ling|salomatboling)\b/gi, replace: "salomat bo'ling" },
            { pattern: /\br[a|o]xm[a|o]t(\s*d?i?\s*o?)?\b/gi, replace: 'rahmat' },
            { pattern: /\b(humm?at|hizmat)\b/gi, replace: 'xizmat' },
            { pattern: /\b(eshitamaormelak|ishitamaormelak|ishitama|teshtama|eshtosmi|eshitama|ole\s+alasanikon\s+arsimisa)\b/gi, replace: 'eshitaman' },

            // 2. Organization, Roles & Brands
            { pattern: /\b(unikonsovtan|unikon\s*softdan)\b/gi, replace: "Unicon-Soft'dan" },
            { pattern: /\b(yokonsos|yokon\s*soft|yunikan\s*soft|yunikon\s*soft|yunkonsoft)\b/gi, replace: 'Unicon-Soft' },
            { pattern: /\b(prizotinchyapikatr|apiratr|apirator|opirator)\b/gi, replace: 'operator' },
            { pattern: /\b(boshqsobchitib\s*yosib\s*qo[‘']?yinar|bosh\s*hisobchi\s*deb\s*yozib\s*qo[‘']?ying)\b/gi, replace: "Bosh hisobchi deb yozib qo'ying" },
            { pattern: /\b(bosh\s*qsobchini\s*o[‘']?zi\s*borakan|bosh\s*hisobchining\s*o[‘']?zi\s*bor\s*ekan)\b/gi, replace: "Bosh hisobchining o'zi bor ekan" },
            { pattern: /\bo[‘']?rinbosari\s*bo\b/gi, replace: "o'rinbosari bo'ladimi?" },
            { pattern: /\b(o[‘']?zbek\s*tonfoishtasina|o[‘']?zbekiston\s*poshtasisi|uzbekiston\s*poshtasi)\b/gi, replace: "O'zbekiston pochtasi" },
            { pattern: /\b(o[‘']?zbekistablik\s*texnologyaligi|axborot\s*texnologiyalari)\b/gi, replace: "Axborot texnologiyalari" },

            // 3. Systems & Software (EDO, Ijro.uz, E-IMZO, Remote Desktop)
            { pattern: /\b(enitiskorqalik|enitisk\s*orqali|anidesk\s*orqali)\b/gi, replace: 'AnyDesk orqali' },
            { pattern: /\b(enina\s*idek|enitisk|enidisk|anidesk|anidisk)\b/gi, replace: 'AnyDesk' },
            { pattern: /\b(timviyer|timvyur|timviver)\b/gi, replace: 'TeamViewer' },
            { pattern: /\b(medok\s*programasli|medok\s*dasturi|edo\s*programmasi)\b/gi, replace: 'EDO dasturi' },
            { pattern: /\b(medok|edo|edoni|edodan)\b/gi, replace: 'EDO' },
            { pattern: /\b(ijroboru|ijro\s*bor|ijro\s*uz)\b/gi, replace: 'Ijro.uz' },
            { pattern: /\b(uskript|eskript|eimzo|e-imzo)\b/gi, replace: 'E-IMZO' },
            { pattern: /\b(yengi\s*vertosini|yangi\s*versiyasini|yengi\s*versiyasini)\b/gi, replace: 'yangi versiyasini' },
            { pattern: /\b(ustonovga|ustanovka|ustanovga\s*qilinlidiu?)\b/gi, replace: "o'rnatildi (ustanovka)" },
            { pattern: /\b(ustonovga\s*qista)\b/gi, replace: "o'rnatilganda" },

            // 4. Digital Signature & Call Actions
            { pattern: /\btelefon\s*qootgandim(esh)?\b/gi, replace: "telefon qilayotgandim, eshitaman" },
            { pattern: /\b(sigi\s+odam|sizga\s+odam)\s*qo[‘']?sh\s*berishkirimaa?\b/gi, replace: "sizga xodim qo'shib berish kerakmi?" },
            { pattern: /\b(ushtay|uchta)\s*xodim\s*qo[‘']?sh\s*beish\s*kereydihaa?\b/gi, replace: "uchta xodim qo'shib berish kerak edi, ha" },
            { pattern: /\bkabinetga\s*dusupiz\s*bora?\b/gi, replace: "kabinetga dostupingiz bormi?" },
            { pattern: /\bkabinetki\s*dotkipimn\s*borlekkan\b/gi, replace: "kabinetga dostupim bor, lekin" },
            { pattern: /\bfoydalani\s*sqoshitib\s*sam\b/gi, replace: "foydalanuvchi qo'shishda" },
            { pattern: /\baniqa\s*ism\s*famiilla\s*a\s*yozadigan\s*joyiga\b/gi, replace: "ism-familiya yozadigan joyiga" },
            { pattern: /\byozbum\s*ayptipa\b/gi, replace: "yozib bo'lmayapti" },
            { pattern: /\bbo[‘']?ldi\s*hos\s*hoz\s*aloqada\s*qottiring\b/gi, replace: "bo'ldi, hozir aloqada qolib turing" },
            { pattern: /\bpo[‘']?sh\s*bera\s*akam\s*om\b/gi, replace: "qo'shib beraman" },
            { pattern: /\bpasportinitashigalar\s*esat\b/gi, replace: "pasportini tashlagan bo'lsangiz" },
            { pattern: /\bushalan\s*qo[‘']?kashkerak\b/gi, replace: "o'shalarni qo'shish kerak" },
            { pattern: /\bbirinchipasporttashagansiz\b/gi, replace: "birinchi pasport tashlagansiz" },
            { pattern: /\bnima\s*lavozim\s*qo[‘']?yberish\s*kerakbola\b/gi, replace: "qanday lavozim qo'yib berish kerak bo'ladi?" },
            { pattern: /\b(imzolomiyanma|imzolamayapti|imzoli\s*bo[‘']?miyapti)\b/gi, replace: "imzolamayapti" },
            { pattern: /\b(telefoniyaliga|telefoniyaga)\b/gi, replace: "telefoniya" },
            { pattern: /\b(buyrug[‘']?imizi|buyrug[‘']?imizni)\b/gi, replace: "buyrug'imizni" },
            { pattern: /\bjoyladikdibuyru\b/gi, replace: "joyladik. Buyruq" },
            { pattern: /\bpuyruvni\s*so[‘']?zini\b/gi, replace: "buyruq so'zini" },
            { pattern: /\bbuyrun\s*tepasi\b/gi, replace: "buyruqning tepasi" },
            { pattern: /\bbuyru\s*noma\b/gi, replace: "buyruq nomeri" },
            { pattern: /\bbuyru\b/gi, replace: "buyruq" },
            { pattern: /\bikki\s*varodan\b/gi, replace: "ikki varoqdan" },
            { pattern: /\byiborat\b/gi, replace: "iborat" },
            { pattern: /\bikkinchi\s*varogampiamiyi\b/gi, replace: "ikkinchi varog'i ham" },
            { pattern: /\bikkinchi\s*barrogan\b/gi, replace: "ikkinchi varoqqa" },
            { pattern: /\bikkinci\s*varodi\b/gi, replace: "ikkinchi varog'i" },
            { pattern: /\btushibi\s*oatidi\b/gi, replace: "tushib qolyapti" },
            { pattern: /\btahrilab\s*ko[‘']?rmadiglamitaqirlaganndi\b/gi, replace: "tahrirlab ko'rmadinglarmi? Tahrirlaganda" },
            { pattern: /\btahrilab|taqirlagan\b/gi, replace: "tahrirlab" },
            { pattern: /\bo[‘']?chiribomayapti|o[‘']?chiribomayap\b/gi, replace: "o'chirib bo'lmayapti" },
            { pattern: /\bulan\s*shimkoni\s*barma\b/gi, replace: "ulanish imkoni bormi" },
            { pattern: /\butahaslani|mutahaslani\b/gi, replace: "mutaxassislarni" },
            { pattern: /\bverolisma\b/gi, replace: "bera olasizmi" },
            { pattern: /\bmasaxotimisverman\b/gi, replace: "maslahat beraman" },
            { pattern: /\bmasofodanturib|masofadan\s*turib\b/gi, replace: "masofadan turib" },
            { pattern: /\bazamjonazzamjona\b/gi, replace: "Azamjon" },

            // 5. Numbers & Codes (Common Uzbek phone prefixes & AnyDesk IDs)
            { pattern: /\b(buruzgetmush|buruz\s*getmush|biruz\s*yetmish|biruzgetmish)\b/gi, replace: "bir yuz yetmish" },
            { pattern: /\b(chislot\s*islo|chislo\s*islo|chislo\s*pislo)\b/gi, replace: "chislo-pislo" },
            { pattern: /\btoxsontoqoslik|to[‘']?qsonto[‘']?qqizlik\b/gi, replace: "99-lik" },
            { pattern: /\btoxsontoq[q|k]iz|to[‘']?qsonto[‘']?qqiz\b/gi, replace: "99" },
            { pattern: /\btoxsonetti|to[‘']?qsonetti\b/gi, replace: "97" },
            { pattern: /\btoxsonbir|to[‘']?qsonbir\b/gi, replace: "91" },
            { pattern: /\btoxsonuch|to[‘']?qsonuch\b/gi, replace: "93" },
            { pattern: /\btoxsontort|to[‘']?qsonto[‘']?rt\b/gi, replace: "94" },
            { pattern: /\btoxsonbesh|to[‘']?qsonbesh\b/gi, replace: "95" },
            { pattern: /\btoxsonnol|to[‘']?qsonnol\b/gi, replace: "90" }
        ];
    }

    initDb() {
        try {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS stt_learned_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    raw_word TEXT UNIQUE COLLATE NOCASE,
                    clean_word TEXT NOT NULL,
                    occurrences INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_learned_raw ON stt_learned_rules(raw_word);
            `);
            this.cleanupBadRules();
        } catch (e) {
            console.error('[SttCleaner] initDb xatosi:', e.message);
        }
    }

    cleanupBadRules() {
        try {
            // Remove corrupted long sentence fragments or bad number hallucinations
            this.db.exec(`
                DELETE FROM stt_learned_rules 
                WHERE length(raw_word) > 28 
                   OR raw_word LIKE '%buruzgetmush%' 
                   OR raw_word LIKE '%to%xson%' 
                   OR clean_word = '96233' 
                   OR clean_word = '91688';
            `);
        } catch (e) {
            console.error('[SttCleaner] cleanupBadRules xatosi:', e.message);
        }
    }

    loadLearnedRules() {
        try {
            const stmt = this.db.prepare(`
                SELECT raw_word, clean_word, occurrences 
                FROM stt_learned_rules 
                WHERE length(raw_word) >= 2 AND raw_word != clean_word
                ORDER BY length(raw_word) DESC, occurrences DESC
            `);
            const rows = stmt.all();
            this.learnedRules = rows.map(r => {
                const escaped = escapeRegex(r.raw_word.trim());
                return {
                    raw: r.raw_word,
                    clean: r.clean_word,
                    occurrences: r.occurrences,
                    pattern: new RegExp(`\\b${escaped}\\b`, 'gi')
                };
            });
            console.log(`[SttCleaner] ${this.learnedRules.length} ta o'rganilgan so'z/qoidalar yuklandi`);
        } catch (e) {
            console.error('[SttCleaner] loadLearnedRules xatosi:', e.message);
            this.learnedRules = [];
        }
    }

    /**
     * Auto-learn vocabulary pairs extracted by AI
     * @param {Array<{raw: string, clean: string}>} pairs
     */
    learnPairs(pairs) {
        if (!Array.isArray(pairs) || pairs.length === 0) return 0;

        let addedCount = 0;
        try {
            const upsertStmt = this.db.prepare(`
                INSERT INTO stt_learned_rules (raw_word, clean_word, occurrences, updated_at)
                VALUES (?, ?, 1, datetime('now'))
                ON CONFLICT(raw_word) DO UPDATE SET
                    clean_word = excluded.clean_word,
                    occurrences = stt_learned_rules.occurrences + 1,
                    updated_at = excluded.updated_at
            `);

            for (const item of pairs) {
                if (!item || !item.raw || !item.clean) continue;
                const raw = String(item.raw).trim();
                const clean = String(item.clean).trim();

                // Skip identical, too short, or meaningless items
                if (raw.toLowerCase() === clean.toLowerCase()) continue;
                if (raw.length < 2 || clean.length < 2) continue;
                // Maximum 2 words for raw phonetic term, max 28 chars
                if (raw.length > 28 || clean.length > 35) continue;
                if (raw.split(/\s+/).length > 2) continue;
                if (clean.split(/\s+/).length > 4) continue;

                upsertStmt.run(raw, clean);
                addedCount++;
            }

            if (addedCount > 0) {
                this.loadLearnedRules();
                console.log(`[SttCleaner] O'z-o'zini o'qitish: ${addedCount} ta yangi lug'at juftligi saqlandi!`);
            }
        } catch (e) {
            console.error('[SttCleaner] learnPairs xatosi:', e.message);
        }

        return addedCount;
    }

    getLearnedStats() {
        try {
            const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stt_learned_rules').get();
            const topRows = this.db.prepare(`
                SELECT raw_word, clean_word, occurrences 
                FROM stt_learned_rules 
                ORDER BY occurrences DESC, id DESC 
                LIMIT 15
            `).all();
            return {
                totalWords: (countRow && countRow.cnt) || 0,
                topWords: topRows || []
            };
        } catch (e) {
            return { totalWords: 0, topWords: [] };
        }
    }

    loadCustomRules() {
        try {
            if (fs.existsSync(this.customRulesFile)) {
                const data = JSON.parse(fs.readFileSync(this.customRulesFile, 'utf8'));
                if (Array.isArray(data)) {
                    this.customRules = data;
                }
            }
        } catch (e) {
            console.error('[SttCleaner] loadCustomRules xatosi:', e.message);
        }
    }

    saveCustomRules() {
        try {
            const dir = path.dirname(this.customRulesFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.customRulesFile, JSON.stringify(this.customRules, null, 2), 'utf8');
        } catch (e) {
            console.error('[SttCleaner] saveCustomRules xatosi:', e.message);
        }
    }

    addCustomRule(patternStr, replaceStr) {
        if (!patternStr || !replaceStr) return false;
        this.customRules.push({ pattern: patternStr, replace: replaceStr });
        this.saveCustomRules();
        return true;
    }

    /**
     * Clean and format raw STT transcription
     * @param {string} rawText 
     * @returns {string} Cleaned text
     */
    clean(rawText) {
        if (!rawText || typeof rawText !== 'string') return '';

        let text = rawText;

        // 1. Apply user custom rules first
        for (const rule of this.customRules) {
            try {
                const regex = new RegExp(rule.pattern, 'gi');
                text = text.replace(regex, rule.replace);
            } catch (e) {}
        }

        // 2. Apply automatically learned rules from SQLite database (longest words first)
        for (const rule of this.learnedRules) {
            text = text.replace(rule.pattern, rule.clean);
        }

        // 3. Apply built-in domain rules
        for (const rule of this.builtinRules) {
            text = text.replace(rule.pattern, rule.replace);
        }

        // 4. Formatting & punctuation cleanup:
        text = text.replace(/\s+/g, ' ').trim();

        const transitions = [
            'eshitaman', 'rahmat', 'anydesk',
            'masofadan turib', 'mutaxassislarni', 'maslahat beraman'
        ];
        transitions.forEach(word => {
            const re = new RegExp(`(?<![.!?]|,)\\s+(${word}\\b)`, 'gi');
            text = text.replace(re, '. $1');
        });

        text = text.replace(/([.!?])\s*([.!?])/g, '$1');
        text = text.replace(/,\s*\./g, ',');
        text = text.replace(/\.\s*,/g, '.');
        text = text.replace(/\s+([,.!?])/g, '$1');

        text = text.replace(/(^\s*|[.!?]\s+)([a-z‘'ʻ])/g, (m, p1, p2) => p1 + p2.toUpperCase());

        return text.trim();
    }
}

module.exports = new SttCleanerService();
