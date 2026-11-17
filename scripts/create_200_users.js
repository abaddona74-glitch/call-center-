const { Client } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const HOST = process.env.DEPLOY_HOST || '213.230.110.9';
const PORT = parseInt(process.env.DEPLOY_PORT || '22', 10);
const USER = process.env.DEPLOY_USER || 'root';
const PASS = process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || '';

async function main() {
    console.log(`Connecting to ${USER}@${HOST}:${PORT} to upload and run create_200.js...`);
    const sftp = new SftpClient();
    await sftp.connect({ host: HOST, port: PORT, username: USER, password: PASS });
    const localScript = path.join(__dirname, 'create_200.js');
    const remoteScript = '/opt/call-center/scripts/create_200.js';
    await sftp.put(localScript, remoteScript);
    console.log('Uploaded create_200.js to production server.');
    await sftp.end();

    const conn = new Client();
    conn.on('ready', () => {
        conn.exec('node /opt/call-center/scripts/create_200.js', (err, stream) => {
            if (err) throw err;
            let output = '';
            let errOutput = '';
            stream.on('data', data => output += data.toString());
            stream.stderr.on('data', data => errOutput += data.toString());
            stream.on('close', code => {
                console.log('Production Output:\n', output);
                if (errOutput) console.log('Production Stderr:\n', errOutput);
                console.log('Exit code:', code);
                conn.end();
            });
        });
    }).connect({ host: HOST, port: PORT, username: USER, password: PASS });
}

main().catch(console.error);

