const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
conn.on('ready', () => {
    console.log('Installing pillow-heif on production server...');
    conn.exec('pip install pillow-heif', (err, stream) => {
        stream.on('data', d => console.log(d.toString().trim()));
        stream.stderr.on('data', d => console.error(d.toString().trim()));
        stream.on('close', () => {
            conn.exec("python3 -c \"import pillow_heif; print('pillow_heif installed:', pillow_heif.__version__)\"", (e2, s2) => {
                s2.on('data', d => console.log(d.toString().trim()));
                s2.stderr.on('data', d => console.error(d.toString().trim()));
                s2.on('close', () => conn.end());
            });
        });
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});

