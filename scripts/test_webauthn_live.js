const { Client } = require('ssh2');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const conn = new Client();
conn.on('ready', () => {
    const cmd = `
        echo "=== Testing :3535 (Dashboard) ==="
        curl -sk -X POST https://127.0.0.1:3535/api/auth/webauthn/login-options -H "Content-Type: application/json" -H "Host: uniconsoft.ddns.net"
        echo ""
        echo "=== Testing :3005 (Viewer Proxy) ==="
        curl -sk -X POST https://127.0.0.1:3005/api/auth/webauthn/login-options -H "Content-Type: application/json" -H "Host: uniconsoft.ddns.net"
        echo ""
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
