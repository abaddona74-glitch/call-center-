const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
    conn.exec('sqlite3 /opt/call-center/data/callcenter.db "SELECT id, username, role, operator_id FROM auth_users;"', (err, stream) => {
        let d = '';
        stream.on('data', c => d += c);
        stream.on('close', () => {
            console.log(d);
            conn.end();
        });
    });
}).connect({ host: '213.230.110.9', port: 22, username: 'root', password: process.env.SSH_PASSWORD || '' });
