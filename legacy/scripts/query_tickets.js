const { Client } = require('ssh2');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const conn = new Client();
conn.on('ready', () => {
    const cleanPayload = JSON.stringify({ lastCleanedMonday: '2026-11-09', updatedAt: Date.now(), total: 0, tickets: [] }, null, 2);
    conn.exec(`echo '${cleanPayload}' > /opt/call-center-viewer/data/tickets.json`, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
            conn.end();
            console.log('tickets.json successfully cleaned up');
        });
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});
