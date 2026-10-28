const { exec } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

class ProxmoxService {
    constructor() {
        this.sshConfig = {
            host: process.env.PROXMOX_HOST || '192.168.0.2',
            port: parseInt(process.env.PROXMOX_PORT || '22', 10),
            username: process.env.PROXMOX_USER || 'root',
            password: process.env.PROXMOX_PASSWORD || 'ZAQ!2wsx123',
            readyTimeout: 10000
        };

        // Proxmox dagi haqiqiy VM lar: 101 - Kerio Control, 200 - Issabel PBX
        this.vms = [
            { id: 101, name: 'Kerio Control', desc: 'Tarmoq / Firewall / Gateway' },
            { id: 200, name: 'Issabel PBX', desc: 'Asterisk Telefon Stansiyasi' }
        ];

        this.settingsFile = path.resolve(__dirname, '../system_settings.json');
        this.autoRecoverEnabled = this.loadAutoRecoverSetting();
        this.lastRecovery = this.loadRecoveryHistory();
        this.isRecovering = false;
        this.lastRecoverAttempt = 0;
        this.lastRecoverOutput = this.lastRecovery?.output || null;
        this.eventCallback = null;

        // Auto-recovery foni monitoring
        this.initAutoRecoverMonitor();
    }

    setEventCallback(cb) {
        this.eventCallback = cb;
    }

    emitEvent(status, data) {
        if (typeof this.eventCallback === 'function') {
            try {
                this.eventCallback({ status, data });
            } catch (e) {
                console.error('ProxmoxService event callback xatosi:', e.message);
            }
        }
    }

    loadRecoveryHistory() {
        try {
            if (fs.existsSync(this.settingsFile)) {
                const raw = fs.readFileSync(this.settingsFile, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed.lastRecovery && typeof parsed.lastRecovery === 'object') {
                    return parsed.lastRecovery;
                }
            }
        } catch (e) {
            console.error('ProxmoxService recovery history o\'qishda xatolik:', e.message);
        }
        return {
            startTime: null,
            endTime: null,
            durationSec: null,
            status: 'idle',
            trigger: 'auto',
            stoppedVms: [],
            output: "Hozircha tiklash jurnali mavjud emas. Avto-tiklash rejimi yoqilgan.",
            error: null
        };
    }

