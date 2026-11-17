const Redis = require('ioredis');
require('dotenv').config();

class RedisService {
    constructor() {
        this.host = process.env.REDIS_HOST || '127.0.0.1';
        this.port = parseInt(process.env.REDIS_PORT || '6379', 10);
        this.password = process.env.REDIS_PASSWORD || undefined;
        this.isConnected = false;
        this.memoryStore = new Map();

        try {
            this.client = new Redis({
                host: this.host,
                port: this.port,
                password: this.password,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 1000, 5000);
                    return delay;
                },
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
                lazyConnect: true
            });

            this.client.connect().then(() => {
                this.isConnected = true;
                console.log(`✅ Redis serverga muvaffaqiyatli ulandi! (${this.host}:${this.port})`);
            }).catch(err => {
                this.isConnected = false;
                console.log(`ℹ️ Redis server ulanmadi (${err.message}). In-Memory tezkor keshdan foydalanilmoqda.`);
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                this.isConnected = true;
                console.log('✅ Redis ga ulandi!');
            });
        } catch (e) {
            this.isConnected = false;
        }
    }

    async set(key, value, ttlSeconds = 60) {
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        if (this.isConnected && this.client) {
            try {
                if (ttlSeconds > 0) {
                    await this.client.setex(key, ttlSeconds, valStr);
                } else {
                    await this.client.set(key, valStr);
                }
                return; // Redis ga muvaffaqiyatli saqlandi, Node RAM Map da saqlash shart emas
            } catch (e) {
                // Redis xatosi bo'lsa fallback xotiraga o'tadi
            }
        }

        // Fallback: Faqat Redis ishlamayotgan bo'lsa memoryStore ga yoziladi
        // Xotira to'lib ketmasligi uchun max 300 ta element bilan cheklangan
        if (this.memoryStore.size >= 300) {
            const oldestKey = this.memoryStore.keys().next().value;
            this.memoryStore.delete(oldestKey);
        }
        this.memoryStore.set(key, {
            val: valStr,
            exp: ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : 0
        });
    }

    async get(key) {
        if (this.isConnected && this.client) {
            try {
                const data = await this.client.get(key);
                if (data) {
                    try { return JSON.parse(data); } catch (e) { return data; }
                }
                return null;
            } catch (e) {
                // fallback to memoryStore
            }
        }
        const item = this.memoryStore.get(key);
        if (item) {
            if (item.exp && item.exp > 0 && item.exp < Date.now()) {
                this.memoryStore.delete(key);
                return null;
            }
            const raw = (typeof item === 'object' && item.val !== undefined) ? item.val : item;
            try { return JSON.parse(raw); } catch (e) { return raw; }
        }
        return null;
    }

    async del(key) {
        this.memoryStore.delete(key);
        if (this.isConnected && this.client) {
            try {
                await this.client.del(key);
            } catch (e) {}
        }
    }
}

module.exports = new RedisService();
