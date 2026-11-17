/**
 * Email Service for Call Center
 * Supports:
 * 1. Gmail SMTP (Nodemailer) via App Password (primary, reliable, sends to ANY recipient without domain restriction)
 * 2. Resend API (secondary fallback)
 * 3. Server Console Simulation (development fallback)
 */

const https = require('https');
let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (_) {}

class EmailService {
    constructor() {
        this.transporter = null;
    }

    getSmtpConfig() {
        const user = (process.env.SMTP_USER || '').trim();
        const pass = (process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
        const from = (process.env.SMTP_FROM || `"Call Center Security" <${user}>`).trim();
        return {
            user,
            pass,
            from,
            enabled: Boolean(user && pass && nodemailer)
        };
    }

    getTransporter() {
        const smtp = this.getSmtpConfig();
        if (!smtp.enabled) return null;
        if (!this.transporter) {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: smtp.user,
                    pass: smtp.pass
                }
            });
        }
        return this.transporter;
    }

    getResendApiKey() {
        return (process.env.RESEND_API_KEY || '').trim();
    }

    getResendFrom() {
        return (process.env.RESEND_FROM || 'Call Center Security <onboarding@resend.dev>').trim();
    }

    isAvailable() {
        const smtp = this.getSmtpConfig();
        const resendKey = this.getResendApiKey();
        return smtp.enabled || (Boolean(resendKey) && resendKey.length > 5);
    }

    /**
     * Send email via Gmail SMTP or fallback to Resend API
     * @param {string} toEmail 
     * @param {string} subject 
     * @param {string} html 
     * @returns {Promise<{success: boolean, service?: string, id?: string, simulated?: boolean, error?: string}>}
     */
    async _sendMail({ toEmail, subject, html, code, username, purpose = 'auth' }) {
        const cleanTo = String(toEmail || '').trim().toLowerCase();
        const smtp = this.getSmtpConfig();
        const transporter = this.getTransporter();

        // 1. GMAIL SMTP (Nodemailer)
        if (transporter && smtp.enabled) {
            try {
                const info = await transporter.sendMail({
                    from: smtp.from,
                    to: cleanTo,
                    subject: subject,
                    html: html
                });
                console.log(`[EMAIL SERVICE] ✅ Email Gmail SMTP orqali muvaffaqiyatli jo'natildi! (MessageId: ${info.messageId}) -> ${cleanTo}`);
                return {
                    success: true,
                    service: 'gmail_smtp',
                    id: info.messageId,
                    message: `${cleanTo} manziliga tasdiqlash kodi jo'natildi`
                };
            } catch (smtpErr) {
                console.error(`[EMAIL SERVICE] ⚠️ Gmail SMTP jo'natishda xatolik:`, smtpErr.message);
                // Agar SMTP xato bersa, Resend ga fallback qilamiz
            }
        }

        // 2. RESEND API FALLBACK
        const resendKey = this.getResendApiKey();
        if (resendKey && resendKey.length > 5) {
            try {
                const resendResult = await this._sendViaResend(cleanTo, subject, html);
                if (resendResult.success) {
                    return resendResult;
                }
                console.warn(`[EMAIL SERVICE] ⚠️ Resend xatoligi tufayli xat jo'natilmadi: ${resendResult.error}`);
                return resendResult;
            } catch (resendErr) {
                console.error(`[EMAIL SERVICE] ⚠️ Resend tarmoq xatosi:`, resendErr.message);
                return { success: false, error: `Email serveri bilan aloqa xatosi: ${resendErr.message}` };
            }
        }

        // 3. SIMULATED / CONSOLE FALLBACK
        console.warn(`[EMAIL SERVICE] ℹ️ Hech qanday email xizmati sozlanmagan. Kod server konsoliga chiqarildi: [${code}]`);
        return {
            success: true,
            simulated: true,
            message: `${cleanTo} manziliga tasdiqlash kodi jo'natildi (Server konsoliga saqlandi)`
        };
    }

    _sendViaResend(toEmail, subject, html) {
        const payload = JSON.stringify({
            from: this.getResendFrom(),
            to: [toEmail],
            subject: subject,
            html: html
        });

        return new Promise((resolve) => {
            const req = https.request('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getResendApiKey()}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                },
                timeout: 10000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log(`[EMAIL SERVICE] ✅ Email Resend orqali jo'natildi! (ID: ${parsed.id}) -> ${toEmail}`);
                            resolve({ success: true, service: 'resend', id: parsed.id });
                        } else {
                            console.error('[EMAIL SERVICE] ⚠️ Resend API xatosi:', parsed);
                            resolve({
                                success: false,
                                error: parsed.message || 'Resend API xatosi yuz berdi'
                            });
                        }
                    } catch (e) {
                        resolve({ success: false, error: `Resend javobini tahlil qilib bo'lmadi: ${data.slice(0, 80)}` });
                    }
                });
            });

            req.on('error', (err) => {
                resolve({ success: false, error: `Email serveriga ulanishda xato: ${err.message}` });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'Email yuborish vaqti tugadi (timeout)' });
            });

            req.write(payload);
            req.end();
        });
    }

    /**
     * Send 6-digit verification code email for password recovery
     * @param {string} toEmail 
     * @param {string} code 
     * @param {string} username 
     * @returns {Promise<{success: boolean, id?: string, simulated?: boolean, error?: string}>}
     */
    async sendPasswordResetCode(toEmail, code, username) {
        console.log(`[EMAIL SERVICE] 📨 Parolni tiklash kodi: [${code}] -> ${toEmail} (${username}) | 2 daqiqa amal qiladi`);

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f1f5f9; margin: 0; padding: 24px; }
            .card { max-width: 460px; margin: 0 auto; background: #131d31; border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 16px; padding: 36px 28px; box-shadow: 0 20px 45px rgba(0,0,0,0.6); text-align: center; }
            .logo { font-size: 22px; font-weight: 800; color: #38bdf8; margin-bottom: 16px; letter-spacing: 0.5px; }
            .title { font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 8px; }
            .desc { font-size: 13.5px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
            .code-box { background: rgba(59, 130, 246, 0.12); border: 2px dashed #3b82f6; border-radius: 12px; padding: 18px; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #60a5fa; font-family: monospace; margin: 0 auto 20px; display: inline-block; min-width: 220px; }
            .timer-badge { display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 20px; margin-bottom: 24px; }
            .warning { font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 0; }
            .footer { font-size: 11px; color: #475569; margin-top: 28px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="logo">CALL CENTER AI</div>
            <div class="title">Parolni tiklash so'rovi</div>
            <div class="desc">Hurmatli <strong>${username || 'Foydalanuvchi'}</strong>, hisobingiz uchun parolni tiklash so'rovi yuborildi. Quyidagi 6 xonali tasdiqlash kodini kiriting:</div>
            <div class="code-box">${code}</div>
            <div>
              <span class="timer-badge">⏱️ Ushbu kod faqat 2 daqiqa amal qiladi</span>
            </div>
            <p class="warning">Agar bu so'rovni siz yubormagan bo'lsangiz, xatni e'tiborsiz qoldiring. Akkaunt xavfsizligingiz ta'minlangan.</p>
            <div class="footer">Call Center Analytics System &bull; Xavfsizlik xizmati</div>
          </div>
        </body>
        </html>
        `;

        return this._sendMail({
            toEmail,
            subject: `Parolni tiklash kodi: ${code}`,
            html,
            code,
            username,
            purpose: 'reset'
        });
    }

    /**
     * Send 6-digit email binding verification code via Gmail SMTP or Resend API
     * @param {string} toEmail 
     * @param {string} code 
     * @param {string} username 
     * @returns {Promise<{success: boolean, id?: string, simulated?: boolean, error?: string}>}
     */
    async sendEmailVerificationCode(toEmail, code, username) {
        console.log(`[EMAIL SERVICE] 📨 Gmail bog'lash tasdiqlash kodi: [${code}] -> ${toEmail} (${username}) | 2 daqiqa amal qiladi`);

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f1f5f9; margin: 0; padding: 24px; }
            .card { max-width: 460px; margin: 0 auto; background: #131d31; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 16px; padding: 36px 28px; box-shadow: 0 20px 45px rgba(0,0,0,0.6); text-align: center; }
            .logo { font-size: 22px; font-weight: 800; color: #38bdf8; margin-bottom: 16px; letter-spacing: 0.5px; }
            .title { font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 8px; }
            .desc { font-size: 13.5px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
            .code-box { background: rgba(56, 189, 248, 0.12); border: 2px dashed #0284c7; border-radius: 12px; padding: 18px; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #38bdf8; font-family: monospace; margin: 0 auto 20px; display: inline-block; min-width: 220px; }
            .timer-badge { display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 20px; margin-bottom: 24px; }
            .warning { font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 0; }
            .footer { font-size: 11px; color: #475569; margin-top: 28px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="logo">CALL CENTER AI</div>
            <div class="title">Gmail manzilini tasdiqlash</div>
            <div class="desc">Hurmatli <strong>${username || 'Foydalanuvchi'}</strong>, Call Center tizimidagi hisobingizga ushbu Gmail manzilini biriktirish uchun quyidagi 6 xonali tasdiqlash kodini kiriting:</div>
            <div class="code-box">${code}</div>
            <div>
              <span class="timer-badge">⏱️ Ushbu kod faqat 2 daqiqa amal qiladi</span>
            </div>
            <p class="warning">Agar bu so'rovni siz bajarmagan bo'lsangiz, xatni e'tiborsiz qoldiring. Akkauntingiz xavfsiz holatda qoladi.</p>
            <div class="footer">Call Center Analytics System &bull; Xavfsizlik xizmati</div>
          </div>
        </body>
        </html>
        `;

        return this._sendMail({
            toEmail,
            subject: `Gmail tasdiqlash kodi: ${code}`,
            html,
            code,
            username,
            purpose: 'verify'
        });
    }

    /**
     * Send 6-digit email unlinking verification code to current bound Gmail
     * @param {string} toEmail 
     * @param {string} code 
     * @param {string} username 
     * @returns {Promise<{success: boolean, id?: string, simulated?: boolean, error?: string}>}
     */
    async sendEmailUnlinkCode(toEmail, code, username) {
        console.log(`[EMAIL SERVICE] 📨 Gmail manzilini hisobdan uzish tasdiqlash kodi: [${code}] -> ${toEmail} (${username}) | 2 daqiqa amal qiladi`);

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f1f5f9; margin: 0; padding: 24px; }
            .card { max-width: 460px; margin: 0 auto; background: #131d31; border: 1px solid rgba(239, 68, 68, 0.45); border-radius: 16px; padding: 36px 28px; box-shadow: 0 20px 45px rgba(0,0,0,0.6); text-align: center; }
            .logo { font-size: 22px; font-weight: 800; color: #38bdf8; margin-bottom: 16px; letter-spacing: 0.5px; }
            .title { font-size: 18px; font-weight: 700; color: #f87171; margin-bottom: 8px; }
            .desc { font-size: 13.5px; color: #cbd5e1; line-height: 1.5; margin-bottom: 24px; }
            .code-box { background: rgba(239, 68, 68, 0.12); border: 2px dashed #ef4444; border-radius: 12px; padding: 18px; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #fca5a5; font-family: monospace; margin: 0 auto 20px; display: inline-block; min-width: 220px; }
            .timer-badge { display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 20px; margin-bottom: 24px; }
            .security-alert { background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 12px; text-align: left; font-size: 12px; color: #fcd34d; line-height: 1.45; margin-bottom: 20px; }
            .footer { font-size: 11px; color: #475569; margin-top: 28px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="logo">CALL CENTER AI</div>
            <div class="title">⚠️ Gmail manzilini uzish / almashtirish</div>
            <div class="desc">Hurmatli <strong>${username || 'Foydalanuvchi'}</strong>, hisobingizdan joriy Gmail manzilini uzish yoki boshqa manzilga almashtirish bo'yicha so'rov berildi. Amalni tasdiqlash uchun quyidagi kodni kiriting:</div>
            <div class="code-box">${code}</div>
            <div>
              <span class="timer-badge">⏱️ Ushbu kod faqat 2 daqiqa amal qiladi</span>
            </div>
            <div class="security-alert">
              <strong>DIQQAT:</strong> Agar bu so'rovni siz yubormagan bo'lsangiz, demak kimdir hisobingiz parolini bilib olgan! Zudlik bilan ushbu xatni e'tiborsiz qoldiring va tizimga kirib hisobingiz parolini darhol yangilang!
            </div>
            <div class="footer">Call Center Analytics System &bull; Xavfsizlik xizmati</div>
          </div>
        </body>
        </html>
        `;

        return this._sendMail({
            toEmail,
            subject: `⚠️ Xavfsizlik tasdig'i: Gmailni uzish kodi ${code}`,
            html,
            code,
            username,
            purpose: 'unlink'
        });
    }
}

module.exports = new EmailService();
