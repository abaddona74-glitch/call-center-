const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8879168539:AAEH8M_DryvCjjq-PEHaBoIUGSUGKPkrvOo';
const SUBSCRIBERS_FILE = path.join(__dirname, '..', 'data', 'telegram_subscribers.json');
const STATUS_FILE = path.join(__dirname, '..', 'data', 'voice_scan_status.json');

class TelegramService {
    constructor() {
        this.token = BOT_TOKEN;
        this.subscribers = this.loadSubscribers();
        this.lastUpdateId = 0;
        this.pollingInterval = null;
    }

    loadSubscribers() {
        try {
            if (fs.existsSync(SUBSCRIBERS_FILE)) {
                return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('Subscribers read error:', e.message);
        }
        return [];
    }

    saveSubscribers() {
        try {
            const dir = path.dirname(SUBSCRIBERS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(this.subscribers, null, 2));
        } catch (e) {
            console.error('Subscribers save error:', e.message);
        }
    }

    addSubscriber(chatId, userInfo = {}) {
        const id = String(chatId);
        const existing = this.subscribers.find(s => String(s.chatId) === id);
        if (!existing) {
            this.subscribers.push({
                chatId: id,
                username: userInfo.username || '',
                firstName: userInfo.first_name || '',
                lastName: userInfo.last_name || '',
                subscribedAt: new Date().toISOString()
            });
            this.saveSubscribers();
            console.log(`✅ Yangi Telegram obunachi qo'shildi: ${id} (${userInfo.first_name || ''})`);
        }
    }

    apiCall(method, payload = {}) {
        return new Promise((resolve) => {
            const data = JSON.stringify(payload);
            const req = https.request({
                hostname: 'api.telegram.org',
                path: `/bot${this.token}/${method}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                },
                timeout: 10000
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve({ ok: false, error: body });
                    }
                });
            });

            req.on('error', (err) => {
                resolve({ ok: false, error: err.message });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, error: 'Timeout' });
            });

            req.write(data);
            req.end();
        });
    }

    async sendMessage(chatId, text, options = {}) {
        return this.apiCall('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            ...options
        });
    }

    async broadcast(text, options = {}) {
        if (!this.subscribers || this.subscribers.length === 0) {
            console.log("⚠️ Telegram: Obunachilar yo'q. /start yuborilganidan so'ng xabar boradi.");
            return;
        }

        for (const sub of this.subscribers) {
            try {
                await this.sendMessage(sub.chatId, text, options);
            } catch (e) {
                console.error(`Broadcast error to ${sub.chatId}:`, e.message);
            }
        }
    }

    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const s = Math.floor(seconds);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
    }

    getStatusSummaryText() {
        let status = null;
        if (fs.existsSync(STATUS_FILE)) {
            try {
                status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            } catch (e) {}
        }

        if (!status) {
            return "⏳ <b>AI Ovoz Tahlili (Voice Scan)</b>\n\nHozirda ma'lumotlar yuklanmoqda...";
        }

        const eta = status.etaMinutes ? (status.etaMinutes > 60 ? `~${Math.floor(status.etaMinutes/60)} soat ${status.etaMinutes%60} daqiqa` : `~${status.etaMinutes} daqiqa`) : 'Hisoblanmoqda...';

        return `🎙️ <b>AI OVOZ TAHLILI HOLATI (SPEECHBRAIN)</b>\n\n` +
               `📅 <b>Oraliq:</b> 17-avgust — 19-sentabr\n` +
               `📊 <b>Progress:</b> ${status.percent} (${status.scannedCount} / ${status.totalTarget} ta)\n` +
               `⏳ <b>Navbatda qolgan:</b> ${status.remainingCount} ta\n` +
               `⏱️ <b>Taxminiy tugash:</b> ${eta}\n` +
               `⚡ <b>Tezlik:</b> ~${status.speedPerMin || 20} ta / daq\n\n` +
               `🔍 <b>Natijalar:</b>\n` +
               `🌸 <b>Zuhra opa:</b> ${status.zuhraCount} ta\n` +
               `👤 <b>Muattar:</b> ${status.muattarCount} ta\n\n` +
               (status.lastScanned ? `🕒 <i>Oxirgi tekshirilgan:</i> ${status.lastScanned.caller_id} (${status.lastScanned.speaker})\n` : '') +
               `🌐 <a href="http://192.168.0.2:3535/voice-status">Jonli Monitor Sahifasiga o'tish</a>`;
    }

    async pollUpdates() {
        try {
            const res = await this.apiCall('getUpdates', {
                offset: this.lastUpdateId + 1,
                timeout: 5
            });

            if (res && res.ok && Array.isArray(res.result)) {
                for (const update of res.result) {
                    this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
                    if (update.message) {
                        await this.handleMessage(update.message);
                    }
                }
            }
        } catch (e) {
            // silent catch for polling errors
        }
    }

    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const from = msg.from || {};

        this.addSubscriber(chatId, from);

        if (text === '/start' || text.startsWith('/start')) {
            const welcomeText = `👋 <b>Assalomu alaykum, ${from.first_name || 'Maxmudbek'}!</b>\n\n` +
                                `✅ <b>Call Center AI Bildirishnoma Boti ulandi!</b>\n\n` +
                                `Bu bot orqali siz:\n` +
                                `• 119-operator (17-avgust — 19-sentabr) suhbatlarining ovozli tahlilini;\n` +
                                `• Skan jarayoni progressini (har 25% oraliqda);\n` +
                                `• 🔥 Har safar yangi <b>Zuhra opa</b> ovozi topilganda;\n` +
                                `• 🏁 <b>100% to'liq yakunlanganda</b> yakuniy hisobotni Telegramingizda qabul qilasiz.\n\n` +
                                `Hozirgi holatni ko'rish uchun <b>/status</b> buyrug'ini yuborishingiz mumkin!`;

            await this.sendMessage(chatId, welcomeText);
            await this.sendMessage(chatId, this.getStatusSummaryText());
        } else if (text === '/status' || text === 'status' || text === 'Status') {
            await this.sendMessage(chatId, this.getStatusSummaryText());
        } else {
            await this.sendMessage(chatId, `Buyruqlar:\n/status — Joriy skan holati va foizini ko'rish\n/start — Botni qayta ishga tushirish`);
        }
    }

    startPolling(intervalMs = 3000) {
        if (this.pollingInterval) return;
        console.log("🤖 Telegram Bot Polling ishga tushdi (@maxmudbek_notify_bot)...");
        this.pollUpdates();
        this.pollingInterval = setInterval(() => this.pollUpdates(), intervalMs);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
}

module.exports = new TelegramService();