    saveRecoveryHistory(rec) {
        try {
            let data = {};
            if (fs.existsSync(this.settingsFile)) {
                try {
                    data = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
                } catch (e) {}
            }
            data.lastRecovery = rec;
            data.updatedAt = new Date().toISOString();
            fs.writeFileSync(this.settingsFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('ProxmoxService recovery saqlashda xatolik:', e.message);
        }
    }

    loadAutoRecoverSetting() {
        try {
            if (fs.existsSync(this.settingsFile)) {
                const raw = fs.readFileSync(this.settingsFile, 'utf8');
                const parsed = JSON.parse(raw);
                if (typeof parsed.autoRecoverVms === 'boolean') {
                    return parsed.autoRecoverVms;
                }
            }
        } catch (e) {
            console.error('ProxmoxService settings o\'qishda xatolik:', e.message);
        }
        return false; // Standart: o'chiq
    }

    saveAutoRecoverSetting(enabled) {
        try {
            let data = {};
            if (fs.existsSync(this.settingsFile)) {
                try {
                    data = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
                } catch (e) {}
            }
            data.autoRecoverVms = Boolean(enabled);
            data.updatedAt = new Date().toISOString();
            fs.writeFileSync(this.settingsFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('ProxmoxService settings saqlashda xatolik:', e.message);
        }
    }

    getAutoRecoverStatus() {
        return {
            enabled: Boolean(this.autoRecoverEnabled),
            isRecovering: Boolean(this.isRecovering),
            lastAttempt: this.lastRecoverAttempt ? new Date(this.lastRecoverAttempt).toISOString() : (this.lastRecovery?.startTime || null),
            lastOutput: this.lastRecovery?.output || this.lastRecoverOutput,
            lastRecovery: this.lastRecovery
        };
    }

    setAutoRecover(enabled) {
        this.autoRecoverEnabled = Boolean(enabled);
        this.saveAutoRecoverSetting(this.autoRecoverEnabled);
        console.log(`[Proxmox Auto-Recover] ${this.autoRecoverEnabled ? '🟢 Yoqildi' : '⚪ O\'chirildi'}`);
        return this.getAutoRecoverStatus();
    }

    initAutoRecoverMonitor() {
        // 1. Server ishga tushganda (masalan, svet o'chib yonganda) 15 soniyadan so'ng 1-tekshiruv
        setTimeout(() => {
            if (this.autoRecoverEnabled) {
                console.log('[Proxmox Auto-Recover] 🚀 Server start: VMlar holati tekshirilmoqda...');
                this.checkAndAutoRecover();
            }
        }, 15000);

        // 2. Har 30 soniyada foniy tekshiruv
        setInterval(() => {
            if (this.autoRecoverEnabled) {
                this.checkAndAutoRecover();
            }
        }, 30000);
    }

    async checkAndAutoRecover() {
        if (!this.autoRecoverEnabled) return;
        if (this.isRecovering) return;

        // Kamida 60 soniya cooldown (qayta-qayta zanjirli tiklashni oldini olish)
        const now = Date.now();
        if (now - this.lastRecoverAttempt < 60000) return;

        try {
            const vms = await this.getVmsStatus();
            const stoppedVms = vms.filter(v => v.status === 'stopped' || v.status === 'paused');

            if (stoppedVms.length > 0) {
                const vmNames = stoppedVms.map(v => `${v.name} (${v.id})`);
                console.log(`[Proxmox Auto-Recover] ⚠️ To'xtab qolgan VMlar aniqlandi: ${vmNames.join(', ')}`);
                console.log('[Proxmox Auto-Recover] ⚡ Avtomatik LVM Fix + VMlarni ishga tushirish boshlanmoqda...');
                
                const result = await this.recoverAndStartAll('auto', vmNames);
                console.log('[Proxmox Auto-Recover] ✅ Natija:', result.success ? 'Muvaffaqiyatli tiklandi' : result.error);
            }
        } catch (err) {
            console.error('[Proxmox Auto-Recover] Tekshiruvda xatolik:', err.message);
        }
    }

    /**
     * Proxmox buyruqlarini bajarish:
     * - Agar serverning o'zida (Linux / Proxmox hostida) ishlayotgan bo'lsa: to'g'ridan-to'g'ri local exec
     * - Agar dev muhitida (Windows) bo'lsa: SSH orqali 192.168.0.2 da bajarish
     */
    async runCommand(cmd) {
        // Agar Linux va qm buyrug'i mavjud bo'lsa, local bajaramiz
        if (process.platform === 'linux') {
            return new Promise((resolve, reject) => {
                exec(cmd, { timeout: 45000 }, (err, stdout, stderr) => {
                    if (err) {
                        // Agar local qm xato bersa, SSH orqali sinab ko'ramiz
                        this.runSshCommand(cmd).then(resolve).catch(reject);
                        return;
                    }
                    resolve({ stdout: stdout || '', stderr: stderr || '', code: 0 });
                });
            });
        }

        // Windows yoki boshqa muhitda SSH orqali
        return this.runSshCommand(cmd);
    }

    runSshCommand(cmd) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            let stdout = '';
            let stderr = '';

            conn.on('ready', () => {
                conn.exec(cmd, (err, stream) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    stream.on('data', (d) => { stdout += d.toString(); });
                    stream.stderr.on('data', (d) => { stderr += d.toString(); });
                    stream.on('close', (code) => {
                        conn.end();
                        resolve({ stdout, stderr, code });
                    });
                });
            });

            conn.on('error', (err) => {
                reject(new Error(`Proxmox SSH ulanish xatosi: ${err.message}`));
            });

            conn.connect(this.sshConfig);
        });
    }

    /**
     * VM lar holatini olish (qm status 101, qm status 200)
     */
    async getVmsStatus() {
        try {
            const results = {};
            const cmd = this.vms.map(vm => `echo "===VM_${vm.id}==="; qm status ${vm.id} 2>&1 || true`).join('; ');
            const res = await this.runCommand(cmd);

            const parts = res.stdout.split('===VM_');
            for (const p of parts) {
                if (!p.trim()) continue;
                const lines = p.split('\n');
                const vmid = parseInt(lines[0].replace('===', '').trim(), 10);
                const body = lines.slice(1).join('\n').trim();

                let status = 'unknown';
                if (body.includes('status: running')) {
                    status = 'running';
                } else if (body.includes('status: stopped')) {
                    status = 'stopped';
                } else if (body.includes('status: paused')) {
                    status = 'paused';
                } else if (body.includes('does not exist') || body.includes('Configuration file') || body.includes('not found')) {
                    status = 'not_found';
                }

                results[vmid] = {
                    status,
                    raw: body
                };
            }

            return this.vms.map(vm => ({
                id: vm.id,
                name: vm.name,
                desc: vm.desc,
                status: results[vm.id]?.status || 'unknown'
            }));
        } catch (err) {
            console.error('❌ Proxmox getVmsStatus xatolik:', err.message);
            return this.vms.map(vm => ({
                id: vm.id,
                name: vm.name,
                desc: vm.desc,
                status: 'unknown',
                error: err.message
            }));
        }
    }

    /**
     * Svet o'chib yonganda LVM Fix + VMlarni yoqish
     * Buyruqlar ketma-ketligi:
     * 1. lvchange -an pve/data_tdata
     * 2. lvchange -an pve/data_tmeta
     * 3. lvchange -ay pve/data
     * 4. qm start 101 (Kerio Control)
     * 5. qm start 200 (Issabel PBX)
     */
    async recoverAndStartAll(trigger = 'manual', targetVms = []) {
        const startTime = new Date().toISOString();
        this.isRecovering = true;
        this.lastRecoverAttempt = Date.now();

        const triggerLabel = trigger === 'auto' ? 'Avtomatik (Svet kelganda)' : 'Qo\'lda (Tugma orqali)';
        const logs = [];
        logs.push(`[${new Date().toLocaleTimeString()}] ⚡ Proxmox LVM tiklash va VMlarni ishga tushirish (${triggerLabel}) boshlandi...`);

        this.lastRecovery = {
            startTime,
            endTime: null,
            durationSec: null,
            status: 'running',
            trigger,
            stoppedVms: targetVms,
            output: logs.join('\n'),
            error: null
        };
        this.saveRecoveryHistory(this.lastRecovery);
        this.emitEvent('started', this.lastRecovery);

        const recoveryCmd = [
            'echo "[1/5] LVM data_tdata faolsizlantirilmoqda..."',
            'lvchange -an pve/data_tdata 2>&1 || true',
            'echo "[2/5] LVM data_tmeta faolsizlantirilmoqda..."',
            'lvchange -an pve/data_tmeta 2>&1 || true',
            'echo "[3/5] LVM pve/data faollashtirilmoqda..."',
            'lvchange -ay pve/data 2>&1',
            'echo "[4/5] VM 101 (Kerio Control) ishga tushirilmoqda..."',
            'qm start 101 2>&1 || true',
            'sleep 2',
            'echo "[5/5] VM 200 (Issabel PBX) ishga tushirilmoqda..."',
            'qm start 200 2>&1 || true'
        ].join(' && ');

        try {
            const res = await this.runCommand(recoveryCmd);
            logs.push(res.stdout);
            if (res.stderr && res.stderr.trim()) {
                logs.push(`Ogohlantirish/Stderr: ${res.stderr.trim()}`);
            }

            const currentStatus = await this.getVmsStatus();
            logs.push(`[${new Date().toLocaleTimeString()}] ✅ Jarayon muvaffaqiyatli yakunlandi.`);

            const endTime = new Date().toISOString();
            const durationSec = Math.round((Date.now() - new Date(startTime).getTime()) / 1000);

            this.lastRecovery = {
                startTime,
                endTime,
                durationSec,
                status: 'success',
                trigger,
                stoppedVms: targetVms,
                output: logs.join('\n'),
                error: null,
                vms: currentStatus
            };
            this.lastRecoverOutput = this.lastRecovery.output;
            this.saveRecoveryHistory(this.lastRecovery);
            this.emitEvent('success', this.lastRecovery);

            return {
                success: true,
                output: logs.join('\n'),
                vms: currentStatus,
                lastRecovery: this.lastRecovery
            };
        } catch (err) {
            logs.push(`[${new Date().toLocaleTimeString()}] ❌ Xatolik: ${err.message}`);
            const endTime = new Date().toISOString();
            const durationSec = Math.round((Date.now() - new Date(startTime).getTime()) / 1000);

            this.lastRecovery = {
                startTime,
                endTime,
                durationSec,
                status: 'failed',
                trigger,
                stoppedVms: targetVms,
                output: logs.join('\n'),
                error: err.message
            };
            this.lastRecoverOutput = this.lastRecovery.output;
            this.saveRecoveryHistory(this.lastRecovery);
            this.emitEvent('failed', this.lastRecovery);

            return {
                success: false,
                output: logs.join('\n'),
                error: err.message,
                lastRecovery: this.lastRecovery
            };
        } finally {
            this.isRecovering = false;
        }
    }

    /**
     * Alohida bitta VMni yoqish
     */
    async startVm(vmid) {
        const validIds = [101, 200];
        const id = parseInt(vmid, 10);
        if (!validIds.includes(id)) {
            throw new Error(`Ruxsat berilmagan VM ID: ${vmid}`);
        }

        const cmd = `qm start ${id} 2>&1`;
        const res = await this.runCommand(cmd);
        const statuses = await this.getVmsStatus();
        return {
            success: true,
            output: res.stdout || 'VM ishga tushirildi',
            vms: statuses
        };
    }

    /**
     * Alohida bitta VMni to'xtatish (shutdown)
     */
    async stopVm(vmid) {
        const validIds = [101, 200];
        const id = parseInt(vmid, 10);
        if (!validIds.includes(id)) {
            throw new Error(`Ruxsat berilmagan VM ID: ${vmid}`);
        }

        const cmd = `qm shutdown ${id} 2>&1`;
        const res = await this.runCommand(cmd);
        const statuses = await this.getVmsStatus();
        return {
            success: true,
            output: res.stdout || 'VM to\'xtatilmoqda',
            vms: statuses
        };
    }
}

module.exports = new ProxmoxService();
