const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
conn.on('ready', () => {
    console.log('Testing remote python converter...');
    // Create dummy text file and convert to PDF, and test fitz import
    const cmd = `python3 -c "
import fitz
import pillow_heif
print('fitz and pillow_heif ready!')
"`;
    conn.exec(cmd, (err, stream) => {
        stream.on('data', d => console.log('STDOUT:', d.toString().trim()));
        stream.stderr.on('data', d => console.error('STDERR:', d.toString().trim()));
        stream.on('close', () => conn.end());
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});

