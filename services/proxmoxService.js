const { exec } = require('child_process');
const { Client } = require('ssh2');

class ProxmoxService {
    constructor() {
        this.sshConfig = {
            host: process.env.PROXMOX_HOST || '192.168.0.2',
            port: parseInt(process.env.PROXMOX_PORT || '22', 10),
            username: process.env.PROXMOX_USER || 'root',
            password: process.env.PROXMOX_PASSWORD || 'ZAQ!2wsx123',
            readyTimeout: 10000
        };

        this.vms = [
            { id: 200, name: 'Kerio Control', desc: 'Tarmoq / Firewall / Gateway' },
            { id: 101, name: 'Issabel PBX', desc: 'Asterisk Telefon Stansiyasi' }
        ];
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
     * VM lar holatini olish (qm status 200, qm status 101)
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
     * 4. qm start 200 (Kerio)
     * 5. qm start 101 (Issabel)
     */
    async recoverAndStartAll() {
        const logs = [];
        logs.push(`[${new Date().toLocaleTimeString()}] ⚡ Proxmox LVM tiklash va VMlarni ishga tushirish jarayoni boshlandi...`);

        const recoveryCmd = [
            'echo "[1/5] LVM data_tdata faolsizlantirilmoqda..."',
            'lvchange -an pve/data_tdata 2>&1 || true',
            'echo "[2/5] LVM data_tmeta faolsizlantirilmoqda..."',
            'lvchange -an pve/data_tmeta 2>&1 || true',
            'echo "[3/5] LVM pve/data faollashtirilmoqda..."',
            'lvchange -ay pve/data 2>&1',
            'echo "[4/5] VM 200 (Kerio Control) ishga tushirilmoqda..."',
            'qm start 200 2>&1 || true',
            'sleep 2',
            'echo "[5/5] VM 101 (Issabel PBX) ishga tushirilmoqda..."',
            'qm start 101 2>&1 || true'
        ].join(' && ');

        try {
            const res = await this.runCommand(recoveryCmd);
            logs.push(res.stdout);
            if (res.stderr && res.stderr.trim()) {
                logs.push(`Ogohlantirish/Stderr: ${res.stderr.trim()}`);
            }

            const currentStatus = await this.getVmsStatus();
            logs.push(`[${new Date().toLocaleTimeString()}] ✅ Jarayon yakunlandi.`);

            return {
                success: true,
                output: logs.join('\n'),
                vms: currentStatus
            };
        } catch (err) {
            logs.push(`[${new Date().toLocaleTimeString()}] ❌ Xatolik: ${err.message}`);
            return {
                success: false,
                output: logs.join('\n'),
                error: err.message
            };
        }
    }

    /**
     * Alohida bitta VMni yoqish
     */
    async startVm(vmid) {
        const validIds = [200, 101];
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
        const validIds = [200, 101];
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
