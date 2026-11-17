import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Maxsus metrikalar
const rateLimitedCount = new Counter('rate_limited_429');
const successfulRequests = new Counter('successful_200');
const errorRate = new Rate('errors');
const responseTimeTrend = new Trend('custom_req_duration');

export const options = {
    // 3 bosqichli yuklama testi (Ramp-up, Sustained, Ramp-down)
    stages: [
        { duration: '30s', target: 50 },   // 1-bosqich: 30 soniya ichida 50 ta foydalanuvchiga chiqish
        { duration: '1m',  target: 200 },  // 2-bosqich: 1 daqiqa davomida 200 tagacha ko'tarish va ushlab turish
        { duration: '30s', target: 0 },    // 3-bosqich: 30 soniyada 0 tagacha pasayish (Cool-down)
    ],

    // Muvaffaqiyat mezonlari (SLA / Thresholds)
    thresholds: {
        http_req_duration: ['p(95)<1000'], // So'rovlarning 95% i 1 soniyadan tez bo'lishi kerak
        errors: ['rate<0.15'],             // Xatoliklar ulushi 15% dan kam bo'lishi kerak
    },
};

const BASE_URL = 'https://uniconsoft.ddns.net';

export default function () {
    const params = {
        headers: {
            'User-Agent': 'k6-load-test-runner/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: '10s',
    };

    // 1. Asosiy sahifani chaqirish (GET /)
    const res = http.get(`${BASE_URL}/`, params);

    // Status kodini tekshirish
    const isOk = check(res, {
        'status is 200': (r) => r.status === 200,
        'status is 429 (Rate Limited)': (r) => r.status === 429,
    });

    if (res.status === 200) {
        successfulRequests.add(1);
        errorRate.add(0);
    } else if (res.status === 429) {
        // Rate limit ishlaganini hisoblaymiz
        rateLimitedCount.add(1);
        errorRate.add(0); // Rate limit to'g'ri ishlashi tizim himoyasi sanaladi
    } else {
        errorRate.add(1);
    }

    responseTimeTrend.add(res.timings.duration);

    // Haqiqiy foydalanuvchi xatti-harakati uchun qisqa oraliq (0.5 - 1.5s)
    sleep(1);
}

