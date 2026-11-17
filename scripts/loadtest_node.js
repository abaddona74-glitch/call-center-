/**
 * Node.js Native Load & Rate-Limit Tester
 * Ushbu skript k6 o'rnatilmagan holatda ham Node.js orqali yuklama
 * va Rate-Limiting (429) himoyasini xavfsiz test qilish uchun yaratilgan.
 *
 * Ishga tushirish:
 *   node scripts/loadtest_node.js
 */

const https = require('https');
const http = require('http');

const TARGET_URL = process.env.TEST_URL || 'https://uniconsoft.ddns.net:3005/api/speedtest/ping';
const TOTAL_REQUESTS = 30; // Test uchun yuboriladigan so'rovlar soni
const CONCURRENCY = 5;      // Bir vaqtning o'zida yuboriladigan parallel so'rovlar

console.log('=====================================================');
console.log('🚀 RATE LIMIT VA YUKLAMA TESTI (NODE.JS RUNNER)');
console.log(`🎯 Nishon: ${TARGET_URL}`);
console.log(`📊 Jami so'rovlar: ${TOTAL_REQUESTS} ta | Parallel: ${CONCURRENCY} ta`);
console.log('=====================================================\n');

let completed = 0;
let success200 = 0;
let rateLimited429 = 0;
let errors = 0;
const startTotal = Date.now();
const durations = [];

function sendRequest(index) {
    return new Promise((resolve) => {
        const start = Date.now();
        const url = new URL(TARGET_URL);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            rejectUnauthorized: false, // O'z-o'zini imzolagan sertifikatlar uchun
            headers: {
                'User-Agent': 'Node-LoadTest/1.0',
                'Accept': 'application/json'
            }
        };

        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                const duration = Date.now() - start;
                durations.push(duration);
                completed++;

                const limit = res.headers['x-rate-limit-limit'] || '-';
                const remaining = res.headers['x-rate-limit-remaining'] || '-';

                if (res.statusCode === 200) {
                    success200++;
                    console.log(`[#${index}] ✅ 200 OK (${duration}ms) | Limit: ${limit} | Qolgan: ${remaining}`);
                } else if (res.statusCode === 429) {
                    rateLimited429++;
                    console.log(`[#${index}] 🛡️ 429 RATE LIMITED (${duration}ms) | Retry-After: ${res.headers['retry-after'] || '60'}s`);
                } else {
                    errors++;
                    console.log(`[#${index}] ⚠️ HTTP ${res.statusCode} (${duration}ms)`);
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            completed++;
            errors++;
            console.error(`[#${index}] ❌ Xatolik: ${err.message}`);
            resolve();
        });

        req.end();
    });
}

async function runQueue() {
    let current = 1;
    const workers = [];

    for (let w = 0; w < CONCURRENCY; w++) {
        workers.push((async () => {
            while (current <= TOTAL_REQUESTS) {
                const idx = current++;
                await sendRequest(idx);
            }
        })());
    }

    await Promise.all(workers);

    const totalTime = ((Date.now() - startTotal) / 1000).toFixed(2);
    const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const rps = (completed / (totalTime || 1)).toFixed(1);

    console.log('\n=====================================================');
    console.log('📊 TEST YAKUNI VA NATIJALAR:');
    console.log(`⏱️ Umumiy sarflangan vaqt: ${totalTime} soniya`);
    console.log(`⚡ O'rtacha javob vaqti (Latency): ${avgDuration} ms`);
    console.log(`📈 RPS (Requests per second): ${rps} so'rov/sekund`);
    console.log(`✅ 200 OK (Muvaffaqiyatli): ${success200}`);
    console.log(`🛡️ 429 (Rate-Limit to'xtatgan): ${rateLimited429}`);
    console.log(`❌ Boshqa xatoliklar: ${errors}`);
    console.log('=====================================================');
}

runQueue();

