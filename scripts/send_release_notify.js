const telegramService = require('../services/telegramService');

async function main() {
    const message = 
`🚀 <b>YANGI RELIZ: CALL CENTER V1.0.0 YANGILANISHI</b>

Hurmatli <b>Maxmudbek</b>, tizimga navbatdagi muhim yangilanishlar va optimizatsiyalar muvaffaqiyatli kiritildi:

📱 <b>Mobil operatorlar aniqlanishi (Telecom)</b>
• <b>Uzmobile (70) prefiksi qo'shildi:</b> Endi <code>+998 70 ...</code> prefiksi orqali kiruvchi barcha qo'ng'iroqlar tizimda avtomatik ravishda <b>Uzmobile</b> operatori sifatida aniqlanadi va maxsus brend rangi bilan ajratiladi.

🛠️ <b>Visual Inspector (Dizayn vositasi)</b>
• <b>Nusxa olish formati tozalandi:</b> Element inspeksiya qilinganda generatsiya qilinadigan prompt formati ixchamlashtirildi. Noaniq shablon buyruqlari o'rniga strukturali va toza <code>🎯 ELEMENT MA'LUMOTLARI</code> bloki o'rnatildi.

⚡ <b>Yuqori tezlikdagi test tizimi (QA)</b>
• <b>Rustwright Smoke Test Suite integratsiyasi:</b> Playwright testlari qatoriga Rustwright dvijogi asosidagi ultra-tezkor test qo'shildi (<code>npm run test:smoke</code>). Brauzerni ishga tushirish va DOM arxitekturasini soniyaning ulushlarida tekshirish imkoniyati yaratildi.


ℹ️ <i>Barcha o'zgarishlar sinovdan o'tkazildi va ishlab chiqarish muhitiga tayyorlandi.</i>`;

    console.log('Sending message to subscribers...');
    const subscribers = telegramService.subscribers;
    console.log('Target subscribers:', JSON.stringify(subscribers, null, 2));

    for (const sub of subscribers) {
        console.log(`Sending to ${sub.chatId} (${sub.firstName})...`);
        const result = await telegramService.sendMessage(sub.chatId, message);
        console.log('Telegram API result:', JSON.stringify(result, null, 2));
        if (result && result.ok) {
            console.log(`SUCCESS: Message delivered to ${sub.chatId}!`);
        } else {
            console.error(`FAILED: Could not deliver to ${sub.chatId}`);
            process.exitCode = 1;
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
