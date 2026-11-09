const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');

const SERVER_HOST = process.env.DEPLOY_HOST || '192.168.0.2';
const SERVER_PORT = parseInt(process.env.DEPLOY_PORT || '22', 10);
const SERVER_USER = process.env.DEPLOY_USER || 'root';
const SERVER_PASS = process.env.DEPLOY_PASS || 'ZAQ!2wsx123';
const REMOTE_DIR  = '/opt/call-center';

const projectRoot = path.resolve(__dirname, '..');
const diffFilePath = path.join(projectRoot, 'scratch', 'server_diff.json');

if (!fs.existsSync(diffFilePath)) {
    console.error('❌ server_diff.json topilmadi! Avval scratch/compare_server.js ni ishga tushiring.');
    process.exit(1);
}

const diffData = JSON.parse(fs.readFileSync(diffFilePath, 'utf8'));
const filesToPull = [];

// Yangi fayllardan vaqtincha/keraksiz fayllarni filtrlaymiz
const skipPatterns = [
    /\.bak_/,
    /\.tmp$/,
    /test_touch/,
    /\.well-known/,
    /\.pyc$/,
    /\.db/
];

function shouldPull(relPath) {
    for (const pat of skipPatterns) {
        if (pat.test(relPath)) return false;
    }
    return true;
}

for (const item of diffData.newOnRemote) {
    if (shouldPull(item.relPath)) {
        filesToPull.push(item.relPath);
    }
}

for (const item of diffData.changed) {
    if (shouldPull(item.relPath)) {
        // .env ni lokal tomonda buzib qo'ymaslik uchun agar kerak bo'lsa zaxiralab olamiz
        filesToPull.push(item.relPath);
    }
}

console.log('====================================================');
console.log('📥 PRODUCTION SERVERDAN O\'ZGARISHLARNI PULL QILISH');
console.log(`🎯 Server: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PORT}`);
console.log(`📂 Remote Path: ${REMOTE_DIR}`);
console.log(`📦 Jami yuklab olinadigan fayllar: ${filesToPull.length} ta`);
console.log('====================================================\n');

async function pullFiles() {
    const sftp = new SftpClient();
    try {
        await sftp.connect({
            host: SERVER_HOST,
            port: SERVER_PORT,
            username: SERVER_USER,
            password: SERVER_PASS
        });
        console.log('✅ SFTP ga ulandi.\n');

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < filesToPull.length; i++) {
            const rel = filesToPull[i];
            const remoteFile = path.posix.join(REMOTE_DIR, rel.split('\\').join('/'));
            const localFile  = path.join(projectRoot, rel.split('/').join(path.sep));
            const localDir   = path.dirname(localFile);

            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }

            try {
                // Agar .env bo'lsa avval lokal zaxirasini olamiz
                if (rel === '.env' && fs.existsSync(localFile)) {
                    fs.copyFileSync(localFile, localFile + '.local_bak');
                }

                await sftp.fastGet(remoteFile, localFile);
                console.log(`[${i + 1}/${filesToPull.length}] ✅ Yuklandi: ${rel}`);
                successCount++;
            } catch (err) {
                console.error(`[${i + 1}/${filesToPull.length}] ❌ Xatolik (${rel}): ${err.message}`);
                failCount++;
            }
        }

        console.log('\n====================================================');
        console.log(`🎉 PULL YAKUNLANDI!`);
        console.log(`Muvaffaqiyatli: ${successCount} ta`);
        console.log(`Xatolik: ${failCount} ta`);
        console.log('====================================================');

    } catch (err) {
        console.error('SFTP Ulanish xatosi:', err);
    } finally {
        await sftp.end();
    }
}

pullFiles();
