const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'tickets');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
if (!fs.existsSync(UPLOADS_DIR)) {
    try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}

let tickets = [];
let lastCleanedMonday = null; // YYYY-MM-DD formatida saqlanadi

function loadTickets() {
    try {
        if (fs.existsSync(TICKETS_FILE)) {
            const raw = fs.readFileSync(TICKETS_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                tickets = parsed;
            } else if (parsed && Array.isArray(parsed.tickets)) {
                tickets = parsed.tickets;
                lastCleanedMonday = parsed.lastCleanedMonday || null;
            }
        }
    } catch (e) {
        console.warn('⚠️ tickets.json yuklashda xatolik:', e.message);
        tickets = [];
    }
}

function saveTickets() {
    try {
        const payload = {
            lastCleanedMonday,
            updatedAt: Date.now(),
            total: tickets.length,
            tickets
        };
        fs.writeFileSync(TICKETS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
        console.error('❌ tickets.json saqlashda xatolik:', e.message);
    }
}

// Boshlang'ich yuklash
loadTickets();

// Helper: base64 faylni diskka yozish
function saveBase64File(base64Data, filenameHint = 'screenshot.png') {
    if (!base64Data || typeof base64Data !== 'string') return null;

    let mimeType = 'image/png';
    let rawBase64 = base64Data;

    if (base64Data.startsWith('data:')) {
        const commaIdx = base64Data.indexOf(',');
        if (commaIdx !== -1) {
            const header = base64Data.substring(0, commaIdx);
            rawBase64 = base64Data.substring(commaIdx + 1);
            const match = header.match(/data:(.*?);base64/);
            if (match && match[1]) mimeType = match[1];
        }
    }

    const hintExt = filenameHint ? path.extname(filenameHint).toLowerCase() : '';
    let ext = '.png';

    if (hintExt === '.pdf' || mimeType.includes('pdf')) {
        ext = '.pdf';
        mimeType = 'application/pdf';
    } else if (hintExt === '.docx' || mimeType.includes('wordprocessingml')) {
        ext = '.docx';
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (hintExt === '.doc' || mimeType.includes('msword')) {
        ext = '.doc';
        mimeType = 'application/msword';
    } else if (hintExt === '.txt' || mimeType.includes('plain')) {
        ext = '.txt';
        mimeType = 'text/plain';
    } else if (hintExt === '.jpg' || hintExt === '.jpeg' || mimeType.includes('jpeg') || mimeType.includes('jpg')) {
        ext = '.jpg';
        mimeType = 'image/jpeg';
    } else if (hintExt === '.webp' || mimeType.includes('webp')) {
        ext = '.webp';
        mimeType = 'image/webp';
    } else if (hintExt === '.gif' || mimeType.includes('gif')) {
        ext = '.gif';
        mimeType = 'image/gif';
    } else if (hintExt) {
        ext = hintExt;
    }

    const baseNameOnly = filenameHint ? path.basename(filenameHint, path.extname(filenameHint)) : 'file';
    const safeName = baseNameOnly.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30) || 'file';
    const uniqueFileName = `tk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${safeName}${ext}`;
    const filePath = path.join(UPLOADS_DIR, uniqueFileName);

    try {
        const buffer = Buffer.from(rawBase64, 'base64');
        fs.writeFileSync(filePath, buffer);
        return {
            name: filenameHint || uniqueFileName,
            fileName: uniqueFileName,
            url: `/uploads/tickets/${uniqueFileName}`,
            size: buffer.length,
            mimeType,
            ext,
            uploadedAt: Date.now()
        };
    } catch (err) {
        console.error('❌ Base64 faylni saqlashda xatolik:', err.message);
        return null;
    }
}

// DOC/DOCX fayllarni HTML formatga aylantirish (in-place ko'rish uchun)
async function renderDocxToHtml(filePathOrName) {
    let targetPath = filePathOrName;
    if (!path.isAbsolute(targetPath)) {
        const cleanName = path.basename(filePathOrName.split('?')[0]);
        targetPath = path.join(UPLOADS_DIR, cleanName);
    }
    if (!fs.existsSync(targetPath)) {
        throw new Error('Fayl topilmadi: ' + path.basename(targetPath));
    }
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.docx') {
        const result = await mammoth.convertToHtml({ path: targetPath });
        return {
            html: result.value || '<p class="text-muted">Hujjat bo\'sh yoki matn topilmadi.</p>',
            messages: result.messages,
            format: 'docx'
        };
    } else if (ext === '.doc') {
        try {
            const result = await mammoth.convertToHtml({ path: targetPath });
            return {
                html: result.value || '<p class="text-muted">Hujjat bo\'sh yoki matn topilmadi.</p>',
                messages: result.messages,
                format: 'doc'
            };
        } catch (e) {
            return {
                html: `<div class="doc-legacy-notice"><div class="notice-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><h3>Eski Word (.doc) formati</h3><p>Ushbu fayl eski Word 97-2003 (.doc) formatida. Brauzerda to'g'ridan-to'g'ri ko'rish uchun .docx formatiga o'tkazish tavsiya etiladi. Faylni to'liq ko'rish uchun "Yuklab olish" tugmasidan foydalanishingiz mumkin.</p></div>`,
                messages: [{ type: 'warning', message: 'Legacy .doc' }],
                format: 'doc',
                legacy: true
            };
        }
    }
    throw new Error('Faqat .docx yoki .doc fayllar ochiladi. Format: ' + ext);
}

