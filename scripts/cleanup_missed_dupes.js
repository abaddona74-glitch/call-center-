/**
 * Bugungi kun uchun "MISSED" jurnalidagi dublikatlarni tozalaydi.
 *
 * Muammo: navbat bir mijozni operatorga qayta-qayta jiringlatib qo'ysa (retry),
 * 3CX Desktop Agent har jiringlashni alohida "MISSED" deb yuborishi mumkin edi.
 * Shu skript bitta operator + bitta mijoz raqami uchun 90 soniya ichida kelgan
 * "MISSED" klasterlarining faqat BIRINCHISINI qoldirib, qolganlarini o'chiradi.
 *
 * Faqat BUGUNGI kun uchun ishlaydi — eski tarixga tegmaydi.
 * Ishga tushirish: node scripts/cleanup_missed_dupes.js
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'data', 'callcenter.db');
const db = new DatabaseSync(dbPath);

const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
const startDay = `${todayStr} 00:00:00`;
const endDay = `${todayStr} 23:59:59`;

const rows = db.prepare(`
    SELECT id, operator_id, caller_id, event_time
    FROM agent_3cx_call_logs
    WHERE event_type = 'MISSED' AND event_time >= ? AND event_time <= ?
    ORDER BY operator_id, caller_id, event_time ASC
`).all(startDay, endDay);

const toDelete = [];
let lastKey = null;
let lastTime = null;

for (const r of rows) {
    const key = `${r.operator_id}|${r.caller_id}`;
    const t = new Date(r.event_time.replace(' ', 'T')).getTime();

    if (key === lastKey && lastTime !== null && (t - lastTime) <= 90 * 1000) {
        // Oldingi (saqlanadigan) yozuvdan 90 soniya ichida — dublikat
        toDelete.push(r.id);
    } else {
        // Yangi klaster boshlanishi — bu yozuv saqlanadi
        lastKey = key;
        lastTime = t;
    }
}

if (toDelete.length === 0) {
    console.log(`✅ Bugun (${todayStr}) uchun dublikat "MISSED" yozuv topilmadi.`);
    process.exit(0);
}

console.log(`Topildi: ${toDelete.length} ta dublikat "MISSED" yozuv (bugun, ${todayStr}).`);

// Operator bo'yicha nechta o'chirilishini ko'rsatish
const byOp = {};
for (const r of rows) {
    if (toDelete.includes(r.id)) {
        byOp[r.operator_id] = (byOp[r.operator_id] || 0) + 1;
    }
}
console.log('Operator bo\'yicha:', byOp);

db.exec('BEGIN TRANSACTION');
const del = db.prepare('DELETE FROM agent_3cx_call_logs WHERE id = ?');
let deleted = 0;
for (const id of toDelete) {
    del.run(id);
    deleted++;
}
db.exec('COMMIT');

console.log(`✅ ${deleted} ta dublikat yozuv o'chirildi.`);
