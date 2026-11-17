const { Client } = require('ssh2');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const conn = new Client();
conn.on('ready', () => {
    const cmd = `
        node -e "
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
            const { DatabaseSync } = require('node:sqlite');
            const db = new DatabaseSync('/opt/call-center/data/callcenter.db');
            const sess = db.prepare('SELECT token, username FROM auth_sessions ORDER BY created_at DESC LIMIT 1').get();
            console.log('Latest session:', sess);
            if (sess) {
                fetch('https://127.0.0.1:3005/api/auth/webauthn/passkeys/list', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + sess.token
                    }
                }).then(async r => {
                    console.log('Status 3005:', r.status);
                    console.log('Body 3005:', await r.text());
                }).catch(e => console.error('Fetch error:', e));
            }
        "
        sleep 2
    `;
    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('data', d => out += d);
        stream.on('close', () => {
            console.log(out);
            conn.end();
        });
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});
