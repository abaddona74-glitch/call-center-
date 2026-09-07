const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');

const SERVER_HOST = '192.168.0.2';
const SERVER_PORT = 22;
const SERVER_USER = 'root';
const SERVER_PASS = 'ZAQ!2wsx123';
const REMOTE_DIR  = '/opt/call-center';

const projectRoot = path.resolve(__dirname, '..');
const scratchDir  = __dirname;
const archivePath = path.join(scratchDir, 'deploy_payload.tar.gz');

console.log('🚀 [1/5] Creating deployment payload archive...');

// Ensure previous archive deleted
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

// Create tarball containing only backend code (exclude 3cx-desktop-agent, node_modules, .git)
// Using tar command on Windows
const tarCmd = `tar -czf "${archivePath}" ` +
    `-C "${projectRoot}" ` +
    `--exclude="node_modules" ` +
    `--exclude="3cx-desktop-agent" ` +
    `--exclude=".git" ` +
    `--exclude=".agents" ` +
    `--exclude="*.log" ` +
    `--exclude="scratch" ` +
    `app.js config.js swaggerSpec.js package.json package-lock.json .env services public data`;

try {
    execSync(tarCmd, { stdio: 'inherit' });
    const stat = fs.statSync(archivePath);
    console.log(`📦 Payload archive created: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
} catch (e) {
    console.error('Failed to create tar archive:', e.message);
    process.exit(1);
}

async function runDeploy() {
    console.log(`📡 [2/5] Connecting to ${SERVER_HOST} via SFTP...`);
    const sftp = new SftpClient();
    await sftp.connect({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: SERVER_USER,
        password: SERVER_PASS,
        readyTimeout: 15000
    });

    console.log(`📂 Ensuring remote directory ${REMOTE_DIR} exists...`);
    const exists = await sftp.exists(REMOTE_DIR);
    if (!exists) {
        await sftp.mkdir(REMOTE_DIR, true);
    }

    const remoteArchive = '/tmp/deploy_payload.tar.gz';
    console.log(`⬆️ Uploading archive to ${remoteArchive}...`);
    await sftp.fastPut(archivePath, remoteArchive);
    console.log('✅ Archive uploaded successfully!');
    await sftp.end();

    console.log('⚙️ [3/5] Extracting and setting up on server via SSH...');
    const conn = new Client();
    await new Promise((resolve, reject) => {
        conn.on('ready', () => {
            const remoteCommands = [
                `mkdir -p ${REMOTE_DIR}`,
                `tar -xzf ${remoteArchive} -C ${REMOTE_DIR}`,
                `rm -f ${remoteArchive}`,
                `cd ${REMOTE_DIR} && npm install --omit=dev`,
                `cd ${REMOTE_DIR} && pm2 delete call-center 2>/dev/null || true`,
                `cd ${REMOTE_DIR} && pm2 start app.js --name "call-center" --time`,
                `pm2 save`,
                `pm2 startup systemd -u root --hp /root 2>/dev/null || true`
            ].join(' && ');

            console.log('Executing remote commands...');
            conn.exec(remoteCommands, (err, stream) => {
                if (err) return reject(err);
                stream.on('close', (code) => {
                    conn.end();
                    if (code === 0) {
                        console.log('✅ Remote setup & PM2 start completed with code 0!');
                        resolve();
                    } else {
                        reject(new Error(`Remote setup failed with exit code ${code}`));
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

    console.log('🔍 [4/5] Verifying production service health on 192.168.0.2:3000...');
    // Give PM2 3 seconds to start
    await new Promise(r => setTimeout(r, 3000));

    const checkConn = new Client();
    await new Promise((resolve, reject) => {
        checkConn.on('ready', () => {
            checkConn.exec('pm2 status call-center; curl -s -I http://localhost:3000 | head -n 5', (err, stream) => {
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

    console.log('\n🎉 [5/5] DEPLOYMENT COMPLETE!');
    console.log(`🌐 Production URL: http://${SERVER_HOST}:3000`);
}

runDeploy().catch(err => {
    console.error('❌ Deployment error:', err.message);
    process.exit(1);
});
