/**
 * Telegram ⇄ Visual AI Bridge Bot
 * Maxmudbek yuborgan xabarlarni va skrinshotlarni qabul qilib,
 * avtomatik ravishda Antigravity Bridge Inbox (ui_inbox.json) ga joylaydi.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8879168539:AAEH8M_DryvCjjq-PEHaBoIUGSUGKPkrvOo';
const ALLOWED_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '5696800674'; // Maxmudbek
const SERVER_HOST = process.env.DEPLOY_HOST || '213.230.110.9';
const SERVER_PORT = parseInt(process.env.DEPLOY_PORT || '22', 10);
const SERVER_USER = process.env.DEPLOY_USER || 'root';
const SERVER_PASS = process.env.DEPLOY_PASS || 'ZAQ!2wsx123';

const IS_ON_SERVER = fs.existsSync('/opt/call-center/scratch');
const LOCAL_INBOX_PATH = path.join(__dirname, '..', 'scratch', 'ui_inbox.json');
const SERVER_INBOX_PATH = '/opt/call-center/scratch/ui_inbox.json';

let lastUpdateId = 0;

async function sendTelegramMessage(chatId, text, replyToMessageId = null) {
    try {
        const payload = {
            chat_id: chatId,
            text,
            parse_mode: 'HTML'
        };
        if (replyToMessageId) {
            payload.reply_to_message_id = replyToMessageId;
        }
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error('sendTelegramMessage error:', e.message);
    }
}

async function getTelegramFileBuffer(fileId) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const data = await res.json();
        if (data.ok && data.result.file_path) {
            const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
            const fileRes = await fetch(fileUrl);
            const arrayBuffer = await fileRes.arrayBuffer();
            return {
                buffer: Buffer.from(arrayBuffer),
                filePath: data.result.file_path
            };
        }
    } catch (e) {
        console.error('getTelegramFileBuffer error:', e.message);
    }
    return null;
}

// ui_inbox.json ga yangi vazifani qo'shish
async function saveToInbox(taskItem) {
    if (IS_ON_SERVER) {
        // Serverning o'zida to'g'ridan-to'g'ri faylga yozish
        let list = [];
        try {
            if (fs.existsSync(SERVER_INBOX_PATH)) {
                list = JSON.parse(fs.readFileSync(SERVER_INBOX_PATH, 'utf8'));
            }
        } catch (_) {}
        list.unshift(taskItem);
        fs.writeFileSync(SERVER_INBOX_PATH, JSON.stringify(list.slice(0, 50), null, 2), 'utf8');
        return true;
    } else {
        // Mahalliy kompyuterdan SSH orqali serverga yozish
        return new Promise((resolve) => {
            const conn = new Client();
            conn.on('ready', () => {
                conn.exec(`cat ${SERVER_INBOX_PATH} 2>/dev/null`, (err, stream) => {
                    if (err) {
                        conn.end();
                        return resolve(false);
                    }
                    let data = '';
                    stream.on('data', d => data += d);
                    stream.on('close', () => {
                        let list = [];
                        try {
                            if (data && data.trim()) list = JSON.parse(data);
                        } catch (_) {}
                        list.unshift(taskItem);
                        const updateCmd = `cat << 'EOF' > ${SERVER_INBOX_PATH}\n${JSON.stringify(list.slice(0, 50), null, 2)}\nEOF`;
                        conn.exec(updateCmd, () => {
                            conn.end();
                            resolve(true);
                        });
                    });
                });
            }).on('error', (e) => {
                console.error('SSH Error:', e.message);
                resolve(false);
            }).connect({
                host: SERVER_HOST,
                port: SERVER_PORT,
                username: SERVER_USER,
                password: SERVER_PASS
            });
        });
    }
}

async function handleMessage(msg) {
    const chatId = String(msg.chat.id);
    const fromName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Maxmudbek';

    // Xavfsizlik: faqat ruxsat etilgan foydalanuvchi (Maxmudbek)
    if (chatId !== ALLOWED_CHAT_ID) {
        await sendTelegramMessage(chatId, "⛔ <b>Ruxsat etilmadi!</b>\nBu bot shaxsiy Call Center AI Bridge tizimi uchun himoyalangan.", msg.message_id);
        return;
    }

    const text = (msg.text || '').trim();

    // Start / Help buyruqlari
    if (text === '/start' || text === '/help') {
        const welcome = `
👋 <b>Assalomu alaykum ${fromName}!</b>

Call Center AI <b>Visual Bridge</b> doimiy faol holatda.
Bu yerga yozgan har bir matningiz yoki yuborgan skrinshotlaringiz avtomatik ravishda <b>Antigravity AI Bridge</b> ga prompt sifatida yuboriladi.

💡 <b>Imkoniyatlar:</b>
• <b>Oddiy matn:</b> Masalan, <i>"Operatorlar sahifasida fon rangini to'g'rilab ber"</i>
• <b>Skrinshot / Rasm:</b> Ekrandan rasm yuborib tagiga tushuntirish yozing
• <b>/status:</b> Tizim va navbatlar holati

<i>Vazifani yuborishingiz mumkin!</i>`;
        await sendTelegramMessage(chatId, welcome, msg.message_id);
        return;
    }

    if (text === '/status') {
        const statusMsg = `
⚡ <b>Call Center Tizim Holati:</b>
• <b>Dashboard API:</b> Faol (Port 3535)
• <b>Viewer:</b> Faol (Port 3005)
• <b>Navbat Strategiyasi:</b> <code>rrmemory</code> (Round Robin with Memory)
• <b>Bridge Watcher:</b> Faol tinglovchi rejimida

Siz bu yerga istalgan vazifangizni yuborishingiz mumkin!`;
        await sendTelegramMessage(chatId, statusMsg, msg.message_id);
        return;
    }

    // Vazifa matni yoki rasm sarlavhasi
    let taskText = msg.text || msg.caption || '';
    const images = [];

    // Agar rasm biriktirilgan bo'lsa
    if (msg.photo && msg.photo.length > 0) {
        const bestPhoto = msg.photo[msg.photo.length - 1];
        const fileInfo = await getTelegramFileBuffer(bestPhoto.file_id);
        if (fileInfo && fileInfo.buffer) {
            images.push({
                base64: `data:image/jpeg;base64,${fileInfo.buffer.toString('base64')}`,
                fileName: path.basename(fileInfo.filePath)
            });
            if (!taskText) {
                taskText = "Skrinshotdagi interfeysni tahlil qil va ko'rinishini yaxshilab ber.";
            }
        }
    }

    if (!taskText) {
        await sendTelegramMessage(chatId, "⚠️ Iltimos, bajarilishi kerak bo'lgan vazifani matn yoki rasm ko'rinishida yuboring.", msg.message_id);
        return;
    }

    const taskId = Date.now();
    const dateStr = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });

    const fullPrompt = `[TELEGRAM BRIDGE VAZIFA]:
- Manba: Telegram (@maxmudbek_notify_bot)
- Yuboruvchi: ${fromName} (ID: ${chatId})
- Vaqt: ${dateStr}
- Biriktirilgan suratlar: ${images.length > 0 ? images.length + ' ta' : 'Yo\'q'}
🎯 VAZIFA:
${taskText}`;

    const taskEntry = {
        id: taskId,
        source: 'telegram',
        sender: fromName,
        task: taskText,
        prompt: fullPrompt,
        images,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    console.log(`\n📥 [Telegram] Yangi vazifa keldi (#${taskId}): "${taskText.slice(0, 80)}"`);

    const saved = await saveToInbox(taskEntry);

    if (saved) {
        const replyHtml = `
🚀 <b>Vazifa Antigravity Bridge tizimiga qabul qilindi!</b>

🆔 <b>ID:</b> <code>${taskId}</code>
📝 <b>Vazifa:</b> <i>${taskText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</i>
${images.length > 0 ? `🖼 <b>Surat:</b> ${images.length} ta skrinshot biriktirildi\n` : ''}
⏳ <b>Holat:</b> <code>pending</code> (AI qabul qilishi kutilmoqda...)

<i>Antigravity hoziroq ushbu vazifani bajarishga kirishadi. Bajarilgach sizga hisobot yetkaziladi!</i>`;
        await sendTelegramMessage(chatId, replyHtml, msg.message_id);
    } else {
        await sendTelegramMessage(chatId, "❌ Xatolik: Vazifani server inbox tizimiga saqlab bo'lmadi. Keyinroq qayta urining.", msg.message_id);
    }
}

async function pollUpdates() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
            for (const upd of data.result) {
                lastUpdateId = upd.update_id;
                if (upd.message) {
                    await handleMessage(upd.message);
                }
            }
        }
    } catch (e) {
        // Tarmoq xatosi bo'lsa 3 soniya kutib qayta urinish
    }
    setTimeout(pollUpdates, 1000);
}

console.log('🤖 Telegram ⇄ Bridge Bot ishga tushdi...');
console.log(`📡 Bot: @maxmudbek_notify_bot | Admin: ${ALLOWED_CHAT_ID}`);
pollUpdates();

