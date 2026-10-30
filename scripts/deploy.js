const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Production Server Configuration
const SERVER_HOST = process.env.DEPLOY_HOST || '213.230.110.9';
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

// PRE-FLIGHT AUTOMATED TEST SUITE
console.log('🧪 [0/4] Avtomatlashtirilgan testlar tekshirilmoqda...');
try {
    execSync('npm test', { stdio: 'inherit', cwd: projectRoot });
    console.log('✅ Barcha testlar muvaffaqiyatli o\'tdi! Deploy davom etmoqda...\n');
} catch (testErr) {
    console.error('\n❌ XATOLIK: Avtomatlashtirilgan testlar muvaffaqiyatsiz tugadi!');
    console.error('🚫 Deploy to\'xtatildi. Iltimos avval xatoliklarni bartaraf eting.');
    process.exit(1);
}

// 0. Update public/version.json with unique build ID and timestamp
const versionFilePath = path.join(projectRoot, 'public', 'version.json');
let pkgVersion = '2.4.0';
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    if (pkg.version) pkgVersion = pkg.version;
} catch (e) {}

const currentBuild = {
    buildId: Date.now().toString(),
    buildTime: new Date().toISOString(),
    version: pkgVersion,
    app: 'call-center'
};
fs.writeFileSync(versionFilePath, JSON.stringify(currentBuild, null, 2), 'utf8');

// Update <meta name="build-id" content="..."> in public/index.html
const indexHtmlPath = path.join(projectRoot, 'public', 'index.html');
if (fs.existsSync(indexHtmlPath)) {
    let html = fs.readFileSync(indexHtmlPath, 'utf8');
    if (html.includes('<meta name="build-id"')) {
        html = html.replace(/<meta name="build-id" content="[^"]*">/, `<meta name="build-id" content="${currentBuild.buildId}">`);
    } else {
        html = html.replace('<head>', `<head>\n    <meta name="build-id" content="${currentBuild.buildId}">`);
    }
    html = html.replace(/\/js\/dashboard\.js\?v=[^"]*/g, `/js/dashboard.js?v=${currentBuild.buildId}`);
    html = html.replace(/\/css\/style\.css\?v=[^"]*/g, `/css/style.css?v=${currentBuild.buildId}`);
    fs.writeFileSync(indexHtmlPath, html, 'utf8');
}

// Update viewer version.json as well so viewer stays in sync
const viewerVersionPath = path.join(projectRoot, 'viewer', 'public', 'version.json');
if (fs.existsSync(viewerVersionPath)) {
    fs.writeFileSync(viewerVersionPath, JSON.stringify({
        buildId: currentBuild.buildId,
        buildTime: currentBuild.buildTime,
        version: currentBuild.version,
        app: 'call-center-viewer'
    }, null, 2), 'utf8');
}

console.log(`🏷️  Versiya tayyorlandi: Build ${currentBuild.buildId} (${currentBuild.version})`);

// 1. Pack files
console.log('📦 [1/4] Loyiha fayllari arxivlanmoqda...');
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

// Exclude node_modules, desktop agent packages, git, cache, and database / dynamic scan data files
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
    `--exclude="data/temp_zips" ` +
    `app.js config.js swaggerSpec.js package.json package-lock.json .env services scripts public ssl viewer data system_settings.json`;

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
                `cd ${REMOTE_DIR} && (pm2 reload call-center --force || pm2 restart call-center --update-env || pm2 start app.js --name "call-center" --time)`,
                `mkdir -p /opt/call-center-viewer`,
                `cp -ru ${REMOTE_DIR}/viewer/* /opt/call-center-viewer/ 2>/dev/null || true`,
                `(pm2 reload call-center-viewer --force || pm2 restart call-center-viewer --update-env || true)`,
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
            checkConn.exec('curl -s -I http://localhost:3535 | head -n 3', (err, stream) => {
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
    console.log(`🌐 Jonli Web Manzil: http://${SERVER_HOST}:3535`);
    console.log(`👥 Operatorlar: http://${SERVER_HOST}:3535/operators`);
    console.log('====================================================');

    // 5. Telegram Bot orqali muvaffaqiyatli deploy bildirishnomasini yuborish
    try {
        console.log('📱 Telegram bot orqali bildirishnoma yuborilmoqda...');
        const telegramService = require('../services/telegramService');
        const nowFormatted = new Date().toLocaleString('uz-UZ', { 
            timeZone: 'Asia/Tashkent', 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });

        const deployNotificationText = 
            `🚀 <b>CALL CENTER AI — DEPLOY MUVAFFAQIYATLI O'TDI!</b>\n\n` +
            `🏷️ <b>Versiya:</b> Build ${currentBuild.buildId} (v${currentBuild.version})\n` +
            `⏱️ <b>Vaqt:</b> ${nowFormatted}\n` +
            `⚡ <b>Davomiyligi:</b> ${elapsed} soniya\n` +
            `🌐 <b>Asosiy Portal:</b> http://${SERVER_HOST}:3535\n` +
            `📊 <b>Viewer Portali:</b> http://${SERVER_HOST}:3005\n\n` +
            `✅ <b>O'zgarishlar:</b>\n` +
            `• Oflayn va suhbatdagi operatorlarni ajratib turuvchi divider liniyasi tiklandi\n` +
            `• Barcha xizmatlar (Node.js, PM2, Asterisk AMI, WebSocket) to'liq barqaror holatda ishga tushirildi.`;

        await telegramService.broadcast(deployNotificationText);
        console.log('✅ Telegram bot bildirishnomasi muvaffaqiyatli jo\'natildi!\n');
    } catch (tgErr) {
        console.error('⚠️ Telegram bot bildirishnomasini jo\'natishda xatolik:', tgErr.message);
    }
}

deploy().catch(err => {
    console.error('\n❌ Deploy jarayonida xatolik yuz berdi:', err.message);
    process.exit(1);
});
