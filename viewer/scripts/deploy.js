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
const REMOTE_DIR  = '/opt/call-center-viewer';

const projectRoot = path.resolve(__dirname, '..');
const tempDir     = path.join(projectRoot, '..', 'scratch');
const archivePath = path.join(tempDir, 'viewer_payload.tar.gz');

if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

console.log('====================================================');
console.log(`🚀 CALL CENTER VIEWER (3005) — PRODUCTION DEPLOYMENT`);
console.log(`🎯 Server: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PORT}`);
console.log(`📂 Remote Path: ${REMOTE_DIR}`);
console.log('====================================================\n');

// 1. Pack files
console.log('📦 [1/4] Viewer fayllari arxivlanmoqda...');
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

const tarCmd = `tar -czf "${archivePath}" ` +
    `-C "${projectRoot}" ` +
    `--exclude="node_modules" ` +
    `--exclude="*.log" ` +
    `app.js config.js package.json .env services public`;

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

    const remoteArchive = '/tmp/viewer_payload.tar.gz';
    await sftp.fastPut(archivePath, remoteArchive);
    console.log('✅ Fayllar serverga yuklandi!\n');
    await sftp.end();

    // 3. Extract, install dependencies, start PM2
    console.log('⚙️ [3/4] Serverda fayllar ochilmoqda va PM2 da 3005-portda ishga tushirilmoqda...');
    const conn = new Client();
    await new Promise((resolve, reject) => {
        conn.on('ready', () => {
            const remoteCommands = [
                `mkdir -p ${REMOTE_DIR}`,
                `rm -f ${REMOTE_DIR}/public/js/dashboard.js`,
                `tar -xzf ${remoteArchive} -C ${REMOTE_DIR}`,
                `rm -f ${remoteArchive}`,
                `cd ${REMOTE_DIR} && npm install --omit=dev`,
                `cd ${REMOTE_DIR} && (pm2 reload call-center-viewer --force || pm2 restart call-center-viewer --update-env || pm2 start app.js --name "call-center-viewer" --time)`,
                `pm2 save`
            ].join(' && ');

            conn.exec(remoteCommands, (err, stream) => {
                if (err) return reject(err);
                stream.on('close', (code) => {
                    conn.end();
                    if (code === 0) {
                        console.log('✅ Serverda call-center-viewer PM2 xizmati ishga tushdi!\n');
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

    // 4. Health Check on port 3005
    console.log('🔍 [4/4] Server holati tekshirilmoqda (Port 3005)...');
    await new Promise(r => setTimeout(r, 2000));

    const checkConn = new Client();
    await new Promise((resolve, reject) => {
        checkConn.on('ready', () => {
            checkConn.exec('curl -s -I http://localhost:3005 | head -n 3', (err, stream) => {
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
    console.log(`🎉 VIEWER DEPLOY MUVAFFAQIYATLI YAKUNLANDI! (${elapsed} soniya)`);
    console.log(`🌐 Jonli Cheklangan Manzil: http://${SERVER_HOST}:3005`);
    console.log(`👥 Operatorlar:             http://${SERVER_HOST}:3005/operators`);
    console.log('====================================================');
}

deploy().catch(err => {
    console.error('\n❌ Deploy jarayonida xatolik yuz berdi:', err.message);
    process.exit(1);
});
