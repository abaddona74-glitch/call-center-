const { Client } = require('ssh2');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const conn = new Client();
conn.on('ready', () => {
    conn.exec("pm2 reload 1", (err, stream) => {
        if (err) throw err;
        stream.on('data', d => console.log(d.toString()));
        stream.on('close', () => {
            conn.end();
            process.exit(0);
        });
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});
