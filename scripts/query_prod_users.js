const { Client } = require('ssh2');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const conn = new Client();
conn.on('ready', () => {
    console.log('SSH connection ready. Querying production auth_users...');
    conn.exec("cd /opt/call-center && node -e \"const dbService = require('./services/dbService'); console.log(JSON.stringify(dbService.db.prepare('SELECT id, username, role, operator_id FROM auth_users').all(), null, 2));\"", (err, stream) => {
        if (err) throw err;
        let output = '';
        let errorOutput = '';
        stream.on('data', data => output += data.toString());
        stream.stderr.on('data', data => errorOutput += data.toString());
        stream.on('close', () => {
            console.log('Production Users:\n', output);
            if (errorOutput) console.log('Stderr:\n', errorOutput);
            conn.end();
        });
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});
