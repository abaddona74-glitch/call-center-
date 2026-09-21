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
        this.memoryStore.set(key, valStr);
        if (this.isConnected && this.client) {
            try {
                if (ttlSeconds > 0) {
                    await this.client.setex(key, ttlSeconds, valStr);
                } else {
                    await this.client.set(key, valStr);
                }
            } catch (e) {
                // Ignore redis error, use memory store
            }
        }
    }

    async get(key) {
        if (this.isConnected && this.client) {
            try {
                const data = await this.client.get(key);
                if (data) {
                    try { return JSON.parse(data); } catch (e) { return data; }
                }
            } catch (e) {
                // fallback to memoryStore
            }
        }
        const mem = this.memoryStore.get(key);
        if (mem) {
            try { return JSON.parse(mem); } catch (e) { return mem; }
        }
        return null;
    }
}

module.exports = new RedisService();
