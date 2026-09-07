const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');

// Production Server Configuration
const SERVER_HOST = process.env.DEPLOY_HOST || '192.168.0.2';
const SERVER_PORT = parseInt(process.env.DEPLOY_PORT || '22', 10);
const SERVER_USER = process.env.DEPLOY_USER || 'root';
const SERVER_PASS = process.env.DEPLOY_PASS || 'ZAQ!2wsx123';
const REMOTE_DIR  = '/opt/call-center';

const projectRoot = path.resolve(__dirname, '..');
const tempDir     = path.join(projectRoot, 'scratch');
const archivePath = path.join(tempDir, 'deploy_payload.tar.gz');

if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

console.log('====================================================');
console.log(`🚀 CALL CENTER AI — 1-CLICK PRODUCTION DEPLOYMENT`);
console.log(`🎯 Server: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PORT}`);
console.log(`📂 Remote Path: ${REMOTE_DIR}`);
console.log('====================================================\n');

// 1. Pack files
console.log('📦 [1/4] Loyiha fayllari arxivlanmoqda...');
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

// Exclude node_modules, desktop agent packages, git, cache, and database files
const tarCmd = `tar -czf "${archivePath}" ` +
    `-C "${projectRoot}" ` +
    `--exclude="node_modules" ` +
    `--exclude="3cx-desktop-agent" ` +
    `--exclude=".git" ` +
    `--exclude=".agents" ` +
    `--exclude="*.log" ` +
    `--exclude="scratch" ` +
    `--exclude="data/*.db" ` +
    `--exclude="data/*.db-*" ` +
    `app.js config.js swaggerSpec.js package.json package-lock.json .env services public`;

try {
    execSync(tarCmd, { stdio: 'inherit' });
    const stat = fs.statSync(archivePath);
    console.log(`✅ Arxiv tayyor: ${(stat.size / 1024 / 1024).toFixed(2)} MB\n`);
} catch (e) {
    console.error('❌ Arxivlashda xatolik:', e.message);
    process.exit(1);
}

async function deploy() {
    const startTime = Date.now();

    // 2. Upload via SFTP
    console.log(`📡 [2/4] Serverga SFTP orqali yuklanmoqda (${SERVER_HOST})...`);
    const sftp = new SftpClient();
    await sftp.connect({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: SERVER_USER,
        password: SERVER_PASS,
        readyTimeout: 20000
    });

    const remoteArchive = '/tmp/deploy_payload.tar.gz';
    await sftp.fastPut(archivePath, remoteArchive);
    console.log('✅ Fayllar serverga muvaffaqiyatli yuklandi!\n');
    await sftp.end();

    // 3. Extract, install dependencies, reload PM2
    console.log('⚙️ [3/4] Serverda fayllar yangilanmoqda va PM2 qayta yuklanmoqda...');
    const conn = new Client();
    await new Promise((resolve, reject) => {
        conn.on('ready', () => {
            const remoteCommands = [
                `mkdir -p ${REMOTE_DIR}/data`,
                `tar -xzf ${remoteArchive} -C ${REMOTE_DIR}`,
                `rm -f ${remoteArchive}`,
                `cd ${REMOTE_DIR} && npm install --omit=dev`,
                `cd ${REMOTE_DIR} && (pm2 reload call-center || pm2 start app.js --name "call-center" --time)`,
                `pm2 save`
            ].join(' && ');

            conn.exec(remoteCommands, (err, stream) => {
                if (err) return reject(err);
                stream.on('close', (code) => {
                    conn.end();
                    if (code === 0) {
                        console.log('✅ Serverda kod yangilandi va PM2 xizmati yangi kod bilan ishga tushdi!\n');
                        resolve();
                    } else {
                        reject(new Error(`Serverdagi buyruqlar ${code} kodi bilan yakunlandi`));
                    }
                }).on('data', d => process.stdout.write(d))
                  .stderr.on('data', d => process.stderr.write(d));
            });
        }).on('error', reject).connect({
            host: SERVER_HOST,
            port: SERVER_PORT,
            username: SERVER_USER,
            password: SERVER_PASS
        });
    });

    // 4. Health Check
    console.log('🔍 [4/4] Server holati tekshirilmoqda...');
    await new Promise(r => setTimeout(r, 2000));

    const checkConn = new Client();
    await new Promise((resolve, reject) => {
        checkConn.on('ready', () => {
            checkConn.exec('curl -s -I http://localhost:3000 | head -n 3', (err, stream) => {
                if (err) return reject(err);
                stream.on('close', () => {
                    checkConn.end();
                    resolve();
                }).on('data', d => process.stdout.write(d))
                  .stderr.on('data', d => process.stderr.write(d));
            });
        }).on('error', reject).connect({
            host: SERVER_HOST,
            port: SERVER_PORT,
            username: SERVER_USER,
            password: SERVER_PASS
        });
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('====================================================');
    console.log(`🎉 DEPLOY MUVAFFAQIYATLI YAKUNLANDI! (${elapsed} soniya)`);
    console.log(`🌐 Jonli Web Manzil: http://${SERVER_HOST}:3000`);
    console.log(`👥 Operatorlar: http://${SERVER_HOST}:3000/operators`);
    console.log('====================================================');
}

deploy().catch(err => {
    console.error('\n❌ Deploy jarayonida xatolik yuz berdi:', err.message);
    process.exit(1);
});