// Yangi yuklanayotgan base64 DOC/DOCX faylni HTML ga aylantirish
async function renderDocxBase64ToHtml(base64Data, filenameHint = '') {
    if (!base64Data || typeof base64Data !== 'string') {
        throw new Error('Base64 ma\'lumot kiritilmagan');
    }
    let rawBase64 = base64Data;
    if (base64Data.startsWith('data:')) {
        const commaIdx = base64Data.indexOf(',');
        if (commaIdx !== -1) {
            rawBase64 = base64Data.substring(commaIdx + 1);
        }
    }
    const buffer = Buffer.from(rawBase64, 'base64');
    const ext = filenameHint ? path.extname(filenameHint).toLowerCase() : '.docx';
    if (ext === '.doc') {
        try {
            const result = await mammoth.convertToHtml({ buffer });
            return {
                html: result.value || '<p class="text-muted">Hujjat bo\'sh yoki matn topilmadi.</p>',
                messages: result.messages,
                format: 'doc'
            };
        } catch (e) {
            return {
                html: `<div class="doc-legacy-notice"><div class="notice-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><h3>Eski Word (.doc) formati</h3><p>Ushbu fayl eski Word 97-2003 (.doc) formatida. Brauzerda to'g'ridan-to'g'ri ko'rish uchun .docx formatiga o'tkazish tavsiya etiladi.</p></div>`,
                messages: [{ type: 'warning', message: 'Legacy .doc' }],
                format: 'doc',
                legacy: true
            };
        }
    }
    const result = await mammoth.convertToHtml({ buffer });
    return {
        html: result.value || '<p class="text-muted">Hujjat bo\'sh yoki matn topilmadi.</p>',
        messages: result.messages,
        format: 'docx'
    };
}

