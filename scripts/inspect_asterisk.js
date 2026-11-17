const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('cat /opt/call-center/data/active_channels_state.json; echo "--- PM2 LOGS ---"; pm2 logs call-center --lines 40 --nostream', (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('data', d => out += d);
        stream.on('close', () => {
            console.log(out);
            conn.end();
        });
    });
}).connect({
    host: '213.230.110.9',
    port: 22,
    username: 'root',
    password: process.env.SSH_PASSWORD || ''
});
