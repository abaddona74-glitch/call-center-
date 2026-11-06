/**
 * Call Center - Universal File Converter Service
 * 
 * Manages document and image conversions via services/converter.py and in-memory streams.
 * Crucial rule: IMMEDIATELY deletes all temporary files and directories after conversion.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

const SCRIPT_PATH = path.join(__dirname, 'converter.py');

// Clean orphaned temporary files on boot and periodically
function cleanupOldTempFiles() {
    try {
        const tmpBase = os.tmpdir();
        const files = fs.readdirSync(tmpBase);
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 daqiqadan oshgan fayllar

        files.forEach(f => {
            if (f.startsWith('cc_conv_')) {
                const fullPath = path.join(tmpBase, f);
                try {
                    const stats = fs.statSync(fullPath);
                    if (now - stats.mtimeMs > maxAge) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                    }
                } catch (e) {}
            }
        });
    } catch (e) {}
}

// Har 15 daqiqada eski vaqtincha papkalarni tozalash
setInterval(cleanupOldTempFiles, 15 * 60 * 1000);
cleanupOldTempFiles();

function getMimeType(ext) {
    const map = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'txt': 'text/plain; charset=utf-8',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'webp': 'image/webp'
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Converts a file buffer into target format
 * @param {Buffer} inputBuffer - The file buffer
 * @param {string} originalName - Original filename (e.g. document.pdf)
 * @param {string} targetFormat - Target extension (e.g. 'docx', 'pdf', 'png')
 * @returns {Promise<{ filename: string, mimeType: string, buffer: Buffer }>}
 */
async function convertFile(inputBuffer, originalName, targetFormat) {
    if (!inputBuffer || !Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
        throw new Error("Yuklangan fayl bo'sh yoki noto'g'ri.");
    }

    const cleanTarget = String(targetFormat || '').toLowerCase().replace(/^\./, '').trim();
    if (!cleanTarget) {
        throw new Error("Konvertatsiya qilinadigan format (target) ko'rsatilmadi.");
    }

    let decodedName = originalName || 'file';
    try {
        if (typeof decodedName === 'string' && decodedName.includes('%')) {
            decodedName = decodeURIComponent(decodedName);
        }
    } catch (e) {}

    const rawBase = path.basename(decodedName);
    const ext = (path.extname(rawBase) || '').toLowerCase().replace(/^\./, '') || 'bin';
    const rawNameWithoutExt = path.basename(rawBase, path.extname(rawBase));

    // Faqat tizimda taqiqlangan belgilarni tozalaymiz (/ \ ? % * : | " < > va control chars)
    // Kirill (o'zbek, rus) va boshqa barcha tillardagi harflar to'liq saqlanadi
    const safeNameWithoutExt = rawNameWithoutExt
        .replace(/[\/\?%*:|"<>\\\0\x00-\x1f\x7f-\x9f]/g, '_')
        .trim() || 'converted_file';

    // 1. Vaqtinchalik xavfsiz papka yaratish
    const sessionToken = crypto.randomBytes(8).toString('hex');
    const tempDir = path.join(os.tmpdir(), `cc_conv_${Date.now()}_${sessionToken}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const inputPath = path.join(tempDir, `input.${ext}`);
    const outputPath = path.join(tempDir, `output.${cleanTarget}`);

    try {
        // Faylni vaqtinchalik diskka yozish
        fs.writeFileSync(inputPath, inputBuffer);

        // Python konvertorni ishga tushirish
        await new Promise((resolve, reject) => {
            const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
            const proc = spawn(pythonBin, [SCRIPT_PATH, inputPath, outputPath, '--target', cleanTarget]);

            let stderrData = '';
            let stdoutData = '';

            proc.stdout.on('data', d => stdoutData += d.toString());
            proc.stderr.on('data', d => stderrData += d.toString());

            proc.on('error', (err) => {
                reject(new Error(`Konvertor dasturini ishga tushirib bo'lmadi: ${err.message}`));
            });

            proc.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve();
                } else {
                    reject(new Error(stderrData.trim() || stdoutData.trim() || `Konvertatsiya jarayoni xato bilan yakunlandi (kod: ${code})`));
                }
            });
        });

        // Natijaviy faylni xotiraga o'qish
        const outputBuffer = fs.readFileSync(outputPath);
        const resultFilename = `${safeNameWithoutExt}.${cleanTarget}`;
        const mimeType = getMimeType(cleanTarget);

        return {
            filename: resultFilename,
            mimeType: mimeType,
            buffer: outputBuffer
        };
    } finally {
        // Zudlik bilan barcha vaqtinchalik fayllarni o'chirish (Zero footprint)
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupErr) {
            console.error('Vaqtincha papkani tozalashda xatolik:', cleanupErr.message);
        }
    }
}

module.exports = {
    convertFile,
    cleanupOldTempFiles
};