// Ticket ID generatsiya qilish
function generateTicketId() {
    let maxNum = 1000;
    for (const t of tickets) {
        if (t.id && t.id.startsWith('TK-')) {
            const num = parseInt(t.id.replace('TK-', ''), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        }
    }
    return `TK-${maxNum + 1}`;
}

function checkOperatorPermission(ticket, operatorId) {
    if (!ticket) return;
    const targetId = ticket.targetOperatorId;
    if (targetId && targetId !== 'all') {
        const opClean = String(operatorId || '').trim();
        const targetClean = String(targetId).trim();
        const creatorClean = String(ticket.creatorId || '').trim();
        if (opClean && opClean !== targetClean && opClean !== creatorClean && opClean !== 'admin' && opClean !== 'superuser') {
            const targetName = ticket.targetOperatorName || ticket.targetOperatorId;
            throw new Error(`Ushbu vazifa faqat "${targetName}" uchun biriktirilgan. Faqat biriktirilgan operator yoki yaratgan shaxs bajara oladi!`);
        }
    }
}

// 1. Yangi ticket yaratish
function createTicket({ creatorId, creatorName, creatorIp, customerPhone, title, comment, files, isUrgent, targetOperatorId, targetOperatorName }) {
    if (!comment && (!files || files.length === 0)) {
        throw new Error("Izoh yoki rasm kiritilishi shart");
    }

    const savedFiles = [];
    if (Array.isArray(files)) {
        for (const f of files) {
            if (f && f.base64) {
                const saved = saveBase64File(f.base64, f.name);
                if (saved) savedFiles.push(saved);
            }
        }
    }

    const cleanCreatorId = String(creatorId || '101').trim();
    const cleanCreatorName = String(creatorName || `Operator ${cleanCreatorId}`).trim();
    const cleanTargetId = targetOperatorId ? String(targetOperatorId).trim() : 'all';
    const cleanTargetName = targetOperatorName ? String(targetOperatorName).trim() : (cleanTargetId === 'all' ? 'Barcha operatorlar' : `Operator ${cleanTargetId}`);

    const newTicket = {
        id: generateTicketId(),
        creatorId: cleanCreatorId,
        creatorName: cleanCreatorName,
        creatorIp: creatorIp || '127.0.0.1',
        customerPhone: customerPhone ? String(customerPhone).trim() : null,
        title: title ? String(title).trim() : (comment ? comment.substring(0, 40) + '...' : 'Yangi ticket'),
        comment: String(comment || '').trim(),
        files: savedFiles,
        isUrgent: Boolean(isUrgent),
        targetOperatorId: cleanTargetId,
        targetOperatorName: cleanTargetName,
        status: 'pending', // 'pending' (yangi), 'in_progress' (jarayonda), 'completed' (bajarildi), 'rejected' (rad etilgan)
        acceptedBy: null, // { id, name, at }
        completedBy: null, // { id, name, at }
        rejectedBy: null, // { id, name, at, reason }
        createdAt: Date.now(),
        updatedAt: Date.now(),
        comments: []
    };

    tickets.unshift(newTicket);
    saveTickets();
    return newTicket;
}

// 1b. Ticketni tahrirlash (Faqat yaratgan shaxs yoki mas'ul)
function updateTicket(ticketId, { editorId, editorName, customerPhone, comment, isUrgent, targetOperatorId, targetOperatorName }) {
    const t = getTicketById(ticketId);
    if (!t) throw new Error("Ticket topilmadi");

    if (editorId) {
        const cleanEditorId = String(editorId).trim();
        const cleanCreatorId = String(t.creatorId || '').trim();
        if (cleanEditorId !== cleanCreatorId && cleanEditorId !== 'admin' && cleanEditorId !== 'superuser') {
            throw new Error("Ticketni faqat uni yaratgan shaxs tahrirlashi mumkin!");
        }
    }

    if (comment !== undefined && comment !== null) {
        t.comment = String(comment).trim();
        t.title = t.comment ? (t.comment.substring(0, 40) + '...') : t.title;
    }
    if (customerPhone !== undefined) {
        t.customerPhone = customerPhone ? String(customerPhone).trim() : null;
    }
    if (isUrgent !== undefined) {
        t.isUrgent = Boolean(isUrgent);
    }
    if (targetOperatorId !== undefined) {
        t.targetOperatorId = targetOperatorId ? String(targetOperatorId).trim() : 'all';
        t.targetOperatorName = targetOperatorName ? String(targetOperatorName).trim() : (t.targetOperatorId === 'all' ? 'Barcha operatorlar' : `Operator ${t.targetOperatorId}`);
    }

    t.updatedAt = Date.now();
    saveTickets();
    return t;
}

// 2. Barcha ticketlarni olish
function getTickets(filter = 'all', operatorId = null) {
    if (filter === 'mine') {
        const cleanOp = String(operatorId || '').trim();
        if (cleanOp) {
            return tickets.filter(t => String(t.targetOperatorId).trim() === cleanOp || String(t.creatorId).trim() === cleanOp);
        }
        return tickets;
    }
    if (filter === 'pending') {
        return tickets.filter(t => t.status === 'pending');
    }
    if (filter === 'in_progress') {
        return tickets.filter(t => t.status === 'in_progress');
    }
    if (filter === 'completed') {
        return tickets.filter(t => t.status === 'completed');
    }
    if (filter === 'rejected') {
        return tickets.filter(t => t.status === 'rejected');
    }
    return tickets;
}

// 3. ID bo'yicha bitta ticketni olish
function getTicketById(ticketId) {
    return tickets.find(t => t.id === ticketId) || null;
}

// 4. Ticketni qabul qilish (Operator qabul qildi)
function acceptTicket(ticketId, { operatorId, operatorName }) {
    const t = getTicketById(ticketId);
    if (!t) throw new Error("Ticket topilmadi");

    checkOperatorPermission(t, operatorId);

    t.status = 'in_progress';
    t.acceptedBy = {
        id: String(operatorId || '101').trim(),
        name: String(operatorName || `Operator ${operatorId || '101'}`).trim(),
        at: Date.now()
    };
    t.updatedAt = Date.now();
    saveTickets();
    return t;
}

// 5. Ticketni bajarildi deb belgilash
function completeTicket(ticketId, { operatorId, operatorName }) {
    const t = getTicketById(ticketId);
    if (!t) throw new Error("Ticket topilmadi");

    checkOperatorPermission(t, operatorId);

    t.status = 'completed';
    t.completedBy = {
        id: String(operatorId || (t.acceptedBy ? t.acceptedBy.id : '101')).trim(),
        name: String(operatorName || (t.acceptedBy ? t.acceptedBy.name : 'Operator')).trim(),
        at: Date.now()
    };
    t.updatedAt = Date.now();
    saveTickets();
    return t;
}

// 5b. Ticketni rad etish (status: rejected)
function rejectTicket(ticketId, { operatorId, operatorName, reason } = {}) {
    const t = getTicketById(ticketId);
    if (!t) throw new Error("Ticket topilmadi");

    checkOperatorPermission(t, operatorId);

    t.status = 'rejected';
    t.rejectedBy = {
        id: String(operatorId || (t.acceptedBy ? t.acceptedBy.id : '101')).trim(),
        name: String(operatorName || (t.acceptedBy ? t.acceptedBy.name : 'Operator')).trim(),
        reason: reason ? String(reason).trim() : null,
        at: Date.now()
    };
    t.updatedAt = Date.now();
    saveTickets();
    return t;
}

// 6. Ticketga qayta javob / izoh / yangi screenshot qo'shish (Ichki chat)
function addTicketComment(ticketId, { operatorId, operatorName, text, files }) {
    const t = getTicketById(ticketId);
    if (!t) throw new Error("Ticket topilmadi");

    const savedFiles = [];
    if (Array.isArray(files)) {
        for (const f of files) {
            if (f && f.base64) {
                const saved = saveBase64File(f.base64, f.name);
                if (saved) savedFiles.push(saved);
            }
        }
    }

    if (!text && savedFiles.length === 0) {
        throw new Error("Izoh matni yoki fayl bo'lishi lozim");
    }

    const commentObj = {
        id: `cm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        operatorId: String(operatorId || '101').trim(),
        operatorName: String(operatorName || `Operator ${operatorId || '101'}`).trim(),
        text: String(text || '').trim(),
        files: savedFiles,
        createdAt: Date.now()
    };

    if (!Array.isArray(t.comments)) t.comments = [];
    t.comments.push(commentObj);
    t.updatedAt = Date.now();
    saveTickets();
    return { ticket: t, comment: commentObj };
}

// 7. Ticketni o'chirish
function deleteTicket(ticketId) {
    const idx = tickets.findIndex(t => t.id === ticketId);
    if (idx === -1) return false;

    const [removed] = tickets.splice(idx, 1);
    // Fayllarni ham o'chirish (disk joyini tozalash)
    if (removed && Array.isArray(removed.files)) {
        for (const f of removed.files) {
            if (f.fileName) {
                const fp = path.join(UPLOADS_DIR, f.fileName);
                try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
            }
        }
    }
    saveTickets();
    return true;
}

// 8. Dushanba kunlik tozalash (Weekly Monday Cleanup)
// Har hafta dushanba kuni bajarilgan ticketlar va ularning screenshotlari tozalanadi
function checkAndRunMondayCleanup() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 1 = Dushanba (Monday)
    const todayStr = now.toISOString().split('T')[0];

    // Agar bugun Dushanba bo'lsa va bu dushanba hali tozalash qilinmagan bo'lsa
    if (dayOfWeek === 1 && lastCleanedMonday !== todayStr) {
        console.log(`🧹 [Ticket Service] Dushanba kunlik tozalash boshlandi: ${todayStr}`);
        const beforeCount = tickets.length;

        // Bajarilgan ('completed') ticketlarni o'chiramiz
        const completedTickets = tickets.filter(t => t.status === 'completed');
        for (const t of completedTickets) {
            if (Array.isArray(t.files)) {
                for (const f of t.files) {
                    if (f.fileName) {
                        const fp = path.join(UPLOADS_DIR, f.fileName);
                        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
                    }
                }
            }
        }

        // Faqat bajarilmagan (pending, in_progress) larni qoldiramiz
        tickets = tickets.filter(t => t.status !== 'completed');
        lastCleanedMonday = todayStr;
        saveTickets();

        console.log(`✅ [Ticket Service] Dushanba tozalash tugadi: ${beforeCount} ta dan ${completedTickets.length} ta bajarilgan ticket tozalandi. Qoldi: ${tickets.length} ta.`);
        return { cleaned: true, removedCount: completedTickets.length, remainingCount: tickets.length };
    }
    return { cleaned: false };
}

// Qo'lda tozalash (Admin / Majburiy tozalash)
function manualCleanupCompleted() {
    const beforeCount = tickets.length;
    const completedTickets = tickets.filter(t => t.status === 'completed');
    for (const t of completedTickets) {
        if (Array.isArray(t.files)) {
            for (const f of t.files) {
                if (f.fileName) {
                    const fp = path.join(UPLOADS_DIR, f.fileName);
                    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
                }
            }
        }
    }
    tickets = tickets.filter(t => t.status !== 'completed');
    saveTickets();
    return { removedCount: completedTickets.length, remainingCount: tickets.length };
}

// Har 1 soatda dushanba tozalashini tekshirib turish
setInterval(checkAndRunMondayCleanup, 60 * 60 * 1000);
// Ishga tushganda bir marta tekshirib olish
setTimeout(checkAndRunMondayCleanup, 5000);

module.exports = {
    createTicket,
    updateTicket,
    getTickets,
    getTicketById,
    acceptTicket,
    completeTicket,
    rejectTicket,
    addTicketComment,
    deleteTicket,
    checkAndRunMondayCleanup,
    manualCleanupCompleted,
    renderDocxToHtml,
    renderDocxBase64ToHtml
};
