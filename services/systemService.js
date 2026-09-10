const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

let lastCpuMeasure = null;

function getCpuUsagePromise() {
    return new Promise((resolve) => {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }

        const current = { totalIdle, totalTick };

        if (!lastCpuMeasure) {
            lastCpuMeasure = current;
            // Dastlabki qiymat: 1 daqiqalik loadavg ga qarab yoki taxminiy
            const load = os.loadavg()[0];
            const percent = Math.min(100, Math.round((load / cpus.length) * 100));
            return resolve(percent > 0 ? percent : 5);
        }

        const idleDiff = current.totalIdle - lastCpuMeasure.totalIdle;
        const totalDiff = current.totalTick - lastCpuMeasure.totalTick;
        lastCpuMeasure = current;

        if (totalDiff <= 0) return resolve(0);
        const usage = Math.round(100 - (100 * idleDiff / totalDiff));
        resolve(Math.max(0, Math.min(100, usage)));
    });
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatSeconds(sec) {
    if (!sec || isNaN(sec)) return '0s';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

class SystemService {
    async getSystemMetrics() {
        const cpus = os.cpus();
        const cpuUsage = await getCpuUsagePromise();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memPercent = Math.round((usedMem / totalMem) * 100);

        const procMem = process.memoryUsage();

        // Disk ma'lumotlari (Node.js statfs orqali)
        let diskInfo = null;
        try {
            const stat = await fs.promises.statfs(process.cwd());
            const totalDisk = stat.bsize * stat.blocks;
            const freeDisk = stat.bsize * stat.bavail;
            const usedDisk = totalDisk - freeDisk;
            const diskPercent = Math.round((usedDisk / totalDisk) * 100);

            diskInfo = {
                mountPath: process.cwd(),
                totalBytes: totalDisk,
                freeBytes: freeDisk,
                usedBytes: usedDisk,
                totalFormatted: formatBytes(totalDisk),
                freeFormatted: formatBytes(freeDisk),
                usedFormatted: formatBytes(usedDisk),
                usedPercent: diskPercent
            };
        } catch (e) {
            diskInfo = {
                mountPath: process.cwd(),
                error: e.message
            };
        }

        // PM2 Holati
        const isPm2 = Boolean(process.env.pm_id !== undefined || process.env.PM2_HOME);
        const pm2Data = {
            isManagedByPm2: isPm2,
            pmId: process.env.pm_id !== undefined ? parseInt(process.env.pm_id, 10) : null,
            name: process.env.name || 'call-center',
            mode: process.env.exec_mode || (isPm2 ? 'cluster' : 'direct/dev'),
            restarts: process.env.restart_time ? parseInt(process.env.restart_time, 10) : 0,
            status: 'online'
        };

        const amiService = require('./amiService');
        const sftpService = require('./sftpService');
        const redisService = require('./redisService');

        return {
            timestamp: new Date().toISOString(),
            services: {
                ami: {
                    name: 'Asterisk AMI (PBX)',
                    connected: Boolean(amiService && amiService.isConnected),
                    status: amiService && amiService.isConnected ? 'ONLINE' : 'OFFLINE'
                },
                sftp: {
                    name: 'Asterisk SFTP (Audio)',
                    connected: Boolean(sftpService && sftpService.isConnected),
                    status: sftpService && sftpService.isConnected ? 'ONLINE' : 'OFFLINE'
                },
                redis: {
                    name: 'Redis Cache',
                    connected: Boolean(redisService && redisService.isConnected),
                    status: redisService && redisService.isConnected ? 'ONLINE' : 'OFFLINE'
                }
            },
            os: {
                platform: process.platform,
                type: os.type(),
                release: os.release(),
                hostname: os.hostname(),
                arch: os.arch(),
                uptimeSec: Math.floor(os.uptime()),
                uptimeFormatted: formatSeconds(os.uptime()),
                cpu: {
                    model: cpus[0]?.model || 'Noma\'lum protsessor',
                    cores: cpus.length,
                    speedMHz: cpus[0]?.speed || 0,
                    usagePercent: cpuUsage,
                    loadAvg: os.loadavg().map(l => parseFloat(l.toFixed(2)))
                },
                memory: {
                    totalBytes: totalMem,
                    freeBytes: freeMem,
                    usedBytes: usedMem,
                    usedPercent: memPercent,
                    totalFormatted: formatBytes(totalMem),
                    freeFormatted: formatBytes(freeMem),
                    usedFormatted: formatBytes(usedMem)
                }
            },
            process: {
                pid: process.pid,
                title: process.title || 'node',
                nodeVersion: process.version,
                uptimeSec: Math.floor(process.uptime()),
                uptimeFormatted: formatSeconds(process.uptime()),
                memory: {
                    rss: procMem.rss,
                    rssFormatted: formatBytes(procMem.rss),
                    heapTotal: procMem.heapTotal,
                    heapTotalFormatted: formatBytes(procMem.heapTotal),
                    heapUsed: procMem.heapUsed,
                    heapUsedFormatted: formatBytes(procMem.heapUsed),
                    heapPercent: Math.round((procMem.heapUsed / procMem.heapTotal) * 100)
                }
            },
            pm2: pm2Data,
            disk: diskInfo
        };
    }
}

module.exports = new SystemService();
