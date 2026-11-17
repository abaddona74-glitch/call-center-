/**
 * Gemini AI Service for STT Auto-Correction & Self-Learning Dictionary
 * Automatically cleans noisy phonetic speech into natural Uzbek dialogue
 * and extracts raw-to-clean vocabulary pairs to continuously train the local dictionary.
 */

const https = require('https');

class GeminiService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || '';
        // gemini-3.5-flash-lite is ultra fast, reliable and supports generateContent
        this.model = 'gemini-3.5-flash-lite';
    }

    setApiKey(key) {
        if (key) this.apiKey = key.trim();
    }

    isAvailable() {
        return !!this.apiKey && this.apiKey.length > 10;
    }

    /**
     * Internal helper to make Gemini API request
     */
    async _request(model, prompt, timeoutMs = 35000) {
        const payload = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.2
            }
        });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        return new Promise((resolve) => {
            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                },
                timeout: timeoutMs
            }, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        if (parsed.error) {
                            return resolve({ success: false, status: res.statusCode, error: parsed.error.message || 'Gemini API xatosi' });
                        }
                        const candidate = parsed.candidates && parsed.candidates[0];
                        const textPart = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
                        if (!textPart || !textPart.text) {
                            return resolve({ success: false, status: res.statusCode, error: 'Gemini javob bermadi' });
                        }

                        let cleanJson = textPart.text.trim();
                        if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
                        if (cleanJson.startsWith('```')) cleanJson = cleanJson.slice(3);
                        if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);

                        const result = JSON.parse(cleanJson.trim());
                        resolve({
                            success: true,
                            formattedText: result.formattedText || '',
                            vocabularyPairs: Array.isArray(result.vocabularyPairs) ? result.vocabularyPairs : []
                        });
                    } catch (e) {
                        resolve({ success: false, status: res.statusCode, error: `Javobni parse qilishda xato: ${e.message}`, rawData: responseData.slice(0, 300) });
                    }
                });
            });

            req.on('error', (err) => {
                resolve({ success: false, error: `Tarmoq xatosi: ${err.message}` });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'Gemini API javob berish vaqti tugadi (timeout)' });
            });

            req.write(payload);
            req.end();
        });
    }

    /**
     * Clean raw STT text and extract vocabulary mapping
     * @param {string} rawText 
     * @returns {Promise<{ success: boolean, formattedText?: string, vocabularyPairs?: Array<{raw: string, clean: string}>, error?: string }>}
     */
    async cleanAndLearn(rawText) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Gemini API kaliti kiritilmagan' };
        }
        if (!rawText || rawText.trim().length < 5) {
            return { success: false, error: 'Matn bo\'sh' };
        }

        const prompt = `Siz "Unicon-Soft" IT call-centeri uchun O'zbek tili bo'yicha sun'iy intellekt mutaxassisisiz.
Quyida telefon qo'ng'irog'idan Wav2Vec2 akustik modeli chiqargan xom, fonetik buzilgan matn berilgan.

VAZIFANGIZ:
1. Xom matnni tushunarli, ravon, mantiqli o'zbek tilidagi dialog (Operator / Mijoz) shakliga keltiring.

2. RAQAMLAR, ANYDESK ID VA PAROLLARGA ALOHIDA EHTIYOT BO'LING:
   - Call-centerda AnyDesk/TeamViewer ID-lari (odatda 9 ta raqam: masalan "962 331 170" yoki "96233, keyingisi 170"), telefon raqamlari, parollar va loginlar aytiladi.
   - Fonetik talaffuz va hisoblash qoidalari:
     * "buruzgetmush" / "biruz getmush" / "biryuz yetmish" = "bir yuz yetmish" (170). Bu ASLO "71" emas!
     * "to'xson olti" = 96
     * "ikki yuz o'ttiz uch" = 233
     * "buruzgetmush" = 170 -> AnyDesk: "96233, keyingisi 170" (yoki 962 331 170)
     * "to'xson bir olti vuch sakson sakkiz" = "916... 88" yoki 91688
   - Raqamlarni aslo o'zboshimchalik bilan qisqartirmang yoki o'zgartirmang (masalan 170 ni 71 qilib yubormang!).

3. SO'ZLASHUV TILI VA JUFT SO'ZLAR (REDUPLIKATSIYA):
   - O'zbek xalqona so'zlashuvidagi juft so'zlar: "chislo-pislo", "hujjat-pujjat", "kalit-malit", "parol-marol".
   - "chislot islo" / "chislo islo" bu "chislo-pislo" (sana-mana) degani. Uni "chislo, ism" yoki boshqa begona so'zga o'zgartirmang! To'qib, so'zlovchi aytmagan so'zlarni (masalan "ism") qo'shmang!

4. IT VA TIZIM ATAMALARI:
   - Unicon-Soft, EDO (edo.ijro.uz, topshiriq yaratish, imzolash), E-IMZO (kalit, erip kalit), AnyDesk, TeamViewer.

5. O'Z-O'ZINI O'QITISH LUG'ATI ("vocabularyPairs"):
   - Butun boshli uzun jumlalarni yoki raqamlar ketma-ketligini lug'atga QO'SHMANG (masalan "to'xson olti...": "96233" deb saqlash qat'iyan man etiladi!).
   - Faqat aniq 1 ta yoki ko'pi bilan 2 ta so'zdan iborat fonetik xatoliklarni juftlik qilib bering (masalan: "buruzgetmush" -> "bir yuz yetmish", "chislot islo" -> "chislo-pislo", "imzolasishi" -> "imzolashni", "topshirqi" -> "topshiriq").

FAQAT quyidagi JSON formatda javob bering (boshqa hech qanday so'zsiz):
{
  "formattedText": "To'g'rilangan, mantiqiy va tushunarli o'zbekcha dialog matni...",
  "vocabularyPairs": [
    { "raw": "xom_soz", "clean": "to'g'ri_soz" }
  ]
}

XOM MATN:
${rawText}`;

        // Try primary model (gemini-3.5-flash-lite)
        let res = await this._request(this.model, prompt, 35000);
        if (!res.success && (res.status === 503 || res.status === 404 || res.error?.includes('timeout'))) {
            console.warn(`[GeminiService] Primary model (${this.model}) xato berdi (${res.error}), zaxira modelga (gemini-3.1-flash-lite) o'tilmoqda...`);
            res = await this._request('gemini-3.1-flash-lite', prompt, 35000);
        }

        return res;
    }
}

module.exports = new GeminiService();
