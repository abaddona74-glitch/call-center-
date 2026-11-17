const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
conn.on('ready', () => {
    conn.exec("grep -n 'panelChoiceModal' /opt/call-center/public/login.html", (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('data', d => out += d);
        stream.on('close', () => {
            console.log('REMOTE FOUND:\n' + out);
            conn.end();
        });
    });
}).connect({
    host: process.env.DEPLOY_HOST,
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER,
    password: process.env.DEPLOY_PASS
});
